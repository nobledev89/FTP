import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Breadcrumbs } from "@/components/public/breadcrumbs";
import { EmptyState } from "@/components/public/empty-state";
import { Container } from "@/components/public/layout";
import { PageHeader } from "@/components/public/page-header";
import { Pagination } from "@/components/public/pagination";
import { StreamList } from "@/components/public/stream-list";
import { archivePageHref, parseArchivePage } from "@/lib/publication/page-number";
import { getPublicArticlePage, PUBLIC_ARCHIVE_PAGE_SIZE } from "@/lib/publication/repository";
import { CANONICAL_ORIGIN, siteConfig } from "@/lib/site/config";
import {
  getTopic,
  storedCategoryVariants,
  TOPIC_MIN_INDEXABLE_ARTICLES,
  topicHref,
  TOPICS,
  type Topic,
} from "@/lib/site/topics";

export const revalidate = 300;

type TopicPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export function generateStaticParams() {
  return TOPICS.map((topic) => ({ slug: topic.slug }));
}

function topicPage(topic: Topic, page: number) {
  return getPublicArticlePage(page, PUBLIC_ARCHIVE_PAGE_SIZE, {
    categories: storedCategoryVariants(topic.categories),
  });
}

export async function generateMetadata({
  params,
  searchParams,
}: TopicPageProps): Promise<Metadata> {
  const topic = getTopic((await params).slug);
  if (!topic) return { title: "Topic not found", robots: { index: false, follow: false } };

  const page = parseArchivePage((await searchParams).page) ?? 1;
  const { total } = await topicPage(topic, 1);
  const title = page === 1 ? topic.title : `${topic.title} — page ${page}`;
  const canonical = `${CANONICAL_ORIGIN}${archivePageHref(topicHref(topic), page)}`;
  return {
    title,
    description: topic.description,
    alternates: { canonical },
    // A hub that cannot yet show real depth stays out of the index (plan section 10, quarterly).
    ...(total < TOPIC_MIN_INDEXABLE_ARTICLES ? { robots: { index: false, follow: true } } : {}),
    openGraph: {
      type: "website",
      url: canonical,
      title: `${title} | ${siteConfig.name}`,
      description: topic.description,
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} | ${siteConfig.name}`,
      description: topic.description,
    },
  };
}

export default async function TopicPage({ params, searchParams }: TopicPageProps) {
  const topic = getTopic((await params).slug);
  if (!topic) notFound();
  const page = parseArchivePage((await searchParams).page);
  if (page === null) notFound();

  const result = await topicPage(topic, page);
  if (page > Math.max(result.totalPages, 1)) notFound();
  const others = TOPICS.filter((other) => other.slug !== topic.slug);

  return (
    <Container className="py-14 sm:py-16 lg:py-20">
      <Breadcrumbs
        items={[
          { name: "Topics", href: "/topics" },
          { name: topic.name, href: topicHref(topic) },
        ]}
      />
      <PageHeader eyebrow="Topic" summary={topic.description} title={topic.title} />
      {page === 1 ? (
        <div className="mt-8 max-w-prose-measure space-y-4 text-base leading-7 text-muted">
          {topic.intro.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      ) : null}
      <section aria-labelledby="topic-latest" className="mt-12">
        <h2
          className="mb-6 font-mono text-[11px] uppercase tracking-[0.24em] text-subtle"
          id="topic-latest"
        >
          Latest on {topic.name}
        </h2>
        {result.articles.length > 0 ? (
          <>
            <StreamList articles={result.articles} start={(page - 1) * result.pageSize + 1} />
            <Pagination
              hrefForPage={(target) => archivePageHref(topicHref(topic), target)}
              page={page}
              totalPages={result.totalPages}
            />
          </>
        ) : (
          <EmptyState eyebrow="Topic" title={`No ${topic.name} articles yet.`}>
            <p>New reporting on this topic will appear here as it is published.</p>
          </EmptyState>
        )}
      </section>
      <nav aria-labelledby="other-topics" className="mt-16 border-t border-line pt-8">
        <h2
          className="font-mono text-[11px] uppercase tracking-[0.24em] text-subtle"
          id="other-topics"
        >
          Other topics
        </h2>
        <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-1">
          {others.map((other) => (
            <li key={other.slug}>
              <Link
                className="inline-flex min-h-10 items-center border-b border-line text-base text-ink transition-colors hover:border-ink"
                href={topicHref(other)}
              >
                {other.title}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </Container>
  );
}
