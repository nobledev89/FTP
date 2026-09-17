import { z } from "zod";

import type { WorkerEnv } from "../config/env.js";
import type { Json } from "../db/database.types.js";
import type { PipelineStage } from "../db/worker-store.js";

const workerSchema = z
  .object({
    worker_id: z.string(),
    host_label: z.string().nullable(),
    version: z.string().nullable(),
    started_at: z.iso.datetime({ offset: true }),
    last_seen_at: z.iso.datetime({ offset: true }),
    current_job_id: z.string().uuid().nullable(),
    current_stage: z
      .enum(["research", "draft", "images", "audit", "revision", "publish", "verify"])
      .nullable(),
    health: z.record(z.string(), z.unknown()),
  })
  .nullable();

const statusSchema = z.object({
  server_time: z.iso.datetime({ offset: true }),
  worker: workerSchema,
  thresholds: z.object({
    stale_after_seconds: z.number().int().positive(),
    offline_after_seconds: z.number().int().positive(),
  }),
  queue: z.object({
    claimable: z.number().int().nonnegative(),
    leased: z.number().int().nonnegative(),
    expired_leases: z.number().int().nonnegative(),
    delayed: z.number().int().nonnegative(),
    action_required: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    oldest_claimable_at: z.iso.datetime({ offset: true }).nullable(),
    by_status: z.record(z.string(), z.number().int().nonnegative()),
  }),
});

export type WorkerHealthState = "missing" | "online" | "stale" | "offline";

export type WorkerStatusReport = {
  ok: boolean;
  checkedAt: string;
  worker: {
    id: string;
    hostLabel: string;
    state: WorkerHealthState;
    version: string | null;
    lastSeenAt: string | null;
    ageSeconds: number | null;
    currentJobId: string | null;
    currentStage: PipelineStage | null;
    health: Record<string, unknown>;
  };
  queue: z.infer<typeof statusSchema>["queue"];
  config: {
    pollIntervalMs: number;
    heartbeatIntervalMs: number;
    offlineAfterSeconds: number;
    leaseSeconds: number;
    maximumAttempts: number;
    supportedStages: readonly PipelineStage[];
  };
};

export function buildStatusReport(
  value: Json,
  env: WorkerEnv,
  supportedStages: readonly PipelineStage[],
): WorkerStatusReport {
  const snapshot = statusSchema.parse(value);
  const serverTime = new Date(snapshot.server_time).getTime();
  const ageSeconds = snapshot.worker
    ? Math.max(
        0,
        Math.floor((serverTime - new Date(snapshot.worker.last_seen_at).getTime()) / 1_000),
      )
    : null;
  const state: WorkerHealthState = !snapshot.worker
    ? "missing"
    : ageSeconds! <= snapshot.thresholds.stale_after_seconds
      ? "online"
      : ageSeconds! <= snapshot.thresholds.offline_after_seconds
        ? "stale"
        : "offline";

  return {
    ok: state === "online",
    checkedAt: snapshot.server_time,
    worker: {
      id: env.WORKER_ID,
      hostLabel: snapshot.worker?.host_label ?? env.WORKER_HOST_LABEL ?? env.WORKER_ID,
      state,
      version: snapshot.worker?.version ?? null,
      lastSeenAt: snapshot.worker?.last_seen_at ?? null,
      ageSeconds,
      currentJobId: snapshot.worker?.current_job_id ?? null,
      currentStage: snapshot.worker?.current_stage ?? null,
      health: snapshot.worker?.health ?? {},
    },
    queue: snapshot.queue,
    config: {
      pollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
      heartbeatIntervalMs: env.WORKER_HEARTBEAT_INTERVAL_MS,
      offlineAfterSeconds: env.WORKER_OFFLINE_AFTER_SECONDS,
      leaseSeconds: env.WORKER_LEASE_SECONDS,
      maximumAttempts: env.WORKER_MAX_ATTEMPTS,
      supportedStages,
    },
  };
}
