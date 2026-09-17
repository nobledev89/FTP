import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

import type { Database } from "@/lib/supabase/database.types";

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
const createdUserIds: string[] = [];
let jobId: string | null = null;
let originalByline: string | null = null;

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

  const ownerId = await createUser(ownerEmail);
  await createUser(outsiderEmail);

  const membership = await service
    .from("admin_users")
    .insert({ user_id: ownerId, site_id: site.data.id, role: "owner", display_name: "E2E Owner" });
  if (membership.error) throw membership.error;

  const settings = await service
    .from("site_settings")
    .select("default_byline_name")
    .eq("site_id", site.data.id)
    .single();
  originalByline = settings.data?.default_byline_name ?? null;
});

test.afterAll(async () => {
  if (!service) return;
  if (originalByline !== null) {
    await service
      .from("site_settings")
      .update({ default_byline_name: originalByline })
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
    await page.getByRole("button", { name: "Create article job" }).click();

    await expect(page).toHaveURL(/\/admin\/articles\/[0-9a-f-]{36}$/);
    jobId = new URL(page.url()).pathname.split("/").pop() ?? null;
    expect(jobId).not.toBeNull();

    await expect(page.getByRole("heading", { level: 1, name: topic })).toBeVisible();
    await expect(page.getByText("IDEA").first()).toBeVisible();
    await expect(page.getByText("job.created")).toBeVisible();
  });

  test("runs the admin transitions the status allows", async ({ page }) => {
    await signIn(page, ownerEmail, /\/admin$/);

    await page.goto(`/admin/articles/${jobId}`);
    await page.getByRole("button", { name: "Start research" }).click();
    await expect(page.getByRole("status")).toHaveText("Job started.");

    await page.reload();
    await expect(page.getByText("RESEARCH_PENDING").first()).toBeVisible();

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
      await expect(page).toHaveURL(/\/admin\/no-access$/);
      expect((await response?.text()) ?? "").not.toContain(topic);
    }
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

  for (const width of widths) {
    test(`renders every screen at ${width}px without horizontal overflow`, async ({ page }) => {
      mkdirSync("test-results/admin-review", { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await signIn(page, ownerEmail, /\/admin$/);

      for (const screen of [...screens, { name: "article", path: `/admin/articles/${jobId}` }]) {
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
