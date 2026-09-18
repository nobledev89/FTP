import type { SupabaseClient } from "@supabase/supabase-js";

import type { ArtifactStore } from "../db/artifact-store.js";
import type { Database, Json } from "../db/database.types.js";
import { WorkerDatabaseError, unwrapResult } from "../db/worker-store.js";

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
  cacheRevalidated: boolean | null;
}>;

export class PublishingService {
  constructor(
    private readonly client: SupabaseClient<Database>,
    private readonly store: ArtifactStore,
    private readonly revalidator?: Readonly<{
      revalidate(slug: string): Promise<Readonly<{ ok: boolean }>>;
    }>,
  ) {}

  /**
   * Copies approved images to public storage and publishes the article.
   *
   * The public path is derived from the slug and the image's own content hash, so re-running a
   * publish attempt overwrites the same object rather than accumulating copies, and
   * `publish_article` treats a repeated path as a no-op.
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
      const fileName = image.privatePath.split("/").pop() ?? `slot-${image.slot}`;
      const publicPath = `articles/${input.slug}/${fileName}`;

      const download = await this.client.storage.from(WORK_BUCKET).download(image.privatePath);
      if (download.error || !download.data) {
        throw new WorkerDatabaseError(
          "download working image",
          undefined,
          download.error?.message ?? "no data",
          { cause: download.error },
        );
      }
      const bytes = new Uint8Array(await download.data.arrayBuffer());

      const upload = await this.client.storage.from(PUBLIC_BUCKET).upload(publicPath, bytes, {
        contentType: image.mimeType,
        upsert: true,
        cacheControl: "31536000",
      });
      if (upload.error) {
        throw new WorkerDatabaseError("upload public image", undefined, upload.error.message, {
          cause: upload.error,
        });
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

    const revalidation = this.revalidator ? await this.revalidator.revalidate(row.slug) : null;

    return {
      articleId: row.article_id,
      slug: row.slug,
      canonicalUrl: row.canonical_url,
      publishedAt: row.published_at,
      imagesPublished: published.length,
      cacheRevalidated: revalidation?.ok ?? null,
    };
  }
}
