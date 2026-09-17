import type { Database } from "../db/database.types.js";

export type ErrorClass = Database["public"]["Enums"]["error_class"];
export type PipelineStage = Database["public"]["Enums"]["pipeline_stage"];
export type FailureOutcome = "retry" | "failed" | "needs_human";

const STAGE_BACKOFF: Readonly<Record<PipelineStage, { baseMs: number; capMs: number }>> = {
  research: { baseMs: 5_000, capMs: 15 * 60_000 },
  draft: { baseMs: 5_000, capMs: 15 * 60_000 },
  images: { baseMs: 15_000, capMs: 30 * 60_000 },
  audit: { baseMs: 5_000, capMs: 15 * 60_000 },
  revision: { baseMs: 5_000, capMs: 15 * 60_000 },
  publish: { baseMs: 10_000, capMs: 5 * 60_000 },
  verify: { baseMs: 30_000, capMs: 10 * 60_000 },
};

export class WorkerStageError extends Error {
  constructor(
    message: string,
    readonly errorClass: ErrorClass,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WorkerStageError";
  }
}

export function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export function classifyError(error: unknown): ErrorClass {
  if (error instanceof WorkerStageError) return error.errorClass;

  const code = errorCode(error)?.toUpperCase();
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (code === "429" || code === "PGRST003" || /rate[ -]?limit|too many requests/.test(message)) {
    return "rate_limit";
  }
  if (/usage limit|quota exhausted|insufficient credits|billing limit/.test(message)) {
    return "usage_limit";
  }
  if (
    code === "401" ||
    code === "403" ||
    /not logged in|login required|authentication|unauthori[sz]ed|expired credential/.test(message)
  ) {
    return "auth";
  }
  if (/invalid (?:json|output|schema)|schema validation|malformed output/.test(message)) {
    return "invalid_output";
  }
  if (
    /missing configuration|unsupported provider|not configured|invalid worker configuration/.test(
      message,
    )
  ) {
    return "permanent_config";
  }
  if (
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "EAI_AGAIN" ||
    /fetch failed|network|socket|timed? out|temporar/.test(message) ||
    (error instanceof Error && error.name === "AbortError")
  ) {
    return "transient";
  }
  return "unknown";
}

export function failureOutcome(
  errorClass: ErrorClass,
  attempt: number,
  maximumAttempts: number,
): FailureOutcome {
  if (errorClass === "auth" || errorClass === "usage_limit" || errorClass === "invalid_output") {
    return "needs_human";
  }
  if (errorClass === "permanent_config" || attempt >= maximumAttempts) return "failed";
  return "retry";
}

export function retryDelayMs(
  stage: PipelineStage,
  attempt: number,
  errorClass: ErrorClass,
  random: () => number = Math.random,
): number {
  const policy = STAGE_BACKOFF[stage];
  const rateMultiplier = errorClass === "rate_limit" ? 6 : 1;
  const exponential = policy.baseMs * rateMultiplier * 2 ** Math.max(0, attempt - 1);
  const jitter = 0.75 + Math.min(1, Math.max(0, random())) * 0.5;
  return Math.round(Math.min(policy.capMs, exponential * jitter));
}

export function retryAt(
  stage: PipelineStage,
  attempt: number,
  errorClass: ErrorClass,
  now: Date = new Date(),
  random: () => number = Math.random,
): string {
  return new Date(now.getTime() + retryDelayMs(stage, attempt, errorClass, random)).toISOString();
}
