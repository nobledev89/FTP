import { createHmac, randomUUID } from "node:crypto";

export type RevalidationResult = Readonly<{
  ok: boolean;
  status: number | null;
  /** How many requests were sent, including the one that succeeded. */
  attempts: number;
  durationMs: number;
  error?: string;
}>;

const DEFAULT_MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 500;

export function signRevalidationRequest(
  secret: string,
  timestamp: string,
  nonce: string,
  body: string,
): string {
  return createHmac("sha256", secret).update(`${timestamp}.${nonce}.${body}`).digest("hex");
}

/**
 * A response worth sending again. A rejected signature, a malformed slug, or an unconfigured
 * endpoint will fail the same way every time, so only transport failures, server errors, and
 * throttling are retried.
 */
function retryable(status: number | null): boolean {
  return status === null || status === 429 || status >= 500;
}

/**
 * Calls the web application after publication; verification remains the correctness backstop.
 *
 * Publication has already committed by the time this runs (plan section 8.3 step 8), so a failure
 * here is reported and logged rather than thrown: readers may see a stale list for one cache
 * window, and live verification is what decides whether the article actually reached them.
 */
export class CacheRevalidationClient {
  constructor(
    private readonly options: Readonly<{
      publicSiteUrl: string;
      secret: string;
      timeoutMs: number;
      maxAttempts?: number;
      fetchRequest?: typeof fetch;
      sleep?: (ms: number) => Promise<void>;
    }>,
  ) {}

  async revalidate(slug: string): Promise<RevalidationResult> {
    const maxAttempts = Math.max(1, this.options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
    const startedAt = Date.now();
    let last: Readonly<{ status: number | null; error?: string }> = {
      status: null,
      error: "not attempted",
    };

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      last = await this.send(slug);
      if (last.status !== null && !retryable(last.status)) {
        return {
          ok: last.status >= 200 && last.status < 300,
          status: last.status,
          attempts: attempt,
          durationMs: Date.now() - startedAt,
          ...(last.error ? { error: last.error } : {}),
        };
      }
      if (attempt < maxAttempts) {
        await this.wait(RETRY_BASE_MS * 2 ** (attempt - 1));
      }
    }

    return {
      ok: false,
      status: last.status,
      attempts: maxAttempts,
      durationMs: Date.now() - startedAt,
      error: last.error ?? `Revalidation responded ${last.status}`,
    };
  }

  /** One signed request. Each attempt carries its own timestamp and nonce so replay protection
   *  on the receiving end never rejects a legitimate retry. */
  private async send(slug: string): Promise<Readonly<{ status: number | null; error?: string }>> {
    const body = JSON.stringify({ slug });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = randomUUID();
    const signature = signRevalidationRequest(this.options.secret, timestamp, nonce, body);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await (this.options.fetchRequest ?? fetch)(
        new URL("/api/revalidate", this.options.publicSiteUrl),
        {
          method: "POST",
          body,
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            "X-FinTechPulse-Timestamp": timestamp,
            "X-FinTechPulse-Nonce": nonce,
            "X-FinTechPulse-Signature": signature,
          },
        },
      );
      return response.ok
        ? { status: response.status }
        : { status: response.status, error: `Revalidation responded ${response.status}` };
    } catch (error) {
      return { status: null, error: error instanceof Error ? error.message : "request failed" };
    } finally {
      clearTimeout(timer);
    }
  }

  private wait(ms: number): Promise<void> {
    const sleep =
      this.options.sleep ??
      ((delay: number) => new Promise((resolve) => setTimeout(resolve, delay)));
    return sleep(ms);
  }
}
