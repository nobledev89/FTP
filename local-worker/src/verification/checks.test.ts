import { describe, expect, it } from "vitest";

import {
  allChecksPassed,
  evaluatePage,
  heroImageUrl,
  type HeroAsset,
  type VerificationTarget,
} from "./checks.js";
import { bodyProbe } from "./verify.js";

const target: VerificationTarget = {
  canonicalUrl: "https://fintechpulse.co.uk/blog/open-banking-rules",
  title: "Open banking rules for UK firms",
  metaDescription: "What the rules mean for UK firms.",
  bodyProbe: "A distinctive paragraph from the published article",
  expectHeroImage: true,
};

const HERO_SRC = "https://cdn.example.test/storage/v1/object/public/article-public/hero.png";

const hero: HeroAsset = {
  url: HERO_SRC,
  status: 200,
  contentType: "image/png",
  durationMs: 12,
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
      <h1>${value.title}</h1><img src="${HERO_SRC}" alt="A document on a desk">
      <p>${value.bodyProbe}. ${"Useful article copy ".repeat(20)}</p>
    </article></main></body></html>`;
}

describe("live verification checks", () => {
  it("passes all eight checks for a complete rendered article", () => {
    const checks = evaluatePage({ status: 200, html: page(), durationMs: 17 }, target, hero);
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
    const checks = evaluatePage({ status: 200, html, durationMs: 9 }, target, hero);
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

describe("hero image resolution", () => {
  it("fails a page whose article rendered but whose public image copy is missing", () => {
    const missing: HeroAsset = { ...hero, status: 404, contentType: "application/json" };
    const checks = evaluatePage({ status: 200, html: page(), durationMs: 11 }, target, missing);
    const check = checks.find((entry) => entry.name === "hero_image_ok")!;

    expect(check.outcome).toBe("failed");
    expect(check.http_status).toBe(404);
    expect(check.error).toContain("404");
    // The rest of the page is fine: only the hero is reported as the reason.
    expect(checks.filter((entry) => entry.outcome === "failed")).toHaveLength(1);
    expect(allChecksPassed(checks)).toBe(false);
  });

  it("fails a hero that resolves to something other than an image", () => {
    const wrongType: HeroAsset = { ...hero, status: 200, contentType: "text/html" };
    const checks = evaluatePage({ status: 200, html: page(), durationMs: 11 }, target, wrongType);
    expect(checks.find((entry) => entry.name === "hero_image_ok")?.outcome).toBe("failed");
  });

  it("fails when the hero could not be fetched at all rather than reporting a pass", () => {
    const checks = evaluatePage({ status: 200, html: page(), durationMs: 11 }, target, null);
    const check = checks.find((entry) => entry.name === "hero_image_ok")!;
    expect(check.outcome).toBe("failed");
    expect(check.error).toContain("not resolved");
  });

  it("fails before any fetch when no image carries alt text", () => {
    const html = page().replace(/alt="[^"]*"/, 'alt=""');
    const checks = evaluatePage({ status: 200, html, durationMs: 11 }, target, hero);
    expect(checks.find((entry) => entry.name === "hero_image_ok")?.error).toContain(
      "No image with alt text",
    );
  });

  it("resolves the first image with alt text against the page URL", () => {
    const html = `<img src="/spacer.gif" alt=""><img src="/i/hero.png" alt="Hero">`;
    expect(heroImageUrl(html, "https://fintechpulse.co.uk/blog/open-banking-rules")).toBe(
      "https://fintechpulse.co.uk/i/hero.png",
    );
    expect(heroImageUrl(page(), "https://fintechpulse.co.uk/blog/open-banking-rules")).toBe(
      HERO_SRC,
    );
  });

  it("ignores inline data images and pages with no image at all", () => {
    expect(
      heroImageUrl('<img src="data:image/png;base64,AAAA" alt="Inline">', "https://x.test/a"),
    ).toBeNull();
    expect(heroImageUrl("<p>No images here</p>", "https://x.test/a")).toBeNull();
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
