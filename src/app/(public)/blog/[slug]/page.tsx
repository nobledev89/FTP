import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

import {
  ArticleHeader,
  DisclosureNote,
  RelatedArticles,
  SourceList,
} from "@/components/public/article-parts";
import { ArticleFigure } from "@/components/public/article-image";
import { Breadcrumbs } from "@/components/public/breadcrumbs";
import { JsonLd } from "@/components/public/json-ld";
import { Container } from "@/components/public/layout";
import { SafeMarkdown } from "@/components/public/markdown";
import { getRelatedPublicArticles, resolvePublicArticle } from "@/lib/publication/repository";
import { LOGO_URL, ORGANIZATION_ID, siteConfig, WEBSITE_ID } from "@/lib/site/config";
import { authorEntity, authorHref } from "@/lib/site/structured-data";
import { storedCategoryVariants, topicForCategory, topicHref } from "@/lib/site/topics";

export const revalidate = 300;

type ArticlePageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: ArticlePageProps): Promise<Metadata> {
  const resolution = await resolvePublicArticle((await params).slug);
  if (!resolution) {
    return { title: "Article not found", robots: { index: false, follow: false } };
  }

  const { article } = resolution;
  return {
    title: { absolute: `${article.title} | ${siteConfig.name}` },
    description: article.metaDescription,
    alternates: { canonical: article.canonicalUrl },
    openGraph: {
      type: "article",
      url: article.canonicalUrl,
      title: article.metaTitle,
      description: article.metaDescription,
      siteName: siteConfig.name,
      locale: "en_GB",
      publishedTime: article.publishedAt,
      modifiedTime: article.updatedAt ?? undefined,
      authors: [article.byline.name],
    },
    twitter: {
      card: "summary_large_image",
      title: article.metaTitle,
      description: article.metaDescription,
    },
  };
}

export default async function ArticlePage({ params }: ArticlePageProps) {
  const requestedSlug = (await params).slug;
  const resolution = await resolvePublicArticle(requestedSlug);
  if (!resolution) notFound();
  if (resolution.alias) permanentRedirect(`/blog/${resolution.article.slug}`);

  const { article } = resolution;
  const topic = topicForCategory(article.category);
  const related = await getRelatedPublicArticles(
    article,
    storedCategoryVariants(topic ? topic.categories : [article.category]),
  );
  const structuredData = {
    "@context": "https://schema.org",
    "@type": article.articleType === "news" ? "NewsArticle" : "Article",
    mainEntityOfPage: { "@type": "WebPage", "@id": article.canonicalUrl },
    headline: article.title,
    description: article.metaDescription,
    datePublished: article.publishedAt,
    dateModified: article.updatedAt ?? article.publishedAt,
    inLanguage: siteConfig.locale,
    articleSection: topic?.name ?? article.category,
    author: [authorEntity(article.byline.name)],
    publisher: {
      "@type": "NewsMediaOrganization",
      "@id": ORGANIZATION_ID,
      name: siteConfig.name,
      logo: { "@type": "ImageObject", url: LOGO_URL, width: 512, height: 512 },
    },
    isPartOf: { "@id": WEBSITE_ID },
    ...(article.image ? { image: [article.image.src] } : {}),
  };

  return (
    <>
      <JsonLd data={structuredData} />
      <Container className="py-14 sm:py-16 lg:py-20" width="article">
        <Breadcrumbs
          items={[
            topic
              ? { name: topic.name, href: topicHref(topic) }
              : { name: "Latest", href: "/blog" },
            { name: article.title, href: `/blog/${article.slug}` },
          ]}
        />
        <article data-article-body="">
          <ArticleHeader
            byline={article.byline}
            bylineHref={authorHref(article.byline.name)}
            category={article.category}
            categoryHref={topic ? topicHref(topic) : null}
            excerpt={article.excerpt}
            publishedAt={article.publishedAt}
            title={article.title}
            updatedAt={article.updatedAt}
          />
          {article.image ? (
            <ArticleFigure
              eager
              image={article.image}
              ratio={article.image.aspectRatio === "3:2" ? "hero-3-2" : "hero"}
              sizes="(min-width: 1024px) 832px, (min-width: 640px) calc(100vw - 3rem), calc(100vw - 2rem)"
            />
          ) : null}
          <SafeMarkdown markdown={article.bodyMarkdown} />
          <DisclosureNote>{siteConfig.disclosure}</DisclosureNote>
          <SourceList sources={article.sources} />
        </article>
        <RelatedArticles
          articles={related}
          topic={topic ? { name: topic.name, href: topicHref(topic) } : null}
        />
      </Container>
    </>
  );
}
