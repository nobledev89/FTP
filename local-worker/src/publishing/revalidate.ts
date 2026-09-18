import { createHmac, randomUUID } from "node:crypto";

export type RevalidationResult = Readonly<{
  ok: boolean;
  status: number | null;
}>;

export function signRevalidationRequest(
  secret: string,
  timestamp: string,
  nonce: string,
  body: string,
): string {
  return createHmac("sha256", secret).update(`${timestamp}.${nonce}.${body}`).digest("hex");
}

/** Calls the web application after publication; verification remains the correctness backstop. */
export class CacheRevalidationClient {
  constructor(
    private readonly options: Readonly<{
      publicSiteUrl: string;
      secret: string;
      timeoutMs: number;
      fetchRequest?: typeof fetch;
    }>,
  ) {}

  async revalidate(slug: string): Promise<RevalidationResult> {
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
      return { ok: response.ok, status: response.status };
    } catch {
      return { ok: false, status: null };
    } finally {
      clearTimeout(timer);
    }
  }
}
