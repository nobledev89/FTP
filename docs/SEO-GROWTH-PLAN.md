# FinTechPulse SEO growth plan

**Prepared:** 24 September 2026  
**Planning horizon:** 12 months  
**Primary market:** United Kingdom  
**Primary outcome:** earn first-page Google rankings for a defined portfolio of UK fintech queries,
then expand into more competitive terms as topical authority grows.

## 1. Executive decision

No ethical SEO plan can guarantee Google's first page. Google does not sell or promise organic
rankings, and a technically valid page is not guaranteed to be indexed or served. The practical
goal is to make first-page rankings increasingly likely for a deliberately chosen query set and to
measure progress in Google Search Console.

FinTechPulse should not try to become a broad finance site immediately. Its best entry point is:

> **The clearest independent source for UK payments, open banking, fintech regulation, fraud, and
> the operating consequences of policy changes.**

The current articles already have unusually good primary sourcing, explicit uncertainty, UK
jurisdiction handling, and useful analysis. The main constraints are:

1. an incomplete migration from the domain's old WordPress site;
2. a stale production sitemap and an archive error;
3. almost no crawlable topic architecture;
4. insufficient publisher and author transparency for a financial/YMYL news site;
5. no demonstrated first-hand authority or strong external citation profile;
6. high automated publishing velocity before the new site's identity is established.

Technical work is necessary, but authority, distinctiveness, and editorial trust will decide
whether the site ranks.

## 2. Baseline audit

This is a source-code and live-site audit, not a Search Console audit. Search Console access is the
first required operational step because third-party searches cannot establish true index coverage,
queries, clicks, or manual actions.

### What is already sound

- HTTPS, one canonical non-`www` origin, and a permanent `www` redirect.
- Server-rendered article content; Google does not need client-side JavaScript to read the story.
- Unique article titles and descriptions, self-referencing canonicals, Open Graph and Twitter cards.
- `Article` or `NewsArticle` JSON-LD with headline, dates, author, publisher, and image.
- Visible publication and update dates, descriptive image alt text, RSS, an XML sitemap, and
  crawlable links.
- True 404s for malformed article/archive inputs and `noindex` protection for review routes.
- Strong source lists, prominent disclosure, related articles, and slug-alias redirects.
- Good lab performance on the live homepage in one mobile Lighthouse run: performance 94,
  accessibility 100, best practices 100, SEO 100; FCP 1.1 s, LCP 2.8 s, TBT 100 ms, CLS 0. This is
  useful diagnostic evidence, not field Core Web Vitals data or proof of ranking quality.

### Critical findings

| Priority | Finding                                    | Evidence on 24 September 2026                                                                                                         | Impact                                                                                             |
| -------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| P0       | Production sitemap is stale                | The live archive exposes 27 current article URLs, but `sitemap.xml` contains only 8 articles and reports `Last-Modified: 22 Sep 2026` | Slower discovery of new time-sensitive articles and misleading Search Console sitemap coverage     |
| P0       | Legacy migration is incomplete             | Google still surfaces old WordPress category and dated-post URLs on `fintechpulse.co.uk`; sampled URLs now end in 404                 | Lost link equity, poor search experience, and a prolonged mixture of old and new URLs in the index |
| P0       | Archive page overflow returns 500          | `/blog?page=4` and `/blog?page=999` return 500 while only three archive pages exist                                                   | Server errors waste crawl attempts and create poor quality signals                                 |
| P1       | No topic hubs                              | Navigation exposes only `Latest`; category labels are not links and there are no category landing pages                               | Weak topical hierarchy, shallow internal linking, and no durable target for broad category queries |
| P1       | Publisher identity is thin                 | No About, ownership, contact, editorial standards, corrections, AI-use, or privacy pages are visible                                  | Material trust gap for Google News and financial/YMYL content                                      |
| P1       | Author entity is thin                      | Every sampled article is by “FinTechPulse Editorial”; the byline is not linked and Article schema has no author URL                   | Readers and crawlers cannot evaluate responsibility, credentials, or track record                  |
| P1       | Suggested internal links are not published | Drafts store `internalLinks`, but article bodies do not apply them; only automated “Related” cards link internally                    | Missed context, weaker cluster signals, and fewer useful reader paths                              |
| P2       | Little first-hand differentiation          | Most stories interpret existing public sources rather than add interviews, proprietary data, documents, or field expertise            | Strong sources help trust, but competitors and original sources can remain more authoritative      |
| P2       | Brand/entity ambiguity                     | Search results also contain `fintechpulse.uk`, `fintech-pulse.com`, KPMG's “Pulse of Fintech”, and legacy content from this domain    | Harder entity recognition and branded-search control                                               |
| P2       | Mobile LCP has headroom                    | Lab LCP was about 2.8 s; Google's “good” field threshold is at most 2.5 s at the 75th percentile                                      | Not a crisis, but image delivery and the lead story can be tightened                               |

