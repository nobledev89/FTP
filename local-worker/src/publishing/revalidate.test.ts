import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { CacheRevalidationClient } from "./revalidate.js";

const SECRET = "test-revalidation-secret-that-is-long-enough";

function client(
  fetchRequest: typeof fetch,
  overrides: Partial<ConstructorParameters<typeof CacheRevalidationClient>[0]> = {},
): CacheRevalidationClient {
  return new CacheRevalidationClient({
    publicSiteUrl: "http://127.0.0.1:3100",
    secret: SECRET,
    timeoutMs: 1000,
    fetchRequest,
    // Retries are exercised without waiting for the real backoff.
    sleep: async () => {},
    ...overrides,
  });
}

describe("CacheRevalidationClient", () => {
  it("sends a body-bound HMAC signature to the configured site", async () => {
    const fetchRequest = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }));

    const result = await client(fetchRequest).revalidate("safe-public-article");
    expect(result).toMatchObject({ ok: true, status: 200, attempts: 1 });

    const [url, init] = fetchRequest.mock.calls[0]!;
    expect(String(url)).toBe("http://127.0.0.1:3100/api/revalidate");
    const headers = new Headers(init?.headers);
    const timestamp = headers.get("x-fintechpulse-timestamp")!;
    const nonce = headers.get("x-fintechpulse-nonce")!;
    const body = String(init?.body);
    expect(headers.get("x-fintechpulse-signature")).toBe(
      createHmac("sha256", SECRET).update(`${timestamp}.${nonce}.${body}`).digest("hex"),
    );
    expect(JSON.parse(body)).toEqual({ slug: "safe-public-article" });
  });

  it("reports transport failure without throwing after publication committed", async () => {
    const fetchRequest = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
    const result = await client(fetchRequest).revalidate("safe-public-article");
    expect(result).toMatchObject({ ok: false, status: null, attempts: 3, error: "offline" });
    expect(fetchRequest).toHaveBeenCalledTimes(3);
  });

  it("retries a server error and reports the attempt that succeeded", async () => {
    const fetchRequest = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 502 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const result = await client(fetchRequest).revalidate("safe-public-article");
    expect(result).toMatchObject({ ok: true, status: 200, attempts: 2 });
  });

  it("signs each retry afresh so replay protection never rejects one", async () => {
    const fetchRequest = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await client(fetchRequest).revalidate("safe-public-article");
    const nonces = fetchRequest.mock.calls.map((call) =>
      new Headers(call[1]?.headers).get("x-fintechpulse-nonce"),
    );
    expect(nonces[0]).not.toBe(nonces[1]);
    expect(new Set(nonces).size).toBe(2);
  });

  it("does not retry a rejected signature, which would fail the same way every time", async () => {
    const fetchRequest = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 401 }));

    const result = await client(fetchRequest).revalidate("safe-public-article");
    expect(result).toMatchObject({ ok: false, status: 401, attempts: 1 });
    expect(fetchRequest).toHaveBeenCalledTimes(1);
  });
});
