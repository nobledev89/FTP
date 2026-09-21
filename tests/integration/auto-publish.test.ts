import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { adminUser, closeDb, db, resetWorkflowData, serviceClient } from "./helpers/clients";
import type { TestUser } from "./helpers/clients";
import {
  claim,
  events,
  jobRow,
  runStartedToApproved,
  runToApproved,
  unwrap,
  adminAction,
  succeed,
} from "./helpers/workflow";

/**
 * The automatic publication policy (migration 20260921190000): which discovered articles go live
 * on their own, when they go live, and why the ones that do not are left for an editor.
 *
 * Jobs are inserted with `origin = 'discovery'` directly rather than through
 * `worker_create_discovered_job`, so the per-category creation quota does not decide how many
 * articles a test may run. The quota itself, and the duplicate check that runs with it, are
 * covered against the real function at the end.
 */

const WORKER = "test-auto-publish-worker";
let editor: TestUser;
let siteId: string;
let paymentsCategoryId: string;

beforeAll(async () => {
  editor = await adminUser("editor");
  const { rows } = await db().query<{ id: string }>("select id from public.sites limit 1");
  siteId = rows[0]!.id;
  const category = await db().query<{ id: string }>(
    "select id from public.topic_categories where slug = 'payments'",
  );
  paymentsCategoryId = category.rows[0]!.id;
});

beforeEach(async () => {
  await resetWorkflowData();
  await db().query("truncate table public.topic_discovery_runs");
  await db().query("update public.topic_categories set daily_target = 0");
  await db().query(
    `update public.site_settings set discovery_enabled = false, discovery_interval_minutes = 30,
       discovery_image_count = 1, discovery_auto_publish = true, auto_publish_spacing_minutes = 15,
       discovery_last_started_at = null`,
  );
  await setDailyTarget("payments", 10);
});

afterAll(closeDb);

async function setDailyTarget(slug: string, target: number): Promise<void> {
  await db().query("update public.topic_categories set daily_target = $2 where slug = $1", [
    slug,
    target,
  ]);
}

/** A started discovery job, without spending the category's creation quota for the day. */
async function discoveredJob(
  options: { topic?: string; imageCount?: number; autoPublish?: boolean } = {},
): Promise<string> {
  const row = await unwrap(
    serviceClient()
      .from("article_jobs")
      .insert({
        site_id: siteId,
        topic: options.topic ?? `Discovered topic ${randomUUID().slice(0, 8)}`,
        keywords: ["payments", "uk"],
        article_type: "news",
        image_count: options.imageCount ?? 1,
        auto_publish: options.autoPublish ?? true,
        category: "Payments",
        research_mode: "mock",
        writing_mode: "mock",
        images_mode: "mock",
        audit_mode: "mock",
        origin: "discovery",
        topic_category_id: paymentsCategoryId,
        discovery_source: {
          url: `https://example.com/news/${randomUUID()}`,
          headline: "A story an outlet published",
          publisher: "Example News",
        },
      })
      .select("id")
      .single(),
  );
  await unwrap(adminAction(editor, row.id, "start"));
  return row.id;
}

/** A discovered article carried to its passing audit, which is where the policy applies. */
async function approve(
  options: { topic?: string; title?: string; imageCount?: number; autoPublish?: boolean } = {},
): Promise<string> {
  const jobId = await discoveredJob(options);
  await runStartedToApproved(jobId, {
    imageCount: options.imageCount ?? 1,
    slug: `auto-${randomUUID().slice(0, 8)}`,
    title: options.title ?? unrelatedHeadline(),
  });
  return jobId;
}

/**
 * A headline with nothing distinctive in common with the next one, so a test about spacing or the
 * daily count is not quietly answered by the duplicate check.
 */
function unrelatedHeadline(): string {
  const [a, b, c] = [randomUUID().slice(0, 8), randomUUID().slice(0, 8), randomUUID().slice(0, 8)];
  return `Lender ${a} and ${b} reshape ${c}`;
}