### Why the sitemap is stale

In Next.js 16, special metadata routes such as `sitemap.ts` remain static by default unless a
request-time API or dynamic route configuration is used. The site's publication webhook invalidates
data tags, but the deployed `sitemap.xml` is still the build artifact. The `revalidate = 300` export
has not produced the intended live behaviour on Vercel.

## 3. Outcomes and targets

The phrase “Google's first page” must be attached to queries. Create a tracked keyword portfolio
before judging success.

### Query tiers

| Tier                     | Examples                                                                                                     | 6-month aim                                                | 12-month aim                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------- |
| Brand                    | `FinTechPulse UK`, article titles, author names                                                              | Own the top result and clean old URLs from branded results | Own the first page's principal brand/entity results                 |
| Long-tail problem/answer | `how to check FCA debt adviser`, `UK APP fraud reimbursement limit`, `what is variable recurring payment UK` | 15–25 tracked queries in top 10                            | 40–60 in top 10                                                     |
| Mid-tail topical         | `UK open banking regulation`, `UK fintech funding`, `payments regulation UK`                                 | Several pages in positions 11–30                           | 8–15 tracked queries in top 10                                      |
| Competitive head terms   | `UK fintech news`, `fintech news`, `open banking news`                                                       | Consistent impressions and rising average position         | Challenge for page one; do not make this the only success criterion |

These are operating targets, not promises. Reset them after 28 days of Search Console data and
validated search-volume research.

### Site health targets

- 100% of intended canonical public URLs present in the correct sitemap.
- At least 95% of submitted editorial URLs indexed or validly excluded; every exclusion classified.
- New news URLs visible in the news sitemap within five minutes and first crawled within 24 hours
  where Google crawl demand supports it.
- Zero unexpected public 5xx responses in daily synthetic checks.
- Field Core Web Vitals at the 75th percentile: LCP <= 2.5 s, INP < 200 ms, CLS < 0.1.
- Every article has a valid author entity, editorial owner, topic parent, at least two intentional
  internal links when relevant, and a recorded review/update state.
- At least 20 relevant referring domains earned in six months and 50 in twelve months, prioritising
  editorially given links rather than raw volume.

### Business metrics

- Google organic clicks, impressions, CTR, and non-brand query count.
- Returning readers, engaged sessions, RSS/newsletter sign-ups, and direct traffic.
- Citations and links from regulators, trade bodies, journalists, universities, firms, and industry
  newsletters.
- Share of articles that produce meaningful impressions after 30 and 90 days.
- Content cost per organic engaged visit and per earned referring domain.

## 4. Phase 0: establish truth and repair indexation (days 1–7)

### 4.1 Connect first-party measurement

1. Verify the full `fintechpulse.co.uk` Domain property in Google Search Console using DNS.
2. Submit the main sitemap and the proposed news sitemap.
3. Export and retain:
   - Performance: 16 months if available, segmented by Web, News, Discover, country, query, and page;
   - Page Indexing reasons and all example URLs;
   - Sitemaps, Core Web Vitals, HTTPS, Links, Manual Actions, and Security Issues;
   - URL Inspection for the homepage, `/blog`, five current articles, and five legacy URLs.
