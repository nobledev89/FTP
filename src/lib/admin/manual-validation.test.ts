import { describe, expect, it } from "vitest";

import { parseManualTextOutput } from "./manual-validation";

const audit = {
  verdict: "REVISION_REQUIRED",
  summary: "A claim needs support.",
  findings: [
    {
      severity: "major",
      category: "support",
      location: "Opening paragraph",
      problem: "A figure has no source.",
      reason: "The packet does not contain it.",
      recommendedCorrection: "Remove the figure.",
    },
  ],
};

describe("manual response validation", () => {
  it("accepts plain JSON and a single outer JSON fence", () => {
    expect(parseManualTextOutput("audit", JSON.stringify(audit))).toEqual({
      ok: true,
      value: audit,
    });
    expect(parseManualTextOutput("audit", `\`\`\`json\n${JSON.stringify(audit)}\n\`\`\``)).toEqual({
      ok: true,
      value: audit,
    });
  });

  it("returns actionable paths for invalid output", () => {
    const parsed = parseManualTextOutput(
      "audit",
      JSON.stringify({ verdict: "REVISION_REQUIRED", summary: "Missing findings", findings: [] }),
    );
    expect(parsed).toMatchObject({ ok: false });
    if (!parsed.ok)
      expect(parsed.error).toContain("findings: REVISION_REQUIRED requires at least one finding");
  });

  it("rejects non-text manual stages", () => {
    expect(parseManualTextOutput("images", "{}")).toEqual({
      ok: false,
      error: "images does not accept a pasted JSON response.",
    });
  });
});
