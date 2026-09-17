import { ArticleCard } from "@/components/public/article-parts";
import { EmptyState } from "@/components/public/empty-state";
import { FeaturedStory } from "@/components/public/featured-story";
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

  const [featured, ...rest] = fixtureArticles;
  if (!featured) {
    throw new Error("Design review fixtures are empty");
  }
  const payments = fixtureArticles.filter(
    (article) => article.category === "Payments" || article.category === "Lending",
  );

  return (
    <>
      <Masthead date={now} />
      <FeaturedStory article={featured} />
      <LatestStream articles={rest.slice(0, 5)} />
      <Section divider labelledBy="topic-payments">
        <SectionHeading
          cta={{ href: "/blog", label: "More payments" }}
          eyebrow="Topic"
          id="topic-payments"
          title="Payments and lending"
        />
        <div className="grid grid-cols-1 gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
          {payments.slice(0, 3).map((article) => (
            <ArticleCard article={article} key={article.slug} />
          ))}
        </div>
      </Section>
    </>
  );
}
