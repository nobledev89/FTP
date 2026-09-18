import type { Database } from "../../db/database.types.js";
import type { PipelineStage, PreparedRun, RawRunResult, RunContext } from "../contract.js";

import { parseDirectives, shouldFail, type MockDirectives } from "./directives.js";

type ErrorClass = Database["public"]["Enums"]["error_class"];

/**
 * A failure raised by a mock provider. It carries the same classification a real adapter would
 * attach, so the queue's retry, escalation, and failure paths are exercised unchanged.
 */
export class MockStageError extends Error {
  constructor(
    message: string,
    readonly errorClass: ErrorClass,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MockStageError";
  }
}

/** Marks text produced by a simulated provider wherever that text can reach a reader. */
export function mockNote(): string {
  return "Produced by the mock provider for pipeline testing; it contains no verified reporting.";
}

export function mockDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    function onAbort() {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("The operation was aborted", "AbortError"));
    }
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * The behaviour every mock `execute` shares: honour `mock:slow`, then `mock:fail`/`mock:fail-always`
 * by throwing where a real provider would, then `mock:manual` by asking for operator input.
 *
 * Returns a manual-action result when one is requested, or null to continue with real output.
 */
export async function runDirectives(
  stage: PipelineStage,
  request: Readonly<{ prepared: PreparedRun; context: RunContext; signal: AbortSignal }>,
): Promise<RawRunResult | null> {
  const { context, signal, prepared } = request;
  const directives: MockDirectives = parseDirectives(context.brief.keywords);
  signal.throwIfAborted();
  await mockDelay(directives.delayMs, signal);

  if (shouldFail(directives, stage, context.attempt)) {
    const persistent = directives.failAlways.has(stage);
    throw new MockStageError(
      `Simulated ${stage} provider failure (mock:${persistent ? "fail-always" : "fail"} directive)`,
      "transient",
    );
  }

  if (directives.manual.has(stage)) {
    return {
      kind: "manual_action",
      message:
        `The ${stage} stage is configured for manual input by a mock:manual directive. ` +
        `Paste the ${prepared.schemaVersion} response into the run panel to continue.`,
    };
  }

  return null;
}
