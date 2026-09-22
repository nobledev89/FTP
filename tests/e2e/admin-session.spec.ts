import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

import type { Database } from "@/lib/supabase/database.types";
import type { WorkerEnv } from "../../local-worker/src/config/env.js";
import { ArtifactStore } from "../../local-worker/src/db/artifact-store.js";
import { createWorkerClient, SupabaseWorkerStore } from "../../local-worker/src/db/worker-store.js";
import { StructuredLogger } from "../../local-worker/src/logging/logger.js";
import { createPipelineHandlers } from "../../local-worker/src/pipeline/handlers.js";
import type { RunContext } from "../../local-worker/src/providers/contract.js";
import { buildAudit } from "../../local-worker/src/providers/mock/audit.js";
import { buildDraft } from "../../local-worker/src/providers/mock/draft.js";
import { buildImages } from "../../local-worker/src/providers/mock/images.js";
import { buildResearchPacket } from "../../local-worker/src/providers/mock/research.js";
import { PublishingService } from "../../local-worker/src/publishing/publish.js";
import { CacheRevalidationClient } from "../../local-worker/src/publishing/revalidate.js";
import { WorkerRunner } from "../../local-worker/src/queue/runner.js";
import { VerificationService } from "../../local-worker/src/verification/verify.js";

/**
 * Phase 4 exit criterion, driven through the browser: an authenticated admin signs in, creates an
 * `IDEA`, inspects it, moves it through admin transitions, saves settings, and signs out; a
 * signed-in account with no membership gets nowhere.
 *
 * Runs only under `pnpm test:e2e:admin`, which builds the app against the local Supabase stack and
 * supplies the service-role key used to create the fixture accounts. Without that the suite is
 * skipped, so `pnpm test:e2e` stays runnable with no database.
 */

const supabaseUrl = process.env.E2E_SUPABASE_URL;
const serviceKey = process.env.E2E_SUPABASE_SERVICE_KEY;
const publishableKey = process.env.E2E_SUPABASE_PUBLISHABLE_KEY;

test.skip(
  !supabaseUrl || !serviceKey || !publishableKey,
  "requires the local Supabase stack; run `pnpm test:e2e:admin`",
);

const PASSWORD = `E2e-${randomUUID()}`;
const ownerEmail = `e2e-owner-${randomUUID().slice(0, 8)}@example.test`;
const outsiderEmail = `e2e-outsider-${randomUUID().slice(0, 8)}@example.test`;
const topic = `End-to-end console check ${randomUUID().slice(0, 8)}`;

let service: SupabaseClient<Database>;
let ownerId: string;
const createdUserIds: string[] = [];
let jobId: string | null = null;
let originalByline: string | null = null;
let originalProcessingMax = 4;
let publishedSlug: string | null = null;
let publishedJobId: string | null = null;

async function createUser(email: string): Promise<string> {
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("createUser returned no user");
  createdUserIds.push(data.user.id);
  return data.user.id;
}

