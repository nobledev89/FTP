// Article detail parts. Header adapted from Paperframe `ArticleDetailTemplate` (MIT), see
// THIRD_PARTY_NOTICES.md. Byline, dates, disclosure, and sources are FinTechPulse trust features.
import Link from "next/link";
import type { ReactNode } from "react";

import { ArticleImage } from "@/components/public/article-image";
import { DateText, Eyebrow } from "@/components/public/meta";
import type { ArticleSummary, Byline, SourceReference } from "@/components/public/types";

type ArticleHeaderProps = {
  category: string;
  title: string;
  excerpt: string;
  byline: Byline;
  publishedAt: string;
  updatedAt?: string | null;
};

export function ArticleHeader({
  category,
  title,
  excerpt,
  byline,
  publishedAt,
  updatedAt,
}: ArticleHeaderProps) {
  return (
    <header className="mb-10 border-b border-line-soft pb-8">
      <Eyebrow>{category}</Eyebrow>
      <h1 className="mt-4 font-serif text-5xl font-semibold leading-tight tracking-tight text-ink sm:text-6xl">
        {title}
      </h1>
      <p className="mt-5 max-w-3xl text-lg leading-8 text-muted">{excerpt}</p>
      <div className="mt-8 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-8">
        <p className="text-sm text-ink">
          By <span className="font-medium">{byline.name}</span>
          {byline.role ? <span className="text-muted">, {byline.role}</span> : null}
        </p>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 font-mono text-[11px] uppercase tracking-[0.18em] text-subtle">
          <div className="flex gap-2">
            <dt>Published</dt>
            <dd>
              <DateText value={publishedAt} />
            </dd>
          </div>
          {updatedAt ? (
            <div className="flex gap-2">
              <dt>Updated</dt>
              <dd>
                <DateText value={updatedAt} />
              </dd>
            </div>
          ) : null}
        </dl>
      </div>
    </header>
  );
}

type DisclosureNoteProps = {
  children: ReactNode;
};

/** Article-level disclosure. Visually subordinate, never hidden. */
export function DisclosureNote({ children }: DisclosureNoteProps) {
  return (
    <aside
      aria-label="Disclosure"
      className="mt-12 max-w-prose-measure border-t border-line-soft pt-6"
    >
      <p className="text-sm leading-6 text-muted">{children}</p>
    </aside>
  );
}

type SourceListProps = {
  sources: readonly SourceReference[];
};

/** Structured source references rendered from data, never from embedded HTML. */
export function SourceList({ sources }: SourceListProps) {
  if (sources.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="article-sources" className="mt-12 max-w-prose-measure">
      <h2
        className="font-mono text-[11px] uppercase tracking-[0.24em] text-subtle"
        id="article-sources"
      >
        Sources
      </h2>
      <ol className="mt-4 border-t border-line">
        {sources.map((source, index) => (
          <li
            className="grid grid-cols-[2.5rem_1fr] gap-x-2 border-b border-line-soft py-4"
            id={`source-${source.id}`}
            key={source.id}
          >
            <span
              aria-hidden="true"
              className="font-mono text-[11px] tracking-[0.18em] text-subtle"
            >
              {String(index + 1).padStart(2, "0")}
            </span>
            <div>
              <a
                className="border-b border-line text-base leading-7 text-ink transition-colors hover:border-ink"
                href={source.url}
                rel="noopener noreferrer"
                target="_blank"
              >
                {source.title}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
              <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-subtle">
                {source.publisher}
                {source.publishedAt ? (
                  <>
                    {" · "}
                    <DateText value={source.publishedAt} />
                  </>
                ) : null}
                {" · Accessed "}
                <DateText value={source.accessedAt} />
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

type ArticleCardProps = {
  article: ArticleSummary;
  headingLevel?: "h2" | "h3";
};

export function ArticleCard({ article, headingLevel = "h3" }: ArticleCardProps) {
  const Heading = headingLevel;
  return (
    <Link className="group block" href={`/blog/${article.slug}`}>
      <ArticleImage
        image={article.image}
        interactive
        ratio="card"
        sizes="(min-width: 1024px) 300px, (min-width: 640px) 45vw, 100vw"
      />
      <Eyebrow className="mt-5">{article.category}</Eyebrow>
      <Heading className="mt-3 font-serif text-2xl font-semibold leading-snug tracking-tight text-ink transition-colors group-hover:text-muted">
        {article.title}
      </Heading>
      <p className="mt-2 text-sm leading-6 text-muted">{article.excerpt}</p>
      <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.18em] text-subtle">
        <DateText value={article.publishedAt} />
      </p>
    </Link>
  );
}

type RelatedArticlesProps = {
  articles: readonly ArticleSummary[];
};

export function RelatedArticles({ articles }: RelatedArticlesProps) {
  if (articles.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="related-articles" className="mt-16 border-t border-line pt-10">
      <h2
        className="font-mono text-[11px] uppercase tracking-[0.24em] text-subtle"
        id="related-articles"
      >
        Related
      </h2>
      <div className="mt-8 grid grid-cols-1 gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
        {articles.map((article) => (
          <ArticleCard article={article} key={article.slug} />
        ))}
      </div>
    </section>
  );
}
