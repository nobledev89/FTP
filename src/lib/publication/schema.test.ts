import { describe, expect, it } from "vitest";

import { publicArticleRowSchema, toPublicArticle } from "./schema";

const row = {
  id: "10000000-0000-4000-8000-000000000001",
  slug: "safe-public-article",
  title: "A safe public article",
  excerpt: "A concise description of the article.",
  body_markdown: "## What changed\n\nA sufficiently useful article body.",
  meta_title: "A safe public article",
  meta_description: "A concise description of the article.",
  category: "Payments",
  article_type: "analysis" as const,
  byline_name: "FinTechPulse Editorial",
  byline_role: "Editorial desk",
  canonical_url: "https://fintechpulse.co.uk/blog/safe-public-article",
  hero_image: {
    path: "articles/safe-public-article/hero.png",
    alt: "A payment terminal",
    caption: "A structured caption",
    aspect_ratio: "16:9" as const,
    width: 1200,
    height: 675,
    focal_x: 25,
    focal_y: 75,
  },
  source_references: [
    {
      title: "Payments report",
      publisher: "Example regulator",
      url: "https://example.com/report",
      published_on: "2026-09-01",
      accessed_at: "2026-09-17T10:00:00Z",
      jurisdiction: "GB",
    },
  ],
  status: "published" as const,
  published_at: "2026-09-18T08:00:00Z",
  content_updated_at: null,
  verified_at: null,
  updated_at: "2026-09-18T08:00:00Z",
};

describe("public article schema", () => {
  it("maps a narrow publication snapshot without exposing editorial linkage", () => {
    const article = toPublicArticle(publicArticleRowSchema.parse(row), "http://127.0.0.1:54321");

    expect(article).toMatchObject({
      slug: row.slug,
      category: "Payments",
      byline: { name: "FinTechPulse Editorial", role: "Editorial desk" },
      image: {
        src: expect.stringContaining(
          "/storage/v1/object/public/article-public/articles/safe-public-article/hero.png",
        ),
        focalPoint: { x: 25, y: 75 },
      },
      sources: [{ id: "source-1", publisher: "Example regulator" }],
    });
    expect(article).not.toHaveProperty("jobId");
    expect(article).not.toHaveProperty("approvedDraftId");
  });

  it("rejects traversal paths, unsafe sources, and a mismatched canonical", () => {
    expect(() =>
      publicArticleRowSchema.parse({
        ...row,
        canonical_url: "https://attacker.example/blog/safe-public-article",
        hero_image: { ...row.hero_image, path: "articles/safe-public-article/../secret.png" },
        source_references: [{ ...row.source_references[0], url: "javascript:alert(1)" }],
      }),
    ).toThrow();
  });

  it("accepts only publication-safe statuses", () => {
    expect(() => publicArticleRowSchema.parse({ ...row, status: "withdrawn" })).toThrow();
  });
});
