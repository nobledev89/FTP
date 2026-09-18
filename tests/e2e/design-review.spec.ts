import { mkdirSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 1 design lock checks (docs/DESIGN-SYSTEM.md section 11). Screenshots are written to
 * test-results/design-review/ for manual review; they are not committed baselines yet.
 */

const widths = [375, 768, 1024, 1440] as const;
const screenshotDir = "test-results/design-review";

const publicPages = [
  { name: "home-fixture", path: "/design-review" },
  { name: "home-empty", path: "/design-review?state=empty" },
  { name: "archive", path: "/design-review/archive" },
  { name: "archive-page-2", path: "/design-review/archive?page=2" },
  { name: "article-16x9", path: "/design-review/article" },
  { name: "article-3x2", path: "/design-review/article?hero=3-2" },
  { name: "article-no-image", path: "/design-review/article?hero=none" },
  { name: "front-page", path: "/" },
  { name: "public-archive", path: "/blog" },
] as const;

/** Waits for web fonts and every image. */
async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    // Full-page screenshots need every image, including lazy ones below the fold.
    for (const image of Array.from(document.images)) {
      image.loading = "eager";
    }
  });
  await page.waitForFunction(
    () => Array.from(document.images).every((image) => image.complete),
    undefined,
    {
      timeout: 10_000,
    },
  );
}

async function expectNoHorizontalOverflow(page: Page) {
  const report = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const offenders = Array.from(document.querySelectorAll<HTMLElement>("body *"))
      .filter((element) => {
        // Content clipped by a scrolling ancestor cannot widen the page.
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          if (getComputedStyle(parent).overflowX !== "visible") return false;
        }
        return element.getBoundingClientRect().right > width + 0.5;
      })
      .map((element) => `${element.tagName.toLowerCase()}.${element.className}`.slice(0, 120));
    return { overflow: document.documentElement.scrollWidth - width, offenders };
  });
  expect(
    report.overflow,
    `page scrolls horizontally; offenders: ${report.offenders.join(" | ")}`,
  ).toBeLessThanOrEqual(0);
}

test.beforeAll(() => {
  mkdirSync(screenshotDir, { recursive: true });
});

for (const width of widths) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    for (const { name, path } of publicPages) {
      test(`public ${name}`, async ({ page }) => {
        const response = await page.goto(path);
        expect(response?.status()).toBe(200);
        await settle(page);

        await expectNoHorizontalOverflow(page);

        const header = page.locator("body > div > header").first();
        await expect(header).toHaveCSS("position", "fixed");
        expect((await header.boundingBox())?.height).toBe(57); // 56px bar + 1px bottom border

        const h1 = page.locator("h1").first();
        expect(await h1.evaluate((element) => getComputedStyle(element).fontFamily)).toContain(
          "Noto Serif SC",
        );

        const mainTop = await page
          .locator("main")
          .evaluate(
            (element) =>
              element.getBoundingClientRect().top +
              parseFloat(getComputedStyle(element).paddingTop),
          );
        expect(mainTop, "content clears the fixed header").toBeGreaterThanOrEqual(56);

        await page.screenshot({ fullPage: true, path: `${screenshotDir}/${name}-${width}.png` });
      });
    }

    test("admin token sheet", async ({ page }) => {
      const response = await page.goto("/admin/design-review");
      expect(response?.status()).toBe(200);
      await settle(page);

      await expectNoHorizontalOverflow(page);
      await expect(page.getByRole("link", { name: "Skip to content" })).toHaveCount(0);
      expect(
        await page.locator("body").evaluate((element) => getComputedStyle(element).fontFamily),
      ).not.toContain("Noto Serif");
      expect(
        await page.locator("body").evaluate((element) => getComputedStyle(element).backgroundColor),
      ).toBe("rgb(250, 250, 250)");

      await page.screenshot({
        fullPage: true,
        path: `${screenshotDir}/admin-token-sheet-${width}.png`,
      });
    });
  });
}

test.describe("mobile menu", () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test("is operable by keyboard and traps the page behind it", async ({ page }) => {
    await page.goto("/design-review/article");
    await settle(page);

    const toggle = page.getByRole("button", { name: "Open menu" });
    await toggle.focus();
    await page.keyboard.press("Enter");

    const close = page.getByRole("button", { name: "Close menu" });
    await expect(close).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.getByRole("dialog", { name: "Site menu" }).getByRole("link", { name: /Latest/ }),
    ).toBeFocused();
    await expect(page.locator("main")).toHaveAttribute("inert", "");
    await expect(page.getByRole("dialog", { name: "Site menu" })).toHaveCSS("opacity", "1");
    await page.waitForTimeout(350); // let the icon morph finish before capturing
    await page.screenshot({ path: `${screenshotDir}/mobile-menu-open-375.png` });

    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Open menu" })).toBeFocused();
    await expect(page.locator("main")).not.toHaveAttribute("inert", "");
  });

  test("hides the toggle and shows inline navigation from 768px", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 800 });
    await page.goto("/design-review");
    await expect(page.getByRole("button", { name: "Open menu" })).toBeHidden();
    await expect(page.locator("header nav").first()).toBeVisible();
  });
});

test.describe("reduced motion", () => {
  test.use({ viewport: { width: 1024, height: 900 }, reducedMotion: "reduce" });

  test("removes image scale transitions", async ({ page }) => {
    await page.goto("/design-review");
    await settle(page);
    const image = page.locator("main img").first();
    const duration = await image.evaluate((element) =>
      parseFloat(getComputedStyle(element).transitionDuration),
    );
    expect(duration).toBeLessThanOrEqual(0.001);
  });
});

test.describe("not found", () => {
  test("unmatched URLs return 404 with the public 404 page", async ({ page }) => {
    const response = await page.goto("/this-route-does-not-exist");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "This page is not in the publication.",
    );
  });
});
