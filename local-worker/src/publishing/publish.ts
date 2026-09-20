import type { SupabaseClient } from "@supabase/supabase-js";

import type { ArtifactStore } from "../db/artifact-store.js";
import type { Database, Json } from "../db/database.types.js";
import type { StructuredLogger } from "../logging/logger.js";
import { WorkerDatabaseError, unwrapResult } from "../db/worker-store.js";
import { WorkerStageError } from "../queue/retry.js";

import type { RevalidationResult } from "./revalidate.js";

/**
 * The publishing service (plan section 8.3, ADR 0003).
 *
 * This is the only code that calls `publish_article`, and `publish_article` is the only path to
 * `PUBLISHED`. No provider adapter can reach either. The service copies approved images into the
 * public bucket first, then hands their paths to the database function, which re-checks the
 * approved draft, the approving audit, the schedule, and the slug before it writes an article.
 */

const WORK_BUCKET = "article-work";
const PUBLIC_BUCKET = "article-public";

export type PublishResult = Readonly<{
  articleId: string;
  slug: string;
  canonicalUrl: string;
  publishedAt: string;
  imagesPublished: number;
  /** `null` when no revalidator is configured, so "not attempted" reads differently from "failed". */
  cacheRevalidated: boolean | null;
}>;

/**
 * Storage object keys are derived from data, so they are constrained rather than trusted. The slug
 * is already validated by the database; this keeps a surprising private file name from producing a
 * key that `publish_article` would reject or that a CDN would encode differently.
 */
export function publicImagePath(slug: string, privatePath: string, slot: number): string {
  const rawName = privatePath.split("/").pop() ?? "";
  const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/^[.-]+/, "");
  return `articles/${slug}/${safeName.length > 0 ? safeName : `slot-${slot}`}`;
}

export class PublishingService {
  constructor(
    private readonly client: SupabaseClient<Database>,
    private readonly store: ArtifactStore,
    private readonly revalidator?: Readonly<{
      revalidate(slug: string): Promise<RevalidationResult>;
    }>,
    private readonly logger?: StructuredLogger,
  ) {}

  /**
   * Copies approved images to public storage and publishes the article.
   *
   * The public path is derived from the slug and the image's own file name, so re-running a publish
   * attempt overwrites the same object rather than accumulating copies, and `publish_article`
   * treats a repeated path as a no-op. A copy that fails part-way therefore leaves the next attempt
   * with less to do and nothing to clean up.
   */
  async publish(
    input: Readonly<{
      jobId: string;
      workerId: string;
      leaseToken: string;
      slug: string;
    }>,
  ): Promise<PublishResult> {
    const images = await this.store.readyImages(input.jobId);
    const published: { image_id: string; public_path: string }[] = [];

    for (const image of images) {
      const publicPath = publicImagePath(input.slug, image.privatePath, image.slot);

      const download = await this.client.storage.from(WORK_BUCKET).download(image.privatePath);
      if (download.error || !download.data) {
        // Storage is a network dependency: a failed copy is a retryable stage failure, not a
        // reason to escalate an article that is otherwise ready to publish.
        throw new WorkerStageError(
          `could not download working image ${image.privatePath}: ${download.error?.message ?? "no data"}`,
          "transient",
          { cause: download.error ?? undefined },
        );
      }
      const bytes = new Uint8Array(await download.data.arrayBuffer());

      const upload = await this.client.storage.from(PUBLIC_BUCKET).upload(publicPath, bytes, {
        contentType: image.mimeType,
        upsert: true,
        cacheControl: "31536000",
      });
      if (upload.error) {
        throw new WorkerStageError(
          `could not upload public image ${publicPath}: ${upload.error.message}`,
          "transient",
          { cause: upload.error },
        );
      }

      published.push({ image_id: image.id, public_path: publicPath });
    }

    const rows = unwrapResult(
      await this.client.rpc("publish_article", {
        p_job_id: input.jobId,
        p_worker_id: input.workerId,
        p_lease_token: input.leaseToken,
        p_published_images: published as unknown as Json,
      }),
      "publish_article",
    );

    const row = rows[0];
    if (!row) {
      throw new WorkerDatabaseError("publish_article", undefined, "returned no article");
    }

    const revalidation = await this.revalidate(input.jobId, input.workerId, row.slug);

    return {
      articleId: row.article_id,
      slug: row.slug,
      canonicalUrl: row.canonical_url,
      publishedAt: row.published_at,
      imagesPublished: published.length,
      cacheRevalidated: revalidation,
    };
  }

  /**
   * Invalidates the public cache and records the attempt. The article is already published, so
   * neither a failed invalidation nor a failed log entry may throw: both are recorded and left for
   * live verification, which fetches the page a reader would receive.
   */
  private async revalidate(jobId: string, workerId: string, slug: string): Promise<boolean | null> {
    if (!this.revalidator) {
      await this.recordRevalidation(jobId, workerId, {
        outcome: "skipped",
        attempts: 1,
        summary: { slug, reason: "no revalidation endpoint configured" },
      });
      return null;
    }

    const result = await this.revalidator.revalidate(slug);
    await this.recordRevalidation(jobId, workerId, {
      outcome: result.ok ? "succeeded" : "failed",
      attempts: result.attempts,
      summary: { slug },
      ...(result.status !== null ? { httpStatus: result.status } : {}),
      durationMs: result.durationMs,
      ...(result.error ? { error: result.error } : {}),
    });
    if (!result.ok) {
      this.logger?.warn("publish.revalidation_failed", {
        job_id: jobId,
        slug,
        attempts: result.attempts,
        status: result.status,
        error: result.error,
      });
    }
    return result.ok;
  }

  private async recordRevalidation(
    jobId: string,
    workerId: string,
    entry: Readonly<{
      outcome: Database["public"]["Enums"]["log_outcome"];
      attempts: number;
      summary: Record<string, string>;
      httpStatus?: number;
      durationMs?: number;
      error?: string;
    }>,
  ): Promise<void> {
    const { error } = await this.client.rpc("record_revalidation", {
      p_job_id: jobId,
      p_worker_id: workerId,
      p_outcome: entry.outcome,
      p_attempts: entry.attempts,
      ...(entry.httpStatus === undefined ? {} : { p_http_status: entry.httpStatus }),
      ...(entry.durationMs === undefined ? {} : { p_duration_ms: entry.durationMs }),
      p_request_summary: entry.summary as unknown as Json,
      ...(entry.error === undefined ? {} : { p_error: entry.error }),
    });
    if (error) {
      this.logger?.warn("publish.revalidation_log_failed", {
        job_id: jobId,
        message: error.message,
      });
    }
  }
}
