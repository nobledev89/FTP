import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { contrastRatio, readColourTokens } from "@/lib/design/contrast";

/**
 * Automated part of the design lock (docs/DESIGN-SYSTEM.md section 11). Scans public source files
 * for utilities the design system prohibits and recomputes token contrast.
 */

const root = process.cwd();
const publicSourceRoots = [
  "src/components/public",
  "src/app/(public)",
  "src/app/global-not-found.tsx",
];
const pillAllowlist = new Set(["src/components/public/pill.tsx"]);

const defaultPalette =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black";

const prohibited: ReadonlyArray<[RegExp, string]> = [
  [/^bg-(gradient|linear|radial|conic)(-|$)/, "gradients are prohibited"],
  [/^(from|via|to)-/, "gradient stops are prohibited"],
  [/^(inset-|drop-|text-)?shadow(-|$)/, "shadows are prohibited"],
  [/^(backdrop-)?blur(-|$)/, "blur and glass effects are prohibited"],
  [/^backdrop-/, "backdrop filters are prohibited"],
  [/^animate-/, "animation utilities are prohibited"],
  [
    /^rounded(-[a-z]+)?-(md|lg|xl|2xl|3xl|4xl)$|^rounded-(md|lg|xl|2xl|3xl|4xl)$/,
    "radius above 4px is prohibited",
  ],
  [
    new RegExp(
      `^(bg|text|border|ring|fill|stroke|outline|decoration|divide|placeholder|caret|accent|marker)(-[trblxy])?-(${defaultPalette})(-|$)`,
    ),
    "use design tokens, not the default palette",
  ],
];

function listFiles(entry: string): string[] {
  const absolute = path.join(root, entry);
  if (statSync(absolute).isFile()) {
    return [entry];
  }
  return readdirSync(absolute, { withFileTypes: true }).flatMap((child) => {
    const relative = path.posix.join(entry, child.name);
    if (child.isDirectory()) {
      return listFiles(relative);
    }
    return /\.(ts|tsx)$/.test(child.name) && !/\.test\.tsx?$/.test(child.name) ? [relative] : [];
  });
}

/** Tokens from string literals that look like class lists (lowercase utility syntax only). */
function classTokens(source: string): string[] {
  const literals = source.matchAll(/"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g);
  const tokens: string[] = [];
  for (const [, doubleQuoted, template] of literals) {
    const words = (doubleQuoted ?? template ?? "").split(/\s+/).filter(Boolean);
    const looksLikeClasses =
      words.length > 0 &&
      words.some((word) => word.includes("-")) &&
      words.every((word) => /^!?-?[a-z0-9[\]&>:_/.%()#,=*'-]+$/.test(word));
    if (looksLikeClasses) {
      // Strip variants such as `sm:`, `group-hover:`, `[&>p]:`.
      tokens.push(...words.map((word) => word.replace(/^!?(?:(?:\[[^\]]*\]|[^:[\]]+):)*/, "")));
    }
  }
  return tokens;
}

function violations(file: string, source: string): string[] {
  return classTokens(source).flatMap((token) => {
    if (token === "rounded-full" && !pillAllowlist.has(file)) {
      return [`${file}: ${token} (pills are limited to pill.tsx)`];
    }
    return prohibited
      .filter(([pattern]) => pattern.test(token))
      .map(([, reason]) => `${file}: ${token} (${reason})`);
  });
}

describe("public design guard", () => {
  it("detects prohibited utilities in a known-bad sample", () => {
    const sample = `<div className="sm:shadow-lg bg-linear-to-r from-stone-100 backdrop-blur-md rounded-xl text-stone-500 hover:animate-pulse" />`;
    const flagged = new Set(
      violations("sample.tsx", sample).map((entry) => entry.split(": ")[1]?.split(" ")[0]),
    );
    expect([...flagged].sort()).toEqual(
      [
        "animate-pulse",
        "backdrop-blur-md",
        "bg-linear-to-r",
        "from-stone-100",
        "rounded-xl",
        "shadow-lg",
        "text-stone-500",
      ].sort(),
    );
    expect(
      violations(
        "sample.tsx",
        `<p className="mt-5 text-lg leading-8 text-muted">Account-to-account</p>`,
      ),
    ).toEqual([]);
  });

  it("finds no prohibited utilities in public sources", () => {
    const files = publicSourceRoots.flatMap(listFiles);
    expect(files.length).toBeGreaterThan(10);
    const found = files.flatMap((file) =>
      violations(file, readFileSync(path.join(root, file), "utf8")),
    );
    expect(found).toEqual([]);
  });

  it("keeps public token contrast at the documented levels", () => {
    const tokens = readColourTokens(readFileSync(path.join(root, "src/styles/public.css"), "utf8"));
    const pairs: ReadonlyArray<[string, string, number]> = [
      ["ink", "paper", 4.5],
      ["muted", "paper", 4.5],
      ["subtle", "paper", 4.5],
      ["muted", "wash", 4.5],
      ["ink", "wash", 4.5],
      ["signal", "paper", 4.5],
      ["white", "signal", 4.5],
      ["dark-copy", "dark-surface", 4.5],
      ["dark-subtle", "dark-surface", 4.5],
      ["white", "dark-surface", 4.5],
    ];
    for (const [foreground, background, minimum] of pairs) {
      const fg = tokens.get(foreground);
      const bg = tokens.get(background);
      expect(fg, `missing token ${foreground}`).toBeDefined();
      expect(bg, `missing token ${background}`).toBeDefined();
      expect(contrastRatio(fg!, bg!), `${foreground} on ${background}`).toBeGreaterThanOrEqual(
        minimum,
      );
    }
    // Documented as not allowed for text; fail loudly if someone "fixes" the doc instead of the pair.
    expect(contrastRatio(tokens.get("subtle")!, tokens.get("wash")!)).toBeLessThan(4.5);
  });

  it("uses the plan's baseline token values", () => {
    const tokens = readColourTokens(readFileSync(path.join(root, "src/styles/public.css"), "utf8"));
    expect(Object.fromEntries(tokens)).toMatchObject({
      paper: "#ffffff",
      ink: "#1c1917",
      muted: "#57534e",
      subtle: "#78716c",
      line: "#d6d3d1",
      "line-soft": "#e7e5e4",
      wash: "#f5f5f4",
      "dark-surface": "#0c0a09",
      "dark-line": "#44403c",
      "dark-copy": "#d6d3d1",
    });
  });
});
