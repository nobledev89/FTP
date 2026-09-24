# Public publication

The public application is a server-rendered Next.js publication backed only by the immutable
`articles` snapshot. It never reads jobs, drafts, prompts, audits, or working Storage objects.

## Routes

| Route                                                          | Behaviour                                                                                                                                   |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                                                            | Publication masthead, newest article as the feature, the next six articles, and publisher/website JSON-LD                                   |
| `/blog`                                                        | Newest-first archive with ten articles per page through `?page=N`; past the last page is a 404                                              |
| `/blog/[slug]`                                                 | Article body, linked byline and topic, breadcrumbs, dates, hero, disclosure, sources, and related articles from the same hub                |
| `/topics`, `/topics/[slug]`                                    | Topic index and five hubs (`src/lib/site/topics.ts`); a hub with fewer than three articles is `noindex`                                     |
| `/authors/[slug]`                                              | Profile and articles for each published byline; the desk byline is described as a team, not a person                                        |
| `/about`, `/editorial-standards`, `/ai-policy`, `/corrections` | Publisher trust pages (`src/lib/site/trust-pages.ts`); publisher facts come from `publisherFacts`                                           |
| `/contact`                                                     | Contact form; a Server Action emails the editor through Resend. The destination is the server-only `CONTACT_TO_EMAIL` and is never rendered |
| `/feed.xml`                                                    | Latest 50 publication snapshots as RSS 2.0; legacy `/feed/...` URLs redirect here                                                           |
| `/sitemap.xml`                                                 | Rendered per request: home, archive, indexable hubs, author profiles, trust pages, and every article                                        |
| `/news-sitemap.xml`                                            | Google News sitemap: news-format articles published in the last two days                                                                    |
| `/robots.txt`                                                  | Allows the publication, disallows admin, API, and review-fixture paths, and lists both sitemaps                                             |
| `/brand/logo.png`                                              | 512×512 publisher logo used in Organization and Article structured data                                                                     |
| `/opengraph-image` and article variants                        | Generated 1200×630 publication/share images                                                                                                 |

Unknown, malformed, future, withdrawn, or otherwise unpublished slugs return the public 404 without
metadata from a draft. A public slug alias returns a permanent redirect to its current canonical
slug. `www.fintechpulse.co.uk` permanently redirects to the canonical apex host.

## Data and rendering boundary

`src/lib/publication/repository.ts` creates a sessionless Supabase client with the browser-safe
publishable key. Database RLS permits it to select only `published` or `verified` articles whose
`published_at` has arrived, plus aliases pointing to those articles. Every selected row is parsed by
a strict Zod schema before being mapped into a narrow public DTO. Hero paths must be immutable
`article-public` paths, source URLs must use HTTP(S), and canonical URLs must match
`https://fintechpulse.co.uk/blog/<slug>`.

Article Markdown is rendered with `react-markdown` and GFM support. Raw HTML and Markdown images are
dropped. Links pass an explicit allowlist: fragments, root-relative internal paths, and HTTP(S)
links only; external links receive `noopener`, `noreferrer`, and `nofollow`. Images and source
captions come from structured snapshot fields rather than article Markdown.

## Caching and invalidation

Public queries use a five-minute Next data cache. Lists, hubs, author pages, both sitemaps, and RSS
carry the `public:articles` tag; individual resolutions also carry `public:article:<slug>`. When publication
commits, the worker calls `POST /api/revalidate` before live verification, retrying a transport
failure, `429`, or `5xx` up to three times and recording the outcome in `publishing_logs`.

The request body is exactly `{"slug":"<published-slug>"}` and carries:

- `X-FinTechPulse-Timestamp`: current Unix seconds;
- `X-FinTechPulse-Nonce`: a UUID;
- `X-FinTechPulse-Signature`: hex HMAC-SHA256 over
  `<timestamp>.<nonce>.<raw-body>` using `REVALIDATION_SECRET`.

The route requires a secret of at least 32 characters, accepts only a five-minute clock window,
uses constant-time signature comparison, rejects reused nonces in the process window, applies a
bounded request rate, validates the slug, and expires only the global list tag and that slug's tag.
It never accepts arbitrary cache tags or paths. Web and worker must receive the same secret.

Both sitemaps are rendered per request (`dynamic = "force-dynamic"`) over that tagged index query.
A metadata route is otherwise prerendered at build time, and a `revalidate` export alone left
production serving the build's article list, so invalidating the tag is what makes a new article
appear. `pnpm seo:check [origin] [--expect-slug <slug>]` verifies this live, along with archive
404s, canonicals, orphans, and broken internal links.

Withdrawal does not use this route. The console's Server Action calls `updateTag` for
`public:articles` and the article's slug tag after `admin_withdraw_article` commits, so the next
request reads the database, where RLS no longer returns the article or its aliases.

Revalidation is deliberately outside the publication transaction. If the web process is down, the
article remains published and the verifier records the failed live checks for bounded retry rather
than attempting to undo the database snapshot or public Storage copy.

## Local verification

`pnpm test:e2e:admin` builds the web app against local Supabase and drives a deterministic mock job
through research, drafting, image creation, audit, public Storage copy, signed invalidation, the real
rendered page, and all eight live checks to `VERIFIED`. It also checks the home/archive appearance,
real image delivery, canonical and social metadata, JSON-LD, RSS, sitemap, robots, alias redirect,
unpublished-slug isolation, and mobile/desktop overflow screenshots.
