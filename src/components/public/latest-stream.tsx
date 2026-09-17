// Adapted from Paperframe `RecentStreamList` (MIT), see THIRD_PARTY_NOTICES.md.
import { Section } from "@/components/public/layout";
import { Eyebrow } from "@/components/public/meta";
import { StreamList } from "@/components/public/stream-list";
import { TextLink } from "@/components/public/text-link";
import type { ArticleSummary } from "@/components/public/types";

type LatestStreamProps = {
  articles: readonly ArticleSummary[];
};

export function LatestStream({ articles }: LatestStreamProps) {
  return (
    <Section labelledBy="latest-stream-title" tone="dark">
      <div className="grid gap-10 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <Eyebrow className="mb-4" tone="dark">
            Latest
          </Eyebrow>
          <h2
            className="font-serif text-4xl leading-[1.1] text-white sm:text-5xl"
            id="latest-stream-title"
          >
            The latest from UK finance
          </h2>
          <p className="mt-6 max-w-xs font-serif text-sm leading-relaxed text-dark-subtle">
            Reporting and analysis, newest first.
          </p>
          <TextLink className="mt-6" href="/blog" tone="dark">
            View all
          </TextLink>
        </div>
        <div className="lg:col-span-8">
          <StreamList articles={articles} tone="dark" />
        </div>
      </div>
    </Section>
  );
}
