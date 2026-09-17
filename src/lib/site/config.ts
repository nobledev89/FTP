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
  locale: "en-GB",
  language: "en",
  timeZone: "Europe/London",
  currency: "GBP",
  navigation: [{ label: "Latest", href: "/blog" }] satisfies readonly NavItem[],
  footerLinks: [
    { label: "Latest", href: "/blog" },
    { label: "RSS", href: "/feed.xml" },
  ] satisfies readonly NavItem[],
  disclosure:
    "FinTechPulse publishes general editorial information, not personalised financial, investment, tax, or legal advice.",
} as const;

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
