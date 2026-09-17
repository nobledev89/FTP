import type {
  ArticleSummary,
  Byline,
  ImageAsset,
  SourceReference,
} from "@/components/public/types";

/**
 * Design review fixtures. Fictional sample content for visual QA only: it is never stored, published,
 * or indexed, and it avoids specific factual claims about real organisations.
 */

const images = {
  feature: {
    src: "/design-review/feature-4x5.svg",
    alt: "Illustration of stacked payment cards beside a contactless symbol",
  },
  chart: {
    src: "/design-review/card-a-16x9.svg",
    alt: "Illustration of a rising bar chart",
  },
  institution: {
    src: "/design-review/card-b-16x9.svg",
    alt: "Illustration of a columned institutional building",
    caption: "Fixture caption: captions sit below the image in smaller muted text.",
  },
  trend: {
    src: "/design-review/card-c-16x9.svg",
    alt: "Illustration of a line chart trending upward",
  },
  terminal: {
    src: "/design-review/hero-3x2.svg",
    alt: "Illustration of a card payment terminal on a shop counter",
    caption: "Fixture caption for a 3:2 hero crop.",
  },
} satisfies Record<string, ImageAsset>;

export const fixtureArticles: readonly ArticleSummary[] = [
  {
    slug: "fixture-open-banking-checkout",
    title: "How account-to-account payments are changing online checkout for UK shoppers",
    excerpt:
      "Pay-by-bank buttons are appearing beside card forms. This fixture explainer walks through what changes for shoppers, retailers, and the firms in between.",
    category: "Payments",
    publishedAt: "2026-09-17T07:30:00Z",
    image: images.feature,
  },
  {
    slug: "fixture-savings-rate-explainer",
    title: "What a base rate decision means for easy-access savings accounts",
    excerpt:
      "A plain-English guide to why savings rates move, and why they do not always move together.",
    category: "Banking",
    publishedAt: "2026-09-16T16:05:00Z",
    image: images.chart,
  },
  {
    slug: "fixture-regulation-consultation",
    title: "Reading a financial regulator's consultation paper without getting lost",
    excerpt:
      "Consultations shape the rules firms follow. Here is how to find the parts that matter.",
    category: "Regulation",
    publishedAt: "2026-09-15T11:00:00Z",
    image: images.institution,
  },
  {
    slug: "fixture-bnpl-affordability",
    title: "Buy now, pay later affordability checks, explained",
    excerpt:
      "What lenders look at before approving instalments, and what borrowers should check first.",
    category: "Lending",
    publishedAt: "2026-09-14T09:45:00Z",
    image: images.trend,
  },
  {
    slug: "fixture-long-title",
    title:
      "A deliberately long fixture headline that tests how the stream, cards, and article header wrap when an editor writes a title well beyond the usual length",
    excerpt:
      "Long excerpts wrap too. This one runs past a single line on desktop so reviewers can check the rhythm of two-line summaries in the archive stream.",
    category: "Analysis",
    publishedAt: "2026-09-12T13:20:00Z",
    image: null,
  },
  {
    slug: "fixture-insurance-claims-apps",
    title: "Why insurers are rebuilding the claims journey around mobile apps",
    excerpt:
      "Photos, chat, and faster decisions: the parts that help, and the parts that still need people.",
    category: "Insurance",
    publishedAt: "2026-09-10T08:00:00Z",
    image: images.terminal,
  },
  {
    slug: "fixture-isa-platform-fees",
    title: "Comparing platform fees on stocks and shares ISAs",
    excerpt: "Percentage fees, flat fees, and dealing charges each suit different pot sizes.",
    category: "Investing",
    publishedAt: "2026-09-08T12:10:00Z",
    image: images.chart,
  },
  {
    slug: "fixture-digital-assets-promotions",
    title: "What the financial promotions regime means for crypto adverts in the UK",
    excerpt:
      "Adverts for cryptoassets carry specific requirements. This fixture outlines what readers will notice.",
    category: "Digital assets",
    publishedAt: "2026-09-05T15:30:00Z",
    image: images.institution,
  },
  {
    slug: "fixture-small-business-lending",
    title: "Small business lending platforms and the questions to ask before applying",
    excerpt: "Speed is only one factor. Terms, security, and early repayment rules matter as much.",
    category: "Lending",
    publishedAt: "2026-09-02T10:00:00Z",
    image: images.trend,
  },
  {
    slug: "fixture-card-surcharges",
    title: "Card surcharges, explained for UK consumers",
    excerpt: "When retailers can and cannot add a fee for paying by card.",
    category: "Payments",
    publishedAt: "2026-08-29T09:00:00Z",
    image: images.feature,
  },
];

export const fixtureHeroImages = {
  "16-9": images.institution,
  "3-2": images.terminal,
} as const;

export const fixtureByline: Byline = {
  name: "Fixture Author",
  role: "Payments correspondent",
};

export const fixtureSources: readonly SourceReference[] = [
  {
    id: "fca",
    title: "Financial Conduct Authority (fixture reference)",
    publisher: "FCA",
    url: "https://www.fca.org.uk/",
    publishedAt: null,
    accessedAt: "2026-09-16T10:00:00Z",
  },
  {
    id: "boe",
    title: "Bank of England (fixture reference)",
    publisher: "Bank of England",
    url: "https://www.bankofengland.co.uk/",
    publishedAt: null,
    accessedAt: "2026-09-16T10:05:00Z",
  },
  {
    id: "psr",
    title:
      "Payment Systems Regulator (fixture reference with a longer title that wraps onto a second line)",
    publisher: "PSR",
    url: "https://www.psr.org.uk/",
    publishedAt: "2026-09-01T09:00:00Z",
    accessedAt: "2026-09-16T10:10:00Z",
  },
];

export const ARCHIVE_PAGE_SIZE = 6;
