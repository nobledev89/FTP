import type { WorkerEnv } from "../config/env.js";
import type { Json } from "../db/database.types.js";
import {
  type ClaimedJob,
  type Heartbeat,
  type PipelineStage,
  type WorkerStore,
} from "../db/worker-store.js";
import { StructuredLogger } from "../logging/logger.js";
import { safeSummary } from "../logging/redact.js";
import { WorkerStageError, classifyError, errorCode, failureOutcome, retryAt } from "./retry.js";

export const WORKER_VERSION = "0.1.0";

export type Settlement = "completed" | "manual_action" | "direct";

export type StageContext = {
  readonly claim: ClaimedJob;
  /** The worker identity that owns this claim. */
  readonly workerId: string;
  readonly signal: AbortSignal;
  /** The provider run this stage opened, so a failure can be linked to it. */
  readonly providerRunId: string | undefined;
  noteProviderRun(runId: string): void;
  complete(
    toStatus: ClaimedJob["status"],
    options?: { note?: string; metadata?: Json },
  ): Promise<void>;
  requestManualAction(runId: string, message: string): Promise<void>;
  /**
   * For stages whose own database function ends the lease. `publish_article` and
   * `record_verification` are the publication boundary: they transition the job themselves, so the
   * stage must not also call `complete_stage`. The lease is still settled exactly once.
   */
  settleDirectly<T>(settle: () => Promise<T>): Promise<T>;
};

export type StageHandler = (context: StageContext) => Promise<void>;
export type StageHandlers = Partial<Readonly<Record<PipelineStage, StageHandler>>>;

export type RunOnceState =
  "idle" | "completed" | "retry_scheduled" | "needs_human" | "failed" | "abandoned";

export type RunOnceResult = {
  state: RunOnceState;
  claim?: ClaimedJob;
};

type RunnerOptions = {
  env: WorkerEnv;
  store: WorkerStore;
  handlers?: StageHandlers;
  logger?: StructuredLogger;
  now?: () => Date;
  random?: () => number;
  leaseRenewIntervalMs?: number;
};

export class WorkerRunner {
  private readonly env: WorkerEnv;
  private readonly store: WorkerStore;
  private readonly handlers: StageHandlers;
  private readonly logger: StructuredLogger;
  private readonly now: () => Date;
  private readonly random: () => number;
  private readonly startedAt: string;
  private readonly leaseRenewIntervalMs: number;

  constructor(options: RunnerOptions) {
    this.env = options.env;
    this.store = options.store;
    this.handlers = options.handlers ?? {};
    this.logger =
      options.logger ??
      new StructuredLogger({ worker_id: options.env.WORKER_ID, version: WORKER_VERSION });
    this.now = options.now ?? (() => new Date());
    this.random = options.random ?? Math.random;
    this.startedAt = this.now().toISOString();
    this.leaseRenewIntervalMs =
      options.leaseRenewIntervalMs ??
      Math.max(
        1_000,
        Math.min(
          this.env.WORKER_HEARTBEAT_INTERVAL_MS,
          (this.env.WORKER_LEASE_SECONDS * 1_000) / 3,
        ),
      );
  }

  get supportedStages(): readonly PipelineStage[] {
    return (Object.keys(this.handlers) as PipelineStage[])
      .filter((stage) => typeof this.handlers[stage] === "function")
      .sort();
  }

  async runOnce(signal: AbortSignal = new AbortController().signal): Promise<RunOnceResult> {
    signal.throwIfAborted();
    await this.sendHeartbeat("idle");

    const recovered = await this.store.recoverExpiredLeases();
    if (recovered > 0) this.logger.warn("leases.recovered", { count: recovered });

    const stages = this.supportedStages;
    if (stages.length === 0) {
      this.logger.info("worker.idle", { reason: "no_registered_stage_handlers" });
      return { state: "idle" };
    }

    const claim = await this.store.claim(this.env.WORKER_ID, this.env.WORKER_LEASE_SECONDS, stages);
    if (!claim) {
      this.logger.debug("worker.idle", { reason: "queue_empty", stages });
      return { state: "idle" };
    }

    return this.processClaim(claim, signal);
  }

