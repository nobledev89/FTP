import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Breadcrumbs } from "@/components/public/breadcrumbs";
import { JsonLd } from "@/components/public/json-ld";
import { Container } from "@/components/public/layout";
import { PageHeader } from "@/components/public/page-header";
import { Pagination } from "@/components/public/pagination";
import { StreamList } from "@/components/public/stream-list";
import { archivePageHref, parseArchivePage } from "@/lib/publication/page-number";
import {
  getPublicArticleIndex,
  getPublicArticlePage,
  PUBLIC_ARCHIVE_PAGE_SIZE,
} from "@/lib/publication/repository";
import { CANONICAL_ORIGIN, siteConfig } from "@/lib/site/config";
import { authorEntity, authorHref, authorSlug, isEditorialTeam } from "@/lib/site/structured-data";

export const revalidate = 300;

type AuthorPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** The byline whose profile path is `slug`, taken from published articles only. */
async function resolveByline(slug: string): Promise<string | null> {
  const index = await getPublicArticleIndex();
  return index.find((item) => authorSlug(item.bylineName) === slug)?.bylineName ?? null;
}

function summaryFor(name: string): string {
  return isEditorialTeam(name)
    ? `${name} is the shared byline of the ${siteConfig.name} desk. Articles under it are researched, drafted, illustrated, and audited in the publication's automated editorial pipeline and published under the editorial standards and AI policy.`
    : `Articles by ${name} for ${siteConfig.name}.`;
}

export async function generateMetadata({
  params,
  searchParams,
}: AuthorPageProps): Promise<Metadata> {
  const name = await resolveByline((await params).slug);
  if (!name) return { title: "Author not found", robots: { index: false, follow: false } };
  const page = parseArchivePage((await searchParams).page) ?? 1;
  const title = page === 1 ? name : `${name} — page ${page}`;
  const canonical = `${CANONICAL_ORIGIN}${archivePageHref(authorHref(name), page)}`;
  return {
    title,
    description: summaryFor(name),
    alternates: { canonical },
    openGraph: { type: "profile", url: canonical, title: `${title} | ${siteConfig.name}` },
  };
}

export default async function AuthorPage({ params, searchParams }: AuthorPageProps) {
  const name = await resolveByline((await params).slug);
  if (!name) notFound();
  const page = parseArchivePage((await searchParams).page);
  if (page === null) notFound();

  const result = await getPublicArticlePage(page, PUBLIC_ARCHIVE_PAGE_SIZE, { byline: name });
  if (page > Math.max(result.totalPages, 1)) notFound();
  const team = isEditorialTeam(name);

  return (
    <Container className="py-14 sm:py-16 lg:py-20">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "ProfilePage",
          url: `${CANONICAL_ORIGIN}${authorHref(name)}`,
          mainEntity: authorEntity(name),
        }}
      />
      <Breadcrumbs
        items={[
          { name: "About", href: "/about" },
          { name, href: authorHref(name) },
        ]}
      />
      <PageHeader
        eyebrow={team ? "Editorial desk" : "Author"}
        summary={summaryFor(name)}
        title={name}
      />
      {team ? (
        <p className="mt-6 max-w-prose-measure text-sm leading-6 text-muted">
          How these articles are made is set out in the{" "}
          <Link className="border-b border-line text-ink hover:border-ink" href="/ai-policy">
            AI policy
          </Link>{" "}
          and the{" "}
          <Link
            className="border-b border-line text-ink hover:border-ink"
            href="/editorial-standards"
          >
            editorial standards
          </Link>
          .
        </p>
      ) : null}
      <section aria-labelledby="author-articles" className="mt-12">
        <h2
          className="mb-6 font-mono text-[11px] uppercase tracking-[0.24em] text-subtle"
          id="author-articles"
        >
          Articles
        </h2>
        <StreamList articles={result.articles} start={(page - 1) * result.pageSize + 1} />
        <Pagination
          hrefForPage={(target) => archivePageHref(authorHref(name), target)}
          page={page}
          totalPages={result.totalPages}
        />
      </section>
    </Container>
  );
}
