import { describe, expect, it } from "vitest";

import type { RunContext } from "../contract.js";
import { buildAudit } from "./audit.js";
import { parseDirectives, shouldFail, verdictForCycle } from "./directives.js";
import { buildDraft } from "./draft.js";
import { buildImages } from "./images.js";
import { MockResearchAdapter, buildResearchPacket } from "./research.js";

function context(overrides: Partial<RunContext> = {}): RunContext {
  return {
    stage: "research",
    mode: "mock",
    cycle: 0,
    attempt: 1,
    claimVersion: 3,
    brief: {
      jobId: "11111111-1111-4111-8111-111111111111",
      topic: "Open banking payment rules",
      keywords: ["payments", "uk"],
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
    styleGuide: null,
    schemaVersion: "research-1",
    ...overrides,
  };
}

describe("mock directives", () => {
  it("parses bounded branch controls and ignores unknown values", () => {
    const directives = parseDirectives([
      "mock:audit=revision",
      "mock:fail=research",
      "mock:fail-always=audit",
      "mock:manual=draft",
      "mock:slow=999999",
      "mock:unknown=value",
    ]);

    expect(directives.auditPlan).toBe("revision");
    expect(directives.failOnce).toEqual(new Set(["research"]));
    expect(directives.failAlways).toEqual(new Set(["audit"]));
    expect(directives.manual).toEqual(new Set(["draft"]));
    expect(directives.delayMs).toBe(120_000);
    expect(shouldFail(directives, "research", 1)).toBe(true);
    expect(shouldFail(directives, "research", 2)).toBe(false);
    expect(shouldFail(directives, "audit", 20)).toBe(true);
  });

  it("makes a revision plan converge after the first completed cycle", () => {
    const directives = parseDirectives(["mock:audit=revision"]);
    expect(verdictForCycle(directives, 0)).toBe("REVISION_REQUIRED");
    expect(verdictForCycle(directives, 1)).toBe("PASS");
  });
});

describe("deterministic mock artifacts", () => {
  it("builds the same normalized research packet for the same job", () => {
    const first = buildResearchPacket(context());
    const second = buildResearchPacket(context());

    expect(second).toEqual(first);
    expect(first.sources.length).toBeGreaterThanOrEqual(4);
    expect(first.claims.every((claim) => claim.evidence.length > 0)).toBe(true);
    expect(first.sources.every((source) => source.jurisdiction === "GB")).toBe(true);
  });

  it("preserves identity and records corrections in a revised draft", () => {
    const packet = buildResearchPacket(context());
    const first = buildDraft(context({ stage: "draft", schemaVersion: "draft-1" }), { packet });
    const audit = buildAudit(
      context({
        stage: "audit",
        schemaVersion: "audit-1",
        brief: { ...context().brief, keywords: ["mock:audit=revision"] },
      }),
      { packet, draft: first, draftVersion: 1 },
    );
    const revised = buildDraft(context({ stage: "revision", cycle: 1, schemaVersion: "draft-1" }), {
      packet,
      previous: { draft: first, audit },
    });

    expect(audit.verdict).toBe("REVISION_REQUIRED");
    expect(revised.slug).toBe(first.slug);
    expect(revised.title).toBe(first.title);
    expect(revised.bodyMarkdown).toContain("## Corrections made in revision");
    for (const finding of audit.findings) {
      expect(revised.bodyMarkdown).toContain(finding.recommendedCorrection);
    }
  });

  it("produces a real, deterministic PNG and matching metadata", () => {
    const packet = buildResearchPacket(context());
    const draft = buildDraft(context({ stage: "draft", schemaVersion: "draft-1" }), { packet });
    const first = buildImages(context({ stage: "images", schemaVersion: "image-1" }), {
      draft,
      draftVersion: 1,
    });
    const second = buildImages(context({ stage: "images", schemaVersion: "image-1" }), {
      draft,
      draftVersion: 1,
    });

    expect(first.artifacts).toHaveLength(1);
    expect(first.files).toHaveLength(1);
    expect([...first.files[0]!.bytes.slice(0, 8)]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    expect(first.artifacts[0]).toMatchObject({
      status: "uploaded",
      mimeType: "image/png",
      width: 1600,
      height: 900,
      byteSize: first.files[0]!.bytes.length,
    });
    expect(second.artifacts[0]!.contentHash).toBe(first.artifacts[0]!.contentHash);
  });

  it("uses the same manual and controlled-failure paths as a real adapter", async () => {
    const adapter = new MockResearchAdapter();
    const manualContext = context({
      brief: { ...context().brief, keywords: ["mock:manual=research"] },
    });
    const prepared = await adapter.prepare({}, manualContext);
    await expect(
      adapter.execute({
        prepared,
        input: {},
        context: manualContext,
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ kind: "manual_action" });

    const failingContext = context({
      brief: { ...context().brief, keywords: ["mock:fail=research"] },
    });
    await expect(
      adapter.execute({
        prepared: await adapter.prepare({}, failingContext),
        input: {},
        context: failingContext,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ errorClass: "transient" });

    const retryContext = { ...failingContext, attempt: 2 };
    await expect(
      adapter.execute({
        prepared: await adapter.prepare({}, retryContext),
        input: {},
        context: retryContext,
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ kind: "output" });
  });
});
