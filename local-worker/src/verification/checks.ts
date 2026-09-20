/**
 * Live verification checks (plan section 14).
 *
 * These run against the HTML the public site actually served, not against the database, because
 * the thing being verified is that a reader can see the article. They are pure functions over the
 * response so they can be tested without a network, and so the same eight checks are applied on
 * every attempt in the same order.
 *
 * `record_verification` requires all eight names and advances the job to VERIFIED only when every
 * one succeeded, so a check that cannot be evaluated must fail rather than be omitted.
 */

export const REQUIRED_CHECKS = [
  "status_ok",
  "canonical_matches",
  "title_present",
  "body_present",
  "hero_image_ok",
  "meta_present",
  "json_ld_valid",
  "no_placeholders",
] as const;

export type CheckName = (typeof REQUIRED_CHECKS)[number];
export type CheckOutcome = "succeeded" | "failed" | "skipped";

export type VerificationCheck = Readonly<{
  name: CheckName;
  outcome: CheckOutcome;
  http_status?: number;
  duration_ms?: number;
  detail?: string;
  error?: string;
}>;

export type VerificationTarget = Readonly<{
  canonicalUrl: string;
  title: string;
  metaDescription: string;
  /** A distinctive phrase from the article body, used to prove the body rendered. */
  bodyProbe: string;
  expectHeroImage: boolean;
}>;

export type PageResponse = Readonly<{
  status: number;
  html: string;
  durationMs: number;
}>;

const PLACEHOLDER_MARKERS = ["lorem ipsum", "[object object]", "{{", "todo:", ">undefined<"];

const ARTICLE_TYPES = new Set(["Article", "NewsArticle", "BlogPosting", "AnalysisNewsArticle"]);

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
};

/** Decodes the entities a server-rendered page actually emits. Not a general HTML parser. */
export function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    const named = NAMED_ENTITIES[entity.toLowerCase()];
    if (named !== undefined) return named;
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (entity.startsWith("#")) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return match;
  });
}

/** The visible text of the page, with script, style, and tags removed. */
export function visibleText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  if (!match) return null;
  return decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
}

function findTags(html: string, tagName: string): readonly string[] {
  return html.match(new RegExp(`<${tagName}\\b[^>]*>`, "gi")) ?? [];
}

export function canonicalHref(html: string): string | null {
  for (const tag of findTags(html, "link")) {
    if (/\brel\s*=\s*("canonical"|'canonical'|canonical)/i.test(tag)) {
      return attribute(tag, "href");
    }
  }
  return null;
}

export function metaDescription(html: string): string | null {
  for (const tag of findTags(html, "meta")) {
    if (/\bname\s*=\s*("description"|'description'|description)/i.test(tag)) {
      return attribute(tag, "content");
    }
  }
  return null;
}

export function documentTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match?.[1] === undefined ? null : decodeEntities(match[1]).trim();
}

/** Images with alt text, which is what "the hero rendered accessibly" means here. */
export function imagesWithAlt(html: string): number {
  return findTags(html, "img").filter((tag) => (attribute(tag, "alt") ?? "").trim().length > 0)
    .length;
}

/**
 * The URL of the first image the page renders with alt text, resolved against the page itself.
 *
 * The hero is taken from the served HTML rather than from the database row so that verification
 * follows the reader's path: whatever `src` the page emitted is what a browser will request, and
 * that is the URL whose availability decides `hero_image_ok`. `srcset` is deliberately ignored —
 * `src` is the fallback every client fetches.
 */
export function heroImageUrl(html: string, pageUrl: string): string | null {
  for (const tag of findTags(html, "img")) {
    if ((attribute(tag, "alt") ?? "").trim().length === 0) continue;
    const src = (attribute(tag, "src") ?? "").trim();
    if (src.length === 0 || src.startsWith("data:")) continue;
    try {
      return new URL(src, pageUrl).toString();
    } catch {
      return null;
    }
  }
  return null;
}

/** The result of fetching the hero image the page asked for. */
export type HeroAsset = Readonly<{
  url: string;
  status: number;
  contentType: string | null;
  durationMs: number;
  error?: string;
}>;

