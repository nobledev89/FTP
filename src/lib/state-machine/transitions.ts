import type { Database } from "@/lib/supabase/database.types";

type Enums = Database["public"]["Enums"];

export type JobStatus = Enums["job_status"];
export type PipelineStage = Enums["pipeline_stage"];
export type TransitionPath =
  "normal" | "pause" | "resume" | "failure" | "escalate" | "resolve" | "retry" | "recovery";

export type JobTransition = Readonly<{
  from: JobStatus;
  to: JobStatus;
  path: TransitionPath;
}>;

export const JOB_STATUSES = [
  "IDEA",
  "RESEARCH_PENDING",
  "RESEARCHING",
  "RESEARCH_COMPLETE",
  "DRAFT_PENDING",
  "DRAFTING",
  "DRAFT_COMPLETE",
  "IMAGES_PENDING",
  "IMAGES_PROCESSING",
  "AUDIT_PENDING",
  "AUDITING",
  "REVISION_REQUIRED",
  "REVISING",
  "RE_AUDIT_PENDING",
  "APPROVED",
  "SCHEDULED",
  "PUBLISHING",
  "PUBLISHED",
  "VERIFIED",
  "PAUSED",
  "FAILED",
  "NEEDS_HUMAN",
] as const satisfies readonly JobStatus[];

export const PIPELINE_STAGES = [
  "research",
  "draft",
  "images",
  "audit",
  "revision",
  "publish",
  "verify",
] as const satisfies readonly PipelineStage[];

export const ACTIVE_STATUSES = [
  "RESEARCHING",
  "DRAFTING",
  "IMAGES_PROCESSING",
  "AUDITING",
  "REVISING",
  "PUBLISHING",
] as const satisfies readonly JobStatus[];

export const PAUSABLE_STATUSES = [
  "IDEA",
  "RESEARCH_PENDING",
  "RESEARCHING",
  "RESEARCH_COMPLETE",
  "DRAFT_PENDING",
  "DRAFTING",
  "DRAFT_COMPLETE",
  "IMAGES_PENDING",
  "IMAGES_PROCESSING",
  "AUDIT_PENDING",
  "AUDITING",
  "REVISION_REQUIRED",
  "REVISING",
  "RE_AUDIT_PENDING",
  "APPROVED",
  "SCHEDULED",
] as const satisfies readonly JobStatus[];

const NORMAL_TRANSITIONS = [
  ["IDEA", "RESEARCH_PENDING"],
  ["RESEARCH_PENDING", "RESEARCHING"],
  ["RESEARCHING", "RESEARCH_COMPLETE"],
  ["RESEARCH_COMPLETE", "DRAFT_PENDING"],
  ["DRAFT_PENDING", "DRAFTING"],
  ["DRAFTING", "DRAFT_COMPLETE"],
  ["DRAFT_COMPLETE", "IMAGES_PENDING"],
  ["DRAFT_COMPLETE", "AUDIT_PENDING"],
  ["IMAGES_PENDING", "IMAGES_PROCESSING"],
  ["IMAGES_PROCESSING", "AUDIT_PENDING"],
  ["AUDIT_PENDING", "AUDITING"],
  ["AUDITING", "APPROVED"],
  ["AUDITING", "REVISION_REQUIRED"],
  ["AUDITING", "NEEDS_HUMAN"],
  ["REVISION_REQUIRED", "REVISING"],
  ["REVISING", "RE_AUDIT_PENDING"],
  ["RE_AUDIT_PENDING", "AUDITING"],
  ["APPROVED", "SCHEDULED"],
  ["APPROVED", "PUBLISHING"],
  ["SCHEDULED", "PUBLISHING"],
  ["PUBLISHING", "PUBLISHED"],
  ["PUBLISHED", "VERIFIED"],
] as const satisfies readonly (readonly [JobStatus, JobStatus])[];

const RETRY_DESTINATIONS = [
  "RESEARCH_PENDING",
  "DRAFT_PENDING",
  "IMAGES_PENDING",
  "AUDIT_PENDING",
  "RE_AUDIT_PENDING",
  "REVISION_REQUIRED",
  "APPROVED",
  "SCHEDULED",
] as const satisfies readonly JobStatus[];

const RESOLUTION_DESTINATIONS = [
  "RESEARCH_PENDING",
  "DRAFT_PENDING",
  "IMAGES_PENDING",
  "AUDIT_PENDING",
  "RE_AUDIT_PENDING",
  "REVISION_REQUIRED",
  "APPROVED",
] as const satisfies readonly JobStatus[];

