import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/public/empty-state";
import { Container } from "@/components/public/layout";
import { PageHeader } from "@/components/public/page-header";
import { Pagination } from "@/components/public/pagination";
import { StreamList } from "@/components/public/stream-list";
import { archivePageHref, parseArchivePage } from "@/lib/publication/page-number";
import { getPublicArticlePage, PUBLIC_ARCHIVE_PAGE_SIZE } from "@/lib/publication/repository";
import { CANONICAL_ORIGIN, siteConfig } from "@/lib/site/config";

export const revalidate = 300;

type BlogPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function archiveUrl(page: number): string {
  return archivePageHref("/blog", page);
}

export async function generateMetadata({ searchParams }: BlogPageProps): Promise<Metadata> {
  const page = parseArchivePage((await searchParams).page) ?? 1;
  const title = page === 1 ? "Latest" : `Latest — page ${page}`;
  const canonical = `${CANONICAL_ORIGIN}${archiveUrl(page)}`;
  return {
    title,
    description: siteConfig.description,
    alternates: { canonical },
    openGraph: {
      type: "website",
      url: canonical,
      title: `${title} | ${siteConfig.name}`,
      description: siteConfig.description,
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} | ${siteConfig.name}`,
      description: siteConfig.description,
    },
  };
}

export default async function BlogPage({ searchParams }: BlogPageProps) {
  const page = parseArchivePage((await searchParams).page);
  if (page === null) notFound();

  const result = await getPublicArticlePage(page, PUBLIC_ARCHIVE_PAGE_SIZE);
  // Past the last page, or any page but the first of an empty archive, is a missing page.
  if (page > Math.max(result.totalPages, 1)) notFound();

  return (
    <Container className="py-14 sm:py-16 lg:py-20">
      <PageHeader
        eyebrow="Archive"
        summary="Reporting and analysis on the institutions, products, rules, and technology shaping UK finance."
        title="Latest"
      />
      <div className="mt-10">
        {result.articles.length > 0 ? (
          <>
            <StreamList
              articles={result.articles}
              headingLevel="h2"
              start={(page - 1) * result.pageSize + 1}
            />
            <Pagination page={page} totalPages={result.totalPages} hrefForPage={archiveUrl} />
          </>
        ) : (
          <EmptyState eyebrow="Archive" title="No articles have been published yet.">
            <p>The archive will fill as reporting clears the editorial and publication checks.</p>
          </EmptyState>
        )}
      </div>
    </Container>
  );
}
