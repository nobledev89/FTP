import {
  allowedTransitionsFrom,
  isPausableStatus,
  stageForStatus,
  stageRank,
  type JobStatus,
  type PipelineStage,
} from "@/lib/state-machine/transitions";

/**
 * Which controls the article detail page offers, and where an escalation may be resolved to.
 *
 * This mirrors the guards in `admin_transition_job` so the console does not draw a button that the
 * database will refuse. The database stays authoritative: anything reachable only through an
 * artifact check (a gate, the latest audit matching the latest draft) is still offered here and
 * refused there with a specific message.
 */

export const CONTROL_KINDS = [
  "start",
  "pause",
  "resume",
  "retry",
  "escalate",
  "resolve",
  "schedule",
] as const;

export type ControlKind = (typeof CONTROL_KINDS)[number];

export type JobControlSnapshot = Readonly<{
  status: JobStatus;
  pausedFromStatus: JobStatus | null;
  failedStage: PipelineStage | null;
  needsHumanStage: PipelineStage | null;
  revisionCount: number;
  hasAudit: boolean;
  hasValidDraft: boolean;
}>;

export function availableControls(snapshot: JobControlSnapshot): readonly ControlKind[] {
  const controls: ControlKind[] = [];

  if (snapshot.status === "IDEA") controls.push("start");
  if (snapshot.status === "APPROVED") controls.push("schedule");
  if (isPausableStatus(snapshot.status)) controls.push("pause", "escalate");
  if (snapshot.status === "PAUSED" && snapshot.pausedFromStatus) controls.push("resume");
  if (snapshot.status === "FAILED" && snapshot.failedStage) controls.push("retry");
  if (snapshot.status === "NEEDS_HUMAN") controls.push("resolve");

  return controls;
}

/** Statuses `resolve` may target for this job, in pipeline order. Empty outside `NEEDS_HUMAN`. */
export function resolutionDestinations(snapshot: JobControlSnapshot): readonly JobStatus[] {
  if (snapshot.status !== "NEEDS_HUMAN") return [];

  const destinations = allowedTransitionsFrom("NEEDS_HUMAN")
    .filter((transition) => transition.path === "resolve")
    .map((transition) => transition.to);

  const escalatedAt = snapshot.needsHumanStage;

  return destinations.filter((destination) => {
    if (destination === "APPROVED") {
      // Approval is only a resolution after the article has been through an audit.
      if (!escalatedAt || !["audit", "revision", "publish"].includes(escalatedAt)) return false;
      return snapshot.hasAudit && snapshot.hasValidDraft;
    }
    // An earlier-stage escalation cannot jump forward past where it stopped.
    if (escalatedAt && ["research", "draft", "images"].includes(escalatedAt)) {
      const target = stageForStatus(destination);
      if (target && stageRank(target) > stageRank(escalatedAt)) return false;
    }
    if (destination === "REVISION_REQUIRED") {
      return snapshot.revisionCount < 2 && snapshot.hasAudit;
    }
    return true;
  });
}

export const CONTROL_LABELS = {
  start: "Start research",
  pause: "Pause",
  resume: "Resume",
  retry: "Retry failed stage",
  escalate: "Mark needs human",
  resolve: "Resolve escalation",
  schedule: "Schedule publication",
} as const satisfies Record<ControlKind, string>;
