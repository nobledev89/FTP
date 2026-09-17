import { Container } from "@/components/public/layout";
import { PageHeader } from "@/components/public/page-header";
import { Pagination } from "@/components/public/pagination";
import { StreamList } from "@/components/public/stream-list";

import { ARCHIVE_PAGE_SIZE, fixtureArticles } from "../_lib/fixtures";

type PageProps = {
  searchParams: Promise<{ page?: string }>;
};

export default async function DesignReviewArchivePage({ searchParams }: PageProps) {
  const { page: pageParam } = await searchParams;
  const totalPages = Math.max(1, Math.ceil(fixtureArticles.length / ARCHIVE_PAGE_SIZE));
  const requested = Number.parseInt(pageParam ?? "1", 10);
  const page = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), totalPages) : 1;
  const offset = (page - 1) * ARCHIVE_PAGE_SIZE;

  return (
    <Container className="py-10 sm:py-14">
      <PageHeader
        eyebrow="Archive"
        summary="Every FinTechPulse article, newest first."
        title="Latest"
      />
      <div className="mt-10 sm:mt-12">
        <StreamList
          articles={fixtureArticles.slice(offset, offset + ARCHIVE_PAGE_SIZE)}
          headingLevel="h2"
          start={offset + 1}
        />
      </div>
      <Pagination
        hrefForPage={(target) => `/design-review/archive?page=${target}`}
        page={page}
        totalPages={totalPages}
      />
    </Container>
  );
}