4. Configure GA4 only with an appropriate UK privacy/consent implementation. Track article view,
   engaged read, topic click, source click, RSS/newsletter conversion, and returning reader.
5. Create a weekly dashboard joining Search Console and analytics. Search Console is the authority
   for Google impressions/clicks; analytics is the authority for on-site behaviour.

**Acceptance:** baseline workbook/dashboard exists, owners can access it, and every later SEO change
has an annotation date.

### 4.2 Make sitemaps publication-aware

- Make `sitemap.xml` request-time/dynamically rendered in the manner supported by the installed
  Next.js 16 version, while retaining the cached article-index query.
- Explicitly invalidate or revalidate `/sitemap.xml` on publish, update, withdrawal, and slug change.
- Add an automated production check: publish fixture -> fetch sitemap -> assert the canonical URL and
  accurate `lastmod` appear within five minutes.
- Add a separate `/news-sitemap.xml` containing only eligible news articles from the previous two
  days, with publication name, language, title, and publication date. Keep older URLs in the main
  sitemap, not the news sitemap.
- Keep sitemap URLs canonical, indexable, status 200, and free of redirected or withdrawn entries.
- Use a sitemap index only when scale requires it; 27 URLs does not.

**Likely files:** `src/app/sitemap.ts`, a new news-sitemap route, `src/app/api/revalidate/route.ts`,
publication/withdrawal handlers, and production verification tests.

### 4.3 Fix archive error semantics

- Prevent Supabase range overflow from becoming an application error; an empty out-of-range result
  should allow the page to return the intended 404.
- Keep invalid `page=0`, negative, array, and non-numeric values at 404.
- Ensure pages 2+ have unique canonicals and self-referencing previous/next crawlable links.
- Test page 1, last valid page, first invalid page, and a very high page number against production-like
  data.

**Likely files:** `src/lib/publication/repository.ts`, `src/app/(public)/blog/page.tsx`, and route tests.

### 4.4 Recover the old-domain migration

Build an old-to-new URL inventory from:

- Search Console Pages and Links exports;
- legacy WordPress XML sitemaps/backups and database exports;
- analytics landing pages and server/Vercel logs;
- backlink exports and the Internet Archive;
- live Google results, including `/category/.../`, `/tag/.../`, `/author/.../`, `/feed/`, and dated
  post paths.

Classify every old URL:

1. **Equivalent new content:** one-hop permanent 301/308 to the closest matching article or hub.
2. **Useful topic but no equivalent:** restore/improve the content first, then redirect.
3. **Spam, irrelevant, or no replacement:** return 404 or 410; do not mass-redirect to the homepage.

Preserve redirects for at least one year and preferably indefinitely. Reclaim high-value external
links by asking their publishers to update destinations. Test status, final URL, canonical, and
redirect chain length in CI.

**Likely files/data:** `next.config.ts` for a small stable map or a database/edge-backed redirect map
for a large inventory, plus redirect tests.

## 5. Phase 1: create trust and topical structure (weeks 2–4)

### 5.1 Publish a real publisher identity

Add crawlable, footer-linked pages:

- `/about`: purpose, ownership/legal publisher, UK base, funding model, and what makes the reporting
  independent;
- `/team` and `/authors/[slug]`: named people, relevant experience, credentials, beats, disclosure,
  social/professional profiles, and all their articles;
- `/editorial-standards`: sourcing hierarchy, fact-checking, anonymous sources, updates, corrections,
  conflicts, sponsorship, affiliate links, and article withdrawal;
- `/ai-policy`: exactly how automation assists discovery, research, drafting, images, audit, and
  publication; what a human reviews; prohibited uses; accountability;
