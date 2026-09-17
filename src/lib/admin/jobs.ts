import "server-only";

import { z } from "zod";

import { toWorkflowError } from "@/lib/state-machine/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  actionRequiredKindSchema,
  articleJobSchema,
  articleTypeSchema,
  jobEventSchema,
  jobStatusSchema,
  jsonObjectSchema,
  nullableTimestampSchema,
  pipelineStageSchema,
  providerModeSchema,
  timestampSchema,
  uuidSchema,
  type ArticleJob,
  type JobEvent,
} from "@/lib/validation/domain";

import { effectiveStatuses, requiresAction, type JobFilters } from "./job-filters";
import { paged, rangeFor, type Paged } from "./pagination";
import { redactJsonObject, redactLogText } from "./redact";

/**
 * Editorial reads for the queue and the article detail page.
 *
 * These are plain selects: RLS already restricts `authenticated` to admins, and the admin policies
 * are read-only, so there is nothing a crafted filter could reach that a legitimate query could
 * not. Selections list their columns so a later migration cannot widen a payload by accident, and
 * bodies are fetched only for the version actually being viewed.
 */

const JOB_LIST_COLUMNS = [
  "id",
  "topic",
  "status",
  "article_type",
  "category",
  "revision_count",
  "attempt_count",
  "max_attempts",
  "desired_publish_at",
  "auto_publish",
  "action_required_kind",
  "lease_owner",
  "lease_expires_at",
  "failed_stage",
  "needs_human_stage",
  "article_id",
  "lock_version",
  "created_at",
  "updated_at",
].join(", ");

export const jobListRowSchema = z
  .object({
    id: uuidSchema,
    topic: z.string(),
    status: jobStatusSchema,
    article_type: articleTypeSchema,
    category: z.string().nullable(),
    revision_count: z.number().int().min(0).max(2),
    attempt_count: z.number().int().nonnegative(),
    max_attempts: z.number().int().positive(),
    desired_publish_at: nullableTimestampSchema,
    auto_publish: z.boolean(),
    action_required_kind: actionRequiredKindSchema.nullable(),
    lease_owner: z.string().nullable(),
    lease_expires_at: nullableTimestampSchema,
    failed_stage: pipelineStageSchema.nullable(),
    needs_human_stage: pipelineStageSchema.nullable(),
    article_id: uuidSchema.nullable(),
    lock_version: z.number().int().nonnegative(),
    created_at: timestampSchema,
    updated_at: timestampSchema,
  })
  .strict();

export type JobListRow = z.infer<typeof jobListRowSchema>;

export async function listJobs(
  filters: JobFilters,
  page: number,
  pageSize: number,
): Promise<Paged<JobListRow>> {
  const client = await createSupabaseServerClient();
  const { from, to } = rangeFor(page, pageSize);

  let query = client
    .from("article_jobs")
    .select(JOB_LIST_COLUMNS, { count: "exact" })
    .order("updated_at", { ascending: false })
    .range(from, to);

  const statuses = effectiveStatuses(filters);
  if (statuses) {
    // An empty intersection must return nothing rather than everything.
    if (statuses.length === 0) return paged([], page, pageSize, 0);
    query = query.in("status", statuses);
  }
  if (requiresAction(filters)) {
    query = query.not("action_required_kind", "is", null);
  }
  if (filters.search.length > 0) {
    query = query.ilike("topic", `%${filters.search}%`);
  }

  const { data, error, count } = await query;
  if (error) throw toWorkflowError(error);

  return paged(jobListRowSchema.array().parse(data ?? []), page, pageSize, count ?? null);
}

// ---------------------------------------------------------------------------
// Article detail
// ---------------------------------------------------------------------------

const researchSummarySchema = z
  .object({
    id: uuidSchema,
    version: z.number().int().positive(),
    summary: z.string().nullable(),
    schema_version: z.string(),
    validation_status: z.enum(["valid", "invalid"]),
    provider_run_id: uuidSchema.nullable(),
    created_at: timestampSchema,
  })
  .strict();

