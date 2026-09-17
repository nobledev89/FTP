import { ArticleFigure, ArticleImage } from "@/components/public/article-image";
import {
  ArticleHeader,
  DisclosureNote,
  RelatedArticles,
  SourceList,
} from "@/components/public/article-parts";
import { Container } from "@/components/public/layout";
import { Prose, proseComponents as md } from "@/components/public/prose";

import {
  fixtureArticles,
  fixtureByline,
  fixtureHeroImages,
  fixtureSources,
} from "../_lib/fixtures";

type PageProps = {
  searchParams: Promise<{ hero?: string }>;
};

/**
 * Article detail with every allowlisted prose element. `?hero=3-2` switches the hero crop and
 * `?hero=none` shows the missing-image placeholder.
 */
export default async function DesignReviewArticlePage({ searchParams }: PageProps) {
  const { hero } = await searchParams;
  const article = fixtureArticles[0];
  if (!article) {
    throw new Error("Design review fixtures are empty");
  }

  return (
    <Container className="py-10" width="article">
      <article>
        <ArticleHeader
          byline={fixtureByline}
          category={article.category}
          excerpt={article.excerpt}
          publishedAt={article.publishedAt}
          title={article.title}
          updatedAt="2026-09-17T12:15:00Z"
        />

        <div className="mb-10">
          {hero === "none" ? (
            <ArticleImage image={null} ratio="hero" sizes="(min-width: 896px) 832px, 100vw" />
          ) : (
            <ArticleFigure
              eager
              image={hero === "3-2" ? fixtureHeroImages["3-2"] : fixtureHeroImages["16-9"]}
              ratio={hero === "3-2" ? "hero-3-2" : "hero"}
              sizes="(min-width: 896px) 832px, 100vw"
            />
          )}
        </div>

        <Prose>
          <md.p>
            This is fixture copy for design review. It exercises the article typography map at the
            real measure, so reviewers can judge line length, rhythm, and hierarchy without any
            published content. The body is set in Geist at 18px with a 32px line height.
          </md.p>
          <md.p>
            Paragraphs can include <md.strong>strong emphasis</md.strong>,{" "}
            <md.em>italic phrasing</md.em>,{" "}
            <md.a href="/design-review/archive">internal links</md.a>, and{" "}
            <md.a href="https://www.fca.org.uk/">external links</md.a> that open in a new tab.
            Inline code such as <md.code>GBP</md.code> uses the mono face.
          </md.p>

          <md.h2 id="what-changes">What changes at checkout</md.h2>
          <md.p>
            Section headings use the editorial serif. They should feel like a newspaper subhead, not
            a product feature heading, and they leave generous space above.
          </md.p>
          <md.ul>
            <md.li>An unordered list item that fits on one line.</md.li>
            <md.li>
              A longer list item that wraps onto a second line to check the hanging indent and the
              32px rhythm between wrapped lines.
            </md.li>
            <md.li>A third item.</md.li>
          </md.ul>

          <md.h3 id="for-retailers">For retailers</md.h3>
          <md.p>Third-level headings are smaller and sit closer to the text they introduce.</md.p>
          <md.ol>
            <md.li>First step in an ordered list.</md.li>
            <md.li>Second step in an ordered list.</md.li>
          </md.ol>

          <md.blockquote>
            <md.p>
              Pull quotes use the serif at 24px with a single thin rule, and no decorative quotation
              marks.
            </md.p>
          </md.blockquote>

          <md.h4 id="fees">Illustrative fee table</md.h4>
          <md.table>
            <md.thead>
              <md.tr>
                <md.th>Method</md.th>
                <md.th>Settlement</md.th>
                <md.th align="right">Example fee</md.th>
              </md.tr>
            </md.thead>
            <md.tbody>
              <md.tr>
                <md.td>Card</md.td>
                <md.td>Batch</md.td>
                <md.td align="right">£0.00</md.td>
              </md.tr>
              <md.tr>
                <md.td>Account to account</md.td>
                <md.td>Near real time</md.td>
                <md.td align="right">£0.00</md.td>
              </md.tr>
            </md.tbody>
          </md.table>
          <md.p>Table figures are placeholders, not real prices.</md.p>

          <md.hr />

          <md.pre>
            <md.code>
              {
                "Preformatted text keeps its spacing\nand scrolls horizontally when a line is too long to fit the measure on a small screen."
              }
            </md.code>
          </md.pre>
          <md.p>
            A final paragraph closes the body before the disclosure, sources, and related articles.
          </md.p>
        </Prose>

        <DisclosureNote>
          This article is general information, not personalised financial advice. FinTechPulse has
          no commercial relationship with the firms mentioned. Fixture disclosure text.
        </DisclosureNote>

        <SourceList sources={fixtureSources} />
      </article>

      <RelatedArticles articles={fixtureArticles.slice(1, 4)} />
    </Container>
  );
}