- `/corrections`: correction policy and a public log for material changes;
- `/contact`: working editorial, corrections, rights, and commercial contact routes;
- privacy, cookie, and terms pages appropriate to the operator and analytics setup.

Do not invent staff or credentials. If there is only one accountable editor, name that person and
state the actual role. For high-stakes consumer guides, add a qualified reviewer where the facts
justify one and display both author and reviewer.

### 5.2 Strengthen entity and article markup

- Add homepage `Organization`/`NewsMediaOrganization` and `WebSite` JSON-LD with a stable `@id`, URL,
  logo, founding/ownership details that are actually public, contact point, and verified `sameAs`
  profiles.
- Change each Article author from an unlinked generic organisation to the truthful `Person` or
  editorial-team entity, with a stable profile URL. Do not use a person merely for schema if that
  person was not responsible for the article.
- Add publisher logo and stable organisation `@id` to Article markup.
- Add visible breadcrumbs and matching `BreadcrumbList` markup: Home -> Topic -> Article.
- Keep visible dates and JSON-LD dates identical; only change `dateModified` for a meaningful
  editorial update, not a deploy or image optimisation.
- Validate representative pages in Google's Rich Results Test after deployment.

Structured data clarifies entities and eligibility; it does not create authority by itself.

### 5.3 Build topic hubs

Create crawlable topic routes and make category labels real links. Start with five focused hubs:

1. `/topics/payments`
2. `/topics/open-banking`
3. `/topics/fintech-regulation`
4. `/topics/fraud-security`
5. `/topics/uk-fintech-funding`

Each hub should contain a unique editorial introduction, a flagship evergreen resource, current
stories, key subtopics, and useful cross-links—not merely a tag archive. Add the strongest hubs to
the header and all hubs to a Topics index/footer. Consolidate current overlapping categories under
one canonical taxonomy rather than exposing ten thin archives at once.

Add author and topic URLs to the main sitemap. Use descriptive page titles such as “UK open banking
news and analysis” rather than internal labels alone.

### 5.4 Publish intentional internal links

- Convert stored draft `internalLinks` from unused suggestions into an editor-visible workflow.
- Validate that a target is public, canonical, and topically relevant before insertion.
- Require each new article, where natural, to link to its parent hub, one evergreen explainer, and one
  related development using descriptive anchors.
- Update the hub and at least two older relevant articles to link to important new evergreen pieces.
- Generate related articles using topic/entity similarity and editorial priority, not exact category
  equality alone.
- Add automated orphan-page and broken-internal-link checks.

## 6. Phase 2: build a search-led editorial system (months 2–6)

### 6.1 Choose an audience and intent for every page

FinTechPulse currently serves both industry operators and consumers. That can work only when each
page is explicit. Record in the brief:

- primary audience: operator, founder/investor, policymaker, journalist, or consumer;
- primary query and search intent: breaking news, explanation, comparison, action/checklist, data,
  or regulatory reference;
- unique contribution that the existing search results do not provide;
- page to update instead of creating a new URL if the intent is already covered;
- conversion: next article, topic follow, RSS/newsletter, or source document.

### 6.2 Use a news-to-evergreen model

News alone has a short traffic half-life. Every priority topic needs one durable canonical resource
that news articles reinforce and update.

| Cluster             | Flagship asset                                                         | Supporting coverage                                                              |
| ------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| UK open banking     | “UK open banking: rules, providers, APIs and what changes next”        | VRPs, UKPI, FCA/PSR decisions, API standards, merchant use cases                 |
| Payments regulation | Living UK payments regulatory calendar/tracker                         | Consultations, effective dates, card fees, safeguarding, payment-services reform |
| APP fraud           | “UK APP fraud reimbursement rules: eligibility, limits and complaints” | PSR data, rule changes, case studies, bank implementation, scam patterns         |
| Fintech funding     | Searchable, sourced UK fintech funding dataset and quarterly analysis  | Individual rounds, regional trends, investor interviews, methodology             |
| Digital banks       | UK licence/status and depositor-protection tracker                     | FCA/PRA milestones, launches, accounts, ownership, financial results             |
| AI in finance       | UK financial-services AI policy and use-case tracker                   | FCA testing, fraud, credit, advice boundaries, bank deployments                  |

