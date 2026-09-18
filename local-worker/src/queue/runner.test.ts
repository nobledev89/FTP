import { describe, expect, it } from "vitest";

import type { WorkerEnv } from "../config/env.js";
import type { Json } from "../db/database.types.js";
import {
  type ClaimedJob,
  type Heartbeat,
  type PipelineStage,
  type StageFailure,
  type WorkerStore,
} from "../db/worker-store.js";
import { StructuredLogger } from "../logging/logger.js";
import { type StageContext, WorkerRunner } from "./runner.js";

const env: WorkerEnv = {
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-value",
  PUBLIC_SITE_URL: "http://localhost:3000",
  REVALIDATION_SECRET: "x".repeat(32),
  WORKER_ID: "test-worker",
  WORKER_POLL_INTERVAL_MS: 250,
  WORKER_HEARTBEAT_INTERVAL_MS: 1_000,
  WORKER_OFFLINE_AFTER_SECONDS: 120,
  WORKER_LEASE_SECONDS: 30,
  WORKER_MAX_ATTEMPTS: 5,
  WORKER_SHUTDOWN_TIMEOUT_MS: 1_000,
  PUBLISH_VERIFY_TIMEOUT_MS: 15_000,
  CODEX_BIN: "codex",
  CLAUDE_BIN: "claude",
  CLI_TIMEOUT_MS: 1_200_000,
  API_TIMEOUT_MS: 300_000,
  API_MAX_RESPONSE_BYTES: 16_000_000,
  OPENAI_API_MODEL: "gpt-5",
  ANTHROPIC_API_MODEL: "claude-sonnet-5",
  GEMINI_IMAGE_MODEL: "gemini-3.1-flash-image",
};

const claim: ClaimedJob = {
  jobId: "11111111-1111-4111-8111-111111111111",
  stage: "research",
  status: "RESEARCHING",
  leaseToken: "22222222-2222-4222-8222-222222222222",
  leaseExpiresAt: "2026-09-18T00:10:00.000Z",
  lockVersion: 2,
  attempt: 1,
  revisionCount: 0,
  mode: "mock",
};

class FakeStore implements WorkerStore {
  claims = 0;
  recoveries = 0;
  renewals = 0;
  completions = 0;
  manualActions = 0;
  heartbeats: Heartbeat[] = [];
  failures: StageFailure[] = [];
  available = true;
  loseLeaseOnRenew = false;

  async heartbeat(input: Heartbeat): Promise<string> {
    this.heartbeats.push(input);
    return "2026-09-18T00:00:00.000Z";
  }

  async recoverExpiredLeases(): Promise<number> {
    this.recoveries += 1;
    return 0;
  }

  async claim(
    _workerId: string,
    _leaseSeconds: number,
    stages: readonly PipelineStage[],
  ): Promise<ClaimedJob | null> {
    this.claims += 1;
    if (!this.available || !stages.includes("research")) return null;
    this.available = false;
    return claim;
  }

  async renewLease(): Promise<string> {
    this.renewals += 1;
    if (this.loseLeaseOnRenew) throw Object.assign(new Error("Lease lost"), { code: "FT003" });
    return "2026-09-18T00:20:00.000Z";
  }

  async completeStage(): Promise<ClaimedJob["status"]> {
    this.completions += 1;
    return "DRAFT_PENDING";
  }

  async requestManualAction(): Promise<ClaimedJob["status"]> {
    this.manualActions += 1;
    return "RESEARCHING";
  }

  async failStage(failure: StageFailure): Promise<ClaimedJob["status"]> {
    this.failures.push(failure);
    return failure.outcome === "needs_human"
      ? "NEEDS_HUMAN"
      : failure.outcome === "failed"
        ? "FAILED"
        : "RESEARCH_PENDING";
  }

  async status(): Promise<Json> {
    return {};
  }
}

const quietLogger = () => new StructuredLogger({}, { write() {} });