const draftSummarySchema = z
  .object({
    id: uuidSchema,
    version: z.number().int().positive(),
    origin: z.enum(["provider", "admin_edit"]),
    title: z.string(),
    slug: z.string(),
    excerpt: z.string(),
    meta_title: z.string().nullable(),
    meta_description: z.string().nullable(),
    category: z.string().nullable(),
    parent_draft_id: uuidSchema.nullable(),
    responds_to_audit_id: uuidSchema.nullable(),
    provider_run_id: uuidSchema.nullable(),
    validation_status: z.enum(["valid", "invalid"]),
    created_at: timestampSchema,
  })
  .strict();

const auditSummarySchema = z
  .object({
    id: uuidSchema,
    version: z.number().int().positive(),
    draft_id: uuidSchema,
    cycle: z.number().int().min(0).max(2),
    verdict: z.enum(["PASS", "REVISION_REQUIRED", "NEEDS_HUMAN"]),
    summary: z.string().nullable(),
    findings: z.array(z.json()),
    created_at: timestampSchema,
  })
  .strict();

const imageSummarySchema = z
  .object({
    id: uuidSchema,
    slot: z.number().int().min(0).max(3),
    version: z.number().int().positive(),
    role: z.enum(["hero", "supporting"]),
    purpose: z.string().nullable(),
    alt_text: z.string().nullable(),
    caption: z.string().nullable(),
    aspect_ratio: z.string(),
    status: z.enum(["briefed", "uploaded", "ready", "published", "rejected"]),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    mime_type: z.string().nullable(),
    private_path: z.string().nullable(),
    public_path: z.string().nullable(),
    created_at: timestampSchema,
  })
  .strict();

const providerRunSummarySchema = z
  .object({
    id: uuidSchema,
    stage: pipelineStageSchema,
    provider: z.enum(["openai", "anthropic", "gemini", "internal"]),
    mode: providerModeSchema,
    cycle: z.number().int().min(0).max(2),
    attempt: z.number().int().positive(),
    status: z.enum(["running", "action_required", "succeeded", "failed", "cancelled"]),
    error_class: z
      .enum([
        "transient",
        "rate_limit",
        "usage_limit",
        "auth",
        "invalid_output",
        "permanent_config",
        "unknown",
      ])
      .nullable(),
    error_summary: z.string().nullable(),
    worker_id: z.string().nullable(),
    started_at: timestampSchema,
    finished_at: nullableTimestampSchema,
    cost_amount: z.union([z.number(), z.string()]).nullable(),
    cost_currency: z.string().nullable(),
  })
  .strict();

const publishingLogSchema = z
  .object({
    id: z.number().int().positive(),
    kind: z.enum(["publish", "revalidate", "verify_check", "verify_summary"]),
    check_name: z.string().nullable(),
    outcome: z.enum(["succeeded", "failed", "skipped"]),
    attempt: z.number().int().positive(),
    http_status: z.number().int().nullable(),
    duration_ms: z.number().int().nullable(),
    result_summary: jsonObjectSchema,
    error: z.string().nullable(),
    created_at: timestampSchema,
  })
  .strict();

const articleSchema = z
  .object({
    id: uuidSchema,
    slug: z.string(),
    title: z.string(),
    excerpt: z.string(),
    meta_title: z.string(),
    meta_description: z.string(),
    canonical_url: z.string(),
    status: z.enum(["published", "verified", "withdrawn"]),
    published_at: timestampSchema,
    verified_at: nullableTimestampSchema,
    content_updated_at: nullableTimestampSchema,
  })
  .strict();

export type ResearchSummary = z.infer<typeof researchSummarySchema>;
export type DraftSummary = z.infer<typeof draftSummarySchema>;
export type AuditSummary = z.infer<typeof auditSummarySchema>;
export type ImageSummary = z.infer<typeof imageSummarySchema>;
export type ProviderRunSummary = z.infer<typeof providerRunSummarySchema>;
export type PublishingLogRow = z.infer<typeof publishingLogSchema>;
export type PublishedArticle = z.infer<typeof articleSchema>;

