import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../db/database.types.js";
import { unwrapResult, WorkerDatabaseError } from "../db/worker-store.js";
import type { StructuredLogger } from "../logging/logger.js";
import { drawGeminiImage, type GeminiSettings } from "../providers/api/gemini.js";
import type { ApiHttpRuntime } from "../providers/api/http.js";
import { imageDimensions, type SupportedImageMime } from "../providers/api/image-metadata.js";
import { codexImagePrompt } from "../providers/cli/codex-images.js";
import type { CodexCli } from "../providers/cli/codex.js";
import { renderTemplate } from "../providers/contract.js";
import { publicImagePath } from "../publishing/publish.js";
import type { RevalidationResult } from "../publishing/revalidate.js";

/**
 * Hero image replacement for an article that is already published.
 *
 * This is a lane of its own, like topic discovery: it never claims a job and never moves one
 * through the state machine, because the article's words are not being re-decided — only its
 * picture. The database owns the editorial state (requested, drawn, reviewed, applied); this
 * service does the two things only the worker can do. It draws a candidate with the same provider
 * that drew the original, and it copies approved bytes into the public bucket, which no browser
 * role is permitted to write.
 *
 * A failure here is recorded on the replacement row and never thrown into the job queue. The
 * editor sees it in the console and can ask again.
 */

const WORK_BUCKET = "article-work";
const PUBLIC_BUCKET = "article-public";
const MAX_IMAGE_BYTES = 10_485_760;

const EXTENSIONS: Readonly<Record<SupportedImageMime, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** Slot 0 of a draft's image briefs, read back for a second attempt at the same picture. */
const heroBriefSchema = z.object({
  slot: z.number(),
  purpose: z.string().nullish(),
  prompt: z.string(),
  altText: z.string(),
  aspectRatio: z.string(),
});

export type HeroReplacementWork = "draw" | "apply";

export type HeroReplacementClaim = Readonly<{
  replacementId: string;
  work: HeroReplacementWork;
  jobId: string;
  articleId: string;
  slug: string;
  mode: "regenerate" | "upload";
  direction: string | null;
  imageId: string | null;
  imagePrivatePath: string | null;
  imageMimeType: string | null;
  imagesMode: string;
  siteId: string;
}>;

/** Slot 0's brief from the approved draft, plus what the image template needs around it. */
export type HeroBrief = Readonly<{
  title: string;
  articleType: string;
  purpose: string;
  prompt: string;
  altText: string;
  aspectRatio: string;
}>;

export type HeroDrawingContext = Readonly<{
  brief: HeroBrief;
  template: string | null;
  styleGuide: string | null;
}>;

export type DrawnCandidate = Readonly<{
  bytes: Uint8Array;
  mimeType: SupportedImageMime;
  width: number;
  height: number;
  contentHash: string;
}>;

export interface HeroReplacementStore {
  claim(workerId: string): Promise<HeroReplacementClaim | null>;
  drawingContext(claim: HeroReplacementClaim): Promise<HeroDrawingContext>;
  saveCandidate(
    claim: HeroReplacementClaim,
    drawn: DrawnCandidate,
    brief: HeroBrief,
    prompt: string,
  ): Promise<void>;
  applyCandidate(claim: HeroReplacementClaim): Promise<Readonly<{ publicPath: string }>>;
  fail(claim: HeroReplacementClaim, error: string, retry: boolean): Promise<void>;
}

export type HeroReplacementOutcome =
  | Readonly<{ state: "idle" }>
  | Readonly<{ state: "drawn"; replacementId: string }>
  | Readonly<{ state: "applied"; replacementId: string; slug: string; publicPath: string }>
  | Readonly<{ state: "failed"; replacementId: string; error: string }>;

/**
 * The editor's steer is appended rather than merged into the brief, so the brief the article was
 * published with stays legible next to it and a second attempt can say something different.
 */
export function heroReplacementPrompt(
  context: HeroDrawingContext,
  direction: string | null,
): string {
  const { brief, template, styleGuide } = context;
  const base = template
    ? renderTemplate(template, {
        styleGuide: styleGuide ?? "",
        title: brief.title,
        articleType: brief.articleType,
        slot: "0",
        role: "hero",
        aspectRatio: brief.aspectRatio,
        purpose: brief.purpose,
        altText: brief.altText,
        prompt: brief.prompt,
        schemaVersion: "image-1",
      })
    : `Generate the hero image for ${brief.title}: ${brief.prompt}`;

  const steer = direction?.trim();
  if (!steer) return base;
  return (
    `${base.trim()}\n\n` +
    "## Extra direction for this attempt\n\n" +
    "The first version of this image was turned down. Keep the house style exactly as described " +
    `above and take this steer on the picture itself:\n\n${steer}`
  );
}

export class HeroReplacementService {
  constructor(
    private readonly store: HeroReplacementStore,
    private readonly workerId: string,
    private readonly drawers: Readonly<{
      gemini?: Readonly<{ settings: GeminiSettings; runtime: ApiHttpRuntime }>;
      codex?: Pick<CodexCli, "generateImage" | "label">;
    }>,
    private readonly logger?: StructuredLogger,
  ) {}

