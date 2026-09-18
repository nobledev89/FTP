import { getPublicArticlePage } from "@/lib/publication/repository";
import { CANONICAL_ORIGIN, siteConfig } from "@/lib/site/config";

export const revalidate = 300;

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export async function GET() {
  const { articles } = await getPublicArticlePage(1, 50);
  const lastBuildDate = articles[0]?.publishedAt ?? new Date().toISOString();
  const items = articles
    .map(
      (article) => `
    <item>
      <title>${xml(article.title)}</title>
      <link>${CANONICAL_ORIGIN}/blog/${xml(article.slug)}</link>
      <guid isPermaLink="true">${CANONICAL_ORIGIN}/blog/${xml(article.slug)}</guid>
      <pubDate>${new Date(article.publishedAt).toUTCString()}</pubDate>
      <category>${xml(article.category)}</category>
      <description>${xml(article.excerpt)}</description>
    </item>`,
    )
    .join("");

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xml(siteConfig.name)}</title>
    <link>${CANONICAL_ORIGIN}</link>
    <description>${xml(siteConfig.description)}</description>
    <language>${siteConfig.locale}</language>
    <lastBuildDate>${new Date(lastBuildDate).toUTCString()}</lastBuildDate>
    <atom:link href="${CANONICAL_ORIGIN}/feed.xml" rel="self" type="application/rss+xml" />${items}
  </channel>
</rss>`;

  return new Response(body, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
