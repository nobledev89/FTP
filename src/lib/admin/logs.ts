import "server-only";

import { z } from "zod";

import { toWorkflowError } from "@/lib/state-machine/errors";
import { PIPELINE_STAGES, type PipelineStage } from "@/lib/state-machine/transitions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  jsonObjectSchema,
  nullableTimestampSchema,
  pipelineStageSchema,
  providerModeSchema,
  timestampSchema,
  uuidSchema,
} from "@/lib/validation/domain";

import { paged, rangeFor, type Paged } from "./pagination";
import { redactJsonObject, redactLogText } from "./redact";

/**
 * Filterable, server-paginated logs (plan section 12). Every message that came from the worker PC
 * passes through redaction before it reaches a browser.
 */

export const LOG_SOURCES = ["provider", "publishing", "events"] as const;
export type LogSource = (typeof LOG_SOURCES)[number];

export const LOG_SOURCE_LABELS: Readonly<Record<LogSource, string>> = {
  provider: "Provider runs",
  publishing: "Publishing and verification",
  events: "Job events",
};

const RUN_STATUSES = ["running", "action_required", "succeeded", "failed", "cancelled"] as const;
const PUBLISH_KINDS = ["publish", "revalidate", "verify_check", "verify_summary"] as const;
const OUTCOMES = ["succeeded", "failed", "skipped"] as const;
const ACTOR_TYPES = ["system", "worker", "admin"] as const;

export type LogFilters = Readonly<{
  source: LogSource;
  /** Provider runs: run status. Publishing: outcome. Events: actor type. */
  state: string | null;
  stage: PipelineStage | null;
  jobId: string | null;
  /** True when only failures should be listed. */
  failuresOnly: boolean;
}>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isOneOf<T extends string>(value: string, allowed: readonly T[]): value is T {
  return (allowed as readonly string[]).includes(value);
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[]): T | null {
  return value !== undefined && isOneOf(value, allowed) ? value : null;
}

export function parseLogFilters(
  searchParams: Readonly<Record<string, string | string[] | undefined>>,
): LogFilters {
  const source = oneOf(first(searchParams.source), LOG_SOURCES) ?? "provider";
  const stateParam = first(searchParams.state);
  const state =
    source === "provider"
      ? oneOf(stateParam, RUN_STATUSES)
      : source === "publishing"
        ? oneOf(stateParam, OUTCOMES)
        : oneOf(stateParam, ACTOR_TYPES);
  const jobIdParam = first(searchParams.job);
  const jobId = jobIdParam && uuidSchema.safeParse(jobIdParam).success ? jobIdParam : null;

  return {
    source,
    state,
    stage: oneOf(first(searchParams.stage), PIPELINE_STAGES),
    jobId,
    failuresOnly: first(searchParams.failures) === "1",
  };
}

export function logFilterParams(filters: LogFilters): Readonly<Record<string, string | undefined>> {
  return {
    source: filters.source,
    state: filters.state ?? undefined,
    stage: filters.stage ?? undefined,
    job: filters.jobId ?? undefined,
    failures: filters.failuresOnly ? "1" : undefined,
  };
}

export const PUBLISH_KIND_VALUES = PUBLISH_KINDS;
export const RUN_STATUS_VALUES = RUN_STATUSES;
export const OUTCOME_VALUES = OUTCOMES;
export const ACTOR_TYPE_VALUES = ACTOR_TYPES;

// ---------------------------------------------------------------------------
// Provider runs
// ---------------------------------------------------------------------------

const providerRunLogSchema = z
  .object({
    id: uuidSchema,
    job_id: uuidSchema,
    stage: pipelineStageSchema,
    mode: providerModeSchema,
    provider: z.enum(["openai", "anthropic", "gemini", "internal"]),
    attempt: z.number().int().positive(),
    cycle: z.number().int().min(0).max(2),
    status: z.enum(RUN_STATUSES),
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
  })
  .strict();

export type ProviderRunLog = z.infer<typeof providerRunLogSchema>;

