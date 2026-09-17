import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { contrastRatio, readColourTokens } from "@/lib/design/contrast";

describe("admin tokens", () => {
  const tokens = readColourTokens(
    readFileSync(path.join(process.cwd(), "src/styles/admin.css"), "utf8"),
  );
  const get = (name: string) => {
    const value = tokens.get(name);
    if (!value) {
      throw new Error(`missing admin token ${name}`);
    }
    return value;
  };

  it("meets WCAG AA for text and 3:1 for control borders", () => {
    const text: ReadonlyArray<[string, string]> = [
      ["text", "panel"],
      ["text", "canvas"],
      ["text-muted", "panel"],
      ["text-muted", "canvas"],
      ["text-subtle", "panel"],
      ["text-subtle", "canvas"],
      ["white", "accent"],
      ["accent", "panel"],
      ["success", "success-bg"],
      ["warning", "warning-bg"],
      ["danger", "danger-bg"],
      ["info", "info-bg"],
      ["neutral", "neutral-bg"],
    ];
    for (const [foreground, background] of text) {
      expect(
        contrastRatio(get(foreground), get(background)),
        `${foreground} on ${background}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrastRatio(get("border-strong"), get("panel"))).toBeGreaterThanOrEqual(3);
  });

  it("shares no colour token names with the public stylesheet except white", () => {
    const publicTokens = readColourTokens(
      readFileSync(path.join(process.cwd(), "src/styles/public.css"), "utf8"),
    );
    const shared = [...tokens.keys()].filter((name) => publicTokens.has(name));
    expect(shared).toEqual(["white"]);
  });
});
