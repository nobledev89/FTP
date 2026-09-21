import Link from "next/link";

import { Section } from "@/components/public/layout";
import { DateText, Eyebrow } from "@/components/public/meta";
import { TextLink } from "@/components/public/text-link";
import type { ArticleSummary } from "@/components/public/types";

type LatestStreamProps = {
  articles: readonly ArticleSummary[];
};

export function LatestStream({ articles }: LatestStreamProps) {
  return (
    <Section labelledBy="latest-stream-title" tone="dark">
      <header className="grid gap-6 pb-8 lg:grid-cols-12 lg:items-end">
        <div className="lg:col-span-8">
          <div className="mb-5 flex items-center gap-4">
            <span className="bg-signal px-3 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white">
              News desk
            </span>
            <Eyebrow tone="dark">Latest dispatches</Eyebrow>
          </div>
          <h2
            className="font-serif text-4xl leading-none text-white sm:text-5xl"
            id="latest-stream-title"
          >
            What is moving money now
          </h2>
        </div>
        <div className="lg:col-span-4">
          <p className="max-w-sm text-sm leading-6 text-dark-subtle">
            Essential reporting and plain-English analysis from across UK finance.
          </p>
          <TextLink className="mt-4" href="/blog" tone="dark">
            View all
          </TextLink>
        </div>
      </header>

      <ol className="grid border-t border-dark-line sm:grid-cols-2">
        {articles.map((article, index) => (
          <li
            className="border-b border-dark-line sm:odd:border-r sm:odd:pr-6 sm:even:pl-6"
            key={article.slug}
          >
            <Link
              className="group block py-7 transition-[padding] duration-300 hover:pl-2 motion-reduce:transition-none motion-reduce:hover:pl-0"
              href={`/blog/${article.slug}`}
            >
              <div className="flex items-center justify-between gap-4">
                <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-dark-subtle">
                  {String(index + 1).padStart(2, "0")} / {article.category}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-dark-subtle">
                  <DateText value={article.publishedAt} />
                </span>
              </div>
              <h3 className="mt-4 font-serif text-2xl leading-tight text-dark-copy transition-colors group-hover:text-white sm:text-3xl">
                {article.title}
              </h3>
              <p className="mt-3 text-sm leading-6 text-dark-subtle">{article.excerpt}</p>
            </Link>
          </li>
        ))}
      </ol>
    </Section>
  );
}