  /** One unit of work per call, so a queue of replacements never starves the job queue. */
  async runNext(signal: AbortSignal): Promise<HeroReplacementOutcome> {
    const claim = await this.store.claim(this.workerId);
    if (!claim) return { state: "idle" };

    const log = this.logger?.child({
      replacement_id: claim.replacementId,
      job_id: claim.jobId,
      slug: claim.slug,
      work: claim.work,
    });
    log?.info("hero_replacement.claimed", { mode: claim.mode, images_mode: claim.imagesMode });

    try {
      return claim.work === "draw" ? await this.draw(claim, signal) : await this.apply(claim);
    } catch (error) {
      const summary = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      // A cancelled shutdown is not the replacement's fault; hand it back for the next run.
      const retry = signal.aborted;
      await this.store.fail(claim, summary, retry);
      log?.warn("hero_replacement.failed", { error, retry });
      if (signal.aborted) throw error;
      return { state: "failed", replacementId: claim.replacementId, error: summary };
    }
  }

  private async draw(
    claim: HeroReplacementClaim,
    signal: AbortSignal,
  ): Promise<HeroReplacementOutcome> {
    const context = await this.store.drawingContext(claim);
    const prompt = heroReplacementPrompt(context, claim.direction);
    const drawn = await this.drawWith(claim.imagesMode, prompt, context.brief.aspectRatio, signal);

    if (drawn.bytes.byteLength === 0 || drawn.bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new Error("the generated image was empty or larger than the 10 MiB artifact limit");
    }

    await this.store.saveCandidate(claim, drawn, context.brief, prompt);
    this.logger?.info("hero_replacement.drawn", {
      replacement_id: claim.replacementId,
      bytes: drawn.bytes.byteLength,
    });
    return { state: "drawn", replacementId: claim.replacementId };
  }

  private async drawWith(
    imagesMode: string,
    prompt: string,
    aspectRatio: string,
    signal: AbortSignal,
  ): Promise<DrawnCandidate> {
    if (imagesMode === "gemini_api") {
      if (!this.drawers.gemini) {
        throw new Error("this worker has no Gemini credentials configured");
      }
      const drawn = await drawGeminiImage(
        this.drawers.gemini.settings,
        this.drawers.gemini.runtime,
        { prompt, aspectRatio, signal },
      );
      return {
        bytes: drawn.bytes,
        mimeType: drawn.mimeType,
        width: drawn.width,
        height: drawn.height,
        contentHash: drawn.contentHash,
      };
    }

    if (imagesMode === "codex_image") {
      if (!this.drawers.codex) throw new Error("this worker has no Codex CLI configured");
      const generated = await this.drawers.codex.generateImage({
        prompt: codexImagePrompt(prompt, aspectRatio),
        signal,
      });
      const bytes = generated.bytes;
      const mimeType = generated.mimeType as SupportedImageMime;
      if (!(mimeType in EXTENSIONS)) {
        throw new Error(`Codex returned an unsupported image type (${generated.mimeType})`);
      }
      return {
        bytes,
        mimeType,
        ...imageDimensions(bytes, mimeType),
        contentHash: createHash("sha256").update(bytes).digest("hex"),
      };
    }

    // manual_gemini and mock cannot draw unattended. Upload mode is the route for those.
    throw new Error(
      `the images stage is set to ${imagesMode}, which cannot draw on its own; ` +
        "request a replacement in upload mode instead",
    );
  }

  private async apply(claim: HeroReplacementClaim): Promise<HeroReplacementOutcome> {
    const { publicPath } = await this.store.applyCandidate(claim);
    this.logger?.info("hero_replacement.applied", {
      replacement_id: claim.replacementId,
      slug: claim.slug,
      public_path: publicPath,
    });
    return { state: "applied", replacementId: claim.replacementId, slug: claim.slug, publicPath };
  }
}

export class SupabaseHeroReplacementStore implements HeroReplacementStore {
  constructor(
    private readonly client: SupabaseClient<Database>,
    private readonly workerId: string,
    private readonly revalidator?: Readonly<{
      revalidate(slug: string): Promise<RevalidationResult>;
    }>,
    private readonly logger?: StructuredLogger,
  ) {}

  async claim(workerId: string): Promise<HeroReplacementClaim | null> {
    const rows = unwrapResult(
      await this.client.rpc("worker_claim_hero_replacement", { p_worker_id: workerId }),
      "worker_claim_hero_replacement",
    );
    const row = rows[0];
    if (!row) return null;
    return {
      replacementId: row.replacement_id,
      work: row.work === "apply" ? "apply" : "draw",
      jobId: row.job_id,
      articleId: row.article_id,
      slug: row.slug,
      mode: row.mode,
      direction: row.direction,
      imageId: row.image_id,
      imagePrivatePath: row.image_private_path,
      imageMimeType: row.image_mime_type,
      imagesMode: row.images_mode,
      siteId: row.site_id,
    };
  }

