import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

let input = "";
for await (const chunk of process.stdin) input += chunk;

const uuid = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });
const nullableTimestamp = timestamp.nullable();
const jobStatus = z.enum([
  "IDEA",
  "RESEARCH_PENDING",
  "RESEARCHING",
  "RESEARCH_COMPLETE",
  "DRAFT_PENDING",
  "DRAFTING",
  "DRAFT_COMPLETE",
  "IMAGES_PENDING",
  "IMAGES_PROCESSING",
  "AUDIT_PENDING",
  "AUDITING",
  "REVISION_REQUIRED",
  "REVISING",
  "RE_AUDIT_PENDING",
  "APPROVED",
  "SCHEDULED",
  "PUBLISHING",
  "PUBLISHED",
  "VERIFIED",
  "PAUSED",
  "FAILED",
  "NEEDS_HUMAN",
  "DISCARDED",
]);
const stage = z.enum(["research", "draft", "images", "audit", "revision", "publish", "verify"]);
const action = z.enum([
  "manual_input",
  "cli_auth",
  "usage_limit",
  "invalid_output",
  "editorial_review",
  "publish_conflict",
  "verification_failed",
]);
const lockVersion = z.number().int().nonnegative();
const counts = z.record(z.string(), z.number().int().nonnegative());

const schema = z
  .object({
    site_id: uuid,
    role: z.enum(["owner", "editor", "viewer"]),
    generated_at: timestamp,
    status_counts: counts,
    stage_counts: counts,
    totals: z
      .object({
        jobs: z.number().int().nonnegative(),
        active: z.number().int().nonnegative(),
        awaiting_action: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        needs_human: z.number().int().nonnegative(),
        paused: z.number().int().nonnegative(),
        published_last_7_days: z.number().int().nonnegative(),
      })
      .strict(),
    action_required: z.array(
      z
        .object({
          id: uuid,
          topic: z.string(),
          status: jobStatus,
          kind: action,
          message: z.string().nullable(),
          since: timestamp,
          lock_version: lockVersion,
        })
        .strict(),
    ),
    blocked: z.array(
      z
        .object({
          id: uuid,
          topic: z.string(),
          status: jobStatus,
          failed_stage: stage.nullable(),
          needs_human_stage: stage.nullable(),
          failure_summary: z.string().nullable(),
          attempt_count: z.number().int().nonnegative(),
          max_attempts: z.number().int().positive(),
          next_attempt_at: nullableTimestamp,
          updated_at: timestamp,
          lock_version: lockVersion,
        })
        .strict(),
    ),
    in_progress: z.array(
      z
        .object({
          id: uuid,
          topic: z.string(),
          status: jobStatus,
          lease_owner: z.string().nullable(),
          lease_expires_at: nullableTimestamp,
          revision_count: z.number().int().min(0).max(2),
          updated_at: timestamp,
          lock_version: lockVersion,
        })
        .strict(),
    ),
    upcoming: z.array(
      z
        .object({
          id: uuid,
          topic: z.string(),
          status: jobStatus,
          desired_publish_at: nullableTimestamp,
          auto_publish: z.boolean(),
          lock_version: lockVersion,
        })
        .strict(),
    ),
    recent_publications: z.array(
      z
        .object({
          id: uuid,
          slug: z.string(),
          title: z.string(),
          status: z.enum(["published", "verified", "withdrawn"]),
          published_at: timestamp,
          verified_at: nullableTimestamp,
          job_id: uuid.nullable(),
        })
        .strict(),
    ),
    workers: z.array(
      z
        .object({
          worker_id: z.string(),
          host_label: z.string().nullable(),
          version: z.string().nullable(),
          started_at: timestamp,
          last_seen_at: timestamp,
          current_job_id: uuid.nullable(),
          current_stage: stage.nullable(),
          state: z.enum(["online", "stale", "offline"]),
        })
        .strict(),
    ),
    worker_thresholds: z
      .object({
        stale_after_seconds: z.number().int().positive(),
        offline_after_seconds: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();

if (input.trim()) {
  const result = schema.safeParse(JSON.parse(input.replace(/^\uFEFF/, "")));
  console.log(
    result.success ? "dashboard schema valid" : JSON.stringify(result.error.issues, null, 2),
  );
} else {
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const jobRow = z
    .object({
      id: uuid,
      topic: z.string(),
      status: jobStatus,
      article_type: z.enum(["news", "analysis", "explainer", "guide", "company", "interview"]),
      category: z.string().nullable(),
      image_count: z.number().int().min(0).max(3),
      revision_count: z.number().int().min(0).max(2),
      attempt_count: z.number().int().nonnegative(),
      max_attempts: z.number().int().positive(),
      desired_publish_at: nullableTimestamp,
      auto_publish: z.boolean(),
      action_required_kind: action.nullable(),
      lease_owner: z.string().nullable(),
      lease_expires_at: nullableTimestamp,
      failed_stage: stage.nullable(),
      needs_human_stage: stage.nullable(),
      article_id: uuid.nullable(),
      lock_version: lockVersion,
      created_at: timestamp,
      updated_at: timestamp,
    })
    .strict();
  const discoverySource = z
    .object({
      url: z.string().url(),
      headline: z.string(),
      publisher: z.string().nullable().optional(),
      published_at: z.string().nullable().optional(),
      run_id: z.number().int().optional(),
      traffic_score: z.number().int().min(0).max(100).optional(),
      traffic_audience: z.enum(["broad", "medium", "niche"]).optional(),
      traffic_search_intent: z.enum(["high", "medium", "low"]).optional(),
      traffic_urgency: z.enum(["breaking", "timely", "evergreen"]).optional(),
      traffic_rationale: z.string().optional(),
    })
    .passthrough();
  const review = z
    .object({
      id: uuid,
      topic: z.string(),
      category: z.string().nullable(),
      origin: z.enum(["editor", "discovery"]),
      discovery_source: discoverySource.nullable(),
      approved_draft_id: uuid.nullable(),
      auto_publish_hold_reason: z.enum(["no_image", "duplicate", "daily_cap"]).nullable(),
      lock_version: lockVersion,
      updated_at: timestamp,
    })
    .strict();
  const draft = z.object({ id: uuid, title: z.string(), excerpt: z.string() }).strict();
  const columns =
    "id, topic, status, article_type, category, image_count, revision_count, attempt_count, max_attempts, desired_publish_at, auto_publish, action_required_kind, lease_owner, lease_expires_at, failed_stage, needs_human_stage, article_id, lock_version, created_at, updated_at";
  const [jobs, progress, reviews] = await Promise.all([
    client
      .from("article_jobs")
      .select(columns)
      .order("updated_at", { ascending: false })
      .range(0, 9),
    client
      .from("article_jobs")
      .select(columns)
      .in("status", [
        "RESEARCH_PENDING",
        "RESEARCHING",
        "RESEARCH_COMPLETE",
        "DRAFT_PENDING",
        "DRAFTING",
        "DRAFT_COMPLETE",
        "IMAGES_PENDING",
        "IMAGES_PROCESSING",
        "AUDIT_PENDING",
        "AUDITING",
        "REVISION_REQUIRED",
        "REVISING",
        "RE_AUDIT_PENDING",
        "PUBLISHING",
      ])
      .order("updated_at", { ascending: false })
      .range(0, 5),
    client
      .from("article_jobs")
      .select(
        "id, topic, category, origin, discovery_source, approved_draft_id, auto_publish_hold_reason, lock_version, updated_at",
      )
      .eq("status", "APPROVED")
      .eq("auto_publish", false)
      .order("updated_at", { ascending: true })
      .limit(50),
  ]);
  for (const result of [jobs, progress, reviews]) if (result.error) throw result.error;
  const draftIds = reviews.data.flatMap((row) =>
    row.approved_draft_id ? [row.approved_draft_id] : [],
  );
  const drafts = await client.from("drafts").select("id, title, excerpt").in("id", draftIds);
  if (drafts.error) throw drafts.error;
  const results = {
    jobs: jobRow.array().safeParse(jobs.data),
    progress: jobRow.array().safeParse(progress.data),
    reviews: review.array().safeParse(reviews.data),
    drafts: draft.array().safeParse(drafts.data),
  };
  for (const [name, result] of Object.entries(results)) {
    console.log(
      result.success ? `${name} schema valid` : `${name}: ${JSON.stringify(result.error.issues)}`,
    );
  }
}
