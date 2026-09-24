import { getPublicArticleIndex } from "@/lib/publication/repository";
import { newsSitemapArticles, renderNewsSitemap } from "@/lib/publication/sitemaps";

// The two-day window moves with the clock, so this is rendered per request over the cached index.
export const dynamic = "force-dynamic";

export async function GET() {
  const articles = newsSitemapArticles(await getPublicArticleIndex());
  return new Response(renderNewsSitemap(articles), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
