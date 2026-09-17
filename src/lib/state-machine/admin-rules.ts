import { WorkflowError } from "./errors";
import {
  canTransition,
  isPausableStatus,
  pendingStatusForStage,
  stageForStatus,
  type JobStatus,
  type PipelineStage,
} from "./transitions";

export type AdminAction =
  "start" | "pause" | "resume" | "retry" | "mark_needs_human" | "resolve" | "schedule";

export type AdminTransitionSnapshot = Readonly<{
  status: JobStatus;
  lockVersion: number;
  revisionCount: number;
  hasLease: boolean;
  pausedFromStatus: JobStatus | null;
  failedStage: PipelineStage | null;
  desiredPublishAt: string | null;
}>;

export type AdminTransitionIntent = Readonly<{
  action: AdminAction;
  expectedLockVersion: number;
  note?: string;
  toStatus?: JobStatus;
  desiredPublishAt?: string;
}>;

function requireNote(note: string | undefined, action: "escalation" | "resolution"): void {
  if (!note || note.trim().length < 3) {
    throw new WorkflowError(
      "INVALID_ARGUMENT",
      `${action} requires a note of at least 3 characters`,
    );
  }
}

function invalid(message: string): never {
  throw new WorkflowError("INVALID_TRANSITION", message);
}

/**
 * Performs the deterministic, artifact-independent portion of admin transition validation. Database
 * gates remain authoritative for latest artifacts, audit verdicts, schedules, and site ownership.
 */
export function planAdminTransition(
  snapshot: AdminTransitionSnapshot,
  intent: AdminTransitionIntent,
): JobStatus {
  if (snapshot.lockVersion !== intent.expectedLockVersion) {
    throw new WorkflowError(
      "STALE_JOB",
      `job changed since it was loaded (${snapshot.lockVersion} !== ${intent.expectedLockVersion})`,
    );
  }

  let destination: JobStatus | null = null;

  switch (intent.action) {
    case "start":
      if (snapshot.status !== "IDEA") invalid("only IDEA jobs can be started");
      destination = "RESEARCH_PENDING";
      break;
    case "pause": {
      if (!isPausableStatus(snapshot.status)) invalid(`${snapshot.status} jobs cannot be paused`);
      destination = "PAUSED";
      break;
    }
    case "resume":
      if (snapshot.status !== "PAUSED" || !snapshot.pausedFromStatus) {
        invalid("only PAUSED jobs with a recorded prior status can be resumed");
      }
      destination = snapshot.pausedFromStatus;
      break;
    case "retry": {
      if (snapshot.status !== "FAILED" || !snapshot.failedStage) {
        invalid("only FAILED jobs with a recorded stage can be retried");
      }
      destination =
        snapshot.failedStage === "publish" && snapshot.desiredPublishAt
          ? "SCHEDULED"
          : pendingStatusForStage(snapshot.failedStage, snapshot.revisionCount);
      if (!destination) invalid(`${snapshot.failedStage} jobs cannot be retried`);
      break;
    }
    case "mark_needs_human":
      if (!isPausableStatus(snapshot.status))
        invalid(`${snapshot.status} jobs cannot be escalated`);
      requireNote(intent.note, "escalation");
      destination = "NEEDS_HUMAN";
      break;
    case "resolve":
      if (snapshot.status !== "NEEDS_HUMAN") invalid("only NEEDS_HUMAN jobs can be resolved");
      requireNote(intent.note, "resolution");
      destination = intent.toStatus ?? null;
      if (!destination) invalid("resolution requires an explicit destination");
      break;
    case "schedule":
      if (snapshot.status !== "APPROVED") invalid("only APPROVED jobs can be scheduled");
      destination = "SCHEDULED";
      break;
  }

  if (!canTransition(snapshot.status, destination)) {
    invalid(`${snapshot.status} cannot transition to ${destination}`);
  }
  return destination;
}

/** The status retained for a pause event; interrupted active work resumes from its pending state. */
export function pausedFromStatus(snapshot: AdminTransitionSnapshot): JobStatus {
  if (!isPausableStatus(snapshot.status)) invalid(`${snapshot.status} jobs cannot be paused`);
  if (!snapshot.hasLease) return snapshot.status;
  const stage = stageForStatus(snapshot.status);
  const pending = stage ? pendingStatusForStage(stage, snapshot.revisionCount) : null;
  if (!pending) invalid(`${snapshot.status} has no resumable pending state`);
  return pending;
}
