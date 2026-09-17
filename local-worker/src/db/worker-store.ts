import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { WorkerEnv } from "../config/env.js";
import type { Database, Json } from "./database.types.js";

type Enums = Database["public"]["Enums"];
type JobStatus = Enums["job_status"];
export type PipelineStage = Enums["pipeline_stage"];
export type ProviderMode = Enums["provider_mode"];
export type ErrorClass = Enums["error_class"];

export type ClaimedJob = {
  jobId: string;
  stage: PipelineStage;
  status: JobStatus;
  leaseToken: string;
  leaseExpiresAt: string;
  lockVersion: number;
  attempt: number;
  revisionCount: number;
  mode: ProviderMode;
};

export type Heartbeat = {
  workerId: string;
  hostLabel: string;
  version: string;
  startedAt: string;
  currentJobId?: string;
  currentStage?: PipelineStage;
  health: Json;
};

export type StageFailure = {
  jobId: string;
  workerId: string;
  leaseToken: string;
  outcome: "retry" | "failed" | "needs_human";
  errorClass: ErrorClass;
  summary: string;
  retryAt?: string;
  runId?: string;
};

export interface WorkerStore {
  heartbeat(input: Heartbeat): Promise<string>;
  recoverExpiredLeases(): Promise<number>;
  claim(
    workerId: string,
    leaseSeconds: number,
    stages: readonly PipelineStage[],
  ): Promise<ClaimedJob | null>;
  renewLease(claim: ClaimedJob, workerId: string, leaseSeconds: number): Promise<string>;
  completeStage(
    claim: ClaimedJob,
    workerId: string,
    toStatus: JobStatus,
    note?: string,
    metadata?: Json,
  ): Promise<JobStatus>;
  requestManualAction(
    claim: ClaimedJob,
    workerId: string,
    runId: string,
    message: string,
  ): Promise<JobStatus>;
  failStage(failure: StageFailure): Promise<JobStatus>;
  status(workerId: string): Promise<Json>;
}

export class WorkerDatabaseError extends Error {
  constructor(
    operation: string,
    readonly code: string | undefined,
    message: string,
    options?: ErrorOptions,
  ) {
    super(`${operation} failed${code ? ` (${code})` : ""}: ${message}`, options);
    this.name = "WorkerDatabaseError";
  }
}

export function createWorkerClient(env: WorkerEnv): SupabaseClient<Database> {
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { "X-Client-Info": "fintechpulse-local-worker/0.1.0" } },
  });
}

export class SupabaseWorkerStore implements WorkerStore {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async heartbeat(input: Heartbeat): Promise<string> {
    const result = await this.client.rpc("heartbeat_worker", {
      p_worker_id: input.workerId,
      p_host_label: input.hostLabel,
      p_version: input.version,
      p_started_at: input.startedAt,
      p_health: input.health,
      ...(input.currentJobId ? { p_current_job_id: input.currentJobId } : {}),
      ...(input.currentStage ? { p_current_stage: input.currentStage } : {}),
    });
    return unwrap(result, "heartbeat_worker");
  }

  async recoverExpiredLeases(): Promise<number> {
    return unwrap(await this.client.rpc("recover_expired_leases"), "recover_expired_leases");
  }

  async claim(
    workerId: string,
    leaseSeconds: number,
    stages: readonly PipelineStage[],
  ): Promise<ClaimedJob | null> {
    const rows = unwrap(
      await this.client.rpc("claim_next_job", {
        p_worker_id: workerId,
        p_lease_seconds: leaseSeconds,
        p_stages: [...stages],
      }),
      "claim_next_job",
    );
    const row = rows[0];
    return row
      ? {
          jobId: row.job_id,
          stage: row.stage,
          status: row.status,
          leaseToken: row.lease_token,
          leaseExpiresAt: row.lease_expires_at,
          lockVersion: row.lock_version,
          attempt: row.attempt,
          revisionCount: row.revision_count,
          mode: row.mode,
        }
      : null;
  }

  async renewLease(claim: ClaimedJob, workerId: string, leaseSeconds: number): Promise<string> {
    return unwrap(
      await this.client.rpc("renew_lease", {
        p_job_id: claim.jobId,
        p_worker_id: workerId,
        p_lease_token: claim.leaseToken,
        p_lease_seconds: leaseSeconds,
      }),
      "renew_lease",
    );
  }

  async completeStage(
    claim: ClaimedJob,
    workerId: string,
    toStatus: JobStatus,
    note?: string,
    metadata: Json = {},
  ): Promise<JobStatus> {
    return unwrap(
      await this.client.rpc("complete_stage", {
        p_job_id: claim.jobId,
        p_worker_id: workerId,
        p_lease_token: claim.leaseToken,
        p_to_status: toStatus,
        p_metadata: metadata,
        ...(note ? { p_note: note } : {}),
      }),
      "complete_stage",
    );
  }

  async requestManualAction(
    claim: ClaimedJob,
    workerId: string,
    runId: string,
    message: string,
  ): Promise<JobStatus> {
    return unwrap(
      await this.client.rpc("request_manual_action", {
        p_job_id: claim.jobId,
        p_worker_id: workerId,
        p_lease_token: claim.leaseToken,
        p_run_id: runId,
        p_message: message,
      }),
      "request_manual_action",
    );
  }

  async failStage(failure: StageFailure): Promise<JobStatus> {
    return unwrap(
      await this.client.rpc("fail_stage", {
        p_job_id: failure.jobId,
        p_worker_id: failure.workerId,
        p_lease_token: failure.leaseToken,
        p_outcome: failure.outcome,
        p_error_class: failure.errorClass,
        p_summary: failure.summary,
        ...(failure.retryAt ? { p_retry_at: failure.retryAt } : {}),
        ...(failure.runId ? { p_run_id: failure.runId } : {}),
      }),
      "fail_stage",
    );
  }

  async status(workerId: string): Promise<Json> {
    return unwrap(
      await this.client.rpc("worker_status", { p_worker_id: workerId }),
      "worker_status",
    );
  }
}

type Result<T> = { data: T; error: { code?: string; message: string } | null };

function unwrap<T>(result: Result<T>, operation: string): NonNullable<T> {
  if (result.error) {
    throw new WorkerDatabaseError(operation, result.error.code, result.error.message, {
      cause: result.error,
    });
  }
  if (result.data === null || result.data === undefined) {
    throw new WorkerDatabaseError(operation, undefined, "database returned no data");
  }
  return result.data as NonNullable<T>;
}
