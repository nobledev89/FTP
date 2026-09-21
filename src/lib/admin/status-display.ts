import type { Database } from "@/lib/supabase/database.types";
import type { JobStatus, PipelineStage } from "@/lib/state-machine/transitions";

type Enums = Database["public"]["Enums"];

/**
 * Presentation vocabulary for the admin console.
 *
 * Every mapping is exhaustive over the database enum, so adding a status or provider mode is a
 * type error here rather than an unlabelled badge in production. Colour only ever reinforces a text
 * label (docs/DESIGN-SYSTEM.md section 10).
 */

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

/** `neutral` = queued or idle, `info` = a worker is on it, `warning` = waiting on time or a person. */
const JOB_STATUS_TONES = {
  IDEA: "neutral",
  RESEARCH_PENDING: "neutral",
  RESEARCHING: "info",
  RESEARCH_COMPLETE: "info",
  DRAFT_PENDING: "neutral",
  DRAFTING: "info",
  DRAFT_COMPLETE: "info",
  IMAGES_PENDING: "neutral",
  IMAGES_PROCESSING: "info",
  AUDIT_PENDING: "neutral",
  AUDITING: "info",
  REVISION_REQUIRED: "warning",
  REVISING: "info",
  RE_AUDIT_PENDING: "neutral",
  APPROVED: "warning",
  SCHEDULED: "warning",
  PUBLISHING: "info",
  PUBLISHED: "success",
  VERIFIED: "success",
  PAUSED: "neutral",
  FAILED: "danger",
  NEEDS_HUMAN: "danger",
} as const satisfies Record<JobStatus, StatusTone>;

const JOB_STATUS_MEANINGS = {
  IDEA: "Created but not started. Start it to enter the research queue.",
  RESEARCH_PENDING: "Waiting for the worker to claim the research stage.",
  RESEARCHING: "The worker is running the research provider.",
  RESEARCH_COMPLETE: "A research packet was stored and validated.",
  DRAFT_PENDING: "Waiting for the worker to claim the writing stage.",
  DRAFTING: "The worker is running the writing provider.",
  DRAFT_COMPLETE: "A draft version was stored and validated.",
  IMAGES_PENDING: "Waiting for the worker to claim the image stage.",
  IMAGES_PROCESSING: "The worker is preparing or importing images.",
  AUDIT_PENDING: "Waiting for the worker to claim the first audit.",
  AUDITING: "The worker is running the audit provider.",
  REVISION_REQUIRED: "The audit asked for changes. A revision cycle is queued.",
  REVISING: "The worker is applying the audit findings to a new draft version.",
  RE_AUDIT_PENDING: "Waiting for the worker to re-audit the revised draft.",
  APPROVED: "Cleared for publication. Schedule it, or let auto-publish take it.",
  SCHEDULED: "Publication is waiting for the scheduled time to arrive.",
  PUBLISHING: "The worker is writing the article and warming the public page.",
  PUBLISHED: "Live on the publication. Post-publish verification is pending.",
  VERIFIED: "Live and every post-publish check passed.",
  PAUSED: "Held by an admin. Resume returns it to where it stopped.",
  FAILED: "Attempts were exhausted. Retry restarts the failed stage.",
  NEEDS_HUMAN: "Escalated. Resolve it to an explicit destination with a note.",
} as const satisfies Record<JobStatus, string>;

const STAGE_LABELS = {
  research: "Research",
  draft: "Writing",
  images: "Images",
  audit: "Audit",
  revision: "Revision",
  publish: "Publish",
  verify: "Verify",
} as const satisfies Record<PipelineStage, string>;

const PROVIDER_MODE_LABELS = {
  mock: "Mock",
  manual_chatgpt: "Manual ChatGPT",
  codex_cli: "Codex CLI",
  openai_api: "OpenAI API",
  claude_code: "Claude Code",
  manual_claude: "Manual Claude",
  anthropic_api: "Anthropic API",
  manual_gemini: "Manual Gemini",
  codex_image: "ChatGPT images (Codex)",
  gemini_api: "Gemini API",
  internal: "Internal",
} as const satisfies Record<Enums["provider_mode"], string>;

