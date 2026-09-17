import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  adminUser,
  anonClient,
  closeDb,
  db,
  resetWorkflowData,
  signedInUser,
  siteId,
  type TestUser,
} from "./helpers/clients";
import { adminAction, createJob, expectCode, unwrap } from "./helpers/workflow";

/**
 * Phase 4 exit criteria, checked against the database the console actually talks to:
 * an authenticated admin can create and inspect an `IDEA`, and unauthenticated or non-admin users
 * reach neither the data nor the actions.
 */

let owner: TestUser;
let editor: TestUser;
let viewer: TestUser;
let outsider: TestUser;
let site: string;

type Dashboard = {
  site_id: string;
  role: "owner" | "editor" | "viewer";
  generated_at: string;
  status_counts: Record<string, number | undefined>;
  stage_counts: Record<string, number | undefined>;
  totals: {
    jobs: number;
    active: number;
    awaiting_action: number;
    failed: number;
    needs_human: number;
    paused: number;
    published_last_7_days: number;
  };
  action_required: Array<Record<string, unknown>>;
  blocked: Array<Record<string, unknown>>;
  in_progress: Array<Record<string, unknown>>;
  upcoming: Array<Record<string, unknown>>;
  recent_publications: Array<Record<string, unknown>>;
  workers: Array<Record<string, unknown>>;
  worker_thresholds: { stale_after_seconds: number; offline_after_seconds: number };
};

type Settings = Record<string, unknown>;

beforeAll(async () => {
  await resetWorkflowData();
  site = await siteId();
  [owner, editor, viewer, outsider] = await Promise.all([
    adminUser("owner"),
    adminUser("editor"),
    adminUser("viewer"),
    signedInUser("outsider"),
  ]);
});

afterAll(async () => {
  // Leave the seeded settings as the next file expects to find them.
  await db().query(
    `update public.site_settings set
       default_byline_name = 'FinTechPulse Editorial',
       default_byline_role = null,
       editorial_contact_email = null,
       seo_default_title = 'FinTechPulse: UK finance and fintech',
       seo_default_description = 'News, analysis, and explainers on UK banking, payments, lending, investing, insurance, and regulation.',
       share_image_path = null,
       worker_stale_after_seconds = 60,
       worker_offline_after_seconds = 120,
       auto_publish_default = false,
       updated_by = null
     where site_id = $1`,
    [site],
  );
  await db().query(
    `update public.sites set name = 'FinTechPulse', timezone = 'Europe/London',
       description = 'News, analysis, and explainers on UK banking, payments, lending, investing, insurance, and regulation.',
       disclosure = 'FinTechPulse publishes general editorial information, not personalised financial, investment, tax, or legal advice.'
     where id = $1`,
    [site],
  );
  await closeDb();
});

describe("admin_dashboard", () => {
  it("is not reachable without an active admin membership", async () => {
    expectCode((await anonClient().rpc("admin_dashboard", {})).error, "42501");
    expectCode((await outsider.client.rpc("admin_dashboard", {})).error, "42501");
  });

  it("answers a viewer, who has read access but no edit rights", async () => {
    const dashboard = (await unwrap(viewer.client.rpc("admin_dashboard", {}))) as Dashboard;
    expect(dashboard.site_id).toBe(site);
    expect(dashboard.role).toBe("viewer");
    expect(dashboard.worker_thresholds.offline_after_seconds).toBeGreaterThan(
      dashboard.worker_thresholds.stale_after_seconds,
    );
  });

  it("stops a deactivated membership immediately", async () => {
    const temporary = await adminUser("editor");
    await unwrap(temporary.client.rpc("admin_dashboard", {}));
    await db().query("update public.admin_users set is_active = false where user_id = $1", [
      temporary.id,
    ]);
    expectCode((await temporary.client.rpc("admin_dashboard", {})).error, "42501");
  });

  it("counts a new job and lists it once it is escalated", async () => {
    const before = (await unwrap(editor.client.rpc("admin_dashboard", {}))) as Dashboard;
    const baseline = before.status_counts.IDEA ?? 0;

    const jobId = await createJob(editor, { topic: "Dashboard counting check" });

    const after = (await unwrap(editor.client.rpc("admin_dashboard", {}))) as Dashboard;
    expect(after.status_counts.IDEA).toBe(baseline + 1);
    expect(after.totals.jobs).toBe(before.totals.jobs + 1);
    expect(after.stage_counts.research).toBeGreaterThanOrEqual(1);
    expect(after.totals.active).toBe(0);

    await unwrap(
      adminAction(editor, jobId, "mark_needs_human", { note: "Needs an editor decision" }),
    );

    const escalated = (await unwrap(editor.client.rpc("admin_dashboard", {}))) as Dashboard;
    expect(escalated.totals.needs_human).toBe(before.totals.needs_human + 1);
    expect(escalated.totals.awaiting_action).toBe(before.totals.awaiting_action + 1);
    expect(escalated.blocked.some((row) => row.id === jobId)).toBe(true);
    expect(escalated.action_required.some((row) => row.id === jobId)).toBe(true);

    const entry = escalated.action_required.find((row) => row.id === jobId);
    // The console needs the lock version to offer an action without a second read.
    expect(entry?.lock_version).toBeTypeOf("number");
    expect(entry?.kind).toBe("editorial_review");
  });

  it("reports worker health against the configured thresholds", async () => {
    const workerId = `dash-${randomUUID().slice(0, 8)}`;
    await db().query(
      `insert into public.worker_instances (worker_id, host_label, last_seen_at)
       values ($1, 'test-host', now())`,
      [workerId],
    );
    let dashboard = (await unwrap(editor.client.rpc("admin_dashboard", {}))) as Dashboard;
    expect(dashboard.workers.find((row) => row.worker_id === workerId)?.state).toBe("online");

    await db().query(
      "update public.worker_instances set last_seen_at = now() - interval '90 seconds' where worker_id = $1",
      [workerId],
    );
    dashboard = (await unwrap(editor.client.rpc("admin_dashboard", {}))) as Dashboard;
    expect(dashboard.workers.find((row) => row.worker_id === workerId)?.state).toBe("stale");

    await db().query(
      "update public.worker_instances set last_seen_at = now() - interval '1 hour' where worker_id = $1",
      [workerId],
    );
    dashboard = (await unwrap(editor.client.rpc("admin_dashboard", {}))) as Dashboard;
    expect(dashboard.workers.find((row) => row.worker_id === workerId)?.state).toBe("offline");
  });

  it("bounds the list length whatever the caller asks for", async () => {
    const dashboard = (await unwrap(
      editor.client.rpc("admin_dashboard", { p_list_limit: 10_000 }),
    )) as Dashboard;
    expect(dashboard.blocked.length).toBeLessThanOrEqual(50);
  });
});

