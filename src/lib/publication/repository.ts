import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";
import { cache } from "react";
import { z } from "zod";

import type { ArticleSummary } from "@/components/public/types";
import type { Database } from "@/lib/supabase/database.types";
import { readSupabaseEnv } from "@/lib/supabase/env";

import {
  parsePublicSlug,
  publicArticleIndexRowSchema,
  publicArticleRowSchema,
  toArticleSummary,
  toPublicArticle,
  type PublicArticle,
} from "./schema";

type Client = SupabaseClient<Database>;

const PUBLIC_ARTICLE_COLUMNS =
  "id, slug, title, excerpt, body_markdown, meta_title, meta_description, category, article_type, byline_name, byline_role, canonical_url, hero_image, source_references, status, published_at, content_updated_at, verified_at, updated_at" as const;
const PUBLIC_INDEX_COLUMNS =
  "id, slug, title, excerpt, category, hero_image, status, published_at, content_updated_at, updated_at" as const;

export const PUBLIC_ARTICLES_TAG = "public:articles";
export const PUBLIC_CACHE_SECONDS = 300;
export const PUBLIC_ARCHIVE_PAGE_SIZE = 10;

export type PublicArticlePage = Readonly<{
  articles: readonly ArticleSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}>;

export type PublicArticleIndexItem = Readonly<{
  slug: string;
  publishedAt: string;
  updatedAt: string | null;
  imageUrl: string | null;
}>;

export type PublicArticleResolution = Readonly<{
  article: PublicArticle;
  alias: boolean;
}>;

export function publicArticleTag(slug: string): string {
  return `public:article:${slug}`;
}

function databaseFailure(operation: string, error: unknown): Error {
  const detail =
    error && typeof error === "object" && "message" in error
      ? String(error.message)
      : "unknown database error";
  return new Error(`Unable to ${operation}: ${detail}`, { cause: error });
}

/**
 * Public queries use a sessionless publishable-key client. RLS remains the final eligibility gate:
 * this client cannot read jobs, drafts, future publications, or withdrawn articles.
 */
function createPublicClient(): { client: Client; supabaseUrl: string } | null {
  let env;
  try {
    env = readSupabaseEnv();
  } catch {
    // Clean builds intentionally work before Supabase is configured.
    return null;
  }

  // The signed-out Playwright build deliberately supplies an offline placeholder. Treating it as
  // unconfigured keeps that suite independent from a local database without masking real outages.
  if (env.publishableKey.includes("_placeholder_")) return null;

  return {
    supabaseUrl: env.url,
    client: createClient<Database>(env.url, env.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    }),
  };
}

const positivePageSchema = z.number().int().positive().max(100_000);
const pageSizeSchema = z.number().int().min(1).max(100);

async function queryArticlePage(
  pageInput: number,
  pageSizeInput: number,
): Promise<PublicArticlePage> {
  const page = positivePageSchema.parse(pageInput);
  const pageSize = pageSizeSchema.parse(pageSizeInput);
  const connection = createPublicClient();
  if (!connection) return { articles: [], page, pageSize, total: 0, totalPages: 0 };

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const { data, error, count } = await connection.client
    .from("articles")
    .select(PUBLIC_INDEX_COLUMNS, { count: "exact" })
    .order("published_at", { ascending: false })
    .range(from, to);
  if (error) throw databaseFailure("load the public archive", error);

  const rows = publicArticleIndexRowSchema.array().parse(data ?? []);
  const total = count ?? rows.length;
  return {
    articles: rows.map((row) => toArticleSummary(row, connection.supabaseUrl)),
    page,
    pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
  };
}

export function getPublicArticlePage(
  page = 1,
  pageSize = PUBLIC_ARCHIVE_PAGE_SIZE,
): Promise<PublicArticlePage> {
  const safePage = positivePageSchema.parse(page);
  const safePageSize = pageSizeSchema.parse(pageSize);
  return unstable_cache(
    () => queryArticlePage(safePage, safePageSize),
    ["public-article-page", String(safePage), String(safePageSize)],
    { tags: [PUBLIC_ARTICLES_TAG], revalidate: PUBLIC_CACHE_SECONDS },
  )();
}

