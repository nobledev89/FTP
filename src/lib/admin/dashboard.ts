import "server-only";

import { z } from "zod";

import { toWorkflowError } from "@/lib/state-machine/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  actionRequiredKindSchema,
  jobStatusSchema,
  nullableTimestampSchema,
  pipelineStageSchema,
  timestampSchema,
  uuidSchema,
} from "@/lib/validation/domain";

import { redactLogText } from "./redact";

/**
 * Dashboard read (plan section 12).
 *
 * The summary is produced by `public.admin_dashboard`, one authorized round trip instead of a dozen
 * count queries from the browser's session. Its shape is validated here so a future migration that
 * changes the payload fails loudly in tests rather than rendering blank panels.
 */

const countsSchema = z.record(z.string(), z.number().int().nonnegative());
const lockVersionSchema = z.number().int().nonnegative();

const actionRequiredRowSchema = z
  .object({
    id: uuidSchema,
    topic: z.string(),
    status: jobStatusSchema,
    kind: actionRequiredKindSchema,
    message: z.string().nullable(),
    since: timestampSchema,
    lock_version: lockVersionSchema,
  })
  .strict();

const blockedRowSchema = z
  .object({
    id: uuidSchema,
    topic: z.string(),
    status: jobStatusSchema,
    failed_stage: pipelineStageSchema.nullable(),
    needs_human_stage: pipelineStageSchema.nullable(),
    failure_summary: z.string().nullable(),
    attempt_count: z.number().int().nonnegative(),
    max_attempts: z.number().int().positive(),
    next_attempt_at: nullableTimestampSchema,
    updated_at: timestampSchema,
    lock_version: lockVersionSchema,
  })
  .strict();

const inProgressRowSchema = z
  .object({
    id: uuidSchema,
    topic: z.string(),
    status: jobStatusSchema,
    lease_owner: z.string().nullable(),
    lease_expires_at: nullableTimestampSchema,
    revision_count: z.number().int().min(0).max(2),
    updated_at: timestampSchema,
    lock_version: lockVersionSchema,
  })
  .strict();

const upcomingRowSchema = z
  .object({
    id: uuidSchema,
    topic: z.string(),
    status: jobStatusSchema,
    desired_publish_at: nullableTimestampSchema,
    auto_publish: z.boolean(),
    lock_version: lockVersionSchema,
  })
  .strict();

const publicationRowSchema = z
  .object({
    id: uuidSchema,
    slug: z.string(),
    title: z.string(),
    status: z.enum(["published", "verified", "withdrawn"]),
    published_at: timestampSchema,
    verified_at: nullableTimestampSchema,
    job_id: uuidSchema.nullable(),
  })
  .strict();

const workerRowSchema = z
  .object({
    worker_id: z.string(),
    host_label: z.string().nullable(),
    version: z.string().nullable(),
    started_at: timestampSchema,
    last_seen_at: timestampSchema,
    current_job_id: uuidSchema.nullable(),
    current_stage: pipelineStageSchema.nullable(),
    state: z.enum(["online", "stale", "offline"]),
  })
  .strict();

export const dashboardSchema = z
  .object({
    site_id: uuidSchema,
    role: z.enum(["owner", "editor", "viewer"]),
    generated_at: timestampSchema,
    status_counts: countsSchema,
    stage_counts: countsSchema,
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
    action_required: actionRequiredRowSchema.array(),
    blocked: blockedRowSchema.array(),
    in_progress: inProgressRowSchema.array(),
    upcoming: upcomingRowSchema.array(),
    recent_publications: publicationRowSchema.array(),
    workers: workerRowSchema.array(),
    worker_thresholds: z
      .object({
        stale_after_seconds: z.number().int().positive(),
        offline_after_seconds: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();

export type AdminDashboard = z.infer<typeof dashboardSchema>;

/** Reads the dashboard summary for the caller's site. The RPC authorizes the caller itself. */
export async function getAdminDashboard(listLimit = 8): Promise<AdminDashboard> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("admin_dashboard", { p_list_limit: listLimit });
  if (error) throw toWorkflowError(error);

  const dashboard = dashboardSchema.parse(data);

  // Worker and provider messages originate on the owner's PC; redact before they reach a browser.
  return {
    ...dashboard,
    action_required: dashboard.action_required.map((row) => ({
      ...row,
      message: redactLogText(row.message, 240),
    })),
    blocked: dashboard.blocked.map((row) => ({
      ...row,
      failure_summary: redactLogText(row.failure_summary, 240),
    })),
  };
}