  async drawingContext(claim: HeroReplacementClaim): Promise<HeroDrawingContext> {
    const job = unwrapResult(
      await this.client
        .from("article_jobs")
        .select("article_type, approved_draft_id")
        .eq("id", claim.jobId)
        .single(),
      "load job for hero replacement",
    );
    if (!job.approved_draft_id) {
      throw new WorkerDatabaseError(
        "load job for hero replacement",
        undefined,
        "the published job has no approved draft",
      );
    }

    const draft = unwrapResult(
      await this.client
        .from("drafts")
        .select("title, image_briefs")
        .eq("id", job.approved_draft_id)
        .single(),
      "load draft for hero replacement",
    );

    const briefs = z.array(z.unknown()).catch([]).parse(draft.image_briefs);
    const hero = briefs
      .map((entry) => heroBriefSchema.safeParse(entry))
      .find((parsed) => parsed.success && parsed.data.slot === 0)?.data;
    if (!hero) {
      throw new WorkerDatabaseError(
        "load draft for hero replacement",
        undefined,
        "the approved draft carries no usable hero image brief",
      );
    }

    const templates = unwrapResult(
      await this.client
        .from("prompt_templates")
        .select("key, content")
        .eq("site_id", claim.siteId)
        .eq("is_active", true)
        .in("key", ["image-brief", "editorial-style"]),
      "load prompt templates for hero replacement",
    );

    return {
      brief: {
        title: draft.title,
        articleType: job.article_type,
        purpose: hero.purpose ?? "",
        prompt: hero.prompt,
        altText: hero.altText,
        aspectRatio: hero.aspectRatio,
      },
      template: templates.find((row) => row.key === "image-brief")?.content ?? null,
      styleGuide: templates.find((row) => row.key === "editorial-style")?.content ?? null,
    };
  }

  async saveCandidate(
    claim: HeroReplacementClaim,
    drawn: DrawnCandidate,
    brief: HeroBrief,
    prompt: string,
  ): Promise<void> {
    const extension = EXTENSIONS[drawn.mimeType];
    const privatePath = `jobs/${claim.jobId}/replacement/${claim.replacementId}/hero-${randomUUID()}.${extension}`;

    const upload = await this.client.storage.from(WORK_BUCKET).upload(privatePath, drawn.bytes, {
      contentType: drawn.mimeType,
      upsert: true,
    });
    if (upload.error) {
      throw new WorkerDatabaseError("upload replacement image", undefined, upload.error.message, {
        cause: upload.error,
      });
    }

    unwrapResult(
      await this.client.rpc("worker_record_hero_candidate", {
        p_replacement_id: claim.replacementId,
        p_worker_id: this.workerId,
        p_metadata: {
          purpose: brief.purpose,
          prompt,
          altText: brief.altText,
          aspectRatio: brief.aspectRatio,
        },
        p_private_path: privatePath,
        p_mime_type: drawn.mimeType,
        p_byte_size: drawn.bytes.byteLength,
        p_content_hash: drawn.contentHash,
        p_width: drawn.width,
        p_height: drawn.height,
      }),
      "worker_record_hero_candidate",
    );
  }

  async applyCandidate(claim: HeroReplacementClaim): Promise<Readonly<{ publicPath: string }>> {
    if (!claim.imagePrivatePath || !claim.imageMimeType) {
      throw new WorkerDatabaseError(
        "apply hero replacement",
        undefined,
        "the approved replacement has no stored file",
      );
    }

    const publicPath = publicImagePath(claim.slug, claim.imagePrivatePath, 0);
    const download = await this.client.storage.from(WORK_BUCKET).download(claim.imagePrivatePath);
    if (download.error || !download.data) {
      throw new WorkerDatabaseError(
        "download replacement image",
        undefined,
        download.error?.message ?? "no data",
        { cause: download.error ?? undefined },
      );
    }
    const bytes = new Uint8Array(await download.data.arrayBuffer());

    const upload = await this.client.storage.from(PUBLIC_BUCKET).upload(publicPath, bytes, {
      contentType: claim.imageMimeType,
      upsert: true,
      cacheControl: "31536000",
    });
    if (upload.error) {
      throw new WorkerDatabaseError(
        "upload public replacement image",
        undefined,
        upload.error.message,
        { cause: upload.error },
      );
    }

    unwrapResult(
      await this.client.rpc("worker_apply_hero_replacement", {
        p_replacement_id: claim.replacementId,
        p_worker_id: this.workerId,
        p_public_path: publicPath,
      }),
      "worker_apply_hero_replacement",
    );

    // The page is already live, so a stale cache is the whole point of revalidating. A failure
    // here does not undo the swap; the next publish or the cache's own age will clear it.
    if (this.revalidator) {
      try {
        await this.revalidator.revalidate(claim.slug);
      } catch (error) {
        this.logger?.warn("hero_replacement.revalidation_failed", { error, slug: claim.slug });
      }
    }

    return { publicPath };
  }

  async fail(claim: HeroReplacementClaim, error: string, retry: boolean): Promise<void> {
    unwrapResult(
      await this.client.rpc("worker_fail_hero_replacement", {
        p_replacement_id: claim.replacementId,
        p_worker_id: this.workerId,
        p_error: error,
        p_retry: retry,
      }),
      "worker_fail_hero_replacement",
    );
  }
}
