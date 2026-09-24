import type { MetadataRoute } from "next";

import { getPublicArticleIndex } from "@/lib/publication/repository";
import { buildSitemap } from "@/lib/publication/sitemaps";

// A metadata route is prerendered at build time unless it opts into request-time rendering, and a
// `revalidate` export alone left production serving the build's article list. Rendering per request
// keeps the sitemap as fresh as the tagged article-index cache, which publication and withdrawal
// already invalidate (docs/SEO-GROWTH-PLAN.md section 4.2).
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return buildSitemap(await getPublicArticleIndex());
}
