/**
 * Sitemap contents (docs/SEO-GROWTH-PLAN.md sections 4.2 and 5.3), kept pure so the rules are
 * testable without a database: which URLs are listed, with which dates, and which articles are
 * recent enough for the Google News sitemap.
 */

import type { MetadataRoute } from "next";

import { CANONICAL_ORIGIN, siteConfig } from "@/lib/site/config";
import { authorHref } from "@/lib/site/structured-data";
import {
  TOPIC_MIN_INDEXABLE_ARTICLES,
  topicForCategory,
  topicHref,
  TOPICS,
} from "@/lib/site/topics";

import type { PublicArticleIndexItem } from "./repository";

/** Google News reads only articles published in the last two days. */
export const NEWS_SITEMAP_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

/** Evergreen formats stay in the main sitemap only. */
const NEWS_ARTICLE_TYPES = new Set<PublicArticleIndexItem["articleType"]>([
  "news",
  "analysis",
  "company",
  "interview",
]);

const TRUST_PATHS = [
  "/about",
  "/editorial-standards",
  "/ai-policy",
  "/corrections",
  "/contact",
] as const;

function latest(dates: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestTime = -Infinity;
  for (const date of dates) {
    const time = Date.parse(date);
    if (time > bestTime) {
      best = date;
      bestTime = time;
    }
  }
  return best;
}

function modified(article: PublicArticleIndexItem): string {
  return article.updatedAt ?? article.publishedAt;
}

export function buildSitemap(articles: readonly PublicArticleIndexItem[]): MetadataRoute.Sitemap {
  const newest = latest(articles.map(modified));
  const entries: MetadataRoute.Sitemap = [
    {
      url: CANONICAL_ORIGIN,
      ...(newest ? { lastModified: newest } : {}),
      changeFrequency: "hourly",
      priority: 1,
    },
    {
      url: `${CANONICAL_ORIGIN}/blog`,
      ...(newest ? { lastModified: newest } : {}),
      changeFrequency: "hourly",
      priority: 0.9,
    },
    { url: `${CANONICAL_ORIGIN}/topics`, changeFrequency: "monthly", priority: 0.6 },
  ];

  // Hubs are listed once they carry real depth; thinner hubs render with `noindex`.
  for (const topic of TOPICS) {
    const inTopic = articles.filter((article) => topicForCategory(article.category) === topic);
    if (inTopic.length < TOPIC_MIN_INDEXABLE_ARTICLES) continue;
    const lastModified = latest(inTopic.map(modified));
    entries.push({
      url: `${CANONICAL_ORIGIN}${topicHref(topic)}`,
      ...(lastModified ? { lastModified } : {}),
      changeFrequency: "daily",
      priority: 0.8,
    });
  }

  const bylines = new Map<string, string[]>();
  for (const article of articles) {
    bylines.set(article.bylineName, [
      ...(bylines.get(article.bylineName) ?? []),
      modified(article),
    ]);
  }
  for (const [name, dates] of bylines) {
    const lastModified = latest(dates);
    entries.push({
      url: `${CANONICAL_ORIGIN}${authorHref(name)}`,
      ...(lastModified ? { lastModified } : {}),
      changeFrequency: "weekly",
      priority: 0.4,
    });
  }

  for (const path of TRUST_PATHS) {
    entries.push({ url: `${CANONICAL_ORIGIN}${path}`, changeFrequency: "monthly", priority: 0.3 });
  }

  for (const article of articles) {
    entries.push({
      url: `${CANONICAL_ORIGIN}/blog/${article.slug}`,
      lastModified: modified(article),
      changeFrequency: "weekly",
      priority: 0.7,
      ...(article.imageUrl ? { images: [article.imageUrl] } : {}),
    });
  }
  return entries;
}

export function newsSitemapArticles(
  articles: readonly PublicArticleIndexItem[],
  now: number = Date.now(),
): PublicArticleIndexItem[] {
  return articles.filter((article) => {
    const published = Date.parse(article.publishedAt);
    return (
      NEWS_ARTICLE_TYPES.has(article.articleType) &&
      published <= now &&
      now - published <= NEWS_SITEMAP_WINDOW_MS
    );
  });
}

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** Google News sitemap XML. An empty `urlset` is valid and is what Google expects on quiet days. */
export function renderNewsSitemap(articles: readonly PublicArticleIndexItem[]): string {
  const urls = articles
    .map(
      (article) => `
  <url>
    <loc>${CANONICAL_ORIGIN}/blog/${xml(article.slug)}</loc>
    <news:news>
      <news:publication>
        <news:name>${xml(siteConfig.name)}</news:name>
        <news:language>${siteConfig.language}</news:language>
      </news:publication>
      <news:publication_date>${xml(new Date(article.publishedAt).toISOString())}</news:publication_date>
      <news:title>${xml(article.title)}</news:title>
    </news:news>
  </url>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">${urls}
</urlset>
`;
}
