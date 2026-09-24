/**
 * Public topic taxonomy (docs/SEO-GROWTH-PLAN.md section 5.3).
 *
 * Articles carry a free-text `category` written at drafting time, and discovery uses ten launch
 * categories. Readers and crawlers get five focused hubs instead: each hub owns the categories whose
 * articles it gathers, so overlapping labels resolve to one canonical landing page. A category that
 * no hub owns still publishes normally; its articles simply have no parent hub yet.
 */

export type Topic = Readonly<{
  slug: string;
  /** Short label for navigation, breadcrumbs, and category links. */
  name: string;
  /** Descriptive page title, written for search rather than internal use. */
  title: string;
  description: string;
  intro: readonly string[];
  /** Article categories this hub gathers, compared after normalisation. */
  categories: readonly string[];
  /** Shown in the header as well as the Topics index and footer. */
  primary: boolean;
}>;

/** A hub with fewer articles than this is rendered but kept out of the index and sitemap. */
export const TOPIC_MIN_INDEXABLE_ARTICLES = 3;

export const TOPICS: readonly Topic[] = [
  {
    slug: "payments",
    name: "Payments",
    title: "UK payments news and analysis",
    description:
      "How money moves in the UK: card and account-to-account payments, payment infrastructure, merchant tools, and the business payments market.",
    intro: [
      "Payments coverage follows the systems that move money between UK households, businesses, and banks: cards and wallets, Faster Payments and account-to-account transfers, cross-border services, and the processors, acquirers, and software firms merchants depend on.",
      "Each story sets out what changed, who it affects, and which rule, scheme, or filing it rests on, with the primary sources listed underneath.",
    ],
    categories: ["Payments", "Fintech for Business"],
    primary: true,
  },
  {
    slug: "open-banking",
    name: "Open Banking",
    title: "UK open banking news and analysis",
    description:
      "UK open banking and open finance: APIs, variable recurring payments, bank connectivity, and the regulatory roadmap.",
    intro: [
      "Open banking coverage tracks how regulated firms in the UK access bank data and initiate payments with a customer's consent, from API standards and variable recurring payments to the governance of the ecosystem and the move towards open finance.",
      "The focus is on the operating consequences: what a decision means for banks, third-party providers, merchants, and the people whose accounts are connected.",
    ],
    categories: ["Open Banking"],
    primary: true,
  },
  {
    slug: "fintech-regulation",
    name: "Regulation",
    title: "UK fintech regulation news and analysis",
    description:
      "FCA, Bank of England, and HM Treasury decisions that shape UK fintech, including crypto-asset and stablecoin rules.",
    intro: [
      "Regulation coverage follows the consultations, policy statements, rule changes, and effective dates that decide what UK financial firms may do and how they must treat customers, including the emerging regimes for crypto-assets, stablecoins, and tokenised assets.",
      "Every rule is dated and attributed to the body that made it, and non-UK developments are labelled as such.",
    ],
    categories: ["Regulation & policy", "UK Fintech", "Crypto, Stablecoins & Tokenisation"],
    primary: true,
  },
  {
    slug: "fraud-security",
    name: "Fraud & Security",
    title: "UK fraud, scams and financial security news",
    description:
      "Authorised push payment fraud and reimbursement, scams, data breaches, anti-money-laundering, and identity verification in UK finance.",
    intro: [
      "Fraud and security coverage explains how scams and breaches reach UK customers, what reimbursement and complaint routes exist, and how banks and payment firms are changing their controls in response.",
      "Where a reader may need to act, articles point to the official source, such as the FCA register or the Financial Ombudsman Service, rather than to a third party.",
    ],
    categories: ["Fraud & Cybersecurity"],
    primary: true,
  },
  {
    slug: "uk-fintech-funding",
    name: "Companies & Funding",
    title: "UK fintech companies and funding news",
    description:
      "Funding rounds, results, licences, launches, and leadership changes at fintech firms active in the UK.",
    intro: [
      "Company coverage follows fintech firms active in the UK: the rounds they raise, the results they file, the licences they win or lose, and the products they launch.",
      "Figures are taken from filings and official announcements where they exist, and each article says when a number is the company's own claim.",
    ],
    categories: ["Fintech News", "Digital Banks"],
    primary: false,
  },
];

const ENTITY_REPLACEMENTS: ReadonlyArray<[RegExp, string]> = [
  [/&amp;/gi, "&"],
  [/&#0*38;/g, "&"],
  [/&#x0*26;/gi, "&"],
  [/&quot;/gi, '"'],
  [/&#0*39;|&apos;/gi, "'"],
];

/**
 * Normalises a stored category for display and comparison. Drafts occasionally arrive with HTML
 * entities already escaped (`Fraud &amp; Cybersecurity`), which React would then escape again.
 */
export function normaliseCategory(value: string): string {
  let result = value;
  // Repeat so double-escaped values (`&amp;amp;`) collapse fully; bounded for safety.
  for (let pass = 0; pass < 3; pass += 1) {
    const next = ENTITY_REPLACEMENTS.reduce(
      (text, [pattern, replacement]) => text.replace(pattern, replacement),
      result,
    );
    if (next === result) break;
    result = next;
  }
  return result.replace(/\s+/g, " ").trim();
}

function categoryKey(value: string): string {
  return normaliseCategory(value).toLowerCase();
}

const topicByCategory = new Map<string, Topic>(
  TOPICS.flatMap((topic) => topic.categories.map((category) => [categoryKey(category), topic])),
);

export function topicForCategory(category: string | null | undefined): Topic | null {
  if (!category) return null;
  return topicByCategory.get(categoryKey(category)) ?? null;
}

export function getTopic(slug: string): Topic | null {
  return TOPICS.find((topic) => topic.slug === slug) ?? null;
}

export function topicHref(topic: Pick<Topic, "slug">): string {
  return `/topics/${topic.slug}`;
}

/**
 * Stored spellings a hub must match in a database `in (...)` filter: each category as written plus
 * its HTML-escaped form, which some existing snapshots carry.
 */
export function storedCategoryVariants(categories: readonly string[]): string[] {
  const variants = new Set<string>();
  for (const category of categories) {
    const clean = normaliseCategory(category);
    variants.add(clean);
    variants.add(clean.replaceAll("&", "&amp;"));
  }
  return [...variants].sort();
}
