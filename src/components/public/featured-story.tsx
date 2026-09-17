// Adapted from Paperframe `FeaturedArticle` (MIT), see THIRD_PARTY_NOTICES.md.
import Link from "next/link";

import { ArticleImage } from "@/components/public/article-image";
import { Section } from "@/components/public/layout";
import { DateText, Eyebrow } from "@/components/public/meta";
import type { ArticleSummary } from "@/components/public/types";

type FeaturedStoryProps = {
  article: ArticleSummary;
};

export function FeaturedStory({ article }: FeaturedStoryProps) {
  return (
    <Section divider labelledBy="featured-story-title">
      <Eyebrow className="mb-8 sm:mb-10">Featured</Eyebrow>
      <Link className="group block" href={`/blog/${article.slug}`}>
        <div className="grid items-start gap-8 lg:grid-cols-12 lg:gap-10">
          <div className="order-2 lg:order-1 lg:col-span-7">
            <Eyebrow className="mb-4">{article.category}</Eyebrow>
            <h2
              className="font-serif text-4xl font-semibold leading-tight tracking-tight text-ink transition-colors group-hover:text-muted sm:text-5xl"
              id="featured-story-title"
            >
              {article.title}
            </h2>
            <p className="mt-6 font-serif text-lg leading-relaxed text-muted">{article.excerpt}</p>
            <div className="mt-8 flex items-center gap-4 font-mono text-[11px] uppercase tracking-[0.18em] text-subtle">
              <DateText value={article.publishedAt} />
              <span aria-hidden="true" className="h-px flex-1 bg-line" />
              <span aria-hidden="true" className="transition-colors group-hover:text-ink">
                Read
              </span>
            </div>
          </div>
          <div className="order-1 lg:order-2 lg:col-span-5">
            <ArticleImage
              eager
              image={article.image}
              interactive
              ratio="feature"
              sizes="(min-width: 1024px) 400px, (min-width: 640px) 90vw, 100vw"
            />
          </div>
        </div>
      </Link>
    </Section>
  );
}
