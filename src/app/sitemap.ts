import type { MetadataRoute } from "next";

import { getPublicArticleIndex } from "@/lib/publication/repository";
import { CANONICAL_ORIGIN } from "@/lib/site/config";

export const revalidate = 300;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const articles = await getPublicArticleIndex();
  return [
    {
      url: CANONICAL_ORIGIN,
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${CANONICAL_ORIGIN}/blog`,
      changeFrequency: "daily",
      priority: 0.9,
    },
    ...articles.map((article) => ({
      url: `${CANONICAL_ORIGIN}/blog/${article.slug}`,
      lastModified: article.updatedAt ?? article.publishedAt,
      changeFrequency: "weekly" as const,
      priority: 0.8,
      ...(article.imageUrl ? { images: [article.imageUrl] } : {}),
    })),
  ];
}