  async run(signal: AbortSignal): Promise<void> {
    this.logger.info("worker.started", {
      stages: this.supportedStages,
      poll_interval_ms: this.env.WORKER_POLL_INTERVAL_MS,
      lease_seconds: this.env.WORKER_LEASE_SECONDS,
    });
    try {
      while (!signal.aborted) {
        const result = await this.runOnce(signal);
        if (result.state === "idle") {
          await sleep(this.env.WORKER_POLL_INTERVAL_MS, signal);
        }
      }
    } catch (error) {
      if (!signal.aborted) throw error;
    } finally {
      await this.tryHeartbeat("stopped");
      this.logger.info("worker.stopped");
    }
  }

  private async processClaim(
    claim: ClaimedJob,
    shutdownSignal: AbortSignal,
  ): Promise<RunOnceResult> {
    const handler = this.handlers[claim.stage];
    if (!handler) {
      throw new WorkerStageError(
        `No handler registered for claimed stage ${claim.stage}`,
        "permanent_config",
      );
    }

    const log = this.logger.child({
      job_id: claim.jobId,
      stage: claim.stage,
      attempt: claim.attempt,
      mode: claim.mode,
    });
    log.info("stage.claimed", { lease_expires_at: claim.leaseExpiresAt });
    await this.tryHeartbeat("working", claim);

    const cleanup = new AbortController();
    const leaseSafety = new AbortController();
    const stageSignal = AbortSignal.any([shutdownSignal, leaseSafety.signal]);
    const context = new StoreStageContext(this.store, this.env.WORKER_ID, claim, stageSignal);

    const keepAlive = this.maintainLease(claim, cleanup.signal).catch((error: unknown) => {
      if (!isAbort(error)) leaseSafety.abort(error);
      throw error;
    });
    const work = Promise.resolve().then(() => handler(context));

    try {
      await Promise.race([work, keepAlive, rejectOnAbort(stageSignal)]);
      await work;
      if (!context.settled) {
        throw new WorkerStageError(
          `Handler for ${claim.stage} returned without completing, failing, or requesting manual input`,
          "permanent_config",
        );
      }
      log.info("stage.settled", { settlement: context.settlement });
      return { state: "completed", claim };
    } catch (rawError) {
      leaseSafety.abort(rawError);
      void work.catch((lateError: unknown) => {
        log.warn("stage.late_handler_error", { error: lateError });
      });

      if (context.settled) {
        log.warn("stage.error_after_settlement", {
          error: rawError,
          settlement: context.settlement,
        });
        return { state: "completed", claim };
      }
      if (errorCode(rawError) === "FT003") {
        log.warn("stage.lease_lost", { error: rawError });
        return { state: "abandoned", claim };
      }

      const effectiveError = shutdownSignal.aborted
        ? new WorkerStageError("Worker shutdown interrupted the active stage", "transient", {
            cause: rawError,
          })
        : rawError;
      const errorClass = classifyError(effectiveError);
      const outcome = failureOutcome(errorClass, claim.attempt, this.env.WORKER_MAX_ATTEMPTS);
      const summary = safeSummary(effectiveError);

      try {
        await this.store.failStage({
          jobId: claim.jobId,
          workerId: this.env.WORKER_ID,
          leaseToken: claim.leaseToken,
          outcome,
          errorClass,
          summary,
          ...(context.providerRunId ? { runId: context.providerRunId } : {}),
          ...(outcome === "retry"
            ? {
                retryAt: retryAt(claim.stage, claim.attempt, errorClass, this.now(), this.random),
              }
            : {}),
        });
      } catch (failureError) {
        if (errorCode(failureError) === "FT003") {
          log.warn("stage.lease_lost", { error: failureError });
          return { state: "abandoned", claim };
        }
        throw failureError;
      }

      const state = outcome === "retry" ? "retry_scheduled" : outcome;
      log.warn("stage.failed", { error_class: errorClass, outcome, summary });
      return { state, claim };
    } finally {
      cleanup.abort();
      await keepAlive.catch((error: unknown) => {
        if (!isAbort(error) && errorCode(error) !== "FT003") {
          log.warn("lease.keepalive_stopped", { error });
        }
      });
      await this.tryHeartbeat("idle");
    }
  }

