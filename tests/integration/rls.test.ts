import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  adminUser,
  anonClient,
  closeDb,
  db,
  resetWorkflowData,
  serviceClient,
  signedInUser,
  siteId,
  type TestUser,
} from "./helpers/clients";
import { createJob, expectCode, WORKER_A } from "./helpers/workflow";

const editorialTables = [
  "admin_users",
  "prompt_templates",
  "site_settings",
  "provider_settings",
  "worker_instances",
  "article_jobs",
  "provider_runs",
  "research_packets",
  "sources",
  "claims",
  "claim_sources",
  "drafts",
  "audits",
  "images",
  "job_events",
  "publishing_logs",
  "originality_checks",
] as const;

let editor: TestUser;
let viewer: TestUser;
let outsider: TestUser;
let jobId: string;

async function insertArticle(
  slug: string,
  status: "published" | "verified" | "withdrawn",
  publishedAt: string,
) {
  const client = await db().connect();
  try {
    await client.query("begin");
    await client.query("select set_config('fintechpulse.state_context', 'publish', true)");
    await client.query(
      `insert into public.articles (site_id, slug, title, excerpt, body_markdown, meta_title, meta_description,
         article_type, byline_name, canonical_url, status, published_at, verified_at, withdrawn_at)
       values ($1, $2, 'Title', 'Excerpt', 'Body', 'Meta', 'Description', 'analysis', 'Editorial',
         'https://fintechpulse.co.uk/blog/' || $2::text, $3::public.article_status, $4::timestamptz,
         case when $3::text = 'verified' then now() end, case when $3::text = 'withdrawn' then now() end)`,
      [await siteId(), slug, status, publishedAt],
    );
    await client.query("commit");
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  await resetWorkflowData();
  editor = await adminUser("editor");
  viewer = await adminUser("viewer");
  outsider = await signedInUser("outsider");
  jobId = await createJob(editor);

  const past = new Date(Date.now() - 60_000).toISOString();
  const future = new Date(Date.now() + 86_400_000).toISOString();
  await insertArticle("public-article", "published", past);
  await insertArticle("verified-article", "verified", past);
  await insertArticle("future-article", "published", future);
  await insertArticle("withdrawn-article", "withdrawn", past);
});

afterAll(closeDb);

describe("anonymous visitors", () => {
  it("read only published articles whose publish time has arrived", async () => {
    const { data, error } = await anonClient().from("articles").select("slug").order("slug");
    expect(error).toBeNull();
    expect(data?.map((row) => row.slug)).toEqual(["public-article", "verified-article"]);
  });

  it("read the publication identity", async () => {
    const { data, error } = await anonClient().from("sites").select("name, canonical_origin");
    expect(error).toBeNull();
    expect(data).toEqual([
      { name: "FinTechPulse", canonical_origin: "https://fintechpulse.co.uk" },
    ]);
  });

  it.each(editorialTables)("cannot read %s", async (table) => {
    const { data, error } = await anonClient().from(table).select("*").limit(1);
    expectCode(error, "42501");
    expect(data).toBeNull();
  });

  it("cannot write articles or jobs", async () => {
    const article = await anonClient()
      .from("articles")
      .update({ title: "Defaced" })
      .eq("slug", "public-article");
    expectCode(article.error, "42501");
    const job = await anonClient().from("article_jobs").delete().eq("id", jobId);
    expectCode(job.error, "42501");
  });

  it("cannot call admin or worker functions", async () => {
    const create = await anonClient().rpc("create_article_job", { p_topic: "Anonymous topic" });
    expectCode(create.error, "42501");
    const claimed = await anonClient().rpc("claim_next_job", { p_worker_id: WORKER_A });
    expectCode(claimed.error, "42501");
  });
});

describe("signed-in users without admin membership", () => {
  it.each(editorialTables)("see no rows in %s", async (table) => {
    const { data, error } = await outsider.client.from(table).select("*").limit(5);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("see only public articles", async () => {
    const { data } = await outsider.client.from("articles").select("slug").order("slug");
    expect(data?.map((row) => row.slug)).toEqual(["public-article", "verified-article"]);
  });

  it("cannot create or transition jobs", async () => {
    const create = await outsider.client.rpc("create_article_job", { p_topic: "Outsider topic" });
    expectCode(create.error, "42501");
    const transition = await outsider.client.rpc("admin_transition_job", {
      p_job_id: jobId,
      p_action: "start",
      p_expected_lock_version: 0,
    });
    expectCode(transition.error, "42501");
  });

  it("cannot promote themselves", async () => {
    const { error } = await outsider.client
      .from("admin_users")
      .insert({ user_id: outsider.id, site_id: await siteId(), role: "owner" });
    expectCode(error, "42501");
  });
});

describe("admins", () => {
  it("read editorial data, including unpublished articles", async () => {
    const jobs = await viewer.client.from("article_jobs").select("id, status");
    expect(jobs.error).toBeNull();
    expect(jobs.data).toEqual([{ id: jobId, status: "IDEA" }]);

    const events = await viewer.client.from("job_events").select("event_type").eq("job_id", jobId);
    expect(events.data).toEqual([{ event_type: "job.created" }]);

    const articles = await viewer.client.from("articles").select("slug").order("slug");
    expect(articles.data?.map((row) => row.slug)).toEqual([
      "future-article",
      "public-article",
      "verified-article",
      "withdrawn-article",
    ]);

    const members = await viewer.client.from("admin_users").select("user_id");
    // Other test files add members too; an admin sees every membership, not just their own.
    expect(members.data?.map((row) => row.user_id)).toEqual(
      expect.arrayContaining([editor.id, viewer.id]),
    );
  });

  it("cannot write tables directly, even as editors", async () => {
    const update = await editor.client
      .from("article_jobs")
      .update({ topic: "Edited directly" })
      .eq("id", jobId);
    expectCode(update.error, "42501");
    const insert = await editor.client
      .from("job_events")
      .insert({ job_id: jobId, event_type: "job.forged", actor_type: "admin" });
    expectCode(insert.error, "42501");
  });

  it("cannot call worker functions", async () => {
    const claimed = await editor.client.rpc("claim_next_job", { p_worker_id: WORKER_A });
    expectCode(claimed.error, "42501");
    const published = await editor.client.rpc("publish_article", {
      p_job_id: jobId,
      p_worker_id: WORKER_A,
      p_lease_token: crypto.randomUUID(),
    });
    expectCode(published.error, "42501");
  });

  it("need an owner or editor role to change workflow state", async () => {
    const byViewer = await viewer.client.rpc("create_article_job", { p_topic: "Viewer topic" });
    expectCode(byViewer.error, "42501");
    const byEditor = await editor.client.rpc("create_article_job", {
      p_topic: "Editor topic",
      p_image_count: 0,
    });
    expect(byEditor.error).toBeNull();
  });

  it("lose access as soon as their membership is deactivated", async () => {
    const temporary = await adminUser("editor");
    await db().query("update public.admin_users set is_active = false where user_id = $1", [
      temporary.id,
    ]);
    const { data } = await temporary.client.from("article_jobs").select("id");
    expect(data).toEqual([]);
  });
});

describe("the local worker (service role)", () => {
  it("reads and writes workflow tables", async () => {
    const { data, error } = await serviceClient().from("article_jobs").select("id").eq("id", jobId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });
});