Avoid creating near-duplicate pages for every query variation. One excellent page can answer a
cluster of related questions.

### 6.3 Seed keyword map

Validate volume, SERP type, difficulty, and business fit using Search Console, Google Keyword
Planner, Trends, and one reputable SEO dataset before committing. The following are hypotheses, not
volume claims:

- **Open banking:** `what is open banking UK`, `variable recurring payments UK`, `open banking for
business UK`, `UKPI payments`, `open banking API UK`, `open banking regulation UK`.
- **Payments:** `payment services regulation UK`, `UK payments regulation changes`, `Faster Payments
limits`, `Direct Debit guarantee rules`, `agentic payments UK`.
- **Fraud:** `APP fraud reimbursement rules`, `APP fraud limit UK`, `bank transfer scam refund UK`,
  `PSR reimbursement rules`, `check FCA authorised firm`.
- **Funding:** `UK fintech funding 2026`, `UK fintech funding rounds`, `London fintech investment`,
  `UK fintech companies raising funding`.
- **Digital banks:** `is [bank] FSCS protected`, `[bank] UK banking licence`, `UK challenger bank
licence`, `digital banks UK regulation`.
- **Regulatory monitoring:** `FCA fintech consultation`, `UK crypto regulation timeline`, `BNPL rules
UK`, `stablecoin regulation UK`, `financial services AI regulation UK`.

Map exactly one preferred landing page to each primary intent to avoid cannibalisation.

### 6.4 Change the production mix

The current pipeline can publish at a pace that looks like roughly 27 articles in three days. The
sampled articles are substantive, so this is not a finding of spam. It is nevertheless a material
risk for a new, low-authority, AI-assisted YMYL publication if quantity outruns original value and
human accountability.

For the next 90 days:

- publish at most 1–3 genuinely consequential news/analysis pieces per day;
- publish one flagship evergreen guide or data update per week;
- publish one original interview, document analysis, or proprietary-data story per week by month 3;
- require human editorial approval for consumer action guides, legal/regulatory interpretation,
  investment/credit risk, corrections, and all sponsored content;
- do not create an article when an existing evergreen URL should be updated;
- no auto-publication solely to satisfy a category quota.

Quality gates should ask: Would a UK reader bookmark this, cite it, or send it to a colleague? Does
it add something beyond the cited release? Is there a named accountable editor?

### 6.5 Upgrade the content workflow

Add structured fields and checks for:

- target audience, primary query, intent, canonical cluster, and unique value;
- competing/result-page gap notes based on live research, without copying competitors;
- named author/reviewer and review timestamp;
- existing-page/cannibalisation check before job creation;
- two-way internal-link plan and actual inserted links;
- facts requiring scheduled freshness review;
- correction/change note when a material published claim changes;
- originality that is semantic and editorial, not just phrase-overlap detection;
- first-hand evidence: interview, calculation, original dataset, obtained document, direct test, or
  clearly identified expert analysis.

Do not treat exact-match keyword counts, word counts, schema volume, or automated “SEO scores” as
publication gates.

## 7. Phase 3: earn authority and links (months 2–12)

### Assets worth citing

- Quarterly UK fintech funding report with a downloadable, sourced dataset and transparent
  methodology.
- UK payments and open-banking regulatory calendar with status, deadline, source, and affected
  audience.
- APP fraud reimbursement dashboard using PSR/UK Finance data with reproducible calculations.
- Digital-bank licence and FSCS-status tracker sourced to PRA, FCA, and FSCS records.
- Original surveys only when sample, questionnaire, sponsor, fieldwork, and limitations are fully
  disclosed.

### Distribution

- Send concise, relevant briefings to UK fintech and finance journalists when an original finding is
  genuinely useful.
