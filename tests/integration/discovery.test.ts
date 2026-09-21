import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { adminUser, closeDb, db, resetWorkflowData, serviceClient } from "./helpers/clients";
import type { TestUser } from "./helpers/clients";
import { events, expectCode, jobRow, succeed, unwrap } from "./helpers/workflow";

/**
 * Topic discovery's database boundary: when a scan is due, which categories it may fill, and the
 * per-day quota, de-duplication, and provider modes enforced when a discovered job is created.
 */

const WORKER = "test-discovery-worker";
let editor: TestUser;

beforeAll(async () => {
  editor = await adminUser("editor");
});

beforeEach(async () => {
  await resetWorkflowData();
  await db().query("truncate table public.topic_discovery_runs");
  await db().query("update public.topic_categories set daily_target = 0");
  await db().query(
    `update public.site_settings set discovery_enabled = false, discovery_interval_minutes = 30,
       discovery_image_count = 1, discovery_auto_publish = false,
       discovery_last_started_at = null`,
  );
});

afterAll(closeDb);

async function category(slug: string): Promise<{ id: string; name: string }> {
  const { rows } = await db().query<{ id: string; name: string }>(
    "select id, name from public.topic_categories where slug = $1",
    [slug],
  );
  return rows[0]!;
}

async function enable(targets: Record<string, number>, autoPublish = false) {
  await succeed(
    editor.client.rpc("admin_update_discovery_settings", {
      p_enabled: true,
      p_interval_minutes: 30,
      p_image_count: 1,
      p_auto_publish: autoPublish,
    }),
  );
  for (const [slug, target] of Object.entries(targets)) {
    const { error } = await editor.client.rpc("admin_update_topic_category", {
      p_category_id: (await category(slug)).id,
      p_daily_target: target,
    });
    expect(error).toBeNull();
  }
}

async function begin() {
  const { data, error } = await serviceClient().rpc("worker_begin_topic_discovery", {
    p_worker_id: WORKER,
  });
  expect(error).toBeNull();
  return data?.[0] ?? null;
}

function propose(runId: number, categoryId: string, url: string, topic = "UK regulator acts") {
  return serviceClient().rpc("worker_create_discovered_job", {
    p_run_id: runId,
    p_worker_id: WORKER,
    p_category_id: categoryId,
    p_topic: topic,
    p_article_type: "news",
    p_keywords: ["payments", "uk"],
    p_requirements: "Explain what changes for UK consumers.",
    p_source: {
      url,
      headline: "Regulator announces a change",
      publisher: "Example News",
      published_at: "2026-09-21",
    },
  });
}