export async function listProviderRunLogs(
  filters: LogFilters,
  page: number,
  pageSize: number,
): Promise<Paged<ProviderRunLog>> {
  const client = await createSupabaseServerClient();
  const { from, to } = rangeFor(page, pageSize);

  let query = client
    .from("provider_runs")
    .select(
      "id, job_id, stage, mode, provider, attempt, cycle, status, error_class, error_summary, worker_id, started_at, finished_at",
      { count: "exact" },
    )
    .order("started_at", { ascending: false })
    .range(from, to);

  if (filters.stage) query = query.eq("stage", filters.stage);
  if (filters.jobId) query = query.eq("job_id", filters.jobId);
  if (filters.failuresOnly) query = query.eq("status", "failed");
  else if (filters.state && isOneOf(filters.state, RUN_STATUSES)) {
    query = query.eq("status", filters.state);
  }

  const { data, error, count } = await query;
  if (error) throw toWorkflowError(error);

  const rows = providerRunLogSchema
    .array()
    .parse(data ?? [])
    .map((row) => ({ ...row, error_summary: redactLogText(row.error_summary) }));
  return paged(rows, page, pageSize, count ?? null);
}

// ---------------------------------------------------------------------------
// Publishing and verification
// ---------------------------------------------------------------------------

const publishingLogRowSchema = z
  .object({
    id: z.number().int().positive(),
    job_id: uuidSchema,
    article_id: uuidSchema.nullable(),
    kind: z.enum(PUBLISH_KINDS),
    check_name: z.string().nullable(),
    outcome: z.enum(OUTCOMES),
    attempt: z.number().int().positive(),
    http_status: z.number().int().nullable(),
    duration_ms: z.number().int().nullable(),
    result_summary: jsonObjectSchema,
    error: z.string().nullable(),
    worker_id: z.string().nullable(),
    created_at: timestampSchema,
  })
  .strict();

export type PublishingLogListRow = z.infer<typeof publishingLogRowSchema>;

export async function listPublishingLogs(
  filters: LogFilters,
  page: number,
  pageSize: number,
): Promise<Paged<PublishingLogListRow>> {
  const client = await createSupabaseServerClient();
  const { from, to } = rangeFor(page, pageSize);

  let query = client
    .from("publishing_logs")
    .select(
      "id, job_id, article_id, kind, check_name, outcome, attempt, http_status, duration_ms, result_summary, error, worker_id, created_at",
      { count: "exact" },
    )
    .order("id", { ascending: false })
    .range(from, to);

  if (filters.jobId) query = query.eq("job_id", filters.jobId);
  if (filters.failuresOnly) query = query.eq("outcome", "failed");
  else if (filters.state && isOneOf(filters.state, OUTCOMES)) {
    query = query.eq("outcome", filters.state);
  }

  const { data, error, count } = await query;
  if (error) throw toWorkflowError(error);

  const rows = publishingLogRowSchema
    .array()
    .parse(data ?? [])
    .map((row) => ({
      ...row,
      error: redactLogText(row.error),
      result_summary: redactJsonObject(row.result_summary),
    }));
  return paged(rows, page, pageSize, count ?? null);
}

// ---------------------------------------------------------------------------
// Job events
// ---------------------------------------------------------------------------

const eventLogSchema = z
  .object({
    id: z.number().int().positive(),
    job_id: uuidSchema,
    event_type: z.string(),
    from_status: z.string().nullable(),
    to_status: z.string().nullable(),
    actor_type: z.enum(ACTOR_TYPES),
    actor_id: z.string().nullable(),
    note: z.string().nullable(),
    created_at: timestampSchema,
  })
  .strict();

export type EventLogRow = z.infer<typeof eventLogSchema>;

export async function listEventLogs(
  filters: LogFilters,
  page: number,
  pageSize: number,
): Promise<Paged<EventLogRow>> {
  const client = await createSupabaseServerClient();
  const { from, to } = rangeFor(page, pageSize);

  let query = client
    .from("job_events")
    .select(
      "id, job_id, event_type, from_status, to_status, actor_type, actor_id, note, created_at",
      {
        count: "exact",
      },
    )
    .order("id", { ascending: false })
    .range(from, to);

  if (filters.jobId) query = query.eq("job_id", filters.jobId);
  if (filters.state && isOneOf(filters.state, ACTOR_TYPES)) {
    query = query.eq("actor_type", filters.state);
  }
  if (filters.failuresOnly) query = query.in("to_status", ["FAILED", "NEEDS_HUMAN"]);

  const { data, error, count } = await query;
  if (error) throw toWorkflowError(error);

  const rows = eventLogSchema
    .array()
    .parse(data ?? [])
    .map((row) => ({ ...row, note: redactLogText(row.note) }));
  return paged(rows, page, pageSize, count ?? null);
}
