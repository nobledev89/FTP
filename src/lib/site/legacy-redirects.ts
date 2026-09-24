/**
 * Permanent redirects from the domain's previous WordPress site (docs/SEO-GROWTH-PLAN.md 4.4).
 *
 * Add a row only when the old URL has a genuine equivalent here, one hop, never to the homepage.
 * Old URLs without an equivalent are deliberately absent: they keep returning 404 so Google drops
 * them. Build the full inventory from Search Console Pages/Links exports, legacy sitemaps, and
 * backlink data before adding category, tag, author, or dated-post mappings.
 */
export type LegacyRedirect = Readonly<{ source: string; destination: string }>;

export const LEGACY_REDIRECTS: readonly LegacyRedirect[] = [
  // WordPress served its RSS feed at /feed/ (and per-category feeds beneath it).
  { source: "/feed", destination: "/feed.xml" },
  { source: "/feed/:rest*", destination: "/feed.xml" },
  { source: "/comments/feed", destination: "/feed.xml" },
];