- Offer subject-matter experts for attributed comment; publish full methodology/source notes.
- Build relationships with Innovate Finance, Open Banking Limited, university fintech centres,
  regional fintech groups, professional associations, and conference organisers without requiring
  followed links.
- Reclaim unlinked brand mentions and broken links to the old domain.
- Maintain consistent, verified profiles and naming across LinkedIn and other genuinely used
  channels to disambiguate the entity.
- Syndicate only with canonical/original-source arrangements and clear disclosure.

Never buy ranking links, automate guest-post links, exchange links at scale, or publish paid
advertorial links without `rel="sponsored"` or `nofollow`. These tactics put the entire domain at
risk.

## 8. On-page standard for every article

Before publication, verify:

1. One clear H1 and a concise title that names the subject and UK relevance where useful.
2. The first two paragraphs answer what happened/what it is, who is affected, and why now.
3. The primary intent is fully answered without padding; terminology is defined once.
4. Claims, figures, dates, jurisdiction, and limitations are linked or traceable to primary sources.
5. A real author/reviewer page is linked and disclosures are visible.
6. `datePublished` and material `dateModified` agree across page and structured data.
7. A unique title and useful description; no keyword stuffing and no invented urgency.
8. Descriptive alt text and a representative, efficiently delivered hero image.
9. A topic breadcrumb, parent hub link, and contextual internal links in both directions.
10. A next step: related analysis, source document, RSS, or topic subscription.
11. The URL is canonical, status 200, indexable, in the correct sitemap, and not orphaned.
12. News, analysis, sponsored, opinion, and updated/corrected content are visibly labelled.

## 9. Performance and technical backlog

After the P0 repairs, prioritise measured field problems rather than chasing a perfect lab score.

- Send web-vital telemetry or use Search Console/CrUX to obtain 75th-percentile LCP, INP, and CLS by
  route template.
- Reduce hero image byte size and serve modern formats/sizes; the Lighthouse run estimated about
  96 KiB of image-delivery savings.
- Keep the lead image discoverable in initial HTML, correctly prioritised, dimensioned, and close to
  the article headline.
- Review the roughly 22 KiB of unused CSS and small legacy-JavaScript warning only after field data.
- Monitor uptime, Supabase latency, 5xx, cache HIT/MISS, sitemap freshness, and Googlebot responses.
- Preserve immutable image URLs; if the Supabase image host changes, migrate/redirect images and
  update sitemaps/schema.
- Keep robots simple. Do not block old URLs that need Google to see their 301, 404, or 410 response.
- Do not add speculative tags such as `meta keywords`; do not expect FAQ markup to create rankings.

## 10. Measurement operating rhythm

### Weekly

- Crawl/index errors, sitemap submitted versus indexed, 5xx, Core Web Vitals, security/manual action.
- New URLs: discovery date, first crawl, index state, impressions, and internal-link count.
- Query/page movements by brand, evergreen, news, and topic cluster.
- Legacy URLs receiving impressions, clicks, links, or crawl activity.

### Monthly

- Top gaining/losing pages and queries, CTR against position, cannibalisation, and zero-value pages.
- Update, merge, redirect, keep, or remove decisions using GSC, analytics, backlinks, and editorial
  value together.
- Referring-domain quality and successful outreach by asset—not arbitrary backlink totals.
- Coverage balance: breaking news, evergreen, original reporting, data, and expert contribution.
- Competitor/result-page review for the 20 highest-priority query intents.

### Quarterly

- Re-score keyword tiers, topical focus, trust gaps, authorship, and commercial/editorial conflicts.
- Refresh flagship assets and publish transparent change notes.
- Review whether new hubs have enough distinct value to launch; do not create thin taxonomy pages.

## 11. 90-day execution board

