import { describe, expect, it } from "vitest";

import { allChecksPassed, evaluatePage, type VerificationTarget } from "./checks.js";
import { bodyProbe } from "./verify.js";

const target: VerificationTarget = {
  canonicalUrl: "https://fintechpulse.co.uk/blog/open-banking-rules",
  title: "Open banking rules for UK firms",
  metaDescription: "What the rules mean for UK firms.",
  bodyProbe: "A distinctive paragraph from the published article",
  expectHeroImage: true,
};

function page(overrides: Partial<VerificationTarget> = {}): string {
  const value = { ...target, ...overrides };
  return `<!doctype html>
    <html><head>
      <title>${value.title} | FinTechPulse</title>
      <link rel="canonical" href="${value.canonicalUrl}">
      <meta name="description" content="${value.metaDescription}">
      <script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Article",
        headline: value.title,
      })}</script>
    </head><body><main><article>
      <h1>${value.title}</h1><img src="/hero.png" alt="A document on a desk">
      <p>${value.bodyProbe}. ${"Useful article copy ".repeat(20)}</p>
    </article></main></body></html>`;
}

describe("live verification checks", () => {
  it("passes all eight checks for a complete rendered article", () => {
    const checks = evaluatePage({ status: 200, html: page(), durationMs: 17 }, target);
    expect(checks).toHaveLength(8);
    expect(allChecksPassed(checks)).toBe(true);
    expect(checks.every((check) => check.outcome === "succeeded")).toBe(true);
  });

  it("fails malformed JSON-LD and visible placeholders", () => {
    const html = page()
      .replace(
        /<script type="application\/ld\+json">[\s\S]*?<\/script>/,
        '<script type="application/ld+json">{broken}</script>',
      )
      .replace("</article>", "<p>TODO: replace this.</p></article>");
    const checks = evaluatePage({ status: 200, html, durationMs: 9 }, target);
    expect(checks.find((check) => check.name === "json_ld_valid")?.outcome).toBe("failed");
    expect(checks.find((check) => check.name === "no_placeholders")?.outcome).toBe("failed");
    expect(allChecksPassed(checks)).toBe(false);
  });

  it("omits non-HTTP status zero after a transport failure", () => {
    const checks = evaluatePage({ status: 0, html: "", durationMs: 50 }, target);
    expect(checks.every((check) => check.outcome === "failed")).toBe(true);
    expect(checks.every((check) => check.http_status === undefined)).toBe(true);
  });

  it("allows the hero check to be skipped only when no image is expected", () => {
    const checks = evaluatePage(
      { status: 200, html: page().replace(/<img[^>]+>/, ""), durationMs: 4 },
      { ...target, expectHeroImage: false },
    );
    expect(checks.find((check) => check.name === "hero_image_ok")?.outcome).toBe("skipped");
    expect(allChecksPassed(checks)).toBe(true);
  });
});

describe("bodyProbe", () => {
  it("uses rendered paragraph text instead of Markdown syntax", () => {
    expect(
      bodyProbe(
        "## Heading\n\nThis [distinctive source](https://example.com) paragraph is long enough to prove that the body rendered for a reader.",
      ),
    ).toBe("This distinctive source paragraph is long enough to prove that the body rendered");
  });
});