export type JobDetail = Readonly<{
  job: ArticleJob;
  research: readonly ResearchSummary[];
  drafts: readonly DraftSummary[];
  audits: readonly AuditSummary[];
  images: readonly ImageSummary[];
  providerRuns: readonly ProviderRunSummary[];
  publishingLogs: readonly PublishingLogRow[];
  article: PublishedArticle | null;
}>;

/**
 * Loads a job and the metadata of every artifact version it produced. Draft and research bodies
 * are excluded: they are fetched one version at a time by `getDraftBody`/`getResearchPacket`.
 */
export async function getJobDetail(jobId: string): Promise<JobDetail | null> {
  const id = uuidSchema.safeParse(jobId);
  if (!id.success) return null;

  const client = await createSupabaseServerClient();
  const jobResult = await client.from("article_jobs").select("*").eq("id", id.data).maybeSingle();
  if (jobResult.error) throw toWorkflowError(jobResult.error);
  if (!jobResult.data) return null;

  const job = articleJobSchema.parse(jobResult.data);

  const [research, drafts, audits, images, runs, logs, article] = await Promise.all([
    client
      .from("research_packets")
      .select(
        "id, version, summary, schema_version, validation_status, provider_run_id, created_at",
      )
      .eq("job_id", id.data)
      .order("version", { ascending: false }),
    client
      .from("drafts")
      .select(
        "id, version, origin, title, slug, excerpt, meta_title, meta_description, category, parent_draft_id, responds_to_audit_id, provider_run_id, validation_status, created_at",
      )
      .eq("job_id", id.data)
      .order("version", { ascending: false }),
    client
      .from("audits")
      .select("id, version, draft_id, cycle, verdict, summary, findings, created_at")
      .eq("job_id", id.data)
      .order("version", { ascending: false }),
    client
      .from("images")
      .select(
        "id, slot, version, role, purpose, alt_text, caption, aspect_ratio, status, width, height, mime_type, private_path, public_path, created_at",
      )
      .eq("job_id", id.data)
      .order("slot", { ascending: true })
      .order("version", { ascending: false }),
    client
      .from("provider_runs")
      .select(
        "id, stage, provider, mode, cycle, attempt, status, error_class, error_summary, worker_id, started_at, finished_at, cost_amount, cost_currency",
      )
      .eq("job_id", id.data)
      .order("started_at", { ascending: false }),
    client
      .from("publishing_logs")
      .select(
        "id, kind, check_name, outcome, attempt, http_status, duration_ms, result_summary, error, created_at",
      )
      .eq("job_id", id.data)
      .order("id", { ascending: false }),
    job.article_id
      ? client
          .from("articles")
          .select(
            "id, slug, title, excerpt, meta_title, meta_description, canonical_url, status, published_at, verified_at, content_updated_at",
          )
          .eq("id", job.article_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  for (const result of [research, drafts, audits, images, runs, logs, article]) {
    if (result.error) throw toWorkflowError(result.error);
  }

  return {
    job: { ...job, failure_summary: redactLogText(job.failure_summary, 600) },
    research: researchSummarySchema.array().parse(research.data ?? []),
    drafts: draftSummarySchema.array().parse(drafts.data ?? []),
    audits: auditSummarySchema.array().parse(audits.data ?? []),
    images: imageSummarySchema.array().parse(images.data ?? []),
    providerRuns: providerRunSummarySchema
      .array()
      .parse(runs.data ?? [])
      .map((run) => ({ ...run, error_summary: redactLogText(run.error_summary, 400) })),
    publishingLogs: publishingLogSchema
      .array()
      .parse(logs.data ?? [])
      .map((log) => ({
        ...log,
        error: redactLogText(log.error, 400),
        result_summary: redactJsonObject(log.result_summary),
      })),
    article: article.data ? articleSchema.parse(article.data) : null,
  };
}

const draftBodySchema = z
  .object({
    id: uuidSchema,
    version: z.number().int().positive(),
    title: z.string(),
    slug: z.string(),
    excerpt: z.string(),
    body_markdown: z.string(),
    internal_links: z.array(z.json()),
    image_briefs: z.array(z.json()),
    source_refs: z.array(z.json()),
    validation_errors: z.array(z.json()).nullable(),
  })
  .strict();

export type DraftBody = z.infer<typeof draftBodySchema>;

/** Loads one draft version's body. Called only for the version the admin selected. */
export async function getDraftBody(jobId: string, version: number): Promise<DraftBody | null> {
  const id = uuidSchema.safeParse(jobId);
  if (!id.success) return null;

  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("drafts")
    .select(
      "id, version, title, slug, excerpt, body_markdown, internal_links, image_briefs, source_refs, validation_errors",
    )
    .eq("job_id", id.data)
    .eq("version", version)
    .maybeSingle();
  if (error) throw toWorkflowError(error);
  return data ? draftBodySchema.parse(data) : null;
}

const researchPacketSchema = z
  .object({
    id: uuidSchema,
    version: z.number().int().positive(),
    packet: jsonObjectSchema,
    summary: z.string().nullable(),
    validation_errors: z.array(z.json()).nullable(),
  })
  .strict();

export type ResearchPacketRow = z.infer<typeof researchPacketSchema>;

export async function getResearchPacket(
  jobId: string,
  version: number,
): Promise<ResearchPacketRow | null> {
  const id = uuidSchema.safeParse(jobId);
  if (!id.success) return null;

  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("research_packets")
    .select("id, version, packet, summary, validation_errors")
    .eq("job_id", id.data)
    .eq("version", version)
    .maybeSingle();
  if (error) throw toWorkflowError(error);
  return data ? researchPacketSchema.parse(data) : null;
}

const sourceSchema = z
  .object({
    id: uuidSchema,
    source_key: z.string(),
    url: z.string(),
    title: z.string(),
    publisher: z.string().nullable(),
    published_on: z.string().nullable(),
    source_type: z.string(),
    quality: z.enum(["primary", "secondary", "tertiary"]),
    is_private: z.boolean(),
    accessed_at: timestampSchema,
  })
  .strict();

export type SourceRow = z.infer<typeof sourceSchema>;

export async function listSources(jobId: string): Promise<readonly SourceRow[]> {
  const id = uuidSchema.safeParse(jobId);
  if (!id.success) return [];

  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("sources")
    .select(
      "id, source_key, url, title, publisher, published_on, source_type, quality, is_private, accessed_at",
    )
    .eq("job_id", id.data)
    .order("quality", { ascending: true })
    .order("source_key", { ascending: true });
  if (error) throw toWorkflowError(error);
  return sourceSchema.array().parse(data ?? []);
}

/** The lifecycle timeline, newest first and paginated: histories are never loaded whole. */
export async function listJobEvents(
  jobId: string,
  page: number,
  pageSize: number,
): Promise<Paged<JobEvent>> {
  const id = uuidSchema.safeParse(jobId);
  if (!id.success) return paged([], page, pageSize, 0);

  const client = await createSupabaseServerClient();
  const { from, to } = rangeFor(page, pageSize);
  const { data, error, count } = await client
    .from("job_events")
    .select("*", { count: "exact" })
    .eq("job_id", id.data)
    .order("id", { ascending: false })
    .range(from, to);
  if (error) throw toWorkflowError(error);

  const events = jobEventSchema
    .array()
    .parse(data ?? [])
    .map((event) => ({
      ...event,
      note: redactLogText(event.note, 400),
      metadata: redactJsonObject(event.metadata),
    }));
  return paged(events, page, pageSize, count ?? null);
}
