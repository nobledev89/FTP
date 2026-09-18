import { describe, expect, it } from "vitest";

import type { RunContext } from "../contract.js";
import { implementedModes, resolveAdapter, UnsupportedModeError } from "../registry.js";

function context(stage: RunContext["stage"], mode: RunContext["mode"]): RunContext {
  return {
    stage,
    mode,
    cycle: 0,
    attempt: 1,
    claimVersion: 3,
    brief: {
      jobId: "11111111-1111-4111-8111-111111111111",
      topic: "UK open banking rules",
      keywords: ["payments"],
      requirements: null,
      articleType: "analysis",
      category: "Payments",
      targetWordCount: 800,
      imageCount: 1,
      siteName: "FinTechPulse",
      timezone: "Europe/London",
      today: "2026-09-18",
    },
    template: {
      id: "22222222-2222-4222-8222-222222222222",
      key: stage,
      version: 3,
      content: "Research {{topic}} for {{today}} under {{schemaVersion}}.",
    },
    styleGuide: "Use British English.",
    schemaVersion: "research-1",
  };
}

describe("manual provider adapters", () => {
  it("prepares the immutable prompt and requests operator input without provider execution", async () => {
    const runContext = context("research", "manual_chatgpt");
    const adapter = resolveAdapter("research", "manual_chatgpt");
    const prepared = await adapter.prepare({}, runContext);

    expect(prepared).toMatchObject({
      provider: "openai",
      mode: "manual_chatgpt",
      promptTemplateId: runContext.template?.id,
      promptVersion: 3,
      schemaVersion: "research-1",
      // The claim version separates a retried or resolved stage from an earlier claim's run.
      idempotencyKey: "11111111-1111-4111-8111-111111111111:research:c0:a1:v3",
    });
    expect(prepared.prompt).toContain("UK open banking rules");
    await expect(
      adapter.execute({
        prepared,
        input: {},
        context: runContext,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        kind: "manual_action",
        message: expect.stringContaining("ChatGPT"),
      }),
    );
  });

  it("advertises only working modes and never falls back to another provider", () => {
    expect(implementedModes("research")).toEqual(["mock", "manual_chatgpt"]);
    expect(implementedModes("draft")).toEqual(["mock", "manual_claude"]);
    expect(implementedModes("images")).toEqual(["mock", "manual_gemini"]);
    expect(() => resolveAdapter("draft", "claude_code")).toThrow(UnsupportedModeError);
    expect(() => resolveAdapter("audit", "manual_claude")).toThrow(UnsupportedModeError);
  });
});