describe("WorkerRunner", () => {
  it("never claims a stage without a registered handler", async () => {
    const store = new FakeStore();
    const runner = new WorkerRunner({ env, store, logger: quietLogger() });

    await expect(runner.runOnce()).resolves.toEqual({ state: "idle" });
    expect(store.recoveries).toBe(1);
    expect(store.claims).toBe(0);
  });

  it("carries the subscription CLI probes in its heartbeat", async () => {
    const store = new FakeStore();
    const providers = { claude_code: { ready: true, version: "2.1.275" } };
    const runner = new WorkerRunner({
      env,
      store,
      logger: quietLogger(),
      providerHealth: () => providers,
    });

    await runner.runOnce();
    expect(store.heartbeats[0]?.health).toMatchObject({ state: "idle", providers });
  });

  it("lets two concurrent workers process one claim exactly once", async () => {
    const store = new FakeStore();
    let handled = 0;
    const handler = async (context: StageContext) => {
      handled += 1;
      await context.complete("RESEARCH_COMPLETE");
    };
    const first = new WorkerRunner({
      env,
      store,
      handlers: { research: handler },
      logger: quietLogger(),
    });
    const second = new WorkerRunner({
      env: { ...env, WORKER_ID: "test-worker-b" },
      store,
      handlers: { research: handler },
      logger: quietLogger(),
    });

    const results = await Promise.all([first.runOnce(), second.runOnce()]);
    expect(results.map((result) => result.state).sort()).toEqual(["completed", "idle"]);
    expect(handled).toBe(1);
    expect(store.completions).toBe(1);
  });

  it("renews the lease while a slow handler is active", async () => {
    const store = new FakeStore();
    const runner = new WorkerRunner({
      env,
      store,
      logger: quietLogger(),
      leaseRenewIntervalMs: 10,
      handlers: {
        research: async (context) => {
          await delay(35, context.signal);
          await context.complete("RESEARCH_COMPLETE");
        },
      },
    });

    await expect(runner.runOnce()).resolves.toMatchObject({ state: "completed" });
    expect(store.renewals).toBeGreaterThanOrEqual(2);
    expect(store.completions).toBe(1);
  });

  it("releases an interrupted stage into backoff on graceful shutdown", async () => {
    const store = new FakeStore();
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const controller = new AbortController();
    const runner = new WorkerRunner({
      env,
      store,
      logger: quietLogger(),
      random: () => 0.5,
      handlers: {
        research: async (context) => {
          markStarted?.();
          await delay(60_000, context.signal);
        },
      },
    });

    const running = runner.runOnce(controller.signal);
    await started;
    controller.abort(new DOMException("shutdown", "AbortError"));

    await expect(running).resolves.toMatchObject({ state: "retry_scheduled" });
    expect(store.failures).toHaveLength(1);
    expect(store.failures[0]).toMatchObject({
      outcome: "retry",
      errorClass: "transient",
      summary: "Worker shutdown interrupted the active stage",
    });
  });

  it("abandons work when renewal proves that the lease was fenced off", async () => {
    const store = new FakeStore();
    store.loseLeaseOnRenew = true;
    const runner = new WorkerRunner({
      env,
      store,
      logger: quietLogger(),
      leaseRenewIntervalMs: 5,
      handlers: { research: async (context) => delay(60_000, context.signal) },
    });

    await expect(runner.runOnce()).resolves.toMatchObject({ state: "abandoned" });
    expect(store.failures).toHaveLength(0);
    expect(store.completions).toBe(0);
  });

  it("fences duplicate settlement attempts in the worker before a second database call", async () => {
    const store = new FakeStore();
    const runner = new WorkerRunner({
      env,
      store,
      logger: quietLogger(),
      handlers: {
        research: async (context) => {
          await context.complete("RESEARCH_COMPLETE");
          await context.complete("RESEARCH_COMPLETE");
        },
      },
    });

    await expect(runner.runOnce()).resolves.toMatchObject({ state: "completed" });
    expect(store.completions).toBe(1);
    expect(store.failures).toHaveLength(0);
  });
});

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
