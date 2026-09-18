import { z } from "zod";

import type {
  ArticleSummary,
  Byline,
  ImageAsset,
  SourceReference,
} from "@/components/public/types";
import { CANONICAL_ORIGIN } from "@/lib/site/config";

const slugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(120);

const isoTimestampSchema = z.iso.datetime({ offset: true });
const publicationStatusSchema = z.enum(["published", "verified"]);

const heroImageSchema = z
  .object({
    path: z
      .string()
      .regex(/^articles\/[a-z0-9]+(?:-[a-z0-9]+)*\/[A-Za-z0-9._/-]+$/)
      .refine((value) => !value.includes(".."), "image paths cannot contain traversal segments"),
    alt: z.string().trim().min(1).max(300),
    caption: z.string().trim().min(1).max(1000).nullish(),
    aspect_ratio: z.enum(["16:9", "4:5", "3:2", "1:1"]).nullish(),
    width: z.number().int().positive().nullish(),
    height: z.number().int().positive().nullish(),
    focal_x: z.number().min(0).max(100).nullish(),
    focal_y: z.number().min(0).max(100).nullish(),
  })
  .strict();

const sourceSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    publisher: z.string().trim().min(1).max(200).nullish(),
    url: z.url().refine((value) => {
      const protocol = new URL(value).protocol;
      return protocol === "https:" || protocol === "http:";
    }, "source URLs must use http or https"),
    published_on: z.iso.date().nullish(),
    accessed_at: isoTimestampSchema,
    jurisdiction: z
      .string()
      .regex(/^[A-Z]{2,6}$/)
      .nullish(),
  })
  .strict();

const publicArticleRowBaseSchema = z
  .object({
    id: z.uuid(),
    slug: slugSchema,
    title: z.string().trim().min(1).max(200),
    excerpt: z.string().trim().min(1).max(500),
    body_markdown: z.string().trim().min(1).max(200_000),
    meta_title: z.string().trim().min(1).max(70),
    meta_description: z.string().trim().min(1).max(320),
    category: z.string().trim().min(1).max(60).nullable(),
    article_type: z.enum(["news", "analysis", "explainer", "guide", "company", "interview"]),
    byline_name: z.string().trim().min(1).max(120),
    byline_role: z.string().trim().min(1).max(120).nullable(),
    canonical_url: z.url(),
    hero_image: heroImageSchema.nullable(),
    source_references: z.array(sourceSchema).max(100),
    status: publicationStatusSchema,
    published_at: isoTimestampSchema,
    content_updated_at: isoTimestampSchema.nullable(),
    verified_at: isoTimestampSchema.nullable(),
    updated_at: isoTimestampSchema,
  })
  .strict();

export const publicArticleRowSchema = publicArticleRowBaseSchema.superRefine((article, context) => {
  const expected = `${CANONICAL_ORIGIN}/blog/${article.slug}`;
  if (article.canonical_url !== expected) {
    context.addIssue({
      code: "custom",
      path: ["canonical_url"],
      message: `canonical URL must be ${expected}`,
    });
  }
});

export const publicArticleIndexRowSchema = publicArticleRowBaseSchema.pick({
  id: true,
  slug: true,
  title: true,
  excerpt: true,
  category: true,
  hero_image: true,
  status: true,
  published_at: true,
  content_updated_at: true,
  updated_at: true,
});

export type PublicArticleRow = z.infer<typeof publicArticleRowSchema>;
export type PublicArticleIndexRow = z.infer<typeof publicArticleIndexRowSchema>;

export type PublicArticle = ArticleSummary & {
  readonly id: string;
  readonly bodyMarkdown: string;
  readonly metaTitle: string;
  readonly metaDescription: string;
  readonly articleType: "news" | "analysis" | "explainer" | "guide" | "company" | "interview";
  readonly byline: Byline;
  readonly canonicalUrl: string;
  readonly sources: readonly SourceReference[];
  readonly updatedAt: string | null;
  readonly verifiedAt: string | null;
};

export function parsePublicSlug(value: string): string | null {
  const parsed = slugSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function publicImageUrl(path: string, supabaseUrl: string): string {
  const base = new URL(supabaseUrl);
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return new URL(`/storage/v1/object/public/article-public/${encodedPath}`, base).toString();
}

function toImageAsset(
  image: z.infer<typeof heroImageSchema> | null,
  supabaseUrl: string,
): ImageAsset | null {
  if (!image) return null;
  return {
    src: publicImageUrl(image.path, supabaseUrl),
    alt: image.alt,
    ...(image.caption ? { caption: image.caption } : {}),
    ...(image.aspect_ratio ? { aspectRatio: image.aspect_ratio } : {}),
    ...(image.focal_x !== null &&
    image.focal_x !== undefined &&
    image.focal_y !== null &&
    image.focal_y !== undefined
      ? { focalPoint: { x: image.focal_x, y: image.focal_y } }
      : {}),
  };
}

function category(value: string | null): string {
  return value ?? "Analysis";
}

export function toArticleSummary(row: PublicArticleIndexRow, supabaseUrl: string): ArticleSummary {
  return {
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    category: category(row.category),
    publishedAt: row.published_at,
    image: toImageAsset(row.hero_image, supabaseUrl),
  };
}

export function toPublicArticle(row: PublicArticleRow, supabaseUrl: string): PublicArticle {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    category: category(row.category),
    publishedAt: row.published_at,
    image: toImageAsset(row.hero_image, supabaseUrl),
    bodyMarkdown: row.body_markdown,
    metaTitle: row.meta_title,
    metaDescription: row.meta_description,
    articleType: row.article_type,
    byline: {
      name: row.byline_name,
      ...(row.byline_role ? { role: row.byline_role } : {}),
    },
    canonicalUrl: row.canonical_url,
    sources: row.source_references.map((source, index) => ({
      id: `source-${index + 1}`,
      title: source.title,
      publisher: source.publisher ?? new URL(source.url).hostname,
      url: source.url,
      publishedAt: source.published_on ?? null,
      accessedAt: source.accessed_at,
    })),
    updatedAt: row.content_updated_at,
    verifiedAt: row.verified_at,
  };
}
