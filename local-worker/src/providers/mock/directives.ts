import type { PipelineStage } from "../contract.js";

/**
 * Mock providers are configured from the job's own keywords, so an operator can drive a branch from
 * the admin console without a code change or an environment variable.
 *
 * A directive changes what the *provider* returns. It never changes the queue, the state machine,
 * or the publication boundary: a mock job that fails does so by throwing where a real adapter would
 * throw, and the same `fail_stage` path classifies and retries it.
 *
 *   mock:audit=pass|revision|needs_human   verdict of the first audit (default: pass)
 *   mock:fail=<stage>                      that stage throws once, then succeeds (controlled retry)
 *   mock:fail-always=<stage>               that stage throws on every attempt (exhausts retries)
 *   mock:manual=<stage>                    that stage asks for manual input instead of completing
 *   mock:slow=<milliseconds>               every stage waits, for lease and heartbeat testing
 */

export type MockAuditPlan = "pass" | "revision" | "needs_human";

export type MockDirectives = Readonly<{
  auditPlan: MockAuditPlan;
  failOnce: ReadonlySet<PipelineStage>;
  failAlways: ReadonlySet<PipelineStage>;
  manual: ReadonlySet<PipelineStage>;
  delayMs: number;
}>;

const STAGES: readonly PipelineStage[] = [
  "research",
  "draft",
  "images",
  "audit",
  "revision",
  "publish",
  "verify",
];

const AUDIT_PLANS: readonly MockAuditPlan[] = ["pass", "revision", "needs_human"];

const MAXIMUM_DELAY_MS = 120_000;

function isStage(value: string): value is PipelineStage {
  return (STAGES as readonly string[]).includes(value);
}

function isAuditPlan(value: string): value is MockAuditPlan {
  return (AUDIT_PLANS as readonly string[]).includes(value);
}

export const DEFAULT_DIRECTIVES: MockDirectives = Object.freeze({
  auditPlan: "pass",
  failOnce: new Set<PipelineStage>(),
  failAlways: new Set<PipelineStage>(),
  manual: new Set<PipelineStage>(),
  delayMs: 0,
});

/**
 * Reads directives from a job's keywords. An unrecognised `mock:` keyword is ignored rather than
 * rejected: keywords are free text an editor types, and a typo must not fail a job.
 */
export function parseDirectives(keywords: readonly string[]): MockDirectives {
  let auditPlan: MockAuditPlan = "pass";
  const failOnce = new Set<PipelineStage>();
  const failAlways = new Set<PipelineStage>();
  const manual = new Set<PipelineStage>();
  let delayMs = 0;

  for (const keyword of keywords) {
    const match = /^mock:([a-z-]+)=(.+)$/.exec(keyword.trim().toLowerCase());
    if (!match) continue;
    const [, name, rawValue] = match;
    const value = (rawValue ?? "").trim();

    switch (name) {
      case "audit":
        if (isAuditPlan(value)) auditPlan = value;
        break;
      case "fail":
        if (isStage(value)) failOnce.add(value);
        break;
      case "fail-always":
        if (isStage(value)) failAlways.add(value);
        break;
      case "manual":
        if (isStage(value)) manual.add(value);
        break;
      case "slow": {
        const milliseconds = Number.parseInt(value, 10);
        if (Number.isInteger(milliseconds) && milliseconds > 0) {
          delayMs = Math.min(milliseconds, MAXIMUM_DELAY_MS);
        }
        break;
      }
      default:
        break;
    }
  }

  return Object.freeze({ auditPlan, failOnce, failAlways, manual, delayMs });
}

/** True when this attempt of `stage` should throw. */
export function shouldFail(
  directives: MockDirectives,
  stage: PipelineStage,
  attempt: number,
): boolean {
  if (directives.failAlways.has(stage)) return true;
  return directives.failOnce.has(stage) && attempt <= 1;
}

/** The audit verdict for a given revision cycle. A revision plan converges on the second cycle. */
export function verdictForCycle(
  directives: MockDirectives,
  cycle: number,
): "PASS" | "REVISION_REQUIRED" | "NEEDS_HUMAN" {
  if (directives.auditPlan === "needs_human") return "NEEDS_HUMAN";
  if (directives.auditPlan === "revision" && cycle === 0) return "REVISION_REQUIRED";
  return "PASS";
}
