import type { Database } from "@/lib/supabase/database.types";
import {
  stageForStatus,
  type JobStatus,
  type PipelineStage,
} from "@/lib/state-machine/transitions";

import type { StatusTone } from "./status-display";

type Enums = Database["public"]["Enums"];

/**
 * The editor's vocabulary for a job.
 *
 * The database has 23 statuses because the worker, the queue, and the audit trail need them. An
 * editor needs six answers: is this mine to act on, is it being worked on, is it ready, when does
 * it go out, is it live, or has it stopped. Everything here is pure and derived from the exact
 * status, which stays visible under Technical details.
 */

export const EDITORIAL_STATES = [
  "needs_you",
  "in_progress",
  "ready",
  "scheduled",
  "live",
  "stopped",
] as const;

export type EditorialState = (typeof EDITORIAL_STATES)[number];

const EDITORIAL_LABELS = {
  needs_you: "Needs you",
  in_progress: "In progress",
  ready: "Ready to publish",
  scheduled: "Scheduled",
  live: "Live",
  stopped: "Stopped",
} as const satisfies Record<EditorialState, string>;

const EDITORIAL_TONES = {
  needs_you: "danger",
  in_progress: "info",
  ready: "warning",
  scheduled: "warning",
  live: "success",
  stopped: "neutral",
} as const satisfies Record<EditorialState, StatusTone>;

export type EditorialInput = Readonly<{
  status: JobStatus;
  actionRequiredKind?: Enums["action_required_kind"] | null;
  autoPublish?: boolean;
  /** The published article's status, when the job has one. */
  articleStatus?: Enums["article_status"] | null;
}>;

export function editorialState(input: EditorialInput): EditorialState {
  const { status } = input;
  if (input.articleStatus === "withdrawn") return "stopped";
  switch (status) {
    case "PUBLISHED":
    case "VERIFIED":
      return "live";
    case "PAUSED":
    case "DISCARDED":
      return "stopped";
    case "IDEA":
    case "FAILED":
    case "NEEDS_HUMAN":
      return "needs_you";
    case "APPROVED":
      // An auto-publish job is claimed by the worker on its own; nobody needs to decide.
      return input.autoPublish ? "scheduled" : "ready";
    case "SCHEDULED":
      return "scheduled";
    default:
      // A manual provider step or a CLI that needs signing in stops the pipeline on a person.
      return input.actionRequiredKind ? "needs_you" : "in_progress";
  }
}

export function editorialLabel(state: EditorialState): string {
  return EDITORIAL_LABELS[state];
}

export function editorialTone(state: EditorialState): StatusTone {
  return EDITORIAL_TONES[state];
}

// ---------------------------------------------------------------------------
// Step tracker
// ---------------------------------------------------------------------------

export const EDITORIAL_STEPS = ["research", "write", "image", "check", "publish"] as const;

export type EditorialStep = (typeof EDITORIAL_STEPS)[number];

const STEP_LABELS = {
  research: "Research",
  write: "Write",
  image: "Image",
  check: "Check",
  publish: "Publish",
} as const satisfies Record<EditorialStep, string>;

export function stepLabel(step: EditorialStep): string {
  return STEP_LABELS[step];
}

const STEP_FOR_STAGE = {
  research: "research",
  draft: "write",
  images: "image",
  audit: "check",
  revision: "check",
  publish: "publish",
  verify: "publish",
} as const satisfies Record<PipelineStage, EditorialStep>;

/** The editor's step for a pipeline stage: revision is part of Check, verification of Publish. */
export function stepForStage(stage: PipelineStage): EditorialStep {
  return STEP_FOR_STAGE[stage];
}

export type StepState = "done" | "current" | "blocked" | "upcoming" | "skipped";

export type StepTrackerInput = Readonly<{
  status: JobStatus;
  imageCount: number;
  pausedFromStatus?: JobStatus | null;
  failedStage?: PipelineStage | null;
  needsHumanStage?: PipelineStage | null;
  actionRequiredKind?: Enums["action_required_kind"] | null;
}>;

export type TrackedStep = Readonly<{ step: EditorialStep; label: string; state: StepState }>;

/**
 * Where the job is along Research → Write → Image → Check → Publish. `blocked` marks the step the
 * job stopped at when it is paused, failed, escalated, or waiting for a person. Returns an empty
 * list for a discarded job, which has no further steps.
 */
export function stepTracker(input: StepTrackerInput): readonly TrackedStep[] {
  const { status } = input;
  if (status === "DISCARDED") return [];

  let current: EditorialStep | null;
  let blocked = false;
  if (status === "IDEA") {
    current = null;
  } else if (status === "PUBLISHED" || status === "VERIFIED") {
    current = null;
  } else if (status === "APPROVED" || status === "SCHEDULED" || status === "PUBLISHING") {
    // stageForStatus files APPROVED under audit; for an editor the check is done by then.
    current = "publish";
  } else if (status === "PAUSED" || status === "FAILED" || status === "NEEDS_HUMAN") {
    const held =
      status === "PAUSED"
        ? input.pausedFromStatus
          ? heldStep(input.pausedFromStatus)
          : null
        : status === "FAILED"
          ? input.failedStage
            ? STEP_FOR_STAGE[input.failedStage]
            : null
          : input.needsHumanStage
            ? STEP_FOR_STAGE[input.needsHumanStage]
            : null;
    current = held;
    blocked = true;
  } else {
    const stage = stageForStatus(status);
    current = stage ? STEP_FOR_STAGE[stage] : null;
    blocked = Boolean(input.actionRequiredKind);
  }

  const allDone = status === "PUBLISHED" || status === "VERIFIED";
  const currentIndex = current ? EDITORIAL_STEPS.indexOf(current) : allDone ? Infinity : -1;

  return EDITORIAL_STEPS.map((step, index) => {
    let state: StepState;
    if (step === "image" && input.imageCount === 0) state = "skipped";
    else if (index < currentIndex) state = "done";
    else if (index === currentIndex) state = blocked ? "blocked" : "current";
    else state = "upcoming";
    return { step, label: STEP_LABELS[step], state };
  });
}

function heldStep(status: JobStatus): EditorialStep | null {
  if (status === "APPROVED" || status === "SCHEDULED") return "publish";
  const stage = stageForStatus(status);
  return stage ? STEP_FOR_STAGE[stage] : null;
}

// ---------------------------------------------------------------------------
// Escalation choices
// ---------------------------------------------------------------------------

const RESOLUTION_CHOICES: Partial<Record<JobStatus, string>> = {
  APPROVED: "Approve it as it is",
  REVISION_REQUIRED: "Rewrite it using the audit notes",
  RE_AUDIT_PENDING: "Check the current draft again",
  AUDIT_PENDING: "Run the check again",
  IMAGES_PENDING: "Make the image again",
  DRAFT_PENDING: "Write the draft again",
  RESEARCH_PENDING: "Start again from research",
};

/** Plain-language wording for a `resolve` destination. */
export function resolutionChoiceLabel(destination: JobStatus): string {
  return RESOLUTION_CHOICES[destination] ?? destination;
}