test.beforeAll(async () => {
  service = createClient<Database>(supabaseUrl as string, serviceKey as string, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const site = await service.from("sites").select("id").eq("slug", "fintechpulse").single();
  if (site.error || !site.data) throw site.error ?? new Error("seed site missing");

  ownerId = await createUser(ownerEmail);
  await createUser(outsiderEmail);

  const membership = await service
    .from("admin_users")
    .insert({ user_id: ownerId, site_id: site.data.id, role: "owner", display_name: "E2E Owner" });
  if (membership.error) throw membership.error;

  const settings = await service
    .from("site_settings")
    .select("default_byline_name, processing_max_articles")
    .eq("site_id", site.data.id)
    .single();
  originalByline = settings.data?.default_byline_name ?? null;
  originalProcessingMax = settings.data?.processing_max_articles ?? 4;
  const testCapacity = await service
    .from("site_settings")
    .update({ processing_max_articles: 24 })
    .eq("site_id", site.data.id);
  if (testCapacity.error) throw testCapacity.error;
});

test.afterAll(async () => {
  if (!service) return;
  if (originalByline !== null) {
    await service
      .from("site_settings")
      .update({
        default_byline_name: originalByline,
        processing_max_articles: originalProcessingMax,
      })
      .neq("site_id", "00000000-0000-0000-0000-000000000000");
  }
  // The job is left behind on purpose: `job_events` is append-only for every role, so the job it
  // references cannot be deleted either. `pnpm supabase:reset` clears the local database.
  for (const userId of createdUserIds) {
    await service.auth.admin.deleteUser(userId);
  }
});

test.describe.configure({ mode: "serial" });

/**
 * Signs in and waits for the redirect to land. Without the wait, a following `page.goto` can race
 * the Server Action's `Set-Cookie` and be sent straight back to the login page by the proxy.
 */
async function signIn(page: Page, email: string, expected: RegExp) {
  await page.goto("/admin/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(expected);
}

/** The worker the console hands off to, wired exactly as `pnpm worker:once` wires it. */
function workerRunner(workerId: string): WorkerRunner {
  const env: WorkerEnv = {
    SUPABASE_URL: supabaseUrl as string,
    SUPABASE_SERVICE_ROLE_KEY: serviceKey as string,
    PUBLIC_SITE_URL: "http://127.0.0.1:3100",
    REVALIDATION_SECRET: process.env.REVALIDATION_SECRET as string,
    WORKER_ID: workerId,
    WORKER_POLL_INTERVAL_MS: 250,
    WORKER_HEARTBEAT_INTERVAL_MS: 1_000,
    WORKER_OFFLINE_AFTER_SECONDS: 120,
    WORKER_LEASE_SECONDS: 30,
    WORKER_MAX_ATTEMPTS: 5,
    WORKER_SHUTDOWN_TIMEOUT_MS: 2_000,
    PUBLISH_VERIFY_TIMEOUT_MS: 10_000,
    CODEX_BIN: "codex",
    CLAUDE_BIN: "claude",
    CLI_TIMEOUT_MS: 1_200_000,
    API_TIMEOUT_MS: 300_000,
    API_MAX_RESPONSE_BYTES: 16_000_000,
    OPENAI_API_MODEL: "gpt-5",
    ANTHROPIC_API_MODEL: "claude-sonnet-5",
    GEMINI_IMAGE_MODEL: "gemini-3.1-flash-image",
  };
  const workerClient = createWorkerClient(env);
  const artifacts = new ArtifactStore(workerClient);
  const quietLogger = new StructuredLogger({}, { write() {} });
  return new WorkerRunner({
    env,
    store: new SupabaseWorkerStore(workerClient),
    handlers: createPipelineHandlers({
      store: artifacts,
      publisher: new PublishingService(
        workerClient,
        artifacts,
        new CacheRevalidationClient({
          publicSiteUrl: env.PUBLIC_SITE_URL,
          secret: env.REVALIDATION_SECRET,
          timeoutMs: env.PUBLISH_VERIFY_TIMEOUT_MS,
        }),
      ),
      verifier: new VerificationService(workerClient, {
        publicSiteUrl: env.PUBLIC_SITE_URL,
        timeoutMs: env.PUBLISH_VERIFY_TIMEOUT_MS,
      }),
      logger: quietLogger,
    }),
    logger: quietLogger,
    random: () => 0,
  });
}

type JobState = Readonly<{
  status: string;
  action_required_kind: string | null;
  action_required_run_id: string | null;
}>;

/**
 * Runs the worker until `jobId` satisfies `wanted`. The local database is shared with the other
 * suites, so a cycle may serve a different job first; that is the queue working, not a failure.
 */
async function runWorkerUntil(
  runner: WorkerRunner,
  jobId: string,
  wanted: (job: JobState) => boolean,
): Promise<JobState> {
  for (let cycle = 0; cycle < 25; cycle += 1) {
    const { data, error } = await service
      .from("article_jobs")
      .select("status, action_required_kind, action_required_run_id")
      .eq("id", jobId)
      .single();
    if (error || !data) throw error ?? new Error("job missing");
    if (wanted(data)) return data;
    await runner.runOnce();
  }
  throw new Error(`job ${jobId} did not reach the expected state`);
}

const waitingForInput = (job: JobState) => job.action_required_kind === "manual_input";

test.describe("authenticated admin console", () => {
  test("signs in and lands on the requested page", async ({ page }) => {
    // Arriving at a deep link should come back to it after signing in.
    await page.goto("/admin/settings");
    await expect(page).toHaveURL(/\/admin\/login\?next=%2Fadmin%2Fsettings/);

    await page.getByLabel("Email address").fill(ownerEmail);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/admin\/settings$/);
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    await expect(page.getByText("E2E Owner")).toBeVisible();
  });

  test("rejects the wrong password without saying which field was wrong", async ({ page }) => {
    await page.goto("/admin/login");
    await page.getByLabel("Email address").fill(ownerEmail);
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByRole("status")).toHaveText("Those sign-in details were not recognised.");
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test("creates an IDEA and shows it on the article page", async ({ page }) => {
    await signIn(page, ownerEmail, /\/admin$/);

    await page.goto("/admin/articles/new");
    await page.getByLabel("Topic").fill(topic);
    await page.getByLabel("Keywords").fill("payments, uk");
    await page.getByLabel("Image count").fill("0");
    // Phase 9 made the seeded writing default (Claude Code) a working mode, so the publication
    // default is selectable and the CLI modes are offered; API modes still are not.
    const writing = page.getByLabel("Writing", { exact: true });
    await expect(writing.locator('option[value="default"]')).toBeEnabled();
    await expect(writing.locator('option[value="default"]')).toHaveText(
      "Publication default (Claude Code)",
    );
    await expect(writing.locator('option[value="claude_code"]')).toHaveCount(1);
    await expect(writing.locator('option[value="anthropic_api"]')).toHaveCount(0);
    const research = page.getByLabel("Research", { exact: true });
    await expect(research.locator('option[value="codex_cli"]')).toHaveCount(1);
    await expect(research.locator('option[value="openai_api"]')).toHaveCount(0);
    await writing.selectOption({ label: "Manual Claude" });
    await page.getByRole("button", { name: "Create article job" }).click();

    await expect(page).toHaveURL(/\/admin\/articles\/[0-9a-f-]{36}$/);
    jobId = new URL(page.url()).pathname.split("/").pop() ?? null;
    expect(jobId).not.toBeNull();

    await expect(page.getByRole("heading", { level: 1, name: topic })).toBeVisible();
    await expect(page.getByText("Needs you").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Not started yet." })).toBeVisible();
    await page.getByRole("link", { name: "Technical details" }).click();
    await expect(page.getByText("job.created")).toBeVisible();
    await expect(page.getByText("IDEA").first()).toBeVisible();
  });

  test("runs the admin transitions the status allows", async ({ page }) => {
    await signIn(page, ownerEmail, /\/admin$/);

    await page.goto(`/admin/articles/${jobId}`);
    await page.getByRole("button", { name: "Start the article" }).click();
    await expect(page.getByRole("status")).toHaveText("Job started.");

    await page.reload();
    await expect(page.getByText("In progress").first()).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Waiting for the worker to start researching/ }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Job paused.");

    await page.reload();
    await page.getByRole("button", { name: "Resume" }).click();
    await expect(page.getByRole("status")).toHaveText("Job resumed.");

    const job = await service
      .from("article_jobs")
      .select("status, lock_version")
      .eq("id", jobId as string)
      .single();
    expect(job.data?.status).toBe("RESEARCH_PENDING");
    expect(job.data?.lock_version).toBe(3);
  });

  test("refuses an action carrying a stale lock version", async ({ page }) => {
    await signIn(page, ownerEmail, /\/admin$/);

    await page.goto(`/admin/articles/${jobId}`);

    // A second admin acts between this page rendering and the button being pressed. The admin RPCs
    // authorize `auth.uid()`, so this has to be a signed-in session, not the service role.
    const other = createClient<Database>(supabaseUrl as string, publishableKey as string, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const signedIn = await other.auth.signInWithPassword({
      email: ownerEmail,
      password: PASSWORD,
    });
    expect(signedIn.error).toBeNull();
    const raced = await other.rpc("admin_transition_job", {
      p_job_id: jobId as string,
      p_action: "pause",
      p_expected_lock_version: 3,
    });
    expect(raced.error).toBeNull();

    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText(
      "This job changed since the page was loaded. Reload it and try again.",
    );
  });

  test("saves publication settings", async ({ page }) => {
    await signIn(page, ownerEmail, /\/admin$/);

    await page.goto("/admin/settings");
    const byline = `E2E Newsroom ${randomUUID().slice(0, 6)}`;
    await page.getByLabel("Default byline").fill(byline);
    await page.getByRole("button", { name: "Save settings" }).click();

    await expect(page.getByText("Settings saved.")).toBeVisible();

    const settings = await service
      .from("site_settings")
      .select("default_byline_name")
      .limit(1)
      .single();
    expect(settings.data?.default_byline_name).toBe(byline);
  });

  test("signs out and locks the console again", async ({ page }) => {
    await signIn(page, ownerEmail, /\/admin$/);

    await page.getByRole("button", { name: "Sign out" }).first().click();
    await expect(page).toHaveURL(/\/admin\/login/);

    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/login/);
    await expect(page.getByRole("heading", { name: "Admin sign in" })).toBeVisible();
  });

  test("gives a signed-in account with no membership nothing", async ({ page }) => {
    await signIn(page, outsiderEmail, /\/admin\/no-access$/);

    await expect(
      page.getByRole("heading", { name: "This account has no admin access" }),
    ).toBeVisible();

    // Every other admin route stays closed while that session exists.
    for (const path of ["/admin", "/admin/logs", `/admin/articles/${jobId}`]) {
      const response = await page.goto(path);
      // Read the body before anything else: once the page navigates on, the browser discards it.
      const body = (await response?.text()) ?? "";
      await expect(page).toHaveURL(/\/admin\/no-access$/);
      expect(body).not.toContain(topic);
    }
  });

  test("publishes through the worker and verifies the real public article page", async ({
    page,
    request,
  }) => {
    const publicationTopic = `Open banking safeguards for UK shoppers ${randomUUID().slice(0, 8)}`;
    const editor = createClient<Database>(supabaseUrl as string, publishableKey as string, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const signIn = await editor.auth.signInWithPassword({ email: ownerEmail, password: PASSWORD });
    expect(signIn.error).toBeNull();

    const created = await editor.rpc("create_article_job", {
      p_topic: publicationTopic,
      p_keywords: ["payments", "uk", "open banking"],
      p_image_count: 1,
      p_auto_publish: true,
      p_research_mode: "mock",
      p_writing_mode: "mock",
      p_images_mode: "mock",
      p_audit_mode: "mock",
    });
    if (created.error || !created.data) throw created.error ?? new Error("job creation failed");
    const publicJobId = created.data;
    const started = await editor.rpc("admin_transition_job", {
      p_job_id: publicJobId,
      p_action: "start",
      p_expected_lock_version: 0,
    });
    if (started.error) throw started.error;

    const runner = workerRunner("e2e-publication-worker");

    let status = "RESEARCH_PENDING";
    for (let cycle = 0; cycle < 10 && status !== "VERIFIED"; cycle += 1) {
      const result = await runner.runOnce();
      expect(result.state).toBe("completed");
      const job = await service
        .from("article_jobs")
        .select("status, article_id")
        .eq("id", publicJobId)
        .single();
      if (job.error || !job.data) throw job.error ?? new Error("published job missing");
      status = job.data.status;
      if (job.data.article_id) {
        const article = await service
          .from("articles")
          .select("slug")
          .eq("id", job.data.article_id)
          .single();
        if (article.error || !article.data) throw article.error ?? new Error("article missing");
        publishedSlug = article.data.slug;
      }
    }

    expect(status).toBe("VERIFIED");
    expect(publishedSlug).toBeTruthy();
    publishedJobId = publicJobId;
    const response = await page.goto(`/blog/${publishedSlug}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Open banking safeguards for UK shoppers",
    );
    await expect(page.locator("article[data-article-body] ")).toBeVisible();
    await expect(page.locator("article img").first()).toHaveAttribute("alt", /editorial scene/i);
    await expect
      .poll(() =>
        page
          .locator("article img")
          .first()
          .evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
    await expect(page.getByRole("heading", { name: "Sources" })).toBeVisible();

    const seo = await page.evaluate(() => ({
      canonical: document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href,
      description: document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content,
      ogType: document.querySelector<HTMLMetaElement>('meta[property="og:type"]')?.content,
      ogImageAlt: document.querySelector<HTMLMetaElement>('meta[property="og:image:alt"]')?.content,
      jsonLd: Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map(
        (script) => JSON.parse(script.textContent ?? "null"),
      ),
    }));
    expect(seo.canonical).toBe(`https://fintechpulse.co.uk/blog/${publishedSlug}`);
    expect(seo.description?.length).toBeGreaterThan(20);
    expect(seo.ogType).toBe("article");
    expect(seo.ogImageAlt).toBe("FinTechPulse article share image");
    expect(seo.jsonLd).toEqual(
      expect.arrayContaining([expect.objectContaining({ "@type": "Article" })]),
    );

    const shareImage = await page.locator('meta[property="og:image"]').getAttribute("content");
    expect(shareImage).toBeTruthy();
    expect(shareImage).toContain("opengraph-image");
    const shareResponse = await request.get(shareImage as string);
    expect(shareResponse.ok()).toBe(true);
    expect(shareResponse.headers()["content-type"]).toContain("image/png");

    await page.goto("/");
    await expect(page.getByRole("link", { name: /Open banking safeguards/ }).first()).toBeVisible();
    await page.goto("/blog");
    await expect(page.getByRole("link", { name: /Open banking safeguards/ }).first()).toBeVisible();

    const hidden = await page.goto("/blog/a-draft-that-was-never-published");
    expect(hidden?.status()).toBe(404);
    expect(await page.textContent("body")).not.toContain(topic);

    const alias = `previous-${publishedSlug}`;
    const article = await service
      .from("articles")
      .select("id, site_id")
      .eq("slug", publishedSlug!)
      .single();
    if (article.error || !article.data) throw article.error ?? new Error("article missing");
    const insertedAlias = await service.from("article_slug_aliases").insert({
      article_id: article.data.id,
      site_id: article.data.site_id,
      slug: alias,
    });
    if (insertedAlias.error) throw insertedAlias.error;
    const aliasResponse = await request.get(`/blog/${alias}`, { maxRedirects: 0 });
    expect(aliasResponse.status()).toBe(308);
    expect(aliasResponse.headers().location).toBe(`/blog/${publishedSlug}`);

    for (const surface of ["/sitemap.xml", "/feed.xml"]) {
      const surfaceResponse = await request.get(surface);
      expect(surfaceResponse.ok()).toBe(true);
      const body = await surfaceResponse.text();
      expect(body).toContain(`/blog/${publishedSlug}`);
      expect(body).not.toContain(topic);
    }
    const robots = await request.get("/robots.txt");
    expect(await robots.text()).toContain("Disallow: /admin");
    const unsignedRevalidation = await request.post("/api/revalidate", {
      data: { slug: publishedSlug },
    });
    expect(unsignedRevalidation.status()).toBe(401);

    const logs = await service
      .from("publishing_logs")
      .select("kind, outcome")
      .eq("job_id", publicJobId);
    expect(logs.error).toBeNull();
    expect(logs.data?.filter((entry) => entry.kind === "verify_check")).toHaveLength(8);
    // The worker signed a real revalidation request against this running site and it was accepted,
    // while the unsigned request above was refused.
    expect(logs.data?.filter((entry) => entry.kind === "revalidate")).toHaveLength(1);
    expect(logs.data?.every((entry) => entry.outcome === "succeeded")).toBe(true);
  });

  test("withdraws a live article from the page, listings, feed, sitemap, and old slugs", async ({
    page,
    request,
  }) => {
    const withdrawnTopic = `Withdrawn buy now pay later notice ${randomUUID().slice(0, 8)}`;
    const editor = createClient<Database>(supabaseUrl as string, publishableKey as string, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    expect(
      (await editor.auth.signInWithPassword({ email: ownerEmail, password: PASSWORD })).error,
    ).toBeNull();
    const job = await editor.rpc("create_article_job", {
      p_topic: withdrawnTopic,
      p_keywords: ["payments", "uk"],
      p_image_count: 0,
      p_auto_publish: true,
      p_research_mode: "mock",
      p_writing_mode: "mock",
      p_images_mode: "mock",
      p_audit_mode: "mock",
    });
    if (job.error || !job.data) throw job.error ?? new Error("job creation failed");
    const withdrawnJobId = job.data;
    const started = await editor.rpc("admin_transition_job", {
      p_job_id: withdrawnJobId,
      p_action: "start",
      p_expected_lock_version: 0,
    });
    if (started.error) throw started.error;

    await runWorkerUntil(
      workerRunner("e2e-withdrawal-worker"),
      withdrawnJobId,
      (state) => state.status === "VERIFIED",
    );
    const published = await service
      .from("article_jobs")
      .select("article_id")
      .eq("id", withdrawnJobId)
      .single();
    const article = await service
      .from("articles")
      .select("id, site_id, slug")
      .eq("id", published.data!.article_id!)
      .single();
    if (article.error || !article.data) throw article.error ?? new Error("article missing");
    const slug = article.data.slug;
    const alias = `earlier-${slug}`;
    const insertedAlias = await service.from("article_slug_aliases").insert({
      article_id: article.data.id,
      site_id: article.data.site_id,
      slug: alias,
    });
    if (insertedAlias.error) throw insertedAlias.error;

    expect((await request.get(`/blog/${slug}`)).status()).toBe(200);
    expect((await request.get(`/blog/${alias}`, { maxRedirects: 0 })).status()).toBe(308);
    expect(await (await request.get("/feed.xml")).text()).toContain(`/blog/${slug}`);

    await signIn(page, ownerEmail, /\/admin$/);
    await page.goto(`/admin/articles/${withdrawnJobId}`);
    await page.getByRole("button", { name: "Withdraw from site" }).click();
    const withdraw = page.getByRole("button", { name: "Withdraw article" });
    await expect(withdraw).toBeVisible();

    // The confirmation checkbox is required, so an unticked form does not submit.
    await page.getByLabel("Reason for withdrawal").fill("Superseded by a corrected explainer.");
    await withdraw.click();
    await expect(page.getByText("and its earlier addresses now return 404")).toHaveCount(0);
    await expect(withdraw).toBeVisible();

    await page.getByLabel("I understand this takes the article off the public site.").check();
    await withdraw.click();
    await expect(page.getByText("and its earlier addresses now return 404")).toBeVisible();
    await expect(page.getByRole("button", { name: "Withdraw from site" })).toHaveCount(0);
    await page.reload();
    await expect(page.getByText("Stopped").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Withdrawn from the site." })).toBeVisible();
    await page.goto(`/admin/articles/${withdrawnJobId}?view=details`);
    await expect(page.getByText("article.withdrawn")).toBeVisible();
    await expect(page.getByText("Superseded by a corrected explainer.")).toBeVisible();

    const gone = await page.goto(`/blog/${slug}`);
    expect(gone?.status()).toBe(404);
    expect(await page.textContent("body")).not.toContain(withdrawnTopic);
    expect((await request.get(`/blog/${alias}`, { maxRedirects: 0 })).status()).toBe(404);
    for (const surface of ["/", "/blog", "/feed.xml", "/sitemap.xml"]) {
      const body = await (await request.get(surface)).text();
      expect(body, `${surface} still lists the withdrawn article`).not.toContain(`/blog/${slug}`);
    }
  });

  test("lists an approved article for review and discards it", async ({ page }) => {
    const reviewTopic = `Review queue check ${randomUUID().slice(0, 8)}`;
    const editor = createClient<Database>(supabaseUrl as string, publishableKey as string, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    expect(
      (await editor.auth.signInWithPassword({ email: ownerEmail, password: PASSWORD })).error,
    ).toBeNull();
    const job = await editor.rpc("create_article_job", {
      p_topic: reviewTopic,
      p_keywords: ["payments", "uk"],
      p_image_count: 0,
      p_auto_publish: false,
      p_research_mode: "mock",
      p_writing_mode: "mock",
      p_images_mode: "mock",
      p_audit_mode: "mock",
    });
    if (job.error || !job.data) throw job.error ?? new Error("job creation failed");
    const reviewJobId = job.data;
    const started = await editor.rpc("admin_transition_job", {
      p_job_id: reviewJobId,
      p_action: "start",
      p_expected_lock_version: 0,
    });
    if (started.error) throw started.error;
    await runWorkerUntil(
      workerRunner("e2e-review-worker"),
      reviewJobId,
      (state) => state.status === "APPROVED",
    );

    await signIn(page, ownerEmail, /\/admin$/);
    const review = page.getByRole("heading", { name: /Needs your decision/ });
    await expect(review).toBeVisible();
    // The card is headed by the draft's own headline, so find it by the article it links to.
    const card = page.locator(`article:has(a[href="/admin/articles/${reviewJobId}"])`);
    await expect(card.getByText("Ready to publish")).toBeVisible();
    await expect(card.getByRole("button", { name: "Publish now" })).toBeVisible();
    await card.getByRole("link", { name: "Read it" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/articles/${reviewJobId}$`));

    await page.getByRole("button", { name: "Discard", exact: true }).click();
    await page.getByLabel("Reason for discarding").fill("Not strong enough for publication.");
    await page.getByLabel("I understand a discarded article cannot be restored.").check();
    await page.getByRole("button", { name: "Discard article" }).click();
    await expect(page.getByText("Stopped").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Discard", exact: true })).toHaveCount(0);
    await page.goto(`/admin/articles/${reviewJobId}?view=details`);
    await expect(page.getByText("job.discarded")).toBeVisible();

    // It leaves the decisions inbox, and stays in the full list as a stopped article.
    await page.goto("/admin");
    await expect(page.locator(`article:has(a[href="/admin/articles/${reviewJobId}"])`)).toHaveCount(
      0,
    );
    const row = page.locator(`li:has(a[href="/admin/articles/${reviewJobId}"])`);
    await expect(row.getByText("Stopped")).toBeVisible();
  });

  test("publishes a ready article straight from the dashboard", async ({ page, request }) => {
    const publishTopic = `Publish now check ${randomUUID().slice(0, 8)}`;
    const editor = createClient<Database>(supabaseUrl as string, publishableKey as string, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    expect(
      (await editor.auth.signInWithPassword({ email: ownerEmail, password: PASSWORD })).error,
    ).toBeNull();
    const job = await editor.rpc("create_article_job", {
      p_topic: publishTopic,
      p_keywords: ["payments", "uk"],
      p_image_count: 0,
      p_auto_publish: false,
      p_research_mode: "mock",
      p_writing_mode: "mock",
      p_images_mode: "mock",
      p_audit_mode: "mock",
    });
    if (job.error || !job.data) throw job.error ?? new Error("job creation failed");
    const publishJobId = job.data;
    const started = await editor.rpc("admin_transition_job", {
      p_job_id: publishJobId,
      p_action: "start",
      p_expected_lock_version: 0,
    });
    if (started.error) throw started.error;

    const runner = workerRunner("e2e-publish-now-worker");
    await runWorkerUntil(runner, publishJobId, (state) => state.status === "APPROVED");

    // One click on the card, with no date to type: the article is queued for immediate release.
    await signIn(page, ownerEmail, /\/admin$/);
    const card = page.locator(`article:has(a[href="/admin/articles/${publishJobId}"])`);
    await card.getByRole("button", { name: "Publish now" }).click();
    await expect
      .poll(async () => {
        const state = await service
          .from("article_jobs")
          .select("status, desired_publish_at")
          .eq("id", publishJobId)
          .single();
        return state.data?.status;
      })
      .toBe("SCHEDULED");
    const scheduled = await service
      .from("article_jobs")
      .select("desired_publish_at")
      .eq("id", publishJobId)
      .single();
    expect(Date.parse(scheduled.data!.desired_publish_at!)).toBeLessThanOrEqual(Date.now());

    // The worker then takes it live without anything else being asked of the editor.
    const final = await runWorkerUntil(
      runner,
      publishJobId,
      (state) => state.status === "VERIFIED",
    );
    expect(final.status).toBe("VERIFIED");

    const published = await service
      .from("article_jobs")
      .select("article_id")
      .eq("id", publishJobId)
      .single();
    const article = await service
      .from("articles")
      .select("slug")
      .eq("id", published.data!.article_id!)
      .single();
    expect((await request.get(`/blog/${article.data!.slug}`)).status()).toBe(200);

    await page.goto(`/admin/articles/${publishJobId}`);
    await expect(page.getByText("Live", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Live on the site." })).toBeVisible();
  });

  test("configures topic discovery per category and requests a scan", async ({ page }) => {
    await signIn(page, ownerEmail, /\/admin$/);
    await page.goto("/admin/settings");
    await expect(page.getByRole("heading", { name: "Topic discovery" })).toBeVisible();
    const targets = page.getByRole("spinbutton", { name: /articles per day$/ });
    await expect(targets).toHaveCount(10);

    await page.getByLabel("Find and write articles automatically").check();
    await page.getByLabel("Payments articles per day").fill("2");
    await page.getByLabel("Open Banking articles per day").fill("1");
    await page.getByLabel("Publish discovered articles automatically").check();
    await page.getByRole("button", { name: "Save discovery settings" }).click();
    await expect(
      page.getByText(
        /Discovery is on: up to 3 articles a day, with no more than 24 entering processing every 5 hours, published 15 minutes apart/,
      ),
    ).toBeVisible();

    const autoPublish = await service
      .from("site_settings")
      .select("discovery_auto_publish")
      .single();
    expect(autoPublish.data?.discovery_auto_publish).toBe(true);

    // Back to waiting for an editor, which is the default.
    await page.getByLabel("Publish discovered articles automatically").uncheck();
    await page.getByRole("button", { name: "Save discovery settings" }).click();
    await expect(
      page.getByText(
        /Discovery is on: up to 3 articles a day, with no more than 24 entering processing every 5 hours/,
      ),
    ).toBeVisible();

    const saved = await service
      .from("topic_categories")
      .select("slug, daily_target")
      .in("slug", ["payments", "open-banking"])
      .order("slug");
    expect(saved.data).toEqual([
      { slug: "open-banking", daily_target: 1 },
      { slug: "payments", daily_target: 2 },
    ]);

    await page.getByRole("button", { name: "Scan now" }).click();
    await expect(page.getByText("Scan requested.", { exact: false })).toBeVisible();

    // Leave discovery off for the rest of the local suite.
    await page.reload();
    await page.getByLabel("Find and write articles automatically").uncheck();
    await page.getByLabel("Payments articles per day").fill("0");
    await page.getByLabel("Open Banking articles per day").fill("0");
    await page.getByRole("button", { name: "Save discovery settings" }).click();
    await expect(page.getByText("Discovery settings saved. Discovery is off.")).toBeVisible();
  });

  test("changes a provider default to a manual mode for new jobs", async ({ page }) => {
    await signIn(page, ownerEmail, /\/admin$/);
    await page.goto("/admin/providers");

    // The seeded Claude Code default is a selectable mode since Phase 9.
    const writing = page.getByLabel("Writing and revision");
    await expect(writing).toHaveValue("claude_code");
    await expect(writing.locator('option[value="claude_code"]')).toBeEnabled();
    await writing.selectOption("manual_claude");
    await page
      .locator("form")
      .filter({ has: writing })
      .getByRole("button", { name: "Save default" })
      .click();
    await expect(page.getByText("Provider default updated for new jobs.")).toBeVisible();

    const rows = await service
      .from("provider_settings")
      .select("stage, mode")
      .in("stage", ["draft", "revision"])
      .order("stage");
    expect(rows.data).toEqual([
      { stage: "draft", mode: "manual_claude" },
      { stage: "revision", mode: "manual_claude" },
    ]);
    // Restore the seeded default so repeated local runs start from the same state.
    const restored = await service
      .from("provider_settings")
      .update({ mode: "claude_code" })
      .in("stage", ["draft", "revision"]);
    expect(restored.error).toBeNull();
  });

  test("requires and records explicit metered API confirmation", async ({ page }) => {
    await signIn(page, ownerEmail, /\/admin$/);
    await page.goto("/admin/providers");

    const research = page.getByLabel("Research", { exact: true });
    await research.selectOption("openai_api");
    const form = page.locator("form").filter({ has: research });
    const confirmation = form.getByLabel(/every OpenAI API run is metered and billed/i);
    await expect(confirmation).toBeVisible();
    await expect(confirmation).not.toBeChecked();
    expect(await form.evaluate((element: HTMLFormElement) => element.checkValidity())).toBe(false);

    await confirmation.check();
    await form.getByRole("button", { name: "Save default" }).click();
    await expect(page.getByText("Provider default updated for new jobs.")).toBeVisible();

    const enabled = await service
      .from("provider_settings")
      .select("mode, api_mode_confirmed_at, api_mode_confirmed_by")
      .eq("stage", "research")
      .single();
    expect(enabled.error).toBeNull();
    expect(enabled.data?.mode).toBe("openai_api");
    expect(enabled.data?.api_mode_confirmed_at).not.toBeNull();
    expect(enabled.data?.api_mode_confirmed_by).toBe(ownerId);

    await page.goto("/admin/articles/new");
    await expect(
      page.getByLabel("Research", { exact: true }).locator('option[value="openai_api"]'),
    ).toHaveCount(1);

    await page.goto("/admin/providers");
    const restoredResearch = page.getByLabel("Research", { exact: true });
    const restoredForm = page.locator("form").filter({ has: restoredResearch });
    await restoredResearch.selectOption("manual_chatgpt");
    await expect(
      restoredForm.getByLabel(/every OpenAI API run is metered and billed/i),
    ).toBeHidden();
    await restoredForm.getByRole("button", { name: "Save default" }).click();
    await expect
      .poll(async () => {
        const restored = await service
          .from("provider_settings")
          .select("mode, api_mode_confirmed_at, api_mode_confirmed_by")
          .eq("stage", "research")
          .single();
        return restored.data;
      })
      .toEqual({
        mode: "manual_chatgpt",
        api_mode_confirmed_at: null,
        api_mode_confirmed_by: null,
      });
  });

  test("completes a job through manual ChatGPT, Claude, and Gemini handoffs", async ({ page }) => {
    test.setTimeout(180_000);
    const manualTopic = `Manual open banking handoff ${randomUUID().slice(0, 8)}`;
    await signIn(page, ownerEmail, /\/admin$/);

    await page.goto("/admin/articles/new");
    await page.getByLabel("Topic").fill(manualTopic);
    await page.getByLabel("Keywords").fill("payments, uk");
    await page.getByLabel("Image count").fill("1");
    await page.getByLabel("Research", { exact: true }).selectOption({ label: "Manual ChatGPT" });
    await page.getByLabel("Writing", { exact: true }).selectOption({ label: "Manual Claude" });
    await page.getByLabel("Images", { exact: true }).selectOption({ label: "Manual Gemini" });
    await page.getByLabel("Audit", { exact: true }).selectOption({ label: "Manual ChatGPT" });
    await page.getByLabel("Publish automatically after a passing audit").check();
    await page.getByRole("button", { name: "Create article job" }).click();
    await expect(page).toHaveURL(/\/admin\/articles\/[0-9a-f-]{36}$/);
    const manualJobId = new URL(page.url()).pathname.split("/").pop() as string;
    await page.getByRole("button", { name: "Start the article" }).click();
    await expect(page.getByRole("status")).toHaveText("Job started.");

    // The mock builders stand in for what an operator pastes back from each provider: they
    // produce schema-valid artifacts, and nothing below knows they were not typed by a person.
    const runContext = (stage: RunContext["stage"], mode: RunContext["mode"]): RunContext => ({
      stage,
      mode,
      cycle: 0,
      attempt: 1,
      claimVersion: 1,
      brief: {
        jobId: manualJobId,
        topic: manualTopic,
        keywords: ["payments", "uk"],
        requirements: null,
        articleType: "analysis",
        category: null,
        targetWordCount: null,
        imageCount: 1,
        siteName: "FinTechPulse",
        timezone: "Europe/London",
        today: "2026-09-18",
      },
      template: null,
      styleGuide: null,
      schemaVersion: "manual-e2e",
    });
    const runner = workerRunner("e2e-manual-worker");
    const importButton = page.getByRole("button", { name: "Validate and continue" });

    // Research through ChatGPT: the prompt is exact, and rejected input stays in place.
    await runWorkerUntil(runner, manualJobId, waitingForInput);
    await page.reload();
    const researchPanel = page.getByRole("heading", { name: "Manual Research" });
    await expect(researchPanel).toBeVisible();
    await expect(page.getByRole("link", { name: "Open ChatGPT" })).toHaveAttribute(
      "href",
      "https://chatgpt.com/",
    );
    await page.getByText("View exact prompt").click();
    await expect(page.locator("pre").filter({ hasText: manualTopic })).toBeVisible();

    const response = page.getByLabel("Provider response");
    await response.fill("{ this is not json");
    await importButton.click();
    await expect(page.getByText(/The response is not valid JSON/)).toBeVisible();
    await expect(response).toHaveValue("{ this is not json");
    await response.fill(JSON.stringify({ verdict: "PASS" }));
    await importButton.click();
    await expect(page.getByText(/does not match the expected schema/)).toBeVisible();
    await expect(response).toHaveValue(JSON.stringify({ verdict: "PASS" }));

    await page.setViewportSize({ width: 375, height: 900 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "manual panel scrolls horizontally at 375px").toBeLessThanOrEqual(0);
    mkdirSync("test-results/admin-review", { recursive: true });
    await page.screenshot({
      path: "test-results/admin-review/manual-research-375.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 900 });

    const packet = buildResearchPacket(runContext("research", "manual_chatgpt"));
    const fence = "```";
    await response.fill(`${fence}json\n${JSON.stringify(packet, null, 2)}\n${fence}`);
    await importButton.click();
    await expect(researchPanel).toBeHidden();

    // Writing through Claude.
    await runWorkerUntil(
      runner,
      manualJobId,
      (job) => job.status === "DRAFTING" && waitingForInput(job),
    );
    await page.reload();
    await expect(page.getByRole("heading", { name: "Manual Writing" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open Claude" })).toBeVisible();
    const articleDraft = buildDraft(runContext("draft", "manual_claude"), { packet });
    await page.getByLabel("Provider response").fill(JSON.stringify(articleDraft));
    await importButton.click();
    await expect(page.getByRole("heading", { name: "Manual Writing" })).toBeHidden();

    // Images through Gemini: upload the file with its editorial metadata, then continue.
    await runWorkerUntil(
      runner,
      manualJobId,
      (job) => job.status === "IMAGES_PROCESSING" && waitingForInput(job),
    );
    await page.reload();
    await expect(page.getByRole("heading", { name: "Manual Images" })).toBeVisible();
    const continueButton = page.getByRole("button", { name: "Continue to audit" });
    await expect(continueButton).toBeDisabled();
    await expect(page.getByLabel("Alt text")).toHaveValue(articleDraft.imageBriefs[0]!.altText);
    const generated = buildImages(runContext("images", "manual_gemini"), {
      draft: articleDraft,
      draftVersion: 1,
    });
    const directUploadRequests: string[] = [];
    const actionRequestSizes: number[] = [];
    const recordUploadRequest = (request: import("@playwright/test").Request) => {
      const size = request.postDataBuffer()?.byteLength ?? 0;
      if (request.url().includes("/storage/v1/object/upload/sign/")) {
        directUploadRequests.push(request.url());
      }
      if (request.headers()["next-action"]) actionRequestSizes.push(size);
    };
    page.on("request", recordUploadRequest);
    // A valid PNG may contain trailing bytes. Padding this fixture beyond Vercel's 4.5 MB function
    // request limit proves the bytes go browser -> Supabase instead of through a Server Action.
    const largeManualImage = Buffer.concat([
      Buffer.from(generated.files[0]!.bytes),
      Buffer.alloc(5_000_000),
    ]);
    await page.getByLabel("Image file").setInputFiles({
      name: "gemini-hero.png",
      mimeType: "image/png",
      buffer: largeManualImage,
    });
    await page.getByLabel("Caption").fill("Generated in Gemini for the manual workflow check.");
    await page.getByRole("button", { name: "Upload image" }).click();
    await expect(page.getByText("Slot 0 image v1 is ready.")).toBeVisible();
    page.off("request", recordUploadRequest);
    expect(directUploadRequests).toHaveLength(1);
    expect(directUploadRequests[0]).toMatch(/^http:\/\/127\.0\.0\.1:54321\/storage\//);
    expect(actionRequestSizes.length).toBeGreaterThan(0);
    expect(Math.max(...actionRequestSizes)).toBeLessThan(1_000_000);
    await expect(continueButton).toBeEnabled();
    await page.screenshot({
      path: "test-results/admin-review/manual-images-1440.png",
      fullPage: true,
    });
    await continueButton.click();
    await expect(page.getByRole("heading", { name: "Manual Images" })).toBeHidden();

    // Audit through ChatGPT, then the internal publishing service and live verification.
    await runWorkerUntil(
      runner,
      manualJobId,
      (job) => job.status === "AUDITING" && waitingForInput(job),
    );
    await page.reload();
    await expect(page.getByRole("heading", { name: "Manual Audit" })).toBeVisible();
    const audit = buildAudit(runContext("audit", "manual_chatgpt"), {
      packet,
      draft: articleDraft,
      draftVersion: 1,
    });
    await page.getByLabel("Provider response").fill(JSON.stringify(audit));
    await importButton.click();
    await expect(page.getByRole("heading", { name: "Manual Audit" })).toBeHidden();

    await runWorkerUntil(runner, manualJobId, (job) => job.status === "VERIFIED");
    const runs = await service
      .from("provider_runs")
      .select("stage, mode, status")
      .eq("job_id", manualJobId)
      .order("created_at");
    expect(runs.data?.map((run) => [run.stage, run.mode, run.status])).toEqual([
      ["research", "manual_chatgpt", "succeeded"],
      ["draft", "manual_claude", "succeeded"],
      ["images", "manual_gemini", "succeeded"],
      ["audit", "manual_chatgpt", "succeeded"],
    ]);
    const image = await service
      .from("images")
      .select("status, caption, public_path, byte_size")
      .eq("job_id", manualJobId)
      .single();
    expect(image.data).toMatchObject({
      status: "published",
      caption: "Generated in Gemini for the manual workflow check.",
      public_path: expect.stringMatching(/^articles\//),
      byte_size: expect.any(Number),
    });
    expect(image.data!.byte_size).toBeGreaterThan(4_500_000);

    await page.reload();
    await expect(page.getByText("Live", { exact: true }).first()).toBeVisible();
    await page.goto(`/admin/articles/${manualJobId}?view=details`);
    await expect(page.getByText("VERIFIED").first()).toBeVisible();
    await expect(page.getByText("manual.image_imported")).toBeVisible();
  });
});

test.describe("admin console review screenshots", () => {
  // Written to test-results/admin-review/ for design review, the same way Phase 1 captured the
  // public fixtures. They are evidence, not committed baselines.
  const widths = [375, 1440] as const;
  const screens = [
    { name: "dashboard", path: "/admin" },
    { name: "new-article", path: "/admin/articles/new" },
    { name: "logs", path: "/admin/logs" },
    { name: "providers", path: "/admin/providers" },
    { name: "prompts", path: "/admin/prompts" },
    { name: "settings", path: "/admin/settings" },
  ] as const;

  test("captures the real publication at mobile and desktop widths", async ({ page }) => {
    expect(publishedSlug).toBeTruthy();
    mkdirSync("test-results/publication-review", { recursive: true });
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      for (const screen of [
        { name: "home", path: "/" },
        { name: "archive", path: "/blog" },
        { name: "article", path: `/blog/${publishedSlug}` },
      ]) {
        await page.goto(screen.path);
        await page.evaluate(() => document.fonts.ready);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `${screen.name} scrolls horizontally at ${width}px`).toBeLessThanOrEqual(
          0,
        );
        await page.screenshot({
          path: `test-results/publication-review/${screen.name}-${width}.png`,
          fullPage: true,
        });
      }
    }
  });

  for (const width of widths) {
    test(`renders every screen at ${width}px without horizontal overflow`, async ({ page }) => {
      mkdirSync("test-results/admin-review", { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await signIn(page, ownerEmail, /\/admin$/);

      // Two article states: one still in the pipeline, and one live with its draft, image, and
      // check, which is what the reading view is for.
      for (const screen of [
        ...screens,
        { name: "article", path: `/admin/articles/${jobId}` },
        { name: "article-live", path: `/admin/articles/${publishedJobId}` },
        { name: "article-details", path: `/admin/articles/${publishedJobId}?view=details` },
      ]) {
        await page.goto(screen.path);
        await page.evaluate(() => document.fonts.ready);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `${screen.name} scrolls horizontally at ${width}px`).toBeLessThanOrEqual(
          0,
        );

        await page.screenshot({
          path: `test-results/admin-review/${screen.name}-${width}.png`,
          fullPage: true,
        });
      }
    });
  }
});