/** API modes are metered by the provider; the console always says so before they are used. */
const BILLABLE_MODES: readonly Enums["provider_mode"][] = [
  "openai_api",
  "anthropic_api",
  "gemini_api",
];

const ACTION_REQUIRED_LABELS = {
  manual_input: "Manual input needed",
  cli_auth: "CLI sign-in needed",
  usage_limit: "Provider usage limit",
  invalid_output: "Provider output rejected",
  editorial_review: "Editorial review",
  publish_conflict: "Publication conflict",
  verification_failed: "Verification failed",
} as const satisfies Record<Enums["action_required_kind"], string>;

const ARTICLE_STATUS_TONES = {
  published: "success",
  verified: "success",
  withdrawn: "neutral",
} as const satisfies Record<Enums["article_status"], StatusTone>;

const RUN_STATUS_TONES = {
  running: "info",
  action_required: "warning",
  succeeded: "success",
  failed: "danger",
  cancelled: "neutral",
} as const satisfies Record<Enums["run_status"], StatusTone>;

const LOG_OUTCOME_TONES = {
  succeeded: "success",
  failed: "danger",
  skipped: "neutral",
} as const satisfies Record<Enums["log_outcome"], StatusTone>;

const ERROR_CLASS_LABELS = {
  transient: "Transient",
  rate_limit: "Rate limited",
  usage_limit: "Usage limit",
  auth: "Authentication",
  invalid_output: "Invalid output",
  permanent_config: "Configuration",
  unknown: "Unknown",
} as const satisfies Record<Enums["error_class"], string>;

const ARTICLE_TYPE_LABELS = {
  news: "News",
  analysis: "Analysis",
  explainer: "Explainer",
  guide: "Guide",
  company: "Company",
  interview: "Interview",
} as const satisfies Record<Enums["article_type"], string>;

const WORKER_STATE_TONES = {
  online: "success",
  stale: "warning",
  offline: "danger",
} as const satisfies Record<WorkerState, StatusTone>;

export type WorkerState = "online" | "stale" | "offline";

export function jobStatusTone(status: JobStatus): StatusTone {
  return JOB_STATUS_TONES[status];
}

export function jobStatusMeaning(status: JobStatus): string {
  return JOB_STATUS_MEANINGS[status];
}

export function stageLabel(stage: PipelineStage): string {
  return STAGE_LABELS[stage];
}

export function providerModeLabel(mode: Enums["provider_mode"]): string {
  return PROVIDER_MODE_LABELS[mode];
}

export function isBillableMode(mode: Enums["provider_mode"]): boolean {
  return BILLABLE_MODES.includes(mode);
}

export function actionRequiredLabel(kind: Enums["action_required_kind"]): string {
  return ACTION_REQUIRED_LABELS[kind];
}

export function articleStatusTone(status: Enums["article_status"]): StatusTone {
  return ARTICLE_STATUS_TONES[status];
}

export function runStatusTone(status: Enums["run_status"]): StatusTone {
  return RUN_STATUS_TONES[status];
}

export function logOutcomeTone(outcome: Enums["log_outcome"]): StatusTone {
  return LOG_OUTCOME_TONES[outcome];
}

export function errorClassLabel(errorClass: Enums["error_class"]): string {
  return ERROR_CLASS_LABELS[errorClass];
}

export function articleTypeLabel(type: Enums["article_type"]): string {
  return ARTICLE_TYPE_LABELS[type];
}

export function workerStateTone(state: WorkerState): StatusTone {
  return WORKER_STATE_TONES[state];
}

/** Short job identifier for dense tables. Full ids stay available as link targets and titles. */
export function shortId(id: string): string {
  return id.slice(0, 8);
}
