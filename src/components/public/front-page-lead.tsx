import Link from "next/link";

import { ArticleImage } from "@/components/public/article-image";
import { Container } from "@/components/public/layout";
import { DateText, Eyebrow } from "@/components/public/meta";
import { TextLink } from "@/components/public/text-link";
import type { ArticleSummary } from "@/components/public/types";
import { cn } from "@/lib/utils/cn";

type FrontPageLeadProps = {
  primary: ArticleSummary;
  supporting: readonly ArticleSummary[];
};

export function FrontPageLead({ primary, supporting }: FrontPageLeadProps) {
  const hasSupportingStories = supporting.length > 0;

  return (
    <section aria-labelledby="front-page-title" className="border-t border-line-soft bg-paper">
      <Container className="py-10 sm:py-12 lg:py-14">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
          <div className="flex items-center gap-4">
            <span className="bg-signal px-3 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white">
              Front page
            </span>
            <h2
              className="font-serif text-2xl font-semibold tracking-tight text-ink sm:text-3xl"
              id="front-page-title"
            >
              Top stories
            </h2>
          </div>
          <TextLink href="/blog">
            <span className="sm:hidden">All</span>
            <span className="hidden sm:inline">All stories</span>
          </TextLink>
        </header>

        <div className={cn("grid items-start gap-10", hasSupportingStories && "lg:grid-cols-12")}>
          <Link
            className={cn(
              "group block",
              hasSupportingStories && "lg:col-span-8 lg:border-r lg:border-line lg:pr-10",
            )}
            href={`/blog/${primary.slug}`}
          >
            <ArticleImage
              eager
              image={primary.image}
              interactive
              ratio="hero-3-2"
              sizes={
                hasSupportingStories
                  ? "(min-width: 1024px) 600px, 100vw"
                  : "(min-width: 1024px) 896px, 100vw"
              }
            />
            <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
              <Eyebrow>{primary.category}</Eyebrow>
              <span aria-hidden="true" className="h-px w-8 bg-signal" />
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-subtle">
                <DateText value={primary.publishedAt} />
              </p>
            </div>
            <h3 className="mt-4 max-w-3xl font-serif text-4xl font-semibold leading-[1.05] tracking-tight text-ink transition-colors group-hover:text-signal sm:text-5xl">
              {primary.title}
            </h3>
            <p className="mt-5 max-w-2xl text-base leading-7 text-muted sm:text-lg sm:leading-8">
              {primary.excerpt}
            </p>
          </Link>

          {hasSupportingStories ? (
            <div className="grid gap-8 sm:grid-cols-2 lg:col-span-4 lg:grid-cols-1">
              {supporting.map((article, index) => (
                <Link
                  className={cn(
                    "group block",
                    index > 0 &&
                      "border-t border-line-soft pt-8 sm:border-t-0 sm:pt-0 lg:border-t lg:pt-8",
                  )}
                  href={`/blog/${article.slug}`}
                  key={article.slug}
                >
                  <ArticleImage
                    image={article.image}
                    interactive
                    ratio="card"
                    sizes="(min-width: 1024px) 280px, (min-width: 640px) 45vw, 100vw"
                  />
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <Eyebrow>{article.category}</Eyebrow>
                    <span className="font-mono text-[10px] tracking-[0.18em] text-subtle">
                      0{index + 2}
                    </span>
                  </div>
                  <h3 className="mt-3 font-serif text-2xl font-semibold leading-tight tracking-tight text-ink transition-colors group-hover:text-signal">
                    {article.title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-muted">{article.excerpt}</p>
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      </Container>
    </section>
  );
}
