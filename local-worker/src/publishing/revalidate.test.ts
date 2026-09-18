import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { CacheRevalidationClient } from "./revalidate.js";

describe("CacheRevalidationClient", () => {
  it("sends a body-bound HMAC signature to the configured site", async () => {
    const secret = "test-revalidation-secret-that-is-long-enough";
    const fetchRequest = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }));
    const client = new CacheRevalidationClient({
      publicSiteUrl: "http://127.0.0.1:3100",
      secret,
      timeoutMs: 1000,
      fetchRequest,
    });

    await expect(client.revalidate("safe-public-article")).resolves.toEqual({
      ok: true,
      status: 200,
    });
    const [url, init] = fetchRequest.mock.calls[0]!;
    expect(String(url)).toBe("http://127.0.0.1:3100/api/revalidate");
    const headers = new Headers(init?.headers);
    const timestamp = headers.get("x-fintechpulse-timestamp")!;
    const nonce = headers.get("x-fintechpulse-nonce")!;
    const body = String(init?.body);
    expect(headers.get("x-fintechpulse-signature")).toBe(
      createHmac("sha256", secret).update(`${timestamp}.${nonce}.${body}`).digest("hex"),
    );
    expect(JSON.parse(body)).toEqual({ slug: "safe-public-article" });
  });

  it("reports transport failure without throwing after publication committed", async () => {
    const client = new CacheRevalidationClient({
      publicSiteUrl: "http://127.0.0.1:3100",
      secret: "test-revalidation-secret-that-is-long-enough",
      timeoutMs: 1000,
      fetchRequest: vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")),
    });
    await expect(client.revalidate("safe-public-article")).resolves.toEqual({
      ok: false,
      status: null,
    });
  });
});
