// Adapted from Paperframe `StreamList` and `RecentStreamList` (MIT), see THIRD_PARTY_NOTICES.md.
// Metadata stacks above the title below 640px (DESIGN-SYSTEM.md deviation D5).
import Link from "next/link";

import { DateText } from "@/components/public/meta";
import type { ArticleSummary } from "@/components/public/types";
import { cn } from "@/lib/utils/cn";

type StreamListProps = {
  articles: readonly ArticleSummary[];
  tone?: "paper" | "dark";
  /** Number of the first item, so paginated archives keep continuous numbering. */
  start?: number;
  headingLevel?: "h2" | "h3";
};

export function StreamList({
  articles,
  tone = "paper",
  start = 1,
  headingLevel = "h3",
}: StreamListProps) {
  const dark = tone === "dark";
  const Heading = headingLevel;

  return (
    <ol className={cn("border-t", dark ? "border-dark-line" : "border-line")} start={start}>
      {articles.map((article, index) => (
        <li
          className={cn("border-b", dark ? "border-dark-line" : "border-line-soft")}
          key={article.slug}
        >
          <Link
            className="group block px-1 py-6 transition-[padding] duration-300 hover:px-3 motion-reduce:transition-none motion-reduce:hover:px-1"
            href={`/blog/${article.slug}`}
          >
            <div className="grid grid-cols-12 items-baseline gap-x-4 gap-y-2">
              <div
                aria-hidden="true"
                className={cn(
                  "col-span-2 font-mono text-[11px] uppercase tracking-[0.18em] sm:col-span-2",
                  dark ? "text-dark-subtle" : "text-subtle",
                )}
              >
                {String(start + index).padStart(2, "0")}
              </div>
              <div
                className={cn(
                  "col-span-10 font-mono text-[11px] uppercase tracking-[0.18em] sm:col-span-3",
                  dark ? "text-dark-subtle" : "text-subtle",
                )}
              >
                <DateText value={article.publishedAt} />
                <span className="sm:hidden"> · {article.category}</span>
              </div>
              <div className="col-span-12 sm:col-span-7">
                <Heading
                  className={cn(
                    "font-serif text-xl leading-snug transition-colors",
                    dark
                      ? "text-dark-copy group-hover:text-white"
                      : "text-ink group-hover:text-muted",
                  )}
                >
                  {article.title}
                </Heading>
                <p
                  className={cn("mt-2 text-sm leading-6", dark ? "text-dark-subtle" : "text-muted")}
                >
                  {article.excerpt}
                </p>
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ol>
  );
}