describe("create and inspect an IDEA", () => {
  it("lets an editor create a job and read it straight back", async () => {
    const jobId = await createJob(editor, { topic: "Open banking variable recurring payments" });

    const job = await unwrap(
      editor.client.from("article_jobs").select("*").eq("id", jobId).single(),
    );
    expect(job.status).toBe("IDEA");
    expect(job.site_id).toBe(site);
    expect(job.created_by).toBe(editor.id);
    expect(job.lock_version).toBe(0);

    const events = await unwrap(
      editor.client.from("job_events").select("event_type, to_status").eq("job_id", jobId),
    );
    expect(events).toEqual([{ event_type: "job.created", to_status: "IDEA" }]);
  });

  it("refuses creation for a viewer and for a signed-in non-admin", async () => {
    expectCode(
      (await viewer.client.rpc("create_article_job", { p_topic: "Viewer attempt" })).error,
      "42501",
    );
    expectCode(
      (await outsider.client.rpc("create_article_job", { p_topic: "Outsider attempt" })).error,
      "42501",
    );
    expectCode(
      (await anonClient().rpc("create_article_job", { p_topic: "Anonymous attempt" })).error,
      "42501",
    );
  });

  it("hides every editorial table from anonymous and non-admin sessions", async () => {
    await createJob(editor, { topic: "Visibility check" });

    for (const [label, client] of [
      ["anonymous", anonClient()],
      ["non-admin", outsider.client],
    ] as const) {
      const jobs = await client.from("article_jobs").select("id");
      expect(jobs.data ?? [], `${label} jobs`).toEqual([]);
      const events = await client.from("job_events").select("id");
      expect(events.data ?? [], `${label} events`).toEqual([]);
      const settings = await client.from("site_settings").select("site_id");
      expect(settings.data ?? [], `${label} settings`).toEqual([]);
    }
  });

  it("refuses a workflow action from a viewer", async () => {
    const jobId = await createJob(editor, { topic: "Viewer action check" });
    expectCode((await adminAction(viewer, jobId, "start")).error, "42501");
    const job = await unwrap(
      editor.client.from("article_jobs").select("status").eq("id", jobId).single(),
    );
    expect(job.status).toBe("IDEA");
  });

  it("rejects a stale lock version, so two admins cannot both act", async () => {
    const jobId = await createJob(editor, { topic: "Optimistic locking check" });
    await unwrap(adminAction(editor, jobId, "start"));
    // The second admin still holds lock_version 0.
    expectCode(
      (
        await editor.client.rpc("admin_transition_job", {
          p_job_id: jobId,
          p_action: "pause",
          p_expected_lock_version: 0,
        })
      ).error,
      "FT002",
    );
  });
});

