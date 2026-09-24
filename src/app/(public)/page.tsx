import { ArticleCard } from "@/components/public/article-parts";
import { JsonLd } from "@/components/public/json-ld";
import { EmptyState } from "@/components/public/empty-state";
import { FrontPageLead } from "@/components/public/front-page-lead";
import { LatestStream } from "@/components/public/latest-stream";
import { Container, Section } from "@/components/public/layout";
import { Masthead } from "@/components/public/masthead";
import { SectionHeading } from "@/components/public/section-heading";
import { getPublicArticlePage } from "@/lib/publication/repository";
import { siteGraph } from "@/lib/site/structured-data";

export const revalidate = 300;

export default async function HomePage() {
  const { articles } = await getPublicArticlePage(1, 10);
  const primary = articles[0];
  const supporting = articles.slice(1, 3);
  const latest = articles.slice(3, 7);
  const more = articles.slice(7, 10);

  return (
    <>
      <JsonLd data={siteGraph()} />
      <Masthead date={new Date()} />
      {primary ? (
        <>
          <FrontPageLead primary={primary} supporting={supporting} />
          {latest.length > 0 ? <LatestStream articles={latest} /> : null}
          {more.length > 0 ? (
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
          ) : null}
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