describe("topic discovery", () => {
  it("does nothing until discovery is enabled and a category has a target", async () => {
    expect(await begin()).toBeNull();
    await enable({});
    expect(await begin()).toBeNull();
  });

  it("starts one scan per interval for the categories that still owe an article", async () => {
    await enable({ payments: 1, "open-banking": 2 });

    const run = await begin();
    expect(run).not.toBeNull();
    expect(run!.site_name).toBe("FinTechPulse");
    expect(run!.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const due = (run!.categories as Array<{ slug: string }>).map((entry) => entry.slug);
    expect(due).toEqual(["payments", "open-banking"]);

    // Single flight, then the interval.
    expect(await begin()).toBeNull();
    const { error } = await serviceClient().rpc("worker_finish_topic_discovery", {
      p_run_id: run!.run_id,
      p_worker_id: WORKER,
      p_succeeded: true,
      p_candidates: 0,
    });
    expect(error).toBeNull();
    expect(await begin()).toBeNull();

    // "Scan now" clears the interval; quotas still apply.
    const { error: requestError } = await editor.client.rpc("admin_request_discovery_scan");
    expect(requestError).toBeNull();
    expect(await begin()).not.toBeNull();
  });

  it("creates a started, subscription-mode job that waits for an editor to publish", async () => {
    await enable({ payments: 1 });
    const run = (await begin())!;
    const payments = await category("payments");

    const jobId = await unwrap(propose(run.run_id, payments.id, "https://example.com/news/one"));
    const job = await jobRow(jobId);
    expect(job).toMatchObject({
      status: "RESEARCH_PENDING",
      origin: "discovery",
      topic_category_id: payments.id,
      category: payments.name,
      auto_publish: false,
      image_count: 1,
      research_mode: "codex_cli",
      writing_mode: "claude_code",
      images_mode: "codex_image",
      audit_mode: "codex_cli",
      created_by: null,
    });
    expect(job.discovery_source).toMatchObject({
      url: "https://example.com/news/one",
      publisher: "Example News",
      run_id: run.run_id,
    });
    expect((await events(jobId)).map((event) => event.event_type)).toEqual([
      "job.created",
      "job.started",
    ]);
    const { rows } = await db().query(
      "select created_job_ids from public.topic_discovery_runs where id = $1",
      [run.run_id],
    );
    expect(rows[0].created_job_ids).toEqual([jobId]);
  });

  it("publishes discovered articles on its own only when the owner opts in", async () => {
    await enable({ payments: 1 }, true);
    const run = (await begin())!;
    const payments = await category("payments");

    const jobId = await unwrap(propose(run.run_id, payments.id, "https://example.com/news/auto"));
    expect(await jobRow(jobId)).toMatchObject({ origin: "discovery", auto_publish: true });

    // The setting is copied onto the job when it is created, so turning it off afterwards leaves
    // articles already in the pipeline alone.
    await succeed(
      editor.client.rpc("admin_update_discovery_settings", {
        p_enabled: true,
        p_interval_minutes: 30,
        p_image_count: 1,
        p_auto_publish: false,
      }),
    );
    expect((await jobRow(jobId)).auto_publish).toBe(true);

    // Omitting the argument keeps whatever the publication has set.
    await succeed(
      editor.client.rpc("admin_update_discovery_settings", {
        p_enabled: true,
        p_interval_minutes: 45,
        p_image_count: 1,
      }),
    );
    const { rows } = await db().query(
      "select discovery_auto_publish, discovery_interval_minutes from public.site_settings",
    );
    expect(rows[0]).toMatchObject({
      discovery_auto_publish: false,
      discovery_interval_minutes: 45,
    });
  });

  it("enforces the daily quota and never uses the same story twice", async () => {
    await enable({ payments: 1, "digital-banks": 12 });
    const run = (await begin())!;
    const payments = await category("payments");
    const banks = await category("digital-banks");

    await unwrap(propose(run.run_id, payments.id, "https://example.com/news/first"));
    // The payments target of one is met for today.
    const overQuota = await propose(run.run_id, payments.id, "https://example.com/news/second");
    expect(overQuota.error).toBeNull();
    expect(overQuota.data).toBeNull();
    // The same story is refused for another category too.
    const duplicate = await propose(run.run_id, banks.id, "https://example.com/news/first");
    expect(duplicate.error).toBeNull();
    expect(duplicate.data).toBeNull();

    const { rows } = await db().query(
      "select count(*)::int as count from public.article_jobs where origin = 'discovery'",
    );
    expect(rows[0].count).toBe(1);
  });

  it("refuses proposals outside a running scan, from another worker, or without a real source", async () => {
    await enable({ payments: 1 });
    const run = (await begin())!;
    const payments = await category("payments");

    expectCode(
      (
        await serviceClient().rpc("worker_create_discovered_job", {
          p_run_id: run.run_id,
          p_worker_id: "another-worker",
          p_category_id: payments.id,
          p_topic: "UK regulator acts",
          p_article_type: "news",
          p_keywords: [],
          p_requirements: "",
          p_source: { url: "https://example.com/x", headline: "Headline" },
        })
      ).error,
      "FT003",
    );
    expectCode((await propose(run.run_id, payments.id, "http://example.com/plain")).error, "22023");

    await succeed(
      serviceClient().rpc("worker_finish_topic_discovery", {
        p_run_id: run.run_id,
        p_worker_id: WORKER,
        p_succeeded: false,
        p_error: "Codex usage limit",
      }),
    );
    expectCode((await propose(run.run_id, payments.id, "https://example.com/late")).error, "FT003");
  });

  it("closes a scan abandoned by a worker that died", async () => {
    await enable({ payments: 1 });
    const run = (await begin())!;
    await db().query(
      "update public.topic_discovery_runs set started_at = now() - interval '2 hours' where id = $1",
      [run.run_id],
    );
    await db().query("update public.site_settings set discovery_last_started_at = null");

    expect(await begin()).not.toBeNull();
    const { rows } = await db().query(
      "select status, error from public.topic_discovery_runs where id = $1",
      [run.run_id],
    );
    expect(rows[0]).toMatchObject({ status: "failed" });
  });

  it("lets editors, not viewers, change discovery settings and targets", async () => {
    const viewer = await adminUser("viewer");
    const payments = await category("payments");

    expectCode(
      (
        await viewer.client.rpc("admin_update_topic_category", {
          p_category_id: payments.id,
          p_daily_target: 3,
        })
      ).error,
      "42501",
    );
    expectCode(
      (
        await editor.client.rpc("admin_update_topic_category", {
          p_category_id: payments.id,
          p_daily_target: 13,
        })
      ).error,
      "22023",
    );
    expectCode(
      (
        await editor.client.rpc("admin_update_discovery_settings", {
          p_enabled: true,
          p_interval_minutes: 5,
          p_image_count: 1,
        })
      ).error,
      "22023",
    );

    const { data } = await viewer.client
      .from("topic_categories")
      .select("slug")
      .order("sort_order");
    expect(data?.map((row) => row.slug)).toHaveLength(10);
  });
});
