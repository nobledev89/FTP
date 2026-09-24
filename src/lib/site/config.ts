/**
 * Static publication defaults (implementation plan section 2.1).
 *
 * The `sites` table becomes the editable source of truth in Phase 2; these values are the seed and
 * the fallback used where no database read is appropriate (fonts, metadata base, 404 pages).
 */

export const CANONICAL_ORIGIN = "https://fintechpulse.co.uk";

export type NavItem = {
  readonly label: string;
  readonly href: string;
};

export const siteConfig = {
  name: "FinTechPulse",
  tagline: "UK finance and fintech",
  description:
    "News, analysis, and explainers on UK banking, payments, lending, investing, insurance, and regulation.",
  positioning: "Clear reporting on the money systems that shape UK households and businesses.",
  coverage: ["Banking", "Payments", "Lending", "Investing", "Insurance", "Regulation"],
  locale: "en-GB",
  language: "en",
  timeZone: "Europe/London",
  currency: "GBP",
  navigation: [
    { label: "Latest", href: "/blog" },
    { label: "Payments", href: "/topics/payments" },
    { label: "Open Banking", href: "/topics/open-banking" },
    { label: "Regulation", href: "/topics/fintech-regulation" },
    { label: "Fraud", href: "/topics/fraud-security" },
  ] satisfies readonly NavItem[],
  footerLinks: [
    { label: "Latest", href: "/blog" },
    { label: "Topics", href: "/topics" },
    { label: "About", href: "/about" },
    { label: "Editorial standards", href: "/editorial-standards" },
    { label: "AI policy", href: "/ai-policy" },
    { label: "Corrections", href: "/corrections" },
    { label: "Contact", href: "/contact" },
    { label: "RSS", href: "/feed.xml" },
  ] satisfies readonly NavItem[],
  disclosure:
    "FinTechPulse publishes general editorial information, not personalised financial, investment, tax, or legal advice.",
} as const;

/**
 * Publisher facts shown on trust pages and in Organization structured data.
 *
 * Only facts the owner has confirmed belong here: a `null` or empty value is omitted from every page
 * and from JSON-LD rather than guessed. Fill these before relying on the About and Contact pages for
 * Google News or reader trust (docs/SEO-GROWTH-PLAN.md section 5.1).
 */
export type PublisherFacts = {
  /** Registered name of the legal publisher, if different from the brand. */
  readonly legalName: string | null;
  /** Where the publisher is established, for example "London, United Kingdom". */
  readonly location: string | null;
  /** Year the current publication launched, as it should appear publicly. */
  readonly foundingYear: string | null;
  /** Named, accountable editor, if the owner chooses to publish one. */
  readonly editor: { readonly name: string; readonly role: string } | null;
  /** Verified profiles the publication actually operates (LinkedIn, X, and so on). */
  readonly sameAs: readonly string[];
};

export const publisherFacts: PublisherFacts = {
  legalName: null,
  location: null,
  foundingYear: null,
  editor: null,
  sameAs: [],
};

/** The shared desk byline used on automated and desk-produced articles. */
export const EDITORIAL_TEAM = {
  name: "FinTechPulse Editorial",
  slug: "fintechpulse-editorial",
} as const;

/** Stable JSON-LD identifiers, so every page describes the same publisher and website entities. */
export const ORGANIZATION_ID = `${CANONICAL_ORIGIN}/#organization`;
export const WEBSITE_ID = `${CANONICAL_ORIGIN}/#website`;
export const LOGO_URL = `${CANONICAL_ORIGIN}/brand/logo.png`;

/**
 * Resolves the public site origin. Falls back to the canonical production origin so metadata never
 * points at an unexpected host. Only `http(s)` origins without paths are accepted.
 */
export function resolveSiteOrigin(
  value: string | undefined = process.env.NEXT_PUBLIC_SITE_URL,
): URL {
  const input = value?.trim();
  if (!input) {
    return new URL(CANONICAL_ORIGIN);
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(
      "NEXT_PUBLIC_SITE_URL must be an absolute URL, for example https://fintechpulse.co.uk",
    );
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("NEXT_PUBLIC_SITE_URL must use http or https");
  }
  if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
    throw new Error("NEXT_PUBLIC_SITE_URL must be an origin without a path, query, or fragment");
  }

  return new URL(url.origin);
}

/** Design fixture routes exist for review only and are never served in Vercel production. */
export function designReviewEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.VERCEL_ENV !== "production";
}
