import {
  JOB_STATUSES,
  PIPELINE_STAGES,
  stageForStatus,
  type JobStatus,
  type PipelineStage,
} from "@/lib/state-machine/transitions";

/**
 * Queue filters, parsed from the URL so a filtered view is linkable and the server does the
 * filtering (plan section 12). Everything here is pure and unit tested: an unparseable filter is
 * dropped rather than passed to the database.
 */

export type JobGroup = "all" | "open" | "action_required" | "blocked" | "scheduled" | "published";

export type JobFilters = Readonly<{
  group: JobGroup;
  statuses: readonly JobStatus[];
  stage: PipelineStage | null;
  search: string;
}>;

export const DEFAULT_FILTERS: JobFilters = {
  group: "all",
  statuses: [],
  stage: null,
  search: "",
};

const GROUPS: readonly JobGroup[] = [
  "all",
  "open",
  "action_required",
  "blocked",
  "scheduled",
  "published",
];

export const GROUP_LABELS: Readonly<Record<JobGroup, string>> = {
  all: "All",
  open: "In the pipeline",
  action_required: "Awaiting input",
  blocked: "Failed or escalated",
  scheduled: "Approved and scheduled",
  published: "Published",
};

const TERMINAL_STATUSES: readonly JobStatus[] = ["PUBLISHED", "VERIFIED"];

/** Statuses a group expands to. `action_required` is a column, not a status, so it stays empty. */
const GROUP_STATUSES: Readonly<Record<JobGroup, readonly JobStatus[]>> = {
  all: [],
  open: JOB_STATUSES.filter(
    (status) => !TERMINAL_STATUSES.includes(status) && status !== "FAILED" && status !== "PAUSED",
  ),
  action_required: [],
  blocked: ["FAILED", "NEEDS_HUMAN"],
  scheduled: ["APPROVED", "SCHEDULED"],
  published: TERMINAL_STATUSES,
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Keeps only characters that can appear in a topic. This is what makes the `ilike` pattern safe:
 * PostgREST splits filter values on commas and treats `%` and `_` as wildcards, and none of those
 * survive here.
 */
export function sanitizeSearch(value: string | string[] | undefined): string {
  const raw = first(value);
  if (typeof raw !== "string") return "";
  return raw
    .replace(/[^\p{L}\p{N} '\-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export function parseJobFilters(
  searchParams: Readonly<Record<string, string | string[] | undefined>>,
): JobFilters {
  const groupParam = first(searchParams.group);
  const group: JobGroup =
    groupParam && (GROUPS as readonly string[]).includes(groupParam)
      ? (groupParam as JobGroup)
      : "all";

  const statusParam = first(searchParams.status);
  const explicitStatuses = (statusParam ?? "")
    .split(",")
    .map((entry) => entry.trim().toUpperCase())
    .filter((entry): entry is JobStatus => (JOB_STATUSES as readonly string[]).includes(entry));

  const stageParam = first(searchParams.stage);
  const stage =
    stageParam && (PIPELINE_STAGES as readonly string[]).includes(stageParam)
      ? (stageParam as PipelineStage)
      : null;

  return {
    group,
    statuses: explicitStatuses.length > 0 ? explicitStatuses : GROUP_STATUSES[group],
    stage,
    search: sanitizeSearch(searchParams.q),
  };
}

/** The statuses that belong to a stage, derived from the same map the worker and database use. */
export function statusesForStage(stage: PipelineStage): readonly JobStatus[] {
  return JOB_STATUSES.filter((status) => stageForStatus(status) === stage);
}

/**
 * Resolves filters to the status set to send to the database, or null for "no status restriction".
 * A stage filter intersects with the status filter rather than replacing it, so `open` + `audit`
 * means "in the pipeline, at the audit stage" and an empty intersection returns no rows.
 */
export function effectiveStatuses(filters: JobFilters): readonly JobStatus[] | null {
  const byStage = filters.stage ? statusesForStage(filters.stage) : null;
  if (filters.statuses.length === 0) return byStage;
  if (!byStage) return filters.statuses;
  return filters.statuses.filter((status) => byStage.includes(status));
}

export function requiresAction(filters: JobFilters): boolean {
  return filters.group === "action_required";
}

/** The filter part of a query string, for pagination links and tab links. */
export function filterParams(filters: JobFilters): Readonly<Record<string, string | undefined>> {
  return {
    group: filters.group === "all" ? undefined : filters.group,
    stage: filters.stage ?? undefined,
    q: filters.search === "" ? undefined : filters.search,
  };
}