const RECOVERY_TRANSITIONS = [
  ["RESEARCHING", "RESEARCH_PENDING"],
  ["DRAFTING", "DRAFT_PENDING"],
  ["IMAGES_PROCESSING", "IMAGES_PENDING"],
  ["AUDITING", "AUDIT_PENDING"],
  ["AUDITING", "RE_AUDIT_PENDING"],
  ["REVISING", "REVISION_REQUIRED"],
  ["PUBLISHING", "SCHEDULED"],
  ["PUBLISHING", "APPROVED"],
] as const satisfies readonly (readonly [JobStatus, JobStatus])[];

function transitionKey(from: JobStatus, to: JobStatus): string {
  return `${from}>${to}`;
}

/**
 * Build in migration order and keep the first duplicate, matching PostgreSQL's `on conflict do
 * nothing`. In particular, AUDITING -> NEEDS_HUMAN is the normal audit outcome, not an escalation.
 */
function buildTransitions(): readonly JobTransition[] {
  const rows = new Map<string, JobTransition>();
  const add = (from: JobStatus, to: JobStatus, path: TransitionPath) => {
    const key = transitionKey(from, to);
    if (!rows.has(key)) {
      rows.set(key, Object.freeze({ from, to, path }));
    }
  };

  for (const [from, to] of NORMAL_TRANSITIONS) add(from, to, "normal");
  for (const status of PAUSABLE_STATUSES) add(status, "PAUSED", "pause");
  for (const status of PAUSABLE_STATUSES) add("PAUSED", status, "resume");
  for (const status of ACTIVE_STATUSES) add(status, "FAILED", "failure");
  for (const status of RETRY_DESTINATIONS) add("FAILED", status, "retry");
  for (const status of [...PAUSABLE_STATUSES, "PUBLISHING"] as const) {
    add(status, "NEEDS_HUMAN", "escalate");
  }
  for (const status of RESOLUTION_DESTINATIONS) add("NEEDS_HUMAN", status, "resolve");
  for (const [from, to] of RECOVERY_TRANSITIONS) add(from, to, "recovery");

  return Object.freeze([...rows.values()]);
}

export const JOB_TRANSITIONS = buildTransitions();

const transitionByPair = new Map(
  JOB_TRANSITIONS.map((transition) => [transitionKey(transition.from, transition.to), transition]),
);

export function transitionFor(from: JobStatus, to: JobStatus): JobTransition | undefined {
  return transitionByPair.get(transitionKey(from, to));
}

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return transitionFor(from, to) !== undefined;
}

export function allowedTransitionsFrom(status: JobStatus): readonly JobTransition[] {
  return JOB_TRANSITIONS.filter((transition) => transition.from === status);
}

export function isActiveStatus(status: JobStatus): boolean {
  return (ACTIVE_STATUSES as readonly JobStatus[]).includes(status);
}

export function isPausableStatus(status: JobStatus): boolean {
  return (PAUSABLE_STATUSES as readonly JobStatus[]).includes(status);
}

export function stageForStatus(status: JobStatus): PipelineStage | null {
  if (["IDEA", "RESEARCH_PENDING", "RESEARCHING", "RESEARCH_COMPLETE"].includes(status)) {
    return "research";
  }
  if (["DRAFT_PENDING", "DRAFTING", "DRAFT_COMPLETE"].includes(status)) return "draft";
  if (["IMAGES_PENDING", "IMAGES_PROCESSING"].includes(status)) return "images";
  if (["AUDIT_PENDING", "AUDITING", "RE_AUDIT_PENDING", "APPROVED"].includes(status)) {
    return "audit";
  }
  if (["REVISION_REQUIRED", "REVISING"].includes(status)) return "revision";
  if (["SCHEDULED", "PUBLISHING"].includes(status)) return "publish";
  if (["PUBLISHED", "VERIFIED"].includes(status)) return "verify";
  return null;
}

export function pendingStatusForStage(
  stage: PipelineStage,
  revisionCount: number,
): JobStatus | null {
  switch (stage) {
    case "research":
      return "RESEARCH_PENDING";
    case "draft":
      return "DRAFT_PENDING";
    case "images":
      return "IMAGES_PENDING";
    case "audit":
      return revisionCount > 0 ? "RE_AUDIT_PENDING" : "AUDIT_PENDING";
    case "revision":
      return "REVISION_REQUIRED";
    case "publish":
      return "APPROVED";
    case "verify":
      return null;
  }
}