export function jsonLdBlocks(html: string): readonly unknown[] {
  const blocks: unknown[] = [];
  const pattern =
    /<script\b[^>]*type\s*=\s*("application\/ld\+json"|'application\/ld\+json')[^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const body = match[2];
    if (body === undefined) continue;
    try {
      blocks.push(JSON.parse(body) as unknown);
    } catch {
      blocks.push(null);
    }
  }
  return blocks;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function hasArticleNode(value: unknown, headline: string): boolean {
  if (Array.isArray(value)) return value.some((entry) => hasArticleNode(entry, headline));
  if (typeof value !== "object" || value === null) return false;

  const node = value as Record<string, unknown>;
  const graph = node["@graph"];
  if (graph !== undefined && hasArticleNode(graph, headline)) return true;

  const types = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
  const isArticle = types.some((type) => typeof type === "string" && ARTICLE_TYPES.has(type));
  if (!isArticle) return false;

  const nodeHeadline = node["headline"];
  return typeof nodeHeadline === "string" && normalize(nodeHeadline) === normalize(headline);
}

type SharedFields = Readonly<{ http_status?: number; duration_ms: number }>;

/**
 * `hero_image_ok` asks two questions: did the page render an image a reader can perceive, and does
 * that image actually resolve? A public Storage copy that never landed leaves the article HTML
 * intact and the picture broken, which is exactly the partially available page verification exists
 * to catch, so the check reports the image's own status rather than the page's.
 */
function heroCheck(
  html: string,
  hero: HeroAsset | null,
  pageShared: SharedFields,
): VerificationCheck {
  const withAlt = imagesWithAlt(html);
  if (withAlt === 0) {
    return {
      ...pageShared,
      name: "hero_image_ok",
      outcome: "failed",
      detail: "0 images with alt text",
      error: "No image with alt text was rendered",
    };
  }
  if (!hero) {
    return {
      ...pageShared,
      name: "hero_image_ok",
      outcome: "failed",
      detail: `${withAlt} images with alt text`,
      error: "The hero image was not resolved from the page",
    };
  }

  const contentType = hero.contentType ?? "";
  const ok =
    hero.status >= 200 && hero.status < 300 && contentType.toLowerCase().startsWith("image/");
  return {
    ...(hero.status >= 100 && hero.status <= 599 ? { http_status: hero.status } : {}),
    duration_ms: hero.durationMs,
    name: "hero_image_ok",
    outcome: ok ? "succeeded" : "failed",
    detail: `${withAlt} images with alt text; ${hero.url} responded ${hero.status} ${contentType || "without a content type"}`,
    ...(ok
      ? {}
      : {
          error:
            hero.error ??
            `The hero image responded ${hero.status} ${contentType || "without a content type"}`,
        }),
  };
}

/**
 * Runs all eight checks. The order is fixed so the logs read the same way on every attempt.
 *
 * `heroAsset` is the outcome of fetching the hero image the page referenced, which the caller does
 * because it needs the network. Omitting it when an image is expected fails `hero_image_ok`: a
 * check that could not be evaluated must never be reported as a pass.
 */
export function evaluatePage(
  response: PageResponse,
  target: VerificationTarget,
  heroAsset?: HeroAsset | null,
): readonly VerificationCheck[] {
  // A transport failure uses status 0 locally. Omit it from the stored check because the database
  // accepts HTTP response codes only (100-599), while still recording the failed outcome.
  const shared = {
    ...(response.status >= 100 && response.status <= 599 ? { http_status: response.status } : {}),
    duration_ms: response.durationMs,
  } as const;
  const html = response.html;
  const text = visibleText(html);
  const checks: VerificationCheck[] = [];

  const reachable = response.status === 200;
  checks.push({
    ...shared,
    name: "status_ok",
    outcome: reachable ? "succeeded" : "failed",
    ...(reachable ? {} : { error: `The page responded ${response.status}` }),
  });

  // Every remaining check reads the body, so an unreachable page fails them all rather than
  // reporting eight separate parse failures.
  if (!reachable) {
    for (const name of REQUIRED_CHECKS.slice(1)) {
      checks.push({
        ...shared,
        name: name as CheckName,
        outcome: "failed",
        error: "The page was not reachable",
      });
    }
    return checks;
  }

  const canonical = canonicalHref(html);
  const canonicalOk = canonical === target.canonicalUrl;
  checks.push({
    ...shared,
    name: "canonical_matches",
    outcome: canonicalOk ? "succeeded" : "failed",
    detail: canonical ?? "absent",
    ...(canonicalOk ? {} : { error: `Expected canonical ${target.canonicalUrl}` }),
  });

  const title = documentTitle(html);
  const titleOk = title !== null && normalize(title).includes(normalize(target.title).slice(0, 60));
  checks.push({
    ...shared,
    name: "title_present",
    outcome: titleOk ? "succeeded" : "failed",
    detail: title ?? "absent",
    ...(titleOk ? {} : { error: "The document title does not carry the article title" }),
  });

  const probe = normalize(target.bodyProbe);
  const bodyOk = probe.length > 0 && normalize(text).includes(probe) && text.length >= 200;
  checks.push({
    ...shared,
    name: "body_present",
    outcome: bodyOk ? "succeeded" : "failed",
    detail: `${text.length} characters of visible text`,
    ...(bodyOk ? {} : { error: "The article body did not render" }),
  });

  if (!target.expectHeroImage) {
    checks.push({
      ...shared,
      name: "hero_image_ok",
      outcome: "skipped",
      detail: "The job requested no images",
    });
  } else {
    checks.push(heroCheck(html, heroAsset ?? null, shared));
  }

  const description = metaDescription(html);
  const descriptionOk = (description ?? "").trim().length > 0;
  checks.push({
    ...shared,
    name: "meta_present",
    outcome: descriptionOk ? "succeeded" : "failed",
    detail: description ? `${description.length} characters` : "absent",
    ...(descriptionOk ? {} : { error: "The meta description is missing or empty" }),
  });

  const blocks = jsonLdBlocks(html);
  const jsonLdOk = blocks.some((block) => hasArticleNode(block, target.title));
  checks.push({
    ...shared,
    name: "json_ld_valid",
    outcome: jsonLdOk ? "succeeded" : "failed",
    detail: `${blocks.length} JSON-LD blocks`,
    ...(jsonLdOk ? {} : { error: "No JSON-LD article node with a matching headline was found" }),
  });

  const lowerText = text.toLowerCase();
  const lowerHtml = html.toLowerCase();
  const found = PLACEHOLDER_MARKERS.filter(
    (marker) => lowerText.includes(marker) || lowerHtml.includes(marker),
  );
  checks.push({
    ...shared,
    name: "no_placeholders",
    outcome: found.length === 0 ? "succeeded" : "failed",
    ...(found.length === 0
      ? { detail: "No placeholder markers" }
      : { error: `Placeholder markers present: ${found.join(", ")}` }),
  });

  return checks;
}

/** True when every required check passed, treating a permitted skip as a pass. */
export function allChecksPassed(checks: readonly VerificationCheck[]): boolean {
  return REQUIRED_CHECKS.every((name) => {
    const check = checks.find((candidate) => candidate.name === name);
    return (
      check?.outcome === "succeeded" || (name === "hero_image_ok" && check?.outcome === "skipped")
    );
  });
}