function minutesBetween(later: string, earlier: string): number {
  return (Date.parse(later) - Date.parse(earlier)) / 60_000;
}

describe("automatic publication policy", () => {
  it("publishes a complete, illustrated article as soon as its audit passes", async () => {
    const jobId = await approve();

    const job = await jobRow(jobId);
    expect(job.status).toBe("APPROVED");
    expect(job.auto_publish).toBe(true);
    expect(job.auto_publish_hold_reason).toBeNull();
    expect(job.desired_publish_at).not.toBeNull();
    // Due now, so the publish stage claims it on the worker's next poll.
    expect(Date.parse(job.desired_publish_at!)).toBeLessThanOrEqual(Date.now());
    expect((await events(jobId)).map((event) => event.event_type)).toContain(
      "job.auto_publish_scheduled",
    );

    const claimed = await claim(WORKER, ["publish"]);
    expect(claimed?.job_id).toBe(jobId);
    expect(claimed?.status).toBe("PUBLISHING");
  });

  it("spaces each following article a quarter of an hour after the one before it", async () => {
    const first = await jobRow(await approve());
    const second = await jobRow(await approve());
    const third = await jobRow(await approve());

    expect(second.status).toBe("SCHEDULED");
    expect(third.status).toBe("SCHEDULED");
    expect(minutesBetween(second.desired_publish_at!, first.desired_publish_at!)).toBeCloseTo(
      15,
      0,
    );
    expect(minutesBetween(third.desired_publish_at!, second.desired_publish_at!)).toBeCloseTo(
      15,
      0,
    );

    // A scheduled article is not claimable before its time.
    expect(await claim(WORKER, ["publish"])).not.toBeNull();
    expect(await claim(WORKER, ["publish"])).toBeNull();
  });

  it("uses the publication's own spacing when the owner changes it", async () => {
    await db().query("update public.site_settings set auto_publish_spacing_minutes = 45");

    const first = await jobRow(await approve());
    const second = await jobRow(await approve());

    expect(minutesBetween(second.desired_publish_at!, first.desired_publish_at!)).toBeCloseTo(
      45,
      0,
    );
  });

  it("holds an article that has no image", async () => {
    const jobId = await approve({ imageCount: 0 });

    const job = await jobRow(jobId);
    expect(job.status).toBe("APPROVED");
    expect(job.auto_publish).toBe(false);
    expect(job.auto_publish_hold_reason).toBe("no_image");
    expect(job.desired_publish_at).toBeNull();
    expect(await claim(WORKER, ["publish"])).toBeNull();
  });

  it("holds an article that retells a story the site already has", async () => {
    const headline = "Revolut wins its full UK banking licence";
    await approve({ topic: "Revolut licence decision", title: headline });

    const repeat = await approve({
      topic: "Something else entirely about card terminals",
      title: "Revolut granted its full UK banking licence",
    });

    const job = await jobRow(repeat);
    expect(job.status).toBe("APPROVED");
    expect(job.auto_publish).toBe(false);
    expect(job.auto_publish_hold_reason).toBe("duplicate");
    const held = (await events(repeat)).find(
      (event) => event.event_type === "job.auto_publish_held",
    );
    expect(held).toBeDefined();
  });

  it("publishes two genuinely different stories about the same company", async () => {
    await approve({ title: "Monzo opens business accounts to sole traders" });
    const second = await approve({ title: "Monzo reports its first annual profit" });

    expect((await jobRow(second)).auto_publish_hold_reason).toBeNull();
  });

  it("holds an article once the day's article count is used up", async () => {
    await setDailyTarget("payments", 2);

    const first = await approve();
    const second = await approve();
    const third = await approve();

    expect((await jobRow(first)).auto_publish_hold_reason).toBeNull();
    expect((await jobRow(second)).auto_publish_hold_reason).toBeNull();

    const held = await jobRow(third);
    expect(held.status).toBe("APPROVED");
    expect(held.auto_publish).toBe(false);
    expect(held.auto_publish_hold_reason).toBe("daily_cap");
  });

  it("leaves an editor's own article alone", async () => {
    // No image, no daily target left, and an identical headline: none of it applies to a job an
    // editor created and chose to auto-publish.
    await setDailyTarget("payments", 0);
    await approve({ title: "A story the site already has" });

    const { jobId } = await runToApproved(editor, {
      autoPublish: true,
      title: "A story the site already has",
      slug: `editor-${randomUUID().slice(0, 8)}`,
    });

    const job = await jobRow(jobId);
    expect(job.origin).toBe("editor");
    expect(job.auto_publish).toBe(true);
    expect(job.auto_publish_hold_reason).toBeNull();
    expect(job.desired_publish_at).toBeNull();
  });

  it("does not write the same story twice", async () => {
    await setDailyTarget("payments", 4);
    await succeed(
      editor.client.rpc("admin_update_discovery_settings", {
        p_enabled: true,
        p_interval_minutes: 30,
        p_image_count: 1,
        p_auto_publish: true,
      }),
    );
    const run = await unwrap(
      serviceClient().rpc("worker_begin_topic_discovery", { p_worker_id: WORKER }),
    );
    const runId = (run as Array<{ run_id: number }>)[0]!.run_id;

    const propose = (topic: string, headline: string, url: string) =>
      serviceClient().rpc("worker_create_discovered_job", {
        p_run_id: runId,
        p_worker_id: WORKER,
        p_category_id: paymentsCategoryId,
        p_topic: topic,
        p_article_type: "news",
        p_keywords: ["payments"],
        p_requirements: "Explain what changes for UK consumers.",
        p_source: { url, headline, publisher: "Example News", published_at: "2026-09-21" },
      });

    const created = await unwrap(
      propose(
        "Barclays closes its instant transfer loophole",
        "Barclays closes instant transfer loophole",
        "https://example.com/news/first",
      ),
    );
    expect(created).not.toBeNull();

    // The same story, told by another outlet under another URL.
    const { data: repeat } = await propose(
      "Barclays closes its instant transfer loophole",
      "Barclays closes the instant transfer loophole",
      "https://example.com/news/second",
    );
    expect(repeat).toBeNull();

    // A different story in the same category still goes through.
    const other = await unwrap(
      propose(
        "Nationwide raises its switching incentive",
        "Nationwide raises switching incentive",
        "https://example.com/news/third",
      ),
    );
    expect(other).not.toBeNull();
  });

  it("refuses automatic publishing with no image, instead of holding every article", async () => {
    const { error } = await editor.client.rpc("admin_update_discovery_settings", {
      p_enabled: true,
      p_interval_minutes: 30,
      p_image_count: 0,
      p_auto_publish: true,
    });
    expect(error?.code).toBe("22023");
    expect(error?.message).toContain("hero image");

    // Turning automatic publishing off makes the same call fine.
    await succeed(
      editor.client.rpc("admin_update_discovery_settings", {
        p_enabled: true,
        p_interval_minutes: 30,
        p_image_count: 0,
        p_auto_publish: false,
      }),
    );
  });

  it("keeps the spacing out of an editor's hands-on publishing", async () => {
    const scheduled = await jobRow(await approve());
    expect(scheduled.desired_publish_at).not.toBeNull();

    // "Publish now" on a held article is immediate however full the schedule is.
    const heldJobId = await approve({ imageCount: 0 });
    const held = await jobRow(heldJobId);
    await unwrap(adminAction(editor, heldJobId, "schedule", { note: undefined }));

    const after = await jobRow(heldJobId);
    expect(after.status).toBe("SCHEDULED");
    expect(Date.parse(after.desired_publish_at!)).toBeLessThanOrEqual(Date.now() + 1000);
    expect(held.lock_version).toBeLessThan(after.lock_version);
  });
});
