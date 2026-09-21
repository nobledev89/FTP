import { z } from "zod";

import { JOB_STATUSES, PIPELINE_STAGES } from "@/lib/state-machine/transitions";

export const uuidSchema = z.string().uuid();
export const timestampSchema = z.string().datetime({ offset: true });
export const nullableTimestampSchema = timestampSchema.nullable();
export const jsonObjectSchema = z.record(z.string(), z.json());

export const jobStatusSchema = z.enum(JOB_STATUSES);
export const pipelineStageSchema = z.enum(PIPELINE_STAGES);
export const providerModeSchema = z.enum([
  "mock",
  "manual_chatgpt",
  "codex_cli",
  "openai_api",
  "claude_code",
  "manual_claude",
  "anthropic_api",
  "manual_gemini",
  "codex_image",
  "gemini_api",
  "internal",
]);
export const articleTypeSchema = z.enum([
  "news",
  "analysis",
  "explainer",
  "guide",
  "company",
  "interview",
]);
export const actionRequiredKindSchema = z.enum([
  "manual_input",
  "cli_auth",
  "usage_limit",
  "invalid_output",
  "editorial_review",
  "publish_conflict",
  "verification_failed",
]);
export const errorClassSchema = z.enum([
  "transient",
  "rate_limit",
  "usage_limit",
  "auth",
  "invalid_output",
  "permanent_config",
  "unknown",
]);

export const articleJobSchema = z
  .object({
    id: uuidSchema,
    site_id: uuidSchema,
    topic: z.string().trim().min(3).max(300),
    keywords: z.array(z.string()).max(20),
    requirements: z.string().max(5000).nullable(),
    article_type: articleTypeSchema,
    target_word_count: z.number().int().min(300).max(6000).nullable(),
    image_count: z.number().int().min(0).max(3),
    desired_publish_at: nullableTimestampSchema,
    auto_publish: z.boolean(),
    byline_name: z.string().max(120).nullable(),
    byline_role: z.string().max(120).nullable(),
    category: z.string().max(60).nullable(),
    research_mode: providerModeSchema,
    writing_mode: providerModeSchema,
    images_mode: providerModeSchema,
    audit_mode: providerModeSchema,
    status: jobStatusSchema,
    lock_version: z.number().int().nonnegative(),
    attempt_count: z.number().int().nonnegative(),
    max_attempts: z.number().int().min(1).max(20),
    revision_count: z.number().int().min(0).max(2),
    next_attempt_at: nullableTimestampSchema,
    lease_owner: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{1,62}$/)
      .nullable(),
    lease_token: uuidSchema.nullable(),
    lease_expires_at: nullableTimestampSchema,
    action_required_kind: actionRequiredKindSchema.nullable(),
    action_required_message: z.string().max(2000).nullable(),
    action_required_run_id: uuidSchema.nullable(),
    action_required_at: nullableTimestampSchema,
    paused_from_status: jobStatusSchema.nullable(),
    failed_stage: pipelineStageSchema.nullable(),
    failure_summary: z.string().max(2000).nullable(),
    needs_human_stage: pipelineStageSchema.nullable(),
    approved_draft_id: uuidSchema.nullable(),
    approved_audit_id: uuidSchema.nullable(),
    article_id: uuidSchema.nullable(),
    created_by: uuidSchema.nullable(),
    created_at: timestampSchema,
    updated_at: timestampSchema,
  })
  .strict()
  .superRefine((job, context) => {
    const leaseFields = [job.lease_owner, job.lease_token, job.lease_expires_at];
    if (
      !leaseFields.every((value) => value === null) &&
      !leaseFields.every((value) => value !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "lease fields must be all present or all absent",
      });
    }
    if ((job.status === "PAUSED") !== (job.paused_from_status !== null)) {
      context.addIssue({
        code: "custom",
        path: ["paused_from_status"],
        message: "PAUSED jobs must record the status they paused from",
      });
    }
    if ((job.action_required_kind === null) !== (job.action_required_at === null)) {
      context.addIssue({
        code: "custom",
        path: ["action_required_at"],
        message: "action-required kind and timestamp must be present together",
      });
    }
  });

export type ArticleJob = z.infer<typeof articleJobSchema>;

export const jobEventSchema = z
  .object({
    id: z.number().int().positive(),
    job_id: uuidSchema,
    event_type: z.string().regex(/^[a-z]+(\.[a-z_]+)+$/),
    from_status: jobStatusSchema.nullable(),
    to_status: jobStatusSchema.nullable(),
    actor_type: z.enum(["system", "worker", "admin"]),
    actor_id: z.string().max(64).nullable(),
    lock_version: z.number().int().nonnegative().nullable(),
    note: z.string().max(2000).nullable(),
    metadata: jsonObjectSchema,
    created_at: timestampSchema,
  })
  .strict();

export type JobEvent = z.infer<typeof jobEventSchema>;
