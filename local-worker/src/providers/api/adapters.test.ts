import { describe, expect, it, vi } from "vitest";

import type { RawRunResult, RunContext } from "../contract.js";
import { buildAudit } from "../mock/audit.js";
import { buildDraft } from "../mock/draft.js";
import { buildResearchPacket } from "../mock/research.js";
import { resolveAdapter } from "../registry.js";
import { createApiAdapters, type ApiAdapterSet } from "./adapters.js";
import type { ApiProviderError } from "./errors.js";

const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function context(stage: RunContext["stage"], mode: RunContext["mode"]): RunContext {
  return {
    stage,
    mode,
    cycle: 0,
    attempt: 1,
    claimVersion: 7,
    brief: {
      jobId: "44444444-4444-4444-8444-444444444444",
      topic: "UK payment safeguarding rules",
      keywords: ["payments", "safeguarding"],
      requirements: null,
      articleType: "analysis",
      category: "Payments",
      targetWordCount: 900,
      imageCount: 1,
      siteName: "FinTechPulse",
      timezone: "Europe/London",
      today: "2026-09-18",
    },
    template: null,
    styleGuide: "Use British English and primary UK sources.",
    schemaVersion:
      stage === "research"
        ? "research-1"
        : stage === "audit"
          ? "audit-1"
          : stage === "images"
            ? "image-1"
            : "draft-1",
  };
}

function adapters(fetchMock: typeof fetch, keys = true): ApiAdapterSet {
  return createApiAdapters({
    openai: { model: "gpt-test", ...(keys ? { apiKey: "openai-test-key" } : {}) },
    anthropic: { model: "claude-test", ...(keys ? { apiKey: "anthropic-test-key" } : {}) },
    gemini: { model: "gemini-test", ...(keys ? { apiKey: "gemini-test-key" } : {}) },
    runtime: { fetch: fetchMock, timeoutMs: 5_000, maxResponseBytes: 2_000_000 },
  });
}

async function run(
  set: ApiAdapterSet,
  stage: "research" | "draft" | "images" | "audit",
  mode: RunContext["mode"],
  input: unknown,
) {
  const adapter = resolveAdapter(stage, mode, undefined, set) as unknown as {
    prepare(input: unknown, context: RunContext): Promise<import("../contract.js").PreparedRun>;
    execute(request: unknown): Promise<RawRunResult>;
    normalize(raw: RawRunResult, context: RunContext): Promise<unknown>;
  };
  const runContext = context(stage, mode);
  const prepared = await adapter.prepare(input, runContext);
  const raw = await adapter.execute({
    prepared,
    input,
    context: runContext,
    signal: new AbortController().signal,
  });
  return { prepared, raw, output: await adapter.normalize(raw, runContext) };
}

const packet = buildResearchPacket(context("research", "mock"));
const draft = buildDraft(context("draft", "mock"), { packet });
const audit = buildAudit(context("audit", "mock"), { packet, draft, draftVersion: 1 });

