import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database, Json } from "@/lib/supabase/database.types";
import {
  adminTransitionCommandSchema,
  transitionResultSchema,
  type AdminTransitionCommand,
  type TransitionResult,
} from "@/lib/validation/workflow";
import {
  errorClassSchema,
  jobStatusSchema,
  jsonObjectSchema,
  pipelineStageSchema,
  providerModeSchema,
  timestampSchema,
  uuidSchema,
} from "@/lib/validation/domain";

import { toWorkflowError } from "./errors";

type Client = SupabaseClient<Database>;

const workerIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/);
const leaseSecondsSchema = z.number().int().min(30).max(3600);

const claimSchema = z
  .object({
    job_id: uuidSchema,
    stage: pipelineStageSchema,
    status: jobStatusSchema,
    lease_token: uuidSchema,
    lease_expires_at: timestampSchema,
    lock_version: z.number().int().nonnegative(),
    attempt: z.number().int().positive(),
    revision_count: z.number().int().min(0).max(2),
    mode: providerModeSchema,
  })
  .strict();

export type JobClaim = z.infer<typeof claimSchema>;

export interface AdminWorkflowService {
  transition(command: AdminTransitionCommand): Promise<TransitionResult>;
  start(jobId: string, expectedLockVersion: number): Promise<TransitionResult>;
  pause(jobId: string, expectedLockVersion: number): Promise<TransitionResult>;
  resume(jobId: string, expectedLockVersion: number): Promise<TransitionResult>;
  retry(jobId: string, expectedLockVersion: number): Promise<TransitionResult>;
  markNeedsHuman(
    jobId: string,
    expectedLockVersion: number,
    note: string,
  ): Promise<TransitionResult>;
  resolve(
    jobId: string,
    expectedLockVersion: number,
    toStatus: Database["public"]["Enums"]["job_status"],
    note: string,
  ): Promise<TransitionResult>;
  schedule(
    jobId: string,
    expectedLockVersion: number,
    desiredPublishAt?: string,
  ): Promise<TransitionResult>;
}

export function createAdminWorkflowService(client: Client): AdminWorkflowService {
  const transition = async (input: AdminTransitionCommand): Promise<TransitionResult> => {
    const command = adminTransitionCommandSchema.parse(input);
    const { data, error } = await client.rpc("admin_transition_job", {
      p_job_id: command.jobId,
      p_action: command.action,
      p_expected_lock_version: command.expectedLockVersion,
      ...("note" in command ? { p_note: command.note } : {}),
      ...("toStatus" in command ? { p_to_status: command.toStatus } : {}),
      ...("desiredPublishAt" in command && command.desiredPublishAt
        ? { p_desired_publish_at: command.desiredPublishAt }
        : {}),
    });
    if (error) throw toWorkflowError(error);
    return transitionResultSchema.parse(data?.[0]);
  };

  return {
    transition,
    start: (jobId, expectedLockVersion) =>
      transition({ action: "start", jobId, expectedLockVersion }),
    pause: (jobId, expectedLockVersion) =>
      transition({ action: "pause", jobId, expectedLockVersion }),
    resume: (jobId, expectedLockVersion) =>
      transition({ action: "resume", jobId, expectedLockVersion }),
    retry: (jobId, expectedLockVersion) =>
      transition({ action: "retry", jobId, expectedLockVersion }),
    markNeedsHuman: (jobId, expectedLockVersion, note) =>
      transition({ action: "mark_needs_human", jobId, expectedLockVersion, note }),
    resolve: (jobId, expectedLockVersion, toStatus, note) =>
      transition({ action: "resolve", jobId, expectedLockVersion, toStatus, note }),
    schedule: (jobId, expectedLockVersion, desiredPublishAt) =>
      transition({
        action: "schedule",
        jobId,
        expectedLockVersion,
        ...(desiredPublishAt ? { desiredPublishAt } : {}),
      }),
  };
}

