import { describe, expect, it } from "vitest";

import { auditOutputSchema, draftOutputSchema, researchPacketOutputSchema } from "./artifacts";

const source = {
  sourceKey: "FCA-1",
  url: "https://www.fca.org.uk/news",
  title: "FCA announcement",
  publisher: "FCA",
  publishedOn: "2026-09-16",
  sourceType: "regulator" as const,
  quality: "primary" as const,
  jurisdiction: "UK",
  accessedAt: "2026-09-17T12:00:00Z",
  excerpt: "Primary-source excerpt",
  isPrivate: false,
};

describe("provider artifact contracts", () => {
  it("accepts research only when claim evidence points at a known source", () => {
    const packet = {
      topicInterpretation: "UK open-banking checkout adoption",
      angle: "What merchants should know",
      facts: ["The announcement was made in September."],
      claims: [
        {
          claimKey: "C1",
          text: "The regulator published new guidance.",
          status: "supported" as const,
          confidence: 0.95,
          jurisdiction: "UK",
          effectiveDate: null,
          asOfDate: "2026-09-17",
          entities: ["FCA"],
          notes: null,
          evidence: [{ sourceKey: "FCA-1", relation: "supports" as const, locator: "para 4" }],
        },
      ],
      statistics: [],
      dates: ["2026-09-16"],
      entities: ["FCA"],
      sources: [source],
      contradictions: [],
      uncertainties: [],
      questions: [],
      recommendedStructure: ["What changed", "Implications"],
    };
    expect(researchPacketOutputSchema.parse(packet).claims).toHaveLength(1);
    expect(() =>
      researchPacketOutputSchema.parse({
        ...packet,
        claims: [
          {
            ...packet.claims[0],
            evidence: [{ sourceKey: "MISSING", relation: "supports", locator: null }],
          },
        ],
      }),
    ).toThrow(/unknown source key/);
  });

  it("enforces image slot roles in draft output", () => {
    const draft = {
      title: "Open banking at checkout",
      slug: "open-banking-at-checkout",
      excerpt: "What UK merchants need to know.",
      bodyMarkdown: "## What changed\n\nA sourced explanation.",
      metaTitle: "Open banking at checkout",
      metaDescription: "A guide to UK open-banking checkout changes.",
      category: "Payments",
      internalLinks: [],
      imageBriefs: [
        {
          slot: 0,
          role: "hero" as const,
          purpose: "Article hero",
          prompt: "Editorial illustration of bank payments",
          altText: "A bank payment moving through a checkout",
          aspectRatio: "16:9" as const,
        },
      ],
      sourceReferences: ["FCA-1"],
    };
    expect(draftOutputSchema.parse(draft).slug).toBe("open-banking-at-checkout");
    expect(() =>
      draftOutputSchema.parse({
        ...draft,
        imageBriefs: [{ ...draft.imageBriefs[0], role: "supporting" }],
      }),
    ).toThrow(/slot 0 is the hero/);
  });

  it("requires actionable findings for non-pass audits", () => {
    expect(
      auditOutputSchema.parse({ verdict: "PASS", summary: "All checks pass.", findings: [] }),
    ).toMatchObject({ verdict: "PASS" });
    expect(() =>
      auditOutputSchema.parse({
        verdict: "REVISION_REQUIRED",
        summary: "A citation is missing.",
        findings: [],
      }),
    ).toThrow(/requires at least one finding/);
  });
});