describe("admin_update_site_settings", () => {
  it("is refused for anonymous, non-admin, and viewer callers", async () => {
    const args = {
      p_default_byline_name: "Attempt",
      p_default_byline_role: "",
      p_editorial_contact_email: "",
      p_seo_default_title: "",
      p_seo_default_description: "",
      p_share_image_path: "",
      p_worker_stale_after_seconds: 60,
      p_worker_offline_after_seconds: 120,
      p_auto_publish_default: false,
    };
    expectCode((await anonClient().rpc("admin_update_site_settings", args)).error, "42501");
    expectCode((await outsider.client.rpc("admin_update_site_settings", args)).error, "42501");
    expectCode((await viewer.client.rpc("admin_update_site_settings", args)).error, "42501");
  });

  it("saves an editor's changes and records who made them", async () => {
    const saved = (await unwrap(
      editor.client.rpc("admin_update_site_settings", {
        p_default_byline_name: "  FinTechPulse Newsroom  ",
        p_default_byline_role: "Staff writer",
        p_editorial_contact_email: "editorial@fintechpulse.co.uk",
        p_seo_default_title: "FinTechPulse",
        p_seo_default_description: "UK finance and fintech.",
        p_share_image_path: "articles/share/default.png",
        p_worker_stale_after_seconds: 45,
        p_worker_offline_after_seconds: 200,
        p_auto_publish_default: true,
      }),
    )) as Settings;

    expect(saved.default_byline_name).toBe("FinTechPulse Newsroom");
    expect(saved.default_byline_role).toBe("Staff writer");
    expect(saved.worker_stale_after_seconds).toBe(45);
    expect(saved.auto_publish_default).toBe(true);
    expect(saved.updated_by).toBe(editor.id);

    // The dashboard reads the same thresholds it just saved.
    const dashboard = (await unwrap(editor.client.rpc("admin_dashboard", {}))) as Dashboard;
    expect(dashboard.worker_thresholds).toEqual({
      stale_after_seconds: 45,
      offline_after_seconds: 200,
    });
  });

  it("clears an optional value when it is submitted empty", async () => {
    const cleared = (await unwrap(
      editor.client.rpc("admin_update_site_settings", {
        p_default_byline_name: "FinTechPulse Newsroom",
        p_default_byline_role: "   ",
        p_editorial_contact_email: "",
        p_seo_default_title: "FinTechPulse",
        p_seo_default_description: "UK finance and fintech.",
        p_share_image_path: "",
        p_worker_stale_after_seconds: 45,
        p_worker_offline_after_seconds: 200,
        p_auto_publish_default: true,
      }),
    )) as Settings;

    expect(cleared.default_byline_role).toBeNull();
    expect(cleared.editorial_contact_email).toBeNull();
    expect(cleared.share_image_path).toBeNull();
  });

  it("still enforces the table's own constraints", async () => {
    const result = await editor.client.rpc("admin_update_site_settings", {
      p_default_byline_name: "FinTechPulse Newsroom",
      p_default_byline_role: "",
      p_editorial_contact_email: "not-an-email",
      p_seo_default_title: "",
      p_seo_default_description: "",
      p_share_image_path: "",
      p_worker_stale_after_seconds: 45,
      p_worker_offline_after_seconds: 200,
      p_auto_publish_default: false,
    });
    expect(result.error?.code).toBe("23514");

    const inverted = await editor.client.rpc("admin_update_site_settings", {
      p_default_byline_name: "FinTechPulse Newsroom",
      p_default_byline_role: "",
      p_editorial_contact_email: "",
      p_seo_default_title: "",
      p_seo_default_description: "",
      p_share_image_path: "",
      p_worker_stale_after_seconds: 300,
      p_worker_offline_after_seconds: 100,
      p_auto_publish_default: false,
    });
    expect(inverted.error?.code).toBe("23514");
  });
});

describe("admin_update_site_identity", () => {
  const args = {
    p_name: "FinTechPulse",
    p_description: "UK finance and fintech.",
    p_disclosure: "Editorial information, not advice.",
    p_timezone: "Europe/London",
  };

  it("is owner-only", async () => {
    expectCode((await anonClient().rpc("admin_update_site_identity", args)).error, "42501");
    expectCode((await outsider.client.rpc("admin_update_site_identity", args)).error, "42501");
    expectCode((await viewer.client.rpc("admin_update_site_identity", args)).error, "42501");
    expectCode((await editor.client.rpc("admin_update_site_identity", args)).error, "42501");
  });

  it("saves the owner's changes", async () => {
    const saved = (await unwrap(
      owner.client.rpc("admin_update_site_identity", {
        ...args,
        p_name: "  FinTechPulse UK  ",
        p_timezone: "Europe/Dublin",
      }),
    )) as Record<string, unknown>;
    expect(saved.name).toBe("FinTechPulse UK");
    expect(saved.timezone).toBe("Europe/Dublin");
    // Deployment-level values are not part of this function's surface.
    expect(saved.canonical_origin).toBe("https://fintechpulse.co.uk");
    expect(saved.slug).toBe("fintechpulse");
  });

  it("rejects a timezone the database does not know", async () => {
    const result = await owner.client.rpc("admin_update_site_identity", {
      ...args,
      p_timezone: "Mars/Olympus_Mons",
    });
    expect(result.error?.code).toBe("22023");
  });

  it("keeps the existing timezone when the field is submitted empty", async () => {
    // The previous test left the site on Europe/Dublin.
    const saved = (await unwrap(
      owner.client.rpc("admin_update_site_identity", { ...args, p_timezone: "" }),
    )) as Record<string, unknown>;
    expect(saved.timezone).toBe("Europe/Dublin");
  });
});