describe("metered API adapters", () => {
  it("uses OpenAI Responses structured output and web search only for research", async () => {
    const requests: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
    const responses = [packet, audit];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: input.toString(),
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      const value = responses.shift();
      return new Response(
        JSON.stringify({
          id: `resp_${requests.length}`,
          model: "gpt-test-2026",
          status: "completed",
          output: [
            ...(requests.length === 1 ? [{ type: "web_search_call", id: "search_1" }] : []),
            {
              type: "message",
              content: [{ type: "output_text", text: JSON.stringify(value) }],
            },
          ],
          usage: {
            input_tokens: 120,
            input_tokens_details: { cached_tokens: 20 },
            output_tokens: 80,
            output_tokens_details: { reasoning_tokens: 10 },
            total_tokens: 200,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    const set = adapters(fetchMock);

    const research = await run(set, "research", "openai_api", {});
    const audited = await run(set, "audit", "openai_api", {
      packet,
      draft,
      draftVersion: 1,
    });

    expect(research.output).toEqual(packet);
    expect(audited.output).toEqual(audit);
    expect(research.prepared).toMatchObject({ mode: "openai_api", provider: "openai" });
    expect(research.raw).toMatchObject({
      kind: "output",
      usage: {
        billing: "metered_api",
        input_tokens: 120,
        cached_input_tokens: 20,
        output_tokens: 80,
        reasoning_tokens: 10,
        total_tokens: 200,
        web_search_calls: 1,
      },
    });
    expect(requests[0]?.url).toBe("https://api.openai.com/v1/responses");
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer openai-test-key");
    expect(requests[0]?.body.tools).toEqual([{ type: "web_search" }]);
    expect(requests[1]?.body).not.toHaveProperty("tools");
    expect(requests[0]?.body).toMatchObject({
      model: "gpt-test",
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "research_research_1",
          strict: true,
          schema: { type: "object", additionalProperties: false },
        },
      },
    });
  });

  it("uses Anthropic Messages structured output and records exposed cache usage", async () => {
    let request: { headers: Headers; body: Record<string, unknown> } | undefined;
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      request = {
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      };
      return new Response(
        JSON.stringify({
          id: "msg_1",
          model: "claude-test-2026",
          stop_reason: "end_turn",
          content: [{ type: "text", text: JSON.stringify(draft) }],
          usage: {
            input_tokens: 300,
            cache_creation_input_tokens: 100,
            cache_read_input_tokens: 50,
            output_tokens: 900,
          },
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const result = await run(adapters(fetchMock), "draft", "anthropic_api", { packet });

    expect(result.output).toEqual(draft);
    expect(result.raw).toMatchObject({
      kind: "output",
      usage: {
        billing: "metered_api",
        input_tokens: 300,
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 50,
        output_tokens: 900,
      },
    });
    expect(request?.headers.get("x-api-key")).toBe("anthropic-test-key");
    expect(request?.headers.get("anthropic-version")).toBe("2023-06-01");
    expect(request?.body).toMatchObject({
      model: "claude-test",
      max_tokens: 32_768,
      output_config: { format: { type: "json_schema", schema: { type: "object" } } },
    });
  });

  it("generates one Gemini image per reviewed slot with real file metadata", async () => {
    let body: Record<string, unknown> | undefined;
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          responseId: "gemini_1",
          candidates: [
            { content: { parts: [{ inlineData: { mimeType: "image/png", data: PNG_1X1 } }] } },
          ],
          usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 20, totalTokenCount: 60 },
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const result = await run(adapters(fetchMock), "images", "gemini_api", {
      draft,
      draftVersion: 1,
    });
    const output = result.output as import("../mock/images.js").ImageStageOutput;

    expect(output.artifacts[0]).toMatchObject({
      slot: 0,
      width: 1,
      height: 1,
      mimeType: "image/png",
      status: "uploaded",
      privatePath: null,
    });
    expect(output.files[0]).toMatchObject({ slot: 0, width: 1, height: 1, mimeType: "image/png" });
    expect(result.raw).toMatchObject({
      usage: { billing: "metered_api", requests: 1, images: 1 },
    });
    expect(body).toMatchObject({
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: "16:9" },
      },
    });
  });

  it("refuses missing credentials before making an HTTP request", async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;
    const set = adapters(fetchMock, false);
    try {
      await run(set, "research", "openai_api", {});
      expect.unreachable();
    } catch (error) {
      expect((error as ApiProviderError).errorClass).toBe("auth");
      expect((error as Error).message).toContain("OPENAI_API_KEY");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("classifies exhausted quota without exposing a provider credential", async () => {
    // Compose the key-shaped fixture at runtime so repository secret scanning never sees a token.
    const secret = ["sk", "ant", "secret-value-123456789"].join("-");
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: `quota exhausted for ${secret}` } }), {
          status: 429,
        }),
    ) as typeof fetch;
    try {
      await run(adapters(fetchMock), "research", "openai_api", {});
      expect.unreachable();
    } catch (error) {
      expect((error as ApiProviderError).errorClass).toBe("usage_limit");
      expect((error as Error).message).toContain("quota exhausted");
      expect((error as Error).message).not.toContain(secret);
      expect((error as Error).message).toContain("[REDACTED]");
    }
  });
});