const completeStageInputSchema = z
  .object({
    jobId: uuidSchema,
    workerId: workerIdSchema,
    leaseToken: uuidSchema,
    toStatus: jobStatusSchema,
    note: z.string().trim().min(3).max(2000).optional(),
    metadata: jsonObjectSchema.default({}),
  })
  .strict();

const manualActionInputSchema = z
  .object({
    jobId: uuidSchema,
    workerId: workerIdSchema,
    leaseToken: uuidSchema,
    runId: uuidSchema,
    message: z.string().trim().min(1).max(2000),
  })
  .strict();

const failStageInputSchema = z
  .object({
    jobId: uuidSchema,
    workerId: workerIdSchema,
    leaseToken: uuidSchema,
    outcome: z.enum(["retry", "failed", "needs_human"]),
    errorClass: errorClassSchema,
    summary: z.string().trim().min(1).max(2000),
    retryAt: timestampSchema.optional(),
    runId: uuidSchema.optional(),
  })
  .strict();

export type CompleteStageInput = z.input<typeof completeStageInputSchema>;
export type ManualActionInput = z.input<typeof manualActionInputSchema>;
export type FailStageInput = z.input<typeof failStageInputSchema>;

export interface WorkerWorkflowService {
  claim(
    workerId: string,
    options?: { leaseSeconds?: number; stages?: Database["public"]["Enums"]["pipeline_stage"][] },
  ): Promise<JobClaim | null>;
  complete(input: CompleteStageInput): Promise<Database["public"]["Enums"]["job_status"]>;
  requestManualAction(input: ManualActionInput): Promise<Database["public"]["Enums"]["job_status"]>;
  fail(input: FailStageInput): Promise<Database["public"]["Enums"]["job_status"]>;
}

export function createWorkerWorkflowService(client: Client): WorkerWorkflowService {
  return {
    async claim(workerId, options = {}) {
      const parsedWorkerId = workerIdSchema.parse(workerId);
      const leaseSeconds = leaseSecondsSchema.parse(options.leaseSeconds ?? 300);
      const stages = options.stages
        ? z.array(pipelineStageSchema).min(1).parse(options.stages)
        : undefined;
      const { data, error } = await client.rpc("claim_next_job", {
        p_worker_id: parsedWorkerId,
        p_lease_seconds: leaseSeconds,
        ...(stages ? { p_stages: stages } : {}),
      });
      if (error) throw toWorkflowError(error);
      const claim = data?.[0];
      return claim ? claimSchema.parse(claim) : null;
    },

    async complete(input) {
      const command = completeStageInputSchema.parse(input);
      const { data, error } = await client.rpc("complete_stage", {
        p_job_id: command.jobId,
        p_worker_id: command.workerId,
        p_lease_token: command.leaseToken,
        p_to_status: command.toStatus,
        ...(command.note ? { p_note: command.note } : {}),
        p_metadata: command.metadata as Json,
      });
      if (error) throw toWorkflowError(error);
      return jobStatusSchema.parse(data);
    },

    async requestManualAction(input) {
      const command = manualActionInputSchema.parse(input);
      const { data, error } = await client.rpc("request_manual_action", {
        p_job_id: command.jobId,
        p_worker_id: command.workerId,
        p_lease_token: command.leaseToken,
        p_run_id: command.runId,
        p_message: command.message,
      });
      if (error) throw toWorkflowError(error);
      return jobStatusSchema.parse(data);
    },

    async fail(input) {
      const command = failStageInputSchema.parse(input);
      const { data, error } = await client.rpc("fail_stage", {
        p_job_id: command.jobId,
        p_worker_id: command.workerId,
        p_lease_token: command.leaseToken,
        p_outcome: command.outcome,
        p_error_class: command.errorClass,
        p_summary: command.summary,
        ...(command.retryAt ? { p_retry_at: command.retryAt } : {}),
        ...(command.runId ? { p_run_id: command.runId } : {}),
      });
      if (error) throw toWorkflowError(error);
      return jobStatusSchema.parse(data);
    },
  };
}
