import { EmptyState } from "@/components/public/empty-state";
import { FeaturedStory } from "@/components/public/featured-story";
import { LatestStream } from "@/components/public/latest-stream";
import { Container } from "@/components/public/layout";
import { Masthead } from "@/components/public/masthead";
import { getPublicArticlePage } from "@/lib/publication/repository";

export const revalidate = 300;

export default async function HomePage() {
  const { articles } = await getPublicArticlePage(1, 7);
  const featured = articles[0];
  const latest = articles.slice(1);

  return (
    <>
      <Masthead date={new Date()} />
      {featured ? (
        <>
          <FeaturedStory article={featured} />
          {latest.length > 0 ? <LatestStream articles={latest} /> : null}
        </>
      ) : (
        <Container className="pb-20">
          <EmptyState eyebrow="Latest" title="The first articles are on their way.">
            <p>
              Reporting and analysis on UK banking, payments, lending, investing, insurance, and
              regulation.
            </p>
          </EmptyState>
        </Container>
      )}
    </>
  );
}
