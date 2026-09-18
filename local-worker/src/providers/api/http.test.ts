import { describe, expect, it, vi } from "vitest";

import type { ApiProviderError } from "./errors.js";
import { requestJson } from "./http.js";

const request = {
  provider: "OpenAI" as const,
  url: "https://api.openai.com/v1/responses",
  headers: { authorization: "Bearer test" },
  body: { model: "test" },
  signal: new AbortController().signal,
};

async function failed(fetchMock: typeof fetch, maxResponseBytes = 1_000) {
  try {
    await requestJson(request, { fetch: fetchMock, timeoutMs: 1_000, maxResponseBytes });
  } catch (error) {
    return error as ApiProviderError;
  }
  throw new Error("expected request to fail");
}

describe("bounded API HTTP client", () => {
  it("classifies a normal 429 as rate limiting", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: "Too many requests" } }), { status: 429 }),
    ) as typeof fetch;
    expect((await failed(fetchMock)).errorClass).toBe("rate_limit");
  });

  it("rejects an oversized declared response before reading it", async () => {
    const fetchMock = vi.fn(
      async () => new Response("{}", { status: 200, headers: { "content-length": "5000" } }),
    ) as typeof fetch;
    const error = await failed(fetchMock, 100);
    expect(error.errorClass).toBe("invalid_output");
    expect(error.message).toContain("100-byte limit");
  });

  it("rejects an oversized streamed response when content-length is absent", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ value: "x".repeat(500) })),
    ) as typeof fetch;
    expect((await failed(fetchMock, 100)).errorClass).toBe("invalid_output");
  });

  it("turns an already-aborted request into a transient cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn(fetch) as unknown as typeof fetch;
    try {
      await requestJson(
        { ...request, signal: controller.signal },
        { fetch: fetchMock, timeoutMs: 1_000, maxResponseBytes: 1_000 },
      );
      expect.unreachable();
    } catch (error) {
      expect((error as ApiProviderError).errorClass).toBe("transient");
      expect((error as Error).message).toContain("cancelled");
    }
  });
});
