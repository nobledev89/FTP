#!/usr/bin/env node
/**
 * Live SEO health check (docs/SEO-GROWTH-PLAN.md sections 4.2, 4.3, and 5.4).
 *
 *   node scripts/check-seo.mjs [origin] [--expect-slug <slug>] [--within <seconds>]
 *
 * Checks, against a running site (production by default):
 *   1. every article the public archive lists is in sitemap.xml, and nothing else is missing;
 *   2. every sitemap URL answers 200 without a redirect and declares itself canonical;
 *   3. the first page past the archive's end and a huge page number answer 404, never 5xx;
 *   4. news-sitemap.xml is well formed and lists only URLs that are in the main sitemap;
 *   5. no sitemap URL is an orphan (linked from no other public page) and no internal link is broken.
 * With --expect-slug it first polls until that article appears in the sitemap, failing after
 * --within seconds (default 300), which is the publication-freshness check.
 *
 * Exits non-zero when any check fails.
 */

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? null : (args[index + 1] ?? null);
};
const origin = (
  args.find((value) => /^https?:\/\//.test(value)) ?? "https://fintechpulse.co.uk"
).replace(/\/+$/, "");
const expectSlug = flag("--expect-slug");
const withinSeconds = Number(flag("--within") ?? 300);

const failures = [];
const fail = (message) => {
  failures.push(message);
  console.log(`  FAIL ${message}`);
};
const pass = (message) => console.log(`  ok   ${message}`);

async function get(path, { redirect = "manual" } = {}) {
  const url = path.startsWith("http") ? path : `${origin}${path}`;
  const response = await fetch(url, {
    redirect,
    headers: { "User-Agent": "FinTechPulse-SEO-check/1.0", "Cache-Control": "no-cache" },
  });
  const body = response.status === 200 ? await response.text() : "";
  return { url, status: response.status, location: response.headers.get("location"), body };
}

function locs(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) =>
    match[1].replaceAll("&amp;", "&").trim(),
  );
}

function internalLinks(html) {
  const links = new Set();
  for (const [, href] of html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)) {
    const value = href.replaceAll("&amp;", "&");
    if (value.startsWith("/") && !value.startsWith("//"))
      links.add(`${origin}${value.split("#")[0]}`);
    else if (value.startsWith(origin)) links.add(value.split("#")[0]);
  }
  return links;
}

function canonicalOf(html) {
  return (
    html.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/)?.[1] ??
    html.match(/<link[^>]+href="([^"]+)"[^>]+rel="canonical"/)?.[1] ??
    null
  )?.replaceAll("&amp;", "&");
}

async function pool(items, size, task) {
  const results = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await task(items[index]);
      }
    }),
  );
  return results;
}

async function sitemapUrls() {
  const response = await get("/sitemap.xml");
  if (response.status !== 200) throw new Error(`sitemap.xml answered ${response.status}`);
  return locs(response.body);
}

console.log(`SEO check for ${origin}\n`);

if (expectSlug) {
  console.log(`Publication freshness: waiting for /blog/${expectSlug}`);
  const target = `${origin}/blog/${expectSlug}`;
  const deadline = Date.now() + withinSeconds * 1000;
  let found = false;
  while (Date.now() < deadline) {
    if ((await sitemapUrls()).includes(target)) {
      found = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
  if (found) pass(`${target} is in the sitemap`);
  else fail(`${target} did not appear in the sitemap within ${withinSeconds}s`);
}

console.log("Archive and sitemap coverage");
const sitemap = await sitemapUrls();
const sitemapSet = new Set(sitemap);
const archiveArticles = new Set();
// Later archive pages are crawlable link sources even though they are not in the sitemap.
const archiveLinkSources = [];
let lastPage = 0;
for (let page = 1; page <= 1000; page += 1) {
  const response = await get(page === 1 ? "/blog" : `/blog?page=${page}`);
  if (response.status !== 200) break;
  lastPage = page;
  if (page > 1) archiveLinkSources.push(internalLinks(response.body));
  const before = archiveArticles.size;
  for (const link of internalLinks(response.body)) {
    if (/\/blog\/[a-z0-9-]+$/.test(link)) archiveArticles.add(link);
  }
  if (!/rel="next"/.test(response.body) || archiveArticles.size === before) break;
}
const missing = [...archiveArticles].filter((url) => !sitemapSet.has(url));
if (missing.length === 0) pass(`all ${archiveArticles.size} archive articles are in the sitemap`);
else fail(`${missing.length} archive articles missing from the sitemap: ${missing.join(", ")}`);
if (new Set(sitemap).size !== sitemap.length) fail("sitemap contains duplicate URLs");

console.log("Archive error semantics");
for (const page of [lastPage + 1, 999]) {
  const { status } = await get(`/blog?page=${page}`);
  if (status === 404) pass(`/blog?page=${page} answers 404`);
  else fail(`/blog?page=${page} answers ${status}, expected 404`);
}

console.log("News sitemap");
const news = await get("/news-sitemap.xml");
if (news.status !== 200) fail(`news-sitemap.xml answered ${news.status}`);
else if (!news.body.includes('xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"')) {
  fail("news-sitemap.xml is missing the news namespace");
} else {
  const newsUrls = locs(news.body);
  const stray = newsUrls.filter((url) => !sitemapSet.has(url));
  if (stray.length === 0) pass(`news sitemap lists ${newsUrls.length} URL(s), all canonical`);
  else fail(`news sitemap lists URLs absent from the main sitemap: ${stray.join(", ")}`);
}

console.log("Sitemap URLs: status, canonical, and links");
const inbound = new Map(sitemap.map((url) => [url, 0]));
for (const links of archiveLinkSources) {
  for (const link of links) if (inbound.has(link)) inbound.set(link, inbound.get(link) + 1);
}
const discovered = new Set();
await pool(sitemap, 6, async (url) => {
  const response = await get(url);
  if (response.status !== 200) {
    fail(
      `${url} answered ${response.status}${response.location ? ` -> ${response.location}` : ""}`,
    );
    return;
  }
  const canonical = canonicalOf(response.body);
  const expected = url === origin ? [origin, `${origin}/`] : [url];
  if (!canonical || !expected.includes(canonical)) {
    fail(`${url} declares canonical ${canonical ?? "(none)"}`);
  }
  for (const link of internalLinks(response.body)) {
    discovered.add(link);
    const key = link === `${origin}/` ? origin : link;
    if (key !== url && inbound.has(key)) inbound.set(key, inbound.get(key) + 1);
  }
});
const orphans = [...inbound].filter(([url, count]) => count === 0 && url !== origin);
if (orphans.length === 0) pass("no sitemap URL is an orphan");
else fail(`orphan URLs (no inbound internal link): ${orphans.map(([url]) => url).join(", ")}`);

const toProbe = [...discovered].filter(
  (url) => !sitemapSet.has(url) && !/\/(admin|api|design-review)(\/|$)/.test(url),
);
const broken = (
  await pool(toProbe, 6, async (url) => {
    const { status } = await get(url, { redirect: "follow" });
    return status >= 400 ? `${url} (${status})` : null;
  })
).filter(Boolean);
if (broken.length === 0)
  pass(`no broken internal links among ${toProbe.length} non-sitemap targets`);
else fail(`broken internal links: ${broken.join(", ")}`);

console.log(
  failures.length === 0 ? "\nAll SEO checks passed." : `\n${failures.length} SEO check(s) failed.`,
);
process.exit(failures.length === 0 ? 0 : 1);
