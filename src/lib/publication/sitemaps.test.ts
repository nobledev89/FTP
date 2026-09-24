import { describe, expect, it } from "vitest";

import type { PublicArticleIndexItem } from "./repository";
import { buildSitemap, newsSitemapArticles, renderNewsSitemap } from "./sitemaps";

const now = Date.parse("2026-09-24T12:00:00Z");

function article(
  slug: string,
  overrides: Partial<PublicArticleIndexItem> = {},
): PublicArticleIndexItem {
  return {
    slug,
    title: `Title ${slug}`,
    category: "Payments",
    articleType: "news",
    bylineName: "FinTechPulse Editorial",
    publishedAt: "2026-09-24T09:00:00Z",
    updatedAt: null,
    imageUrl: null,
    ...overrides,
  };
}

describe("buildSitemap", () => {
  const articles = [
    article("a", { updatedAt: "2026-09-24T10:00:00Z", imageUrl: "https://img.example/a.webp" }),
    article("b"),
    article("c"),
    article("d", { category: "Open Banking" }),
  ];
  const urls = () => buildSitemap(articles).map((entry) => entry.url);

  it("lists every published article with its latest editorial date", () => {
    const entry = buildSitemap(articles).find((item) => item.url.endsWith("/blog/a"));
    expect(entry).toMatchObject({
      lastModified: "2026-09-24T10:00:00Z",
      images: ["https://img.example/a.webp"],
    });
    expect(urls().filter((url) => url.includes("/blog/"))).toHaveLength(4);
  });

  it("lists hubs with enough depth and holds back thin ones", () => {
    expect(urls()).toContain("https://fintechpulse.co.uk/topics/payments");
    expect(urls()).not.toContain("https://fintechpulse.co.uk/topics/open-banking");
  });

  it("lists author profiles and trust pages, including Contact", () => {
    expect(urls()).toContain("https://fintechpulse.co.uk/authors/fintechpulse-editorial");
    expect(urls()).toContain("https://fintechpulse.co.uk/ai-policy");
    expect(urls()).toContain("https://fintechpulse.co.uk/contact");
  });

  it("has no duplicate URLs", () => {
    expect(new Set(urls()).size).toBe(urls().length);
  });
});

describe("newsSitemapArticles", () => {
  it("keeps only news-format articles from the last two days", () => {
    const selected = newsSitemapArticles(
      [
        article("fresh"),
        article("old", { publishedAt: "2026-09-21T09:00:00Z" }),
        article("evergreen", { articleType: "explainer" }),
        article("future", { publishedAt: "2026-09-25T09:00:00Z" }),
      ],
      now,
    );
    expect(selected.map((item) => item.slug)).toEqual(["fresh"]);
  });
});

describe("renderNewsSitemap", () => {
  it("escapes titles and declares the news namespace", () => {
    const body = renderNewsSitemap([article("x", { title: "Banks & <fintechs>" })]);
    expect(body).toContain('xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"');
    expect(body).toContain("<news:title>Banks &amp; &lt;fintechs&gt;</news:title>");
    expect(body).toContain("<news:language>en</news:language>");
    expect(body).toContain(
      "<news:publication_date>2026-09-24T09:00:00.000Z</news:publication_date>",
    );
  });

  it("renders a valid empty urlset on a quiet day", () => {
    expect(renderNewsSitemap([])).toMatch(/<urlset[^>]*>\s*<\/urlset>/);
  });
});
