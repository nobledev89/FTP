import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "../db/database.types.js";
import { WorkerDatabaseError, unwrapResult } from "../db/worker-store.js";

import {
  evaluatePage,
  allChecksPassed,
  heroImageUrl,
  type HeroAsset,
  type VerificationCheck,
} from "./checks.js";

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
  heroUrl: string | null;
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

    // A rendered page can reference an image that was never copied to public Storage, so the hero
    // is fetched separately before the checks are evaluated.
    const expectHeroImage = article.hero_image !== null;
    const heroUrl =
      expectHeroImage && response.status === 200 ? heroImageUrl(response.html, url) : null;
    const heroAsset = heroUrl === null ? null : await this.fetchHeroImage(heroUrl);

    const checks = evaluatePage(
      response,
      {
        canonicalUrl: article.canonical_url,
        title: article.title,
        metaDescription: article.meta_description,
        bodyProbe: bodyProbe(article.body_markdown),
        expectHeroImage,
      },
      heroAsset,
    );

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

    return { status, checks, passed: allChecksPassed(checks), url, heroUrl };
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

  /**
   * Asks only for the headers: the check needs the status and the media type, and an article hero
   * is large enough that downloading it on every attempt would be wasteful. Storage back ends that
   * reject HEAD fall back to a GET whose body is discarded.
   */
  private async fetchHeroImage(url: string): Promise<HeroAsset> {
    const doFetch = this.options.fetchPage ?? fetch;
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      let response = await doFetch(url, {
        method: "HEAD",
        signal: controller.signal,
        redirect: "follow",
        headers: { "User-Agent": "FinTechPulse-Verifier/1.0", Accept: "image/*" },
      });
      if (response.status === 405 || response.status === 501) {
        response = await doFetch(url, {
          method: "GET",
          signal: controller.signal,
          redirect: "follow",
          headers: { "User-Agent": "FinTechPulse-Verifier/1.0", Accept: "image/*" },
        });
      }
      return {
        url,
        status: response.status,
        contentType: response.headers.get("content-type"),
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.name : "unknown";
      return {
        url,
        status: 0,
        contentType: null,
        durationMs: Date.now() - startedAt,
        error: `The hero image could not be fetched (${reason})`,
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