| When         | Deliverable                                                              | Owner type              | Effort    | Definition of done                                                  |
| ------------ | ------------------------------------------------------------------------ | ----------------------- | --------- | ------------------------------------------------------------------- |
| Days 1–2     | Search Console property, exports, sitemap submission, dashboard skeleton | Owner/SEO               | S         | Baseline saved and shared                                           |
| Days 1–4     | Dynamic main sitemap + publication invalidation + tests                  | Engineering             | M         | All 27+ current URLs appear; new URL appears within 5 min           |
| Days 1–4     | Archive overflow fix                                                     | Engineering             | S         | First invalid page and huge page return 404, never 5xx              |
| Days 2–7     | Legacy URL inventory and first redirect batch                            | SEO + engineering       | L         | Top traffic/link URLs mapped and one-hop redirects tested           |
| Week 2       | About, Contact, Editorial Standards, AI Policy, Corrections              | Publisher/editor        | M         | Accurate pages live and footer-linked                               |
| Weeks 2–3    | Named author/reviewer system and entity schema                           | Editorial + engineering | L         | Every new article has truthful linked identity; schema validates    |
| Weeks 3–4    | Five topic hubs, breadcrumbs, taxonomy navigation                        | Editorial + engineering | L         | Hubs are unique, indexable, internally linked, and in sitemap       |
| Week 4       | News sitemap                                                             | Engineering             | M         | Only eligible last-two-day news articles appear and GSC accepts it  |
| Weeks 4–6    | Internal-link workflow and orphan checks                                 | Engineering + editorial | M         | New articles have reviewed contextual links; no public orphans      |
| Weeks 5–8    | First two flagship evergreen resources                                   | Editorial               | L         | Best-in-class coverage, named expert review, outreach list prepared |
| Weeks 7–10   | First original dataset/tracker                                           | Data/editorial          | L         | Methodology, sources, update cadence, and embeddable findings live  |
| Weeks 8–12   | Digital PR/link reclamation campaign                                     | Editor/PR               | M ongoing | Relevant earned mentions/links and corrected legacy links tracked   |
| Day 30/60/90 | Review and reprioritise from GSC evidence                                | Owner + team            | S         | Decisions recorded; low-value output is cut, winners are expanded   |

## 12. Decisions not to make yet

- Do not promise a date for ranking `UK fintech news` until Search Console reveals the baseline.
- Do not launch all ten category archives before five hubs prove they can be substantive.
- Do not migrate domains again merely because similarly named sites exist; first establish the entity
  consistently and measure branded confusion.
- Do not delete old URLs in bulk before exporting their links/traffic and mapping real equivalents.
- Do not scale production further until indexation, author accountability, and content yield are
  visible after 60–90 days.
- Do not purchase links or use mass AI pages. The durable moat is original evidence and trusted
  editorial judgement.

## 13. Primary guidance used