  private async maintainLease(claim: ClaimedJob, signal: AbortSignal): Promise<never> {
    let lastHeartbeatAt = this.now().getTime();
    while (true) {
      await sleep(this.leaseRenewIntervalMs, signal);
      const leaseExpiresAt = await this.store.renewLease(
        claim,
        this.env.WORKER_ID,
        this.env.WORKER_LEASE_SECONDS,
      );
      this.logger.debug("lease.renewed", {
        job_id: claim.jobId,
        stage: claim.stage,
        lease_expires_at: leaseExpiresAt,
      });
      if (this.now().getTime() - lastHeartbeatAt >= this.env.WORKER_HEARTBEAT_INTERVAL_MS) {
        await this.tryHeartbeat("working", claim);
        lastHeartbeatAt = this.now().getTime();
      }
    }
  }

  private heartbeat(state: string, claim?: ClaimedJob): Heartbeat {
    return {
      workerId: this.env.WORKER_ID,
      hostLabel: this.env.WORKER_HOST_LABEL ?? this.env.WORKER_ID,
      version: WORKER_VERSION,
      startedAt: this.startedAt,
      ...(claim ? { currentJobId: claim.jobId, currentStage: claim.stage } : {}),
      health: {
        state,
        pid: process.pid,
        node: process.version,
        supported_stages: [...this.supportedStages],
      },
    };
  }

  private async sendHeartbeat(state: string, claim?: ClaimedJob): Promise<void> {
    await this.store.heartbeat(this.heartbeat(state, claim));
  }

  private async tryHeartbeat(state: string, claim?: ClaimedJob): Promise<void> {
    try {
      await this.sendHeartbeat(state, claim);
    } catch (error) {
      this.logger.warn("heartbeat.failed", { error });
    }
  }
}

class StoreStageContext implements StageContext {
  settled = false;
  settlement: Settlement | undefined;
  providerRunId: string | undefined;
  private settling = false;

  constructor(
    private readonly store: WorkerStore,
    readonly workerId: string,
    readonly claim: ClaimedJob,
    readonly signal: AbortSignal,
  ) {}

  noteProviderRun(runId: string): void {
    this.providerRunId = runId;
  }

  async settleDirectly<T>(settle: () => Promise<T>): Promise<T> {
    this.beginSettlement();
    try {
      const result = await settle();
      this.settled = true;
      this.settlement = "direct";
      return result;
    } finally {
      this.settling = false;
    }
  }

  async complete(
    toStatus: ClaimedJob["status"],
    options: { note?: string; metadata?: Json } = {},
  ): Promise<void> {
    this.beginSettlement();
    try {
      await this.store.completeStage(
        this.claim,
        this.workerId,
        toStatus,
        options.note,
        options.metadata,
      );
      this.settled = true;
      this.settlement = "completed";
    } finally {
      this.settling = false;
    }
  }

  async requestManualAction(runId: string, message: string): Promise<void> {
    this.beginSettlement();
    try {
      await this.store.requestManualAction(this.claim, this.workerId, runId, message);
      this.settled = true;
      this.settlement = "manual_action";
    } finally {
      this.settling = false;
    }
  }

  private beginSettlement(): void {
    this.signal.throwIfAborted();
    if (this.settled || this.settling) {
      throw new WorkerStageError("A stage lease may be settled exactly once", "permanent_config");
    }
    this.settling = true;
  }
}

function sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? abortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function rejectOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason ?? abortError());
    else
      signal.addEventListener("abort", () => reject(signal.reason ?? abortError()), { once: true });
  });
}

function abortError(): Error {
  return new DOMException("The operation was aborted", "AbortError");
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
