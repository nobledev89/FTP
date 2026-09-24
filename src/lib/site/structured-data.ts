/**
 * Schema.org entities shared across public pages (docs/SEO-GROWTH-PLAN.md section 5.2).
 *
 * Every page refers to one publisher and one website by stable `@id`, so Google reads them as the
 * same entities. Only confirmed publisher facts are emitted; unknown ones are left out.
 */

import {
  CANONICAL_ORIGIN,
  EDITORIAL_TEAM,
  LOGO_URL,
  ORGANIZATION_ID,
  publisherFacts,
  siteConfig,
  WEBSITE_ID,
  type PublisherFacts,
} from "./config";

export type BreadcrumbItem = Readonly<{ name: string; href: string }>;

/** Serialises JSON-LD for a `<script>` element without allowing `</script>` breakouts. */
export function jsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function absoluteUrl(href: string): string {
  return href.startsWith("http") ? href : `${CANONICAL_ORIGIN}${href === "/" ? "" : href}`;
}

/** Author profile path for a byline. Stable as long as the byline text is. */
export function authorSlug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function authorHref(name: string): string {
  return `/authors/${authorSlug(name)}`;
}

export function isEditorialTeam(name: string): boolean {
  return authorSlug(name) === EDITORIAL_TEAM.slug;
}

export function organizationEntity(facts: PublisherFacts = publisherFacts) {
  return {
    "@type": "NewsMediaOrganization",
    "@id": ORGANIZATION_ID,
    name: siteConfig.name,
    url: CANONICAL_ORIGIN,
    logo: { "@type": "ImageObject", url: LOGO_URL, width: 512, height: 512 },
    description: siteConfig.description,
    ...(facts.legalName ? { legalName: facts.legalName } : {}),
    ...(facts.foundingYear ? { foundingDate: facts.foundingYear } : {}),
    ...(facts.location ? { location: facts.location } : {}),
    ...(facts.sameAs.length > 0 ? { sameAs: [...facts.sameAs] } : {}),
    // Readers reach the publisher through the contact form; no address is published.
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "editorial",
      url: absoluteUrl("/contact"),
      areaServed: "GB",
      availableLanguage: "en-GB",
    },
    publishingPrinciples: absoluteUrl("/editorial-standards"),
    correctionsPolicy: absoluteUrl("/corrections"),
    actionableFeedbackPolicy: absoluteUrl("/corrections"),
    ethicsPolicy: absoluteUrl("/editorial-standards"),
    masthead: absoluteUrl("/about"),
  };
}

export function websiteEntity() {
  return {
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    name: siteConfig.name,
    url: CANONICAL_ORIGIN,
    inLanguage: siteConfig.locale,
    publisher: { "@id": ORGANIZATION_ID },
  };
}

/** Homepage graph: the publisher and the website it runs. */
export function siteGraph() {
  return {
    "@context": "https://schema.org",
    "@graph": [organizationEntity(), websiteEntity()],
  };
}

/**
 * The byline as a schema.org entity. The shared desk byline is an organisation unit of the
 * publisher, never a fabricated person; any other byline is the named person who wrote the piece.
 */
export function authorEntity(name: string) {
  const url = absoluteUrl(authorHref(name));
  return isEditorialTeam(name)
    ? {
        "@type": "Organization",
        "@id": `${url}#team`,
        name,
        url,
        parentOrganization: { "@id": ORGANIZATION_ID },
      }
    : { "@type": "Person", "@id": `${url}#person`, name, url };
}

export function breadcrumbList(items: readonly BreadcrumbItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.href),
    })),
  };
}
