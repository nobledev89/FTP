import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 4: the authentication boundary, exercised through a real browser and a real production
 * build. No Supabase session exists in this suite, so these are the signed-out paths: every admin
 * route redirects, the login page renders, and nothing about the queue leaks on the way.
 *
 * Signed-in behaviour is covered against the database in tests/integration/admin-console.test.ts,
 * which is where authorization is actually decided.
 */

const protectedPaths = [
  "/admin",
  "/admin/articles/new",
  "/admin/articles/2c6e3f22-0000-4000-8000-000000000000",
  "/admin/prompts",
  "/admin/providers",
  "/admin/logs",
  "/admin/settings",
] as const;

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "page scrolls horizontally").toBeLessThanOrEqual(0);
}

test.describe("signed-out admin routes", () => {
  for (const path of protectedPaths) {
    test(`${path} redirects to the login page`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page).toHaveURL(/\/admin\/login(\?|$)/);
      await expect(page.getByRole("heading", { name: "Admin sign in" })).toBeVisible();
    });
  }

  test("preserves the intended destination, including its query string", async ({ page }) => {
    await page.goto("/admin/logs?source=events&failures=1");
    const url = new URL(page.url());
    expect(url.pathname).toBe("/admin/login");
    expect(url.searchParams.get("next")).toBe("/admin/logs?source=events&failures=1");
    await expect(page.locator('input[name="next"]')).toHaveValue(
      "/admin/logs?source=events&failures=1",
    );
  });

  test("redirects to the dashboard rather than adding a redundant next value", async ({ page }) => {
    await page.goto("/admin");
    expect(new URL(page.url()).search).toBe("");
    await expect(page.locator('input[name="next"]')).toHaveCount(0);
  });

  test("discards a destination that would leave the admin application", async ({ page }) => {
    for (const hostile of ["https://evil.example/", "//evil.example", "/blog"]) {
      await page.goto(`/admin/login?next=${encodeURIComponent(hostile)}`);
      await expect(page.getByRole("heading", { name: "Admin sign in" })).toBeVisible();
      // Nothing to carry forward means no hidden field at all.
      await expect(page.locator('input[name="next"]')).toHaveCount(0);
    }
  });

  test("never renders queue data on the way to the login page", async ({ page }) => {
    const response = await page.goto("/admin");
    const body = (await response?.text()) ?? "";
    expect(body).not.toContain("article_jobs");
    expect(body).not.toContain("lock_version");
    await expect(page.getByRole("navigation", { name: "Admin" })).toHaveCount(0);
  });
});

test.describe("login page", () => {
  test("offers a labelled email and password form", async ({ page }) => {
    await page.goto("/admin/login");
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await expect(page.getByLabel("Email address")).toHaveAttribute("autocomplete", "username");
    await expect(page.getByLabel("Password")).toHaveAttribute("autocomplete", "current-password");
  });

  test("is not indexed", async ({ page }) => {
    await page.goto("/admin/login");
    const robots = page.locator('meta[name="robots"]');
    await expect(robots).toHaveAttribute("content", /noindex/);
  });

  test("carries no public publication chrome", async ({ page }) => {
    await page.goto("/admin/login");
    // The publication masthead and its skip link belong to the (public) route group only.
    await expect(page.getByRole("link", { name: "Skip to content" })).toHaveCount(0);
    await expect(page.getByRole("banner")).toHaveCount(0);
    await expect(page.getByRole("contentinfo")).toHaveCount(0);
    // The admin is sans-first; the publication's editorial serif must not be loaded here.
    const fontStack = await page
      .getByRole("heading", { name: "Admin sign in" })
      .evaluate((element) => getComputedStyle(element).fontFamily.toLowerCase());
    expect(fontStack).not.toContain("noto serif");
    expect(fontStack).not.toContain("georgia");
    expect(fontStack.split(",")[0]?.trim()).toContain("geist");
  });

  test("fits a 375px viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/admin/login");
    await expectNoHorizontalOverflow(page);
  });

  test("keeps the sign-in submission on the same origin", async ({ page }) => {
    await page.goto("/admin/login");
    const action = await page.locator("form").first().getAttribute("action");
    // React posts Server Actions back to the route that rendered them; credentials never leave
    // this origin, whether the attribute is relative or absolute.
    if (action !== null) {
      expect(new URL(action, page.url()).origin).toBe(new URL(page.url()).origin);
    }
  });
});

test.describe("no-access page", () => {
  test("explains the situation and offers a sign-out", async ({ page }) => {
    await page.goto("/admin/no-access");
    await expect(
      page.getByRole("heading", { name: "This account has no admin access" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  });
});
