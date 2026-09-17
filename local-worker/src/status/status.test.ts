import { describe, expect, it } from "vitest";

import type { WorkerEnv } from "../config/env.js";
import { buildStatusReport } from "./status.js";

const env = {
  WORKER_ID: "worker-a",
  WORKER_POLL_INTERVAL_MS: 10_000,
  WORKER_HEARTBEAT_INTERVAL_MS: 30_000,
  WORKER_OFFLINE_AFTER_SECONDS: 120,
  WORKER_LEASE_SECONDS: 900,
  WORKER_MAX_ATTEMPTS: 5,
} as WorkerEnv;

const base = {
  server_time: "2026-09-18T00:02:00.000Z",
  thresholds: { stale_after_seconds: 60, offline_after_seconds: 120 },
  queue: {
    claimable: 2,
    leased: 1,
    expired_leases: 0,
    delayed: 0,
    action_required: 1,
    failed: 0,
    oldest_claimable_at: "2026-09-18T00:00:00.000Z",
    by_status: { RESEARCH_PENDING: 2, RESEARCHING: 1 },
  },
};

describe("buildStatusReport", () => {
  it("classifies an up-to-date heartbeat as online", () => {
    const report = buildStatusReport(
      {
        ...base,
        worker: {
          worker_id: "worker-a",
          host_label: "worker-a",
          version: "0.1.0",
          started_at: "2026-09-18T00:00:00.000Z",
          last_seen_at: "2026-09-18T00:01:30.000Z",
          current_job_id: null,
          current_stage: null,
          health: { state: "idle" },
        },
      },
      env,
      ["research"],
    );
    expect(report.ok).toBe(true);
    expect(report.worker).toMatchObject({ state: "online", ageSeconds: 30 });
    expect(report.config.supportedStages).toEqual(["research"]);
  });

  it("distinguishes stale, offline, and never-seen workers", () => {
    const worker = {
      worker_id: "worker-a",
      host_label: null,
      version: null,
      started_at: "2026-09-17T23:00:00.000Z",
      current_job_id: null,
      current_stage: null,
      health: {},
    };
    expect(
      buildStatusReport(
        { ...base, worker: { ...worker, last_seen_at: "2026-09-18T00:01:00.000Z" } },
        env,
        [],
      ).worker.state,
    ).toBe("online");
    expect(
      buildStatusReport(
        { ...base, worker: { ...worker, last_seen_at: "2026-09-18T00:00:59.000Z" } },
        env,
        [],
      ).worker.state,
    ).toBe("stale");
    expect(
      buildStatusReport(
        { ...base, worker: { ...worker, last_seen_at: "2026-09-17T23:59:59.000Z" } },
        env,
        [],
      ).worker.state,
    ).toBe("offline");
    expect(buildStatusReport({ ...base, worker: null }, env, []).worker.state).toBe("missing");
  });
});
