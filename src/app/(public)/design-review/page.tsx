import { ArticleCard } from "@/components/public/article-parts";
import { EmptyState } from "@/components/public/empty-state";
import { FrontPageLead } from "@/components/public/front-page-lead";
import { LatestStream } from "@/components/public/latest-stream";
import { Container, Section } from "@/components/public/layout";
import { Masthead } from "@/components/public/masthead";
import { SectionHeading } from "@/components/public/section-heading";

import { fixtureArticles } from "./_lib/fixtures";

type PageProps = {
  searchParams: Promise<{ state?: string }>;
};

/** Home composition with fixture content. `?state=empty` shows the no-articles state. */
export default async function DesignReviewHomePage({ searchParams }: PageProps) {
  const { state } = await searchParams;
  const now = new Date("2026-09-17T08:00:00Z");

  if (state === "empty") {
    return (
      <>
        <Masthead date={now} />
        <Container className="pb-20">
          <EmptyState eyebrow="Latest" title="The first articles are on their way.">
            <p>
              Reporting and analysis on UK banking, payments, lending, investing, insurance, and
              regulation.
            </p>
          </EmptyState>
        </Container>
      </>
    );
  }

  const [primary] = fixtureArticles;
  if (!primary) {
    throw new Error("Design review fixtures are empty");
  }
  const supporting = fixtureArticles.slice(1, 3);
  const latest = fixtureArticles.slice(3, 7);
  const more = fixtureArticles.slice(7, 10);

  return (
    <>
      <Masthead date={now} />
      <FrontPageLead primary={primary} supporting={supporting} />
      <LatestStream articles={latest} />
      <Section divider labelledBy="more-from-the-desk">
        <SectionHeading
          cta={{ href: "/blog", label: "Browse the archive" }}
          eyebrow="Keep reading"
          id="more-from-the-desk"
          title="More from the desk"
        />
        <div className="grid grid-cols-1 gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
          {more.map((article) => (
            <ArticleCard article={article} key={article.slug} />
          ))}
        </div>
      </Section>
    </>
  );
}
