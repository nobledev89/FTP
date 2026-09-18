import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "../db/database.types.js";
import { WorkerDatabaseError, unwrapResult } from "../db/worker-store.js";

import { evaluatePage, allChecksPassed, type VerificationCheck } from "./checks.js";

/**
 * Live verification (plan section 14).
 *
 * The worker fetches the published page over HTTP exactly as a reader would and records what it
 * found. It never marks an article verified itself: `record_verification` decides, and on failure
 * it schedules the next attempt or raises a human action once the attempts are exhausted.
 */

export type VerificationOutcome = Readonly<{
  status: Database["public"]["Enums"]["job_status"];
  checks: readonly VerificationCheck[];
  passed: boolean;
  url: string;
}>;

export class VerificationService {
  constructor(
    private readonly client: SupabaseClient<Database>,
    private readonly options: Readonly<{
      /** Where the public site is actually served. In production this is the canonical origin. */
      publicSiteUrl: string;
      timeoutMs: number;
      fetchPage?: typeof fetch;
    }>,
  ) {}

  async verify(
    input: Readonly<{
      jobId: string;
      workerId: string;
      leaseToken: string;
      articleId: string;
      retryAt?: string;
    }>,
  ): Promise<VerificationOutcome> {
    const article = unwrapResult(
      await this.client
        .from("articles")
        .select("id, slug, title, meta_description, body_markdown, canonical_url, hero_image")
        .eq("id", input.articleId)
        .single(),
      "load published article",
    );

    const url = new URL(`/blog/${article.slug}`, this.options.publicSiteUrl).toString();
    const response = await this.fetchPage(url);

    const checks = evaluatePage(response, {
      canonicalUrl: article.canonical_url,
      title: article.title,
      metaDescription: article.meta_description,
      bodyProbe: bodyProbe(article.body_markdown),
      expectHeroImage: article.hero_image !== null,
    });

    const status = unwrapResult(
      await this.client.rpc("record_verification", {
        p_job_id: input.jobId,
        p_worker_id: input.workerId,
        p_lease_token: input.leaseToken,
        p_checks: checks as unknown as Json,
        ...(input.retryAt ? { p_retry_at: input.retryAt } : {}),
      }),
      "record_verification",
    );

    return { status, checks, passed: allChecksPassed(checks), url };
  }

  private async fetchPage(
    url: string,
  ): Promise<{ status: number; html: string; durationMs: number }> {
    const doFetch = this.options.fetchPage ?? fetch;
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      const response = await doFetch(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: { "User-Agent": "FinTechPulse-Verifier/1.0", Accept: "text/html" },
      });
      // A verifier must not hold a whole site in memory if the origin misbehaves.
      const html = (await response.text()).slice(0, 2_000_000);
      return { status: response.status, html, durationMs: Date.now() - startedAt };
    } catch (error) {
      // A network failure is a failed verification, not a crashed stage: record_verification still
      // has to run so the attempt is logged and the retry is scheduled by the database.
      const reason = error instanceof Error ? error.name : "unknown";
      return {
        status: 0,
        html: `<!-- fetch failed: ${reason} -->`,
        durationMs: Date.now() - startedAt,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * A distinctive phrase from the body, used to prove the page rendered the article rather than a
 * shell. Taken from the first substantial paragraph so it survives a heading-only layout change.
 */
export function bodyProbe(bodyMarkdown: string): string {
  const paragraph = bodyMarkdown
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .find((block) => block.length >= 80 && !block.startsWith("#") && !block.startsWith("-"));
  const source = paragraph ?? bodyMarkdown.trim();
  // Strip inline Markdown so the probe matches rendered text rather than the source.
  return source
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export { WorkerDatabaseError };