async function queryArticleBySlug(slug: string): Promise<PublicArticle | null> {
  const connection = createPublicClient();
  if (!connection) return null;
  const { data, error } = await connection.client
    .from("articles")
    .select(PUBLIC_ARTICLE_COLUMNS)
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw databaseFailure("load the public article", error);
  return data ? toPublicArticle(publicArticleRowSchema.parse(data), connection.supabaseUrl) : null;
}

async function queryArticleById(id: string): Promise<PublicArticle | null> {
  const connection = createPublicClient();
  if (!connection) return null;
  const { data, error } = await connection.client
    .from("articles")
    .select(PUBLIC_ARTICLE_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw databaseFailure("load the aliased public article", error);
  return data ? toPublicArticle(publicArticleRowSchema.parse(data), connection.supabaseUrl) : null;
}

async function queryAliasArticleId(slug: string): Promise<string | null> {
  const connection = createPublicClient();
  if (!connection) return null;
  const { data, error } = await connection.client
    .from("article_slug_aliases")
    .select("article_id")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw databaseFailure("resolve the public article alias", error);
  return data?.article_id ?? null;
}

export const resolvePublicArticle = cache(
  async (slugInput: string): Promise<PublicArticleResolution | null> => {
    const slug = parsePublicSlug(slugInput);
    if (!slug) return null;
    return unstable_cache(
      async () => {
        const direct = await queryArticleBySlug(slug);
        if (direct) return { article: direct, alias: false };
        const articleId = await queryAliasArticleId(slug);
        if (!articleId) return null;
        const article = await queryArticleById(articleId);
        return article ? { article, alias: true } : null;
      },
      ["public-article-resolution", slug],
      { tags: [PUBLIC_ARTICLES_TAG, publicArticleTag(slug)], revalidate: PUBLIC_CACHE_SECONDS },
    )();
  },
);

export async function getRelatedPublicArticles(
  article: Pick<PublicArticle, "slug" | "category">,
  limit = 3,
): Promise<readonly ArticleSummary[]> {
  const safeLimit = z.number().int().min(1).max(12).parse(limit);
  return unstable_cache(
    async () => {
      const connection = createPublicClient();
      if (!connection) return [];
      const { data, error } = await connection.client
        .from("articles")
        .select(PUBLIC_INDEX_COLUMNS)
        .eq("category", article.category)
        .neq("slug", article.slug)
        .order("published_at", { ascending: false })
        .limit(safeLimit);
      if (error) throw databaseFailure("load related public articles", error);
      return publicArticleIndexRowSchema
        .array()
        .parse(data ?? [])
        .map((row) => toArticleSummary(row, connection.supabaseUrl));
    },
    ["public-related-articles", article.slug, article.category, String(safeLimit)],
    {
      tags: [PUBLIC_ARTICLES_TAG, publicArticleTag(article.slug)],
      revalidate: PUBLIC_CACHE_SECONDS,
    },
  )();
}

export function getPublicArticleIndex(limit = 50_000): Promise<readonly PublicArticleIndexItem[]> {
  const safeLimit = z.number().int().min(1).max(50_000).parse(limit);
  return unstable_cache(
    async () => {
      const connection = createPublicClient();
      if (!connection) return [];
      const { data, error } = await connection.client
        .from("articles")
        .select(PUBLIC_INDEX_COLUMNS)
        .order("published_at", { ascending: false })
        .limit(safeLimit);
      if (error) throw databaseFailure("load the public article index", error);
      return publicArticleIndexRowSchema
        .array()
        .parse(data ?? [])
        .map((row) => {
          const summary = toArticleSummary(row, connection.supabaseUrl);
          return {
            slug: row.slug,
            publishedAt: row.published_at,
            updatedAt: row.content_updated_at ?? row.updated_at,
            imageUrl: summary.image?.src ?? null,
          };
        });
    },
    ["public-article-index", String(safeLimit)],
    { tags: [PUBLIC_ARTICLES_TAG], revalidate: PUBLIC_CACHE_SECONDS },
  )();
}