- [Google: Creating helpful, reliable, people-first content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)
- [Google: Spam policies, including scaled content and link abuse](https://developers.google.com/search/docs/essentials/spam-policies)
- [Google: Search Console for monitoring and debugging](https://developers.google.com/search/docs/monitor-debug/search-console-start)
- [Google: Site moves and URL mappings](https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes)
- [Google: News sitemap requirements](https://developers.google.com/search/docs/crawling-indexing/sitemaps/news-sitemap)
- [Google: Article structured data](https://developers.google.com/search/docs/appearance/structured-data/article)
- [Google: Breadcrumb structured data](https://developers.google.com/search/docs/appearance/structured-data/breadcrumb)
- [Google News transparency policies](https://support.google.com/news/publisher-center/answer/6204050)
- [Google: Core Web Vitals](https://developers.google.com/search/docs/appearance/core-web-vitals)

## 14. Implementation status

**Engineering pass: 24 September 2026, not yet deployed.** What's built, and what still needs the owner.

### Built in code

| Plan item                         | Status                                                                                                                                                                           | Where                                                   |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 4.2 Publication-aware sitemap     | Done: rendered per request over the tagged article index, so publish and withdrawal invalidation reach it                                                                        | `src/app/sitemap.ts`, `src/lib/publication/sitemaps.ts` |
| 4.2 News sitemap                  | Done: news, analysis, company, and interview pieces from the last two days; listed in robots                                                                                     | `src/app/news-sitemap.xml/route.ts`                     |
| 4.2 / 4.3 / 5.4 Production checks | Done: `pnpm seo:check [origin] [--expect-slug <slug>]` checks sitemap vs archive, freshness, archive 404s, canonicals, orphans, broken internal links                            | `scripts/check-seo.mjs`                                 |
| 4.3 Archive overflow              | Done: an out-of-range page (PostgREST `PGRST103`) now returns a 404 instead of a 500, for archive, hub, and author listings                                                      | `src/lib/publication/repository.ts`                     |
| 4.4 Legacy redirects              | Mechanism only: WordPress `/feed/...` redirects to `/feed.xml`. No other mappings until the inventory exists                                                                     | `src/lib/site/legacy-redirects.ts`                      |
| 5.1 Trust pages                   | Done: About, Editorial standards, AI policy, and Corrections, written from what the pipeline does. Contact is a form that emails the editor without publishing an address        | `src/lib/site/trust-pages.ts`                           |
| 5.2 Entity markup                 | Done: `NewsMediaOrganization` + `WebSite` graph with stable `@id`s, a logo, article publisher/author entities with profile URLs, and `BreadcrumbList`                            | `src/lib/site/structured-data.ts`                       |
| 5.3 Topic hubs                    | Done: five hubs, a Topics index, header and footer links, linked category labels, and breadcrumbs. Hubs with fewer than three articles are `noindex` and left out of the sitemap | `src/lib/site/topics.ts`, `src/app/(public)/topics`     |
| 5.3 Author pages                  | Done: `/authors/[slug]` for every published byline. The desk byline is a team entity, never a person                                                                             | `src/app/(public)/authors/[slug]`                       |
| 5.4 Internal links (structural)   | Partial: every article links to its hub; related articles come from the whole hub, not just the exact category                                                                   | `src/app/(public)/blog/[slug]/page.tsx`                 |
| Data fix                          | Categories stored with escaped entities (`Fraud &amp; Cybersecurity`) now display and group correctly                                                                            | `normaliseCategory`                                     |

### Needs the owner before or after deploy

1. **Publisher facts.** Fill `publisherFacts` in `src/lib/site/config.ts`: legal publisher, location, launch year, named accountable editor (optional), and verified profiles. Until then, About has no ownership section. This is the largest remaining trust gap for Google News.
2. **Review the trust-page copy.** Confirm especially the statements that FinTechPulse publishes no sponsored content, affiliate links, or anonymous sources, and the AI policy's statement that not every article is read by a person before publication. That statement matches the auto-publish policy now in production.
3. **Search Console (4.1).** Verify the Domain property, submit `sitemap.xml` and `news-sitemap.xml`, and export the baseline. Analytics needs a UK consent implementation first.
4. **Legacy inventory (4.4).** Export legacy URLs from Search Console, backlinks, and the Internet Archive, then add one-hop mappings to `legacy-redirects.ts`.
5. **Rich Results Test** on the homepage, one article, and one hub after deploy.

### Deferred: needs a design decision or a migration

- **Corrections workflow.** Published article text cannot be edited in place today; an error can only be handled by withdrawal. A correction note, `dateModified` for text changes, and a public corrections log need an article-revision model.
- **Hero replacement changes `dateModified`.** It stamps `content_updated_at`, which section 5.2 says only editorial updates should do.
- **Draft `internalLinks` (5.4).** These are unverified model suggestions stored on drafts. Publishing them needs validation against live slugs and an editor-visible step, which means a migration plus console UI.
- **Search-led brief fields (6.1, 6.5)** and **production mix (6.4).** These are pipeline and editorial-policy changes for the owner to decide: audience, primary query, cannibalisation check, and human approval for consumer guides.
- **Performance (9).** Wait for field Core Web Vitals data before tuning, as the plan advises.
