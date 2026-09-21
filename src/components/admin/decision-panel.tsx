import type { ReactNode } from "react";

import {
  editorialLabel,
  editorialState,
  editorialTone,
  stepForStage,
  stepLabel,
  type EditorialStep,
} from "@/lib/admin/editorial-status";
import { formatDateTime, formatRelativeTime } from "@/lib/admin/format";
import type { AuditSummary, PublishedArticle } from "@/lib/admin/jobs";
import { actionRequiredLabel } from "@/lib/admin/status-display";
import { stageForStatus } from "@/lib/state-machine/transitions";
import type { ArticleJob } from "@/lib/validation/domain";

import { StatusBadge } from "./status-badge";
import { StepTracker } from "./step-tracker";

/**
 * The top of the article page: what state the article is in, in one sentence, where it is along
 * the pipeline, and the decisions available now (passed in as `children`).
 */

const DOING = {
  research: "researching the story",
  write: "writing the draft",
  image: "making the image",
  check: "checking facts, sources, and style",
  publish: "publishing",
} as const satisfies Record<EditorialStep, string>;

/**
 * Why an article the worker could have published on its own was left for the editor
 * (`article_jobs.auto_publish_hold_reason`). Each one is a decision the editor can now make.
 */
const HOLD_REASON = {
  no_image: "It has no image, and articles are not published automatically without one.",
  duplicate: "It tells a story the site has already published.",
  daily_cap: "The day's article count was already used up.",
} as const satisfies Record<NonNullable<ArticleJob["auto_publish_hold_reason"]>, string>;

type Summary = Readonly<{ headline: string; detail?: ReactNode }>;

function describe(
  job: ArticleJob,
  article: PublishedArticle | null,
  audit: AuditSummary | undefined,
  now: Date,
): Summary {
  const stage = stageForStatus(job.status);
  const step = stage ? stepForStage(stage) : null;
  const notes = audit?.findings.length ?? 0;

  if (article?.status === "withdrawn") {
    return {
      headline: "Withdrawn from the site.",
      detail: `Taken down ${formatDateTime(article.withdrawn_at)}. The reason is on the history.`,
    };
  }

  switch (job.status) {
    case "IDEA":
      return {
        headline: "Not started yet.",
        detail: "Start it and the worker researches, writes, illustrates, and checks it.",
      };
    case "APPROVED":
      if (job.auto_publish) {
        return {
          headline: "Publishing automatically.",
          detail: "The worker picks it up on its next poll, usually within a minute.",
        };
      }
      if (job.auto_publish_hold_reason) {
        return {
          headline: "Ready, but not published automatically.",
          detail: `${HOLD_REASON[job.auto_publish_hold_reason]} Read it below, then publish, schedule, or discard it.`,
        };
      }
      return {
        headline: "Ready to publish.",
        detail:
          audit?.verdict === "PASS"
            ? `The check passed${notes > 0 ? ` with ${notes} note${notes === 1 ? "" : "s"}` : ""}. Read it below, then publish, schedule, or discard it.`
            : "An editor approved it. Read it below, then publish, schedule, or discard it.",
      };
    case "SCHEDULED": {
      const at = job.desired_publish_at;
      if (!at || Date.parse(at) <= now.getTime()) {
        return {
          headline: "Going live now.",
          detail: "The worker picks it up on its next poll, usually within a minute.",
        };
      }
      return {
        headline: `Goes live ${formatDateTime(at)}.`,
        detail: `That is ${formatRelativeTime(at, now)}. Publish it now or change the time below.`,
      };
    }
    case "PUBLISHING":
      return { headline: "Going live now.", detail: "The worker is publishing it." };
    case "PUBLISHED":
      return {
        headline: "Live on the site.",
        detail: `Published ${formatDateTime(article?.published_at ?? null)}. The site is checking the live page.`,
      };
    case "VERIFIED":
      return {
        headline: "Live on the site.",
        detail: `Published ${formatDateTime(article?.published_at ?? null)}. Every check on the live page passed.`,
      };
    case "PAUSED": {
      const held = job.paused_from_status ? stageForStatus(job.paused_from_status) : null;
      return {
        headline: "Paused.",
        detail: held
          ? `Resume to continue from the ${stepLabel(stepForStage(held)).toLowerCase()} step.`
          : "Resume to continue where it stopped.",
      };
    }
    case "FAILED":
      return {
        headline: job.failed_stage
          ? `Something went wrong while ${DOING[stepForStage(job.failed_stage)]}.`
          : "Something went wrong.",
        detail: job.failure_summary ?? "Try again, or discard it.",
      };
    case "NEEDS_HUMAN":
      return {
        headline: "This article needs your decision.",
        detail: job.action_required_message ?? "Choose what should happen next.",
      };
    case "DISCARDED":
      return { headline: "Discarded.", detail: "It will never be published. Its history is kept." };
    default:
      break;
  }

  if (job.action_required_kind === "manual_input") {
    return {
      headline: `Your input is needed to finish the ${step ? stepLabel(step).toLowerCase() : "current"} step.`,
      detail: "Follow the steps in the panel below.",
    };
  }
  if (job.action_required_kind) {
    return {
      headline: `${actionRequiredLabel(job.action_required_kind)}.`,
      detail: job.action_required_message ?? undefined,
    };
  }
  if (job.status === "REVISION_REQUIRED" || job.status === "REVISING") {
    return {
      headline: "The check asked for changes. The worker is rewriting it.",
      detail: `Rewrite ${job.revision_count + (job.status === "REVISION_REQUIRED" ? 1 : 0)} of 2.`,
    };
  }
  const running = job.lease_owner !== null;
  return {
    headline: step
      ? running
        ? `The worker is ${DOING[step]}.`
        : `Waiting for the worker to start ${DOING[step]}.`
      : "In progress.",
    detail: running
      ? "Nothing to do yet. This page updates on its own."
      : job.next_attempt_at
        ? `Retrying ${formatRelativeTime(job.next_attempt_at, now)}.`
        : "If this does not change within a few minutes, check that the worker PC is on.",
  };
}

type DecisionPanelProps = {
  job: ArticleJob;
  article: PublishedArticle | null;
  latestAudit: AuditSummary | undefined;
  /** When the page was rendered, so relative times agree across the page. */
  now: Date;
  children: ReactNode;
};

export function DecisionPanel({ job, article, latestAudit, now, children }: DecisionPanelProps) {
  const state = editorialState({
    status: job.status,
    actionRequiredKind: job.action_required_kind,
    autoPublish: job.auto_publish,
    articleStatus: article?.status ?? null,
  });
  const tone = editorialTone(state);
  const summary = describe(job, article, latestAudit, now);

  const accent = {
    danger: "border-l-danger",
    warning: "border-l-warning",
    info: "border-l-info",
    success: "border-l-success",
    neutral: "border-l-neutral",
  }[tone];

  return (
    <section
      aria-labelledby="decision-heading"
      className={`rounded-panel border border-l-4 border-border bg-panel ${accent}`}
    >
      <div className="grid gap-4 p-4 lg:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid min-w-0 gap-1.5">
            <div>
              <StatusBadge tone={tone}>{editorialLabel(state)}</StatusBadge>
            </div>
            <h2 className="text-lg font-semibold tracking-tight" id="decision-heading">
              {summary.headline}
            </h2>
            {summary.detail ? (
              <p className="max-w-3xl text-sm text-text-muted">{summary.detail}</p>
            ) : null}
          </div>
          {article && article.status !== "withdrawn" ? (
            <a
              className="text-sm font-medium text-accent hover:underline"
              href={article.canonical_url}
              rel="noreferrer"
              target="_blank"
            >
              View on site ↗
            </a>
          ) : null}
        </div>
        <StepTracker
          actionRequiredKind={job.action_required_kind}
          failedStage={job.failed_stage}
          imageCount={job.image_count}
          needsHumanStage={job.needs_human_stage}
          pausedFromStatus={job.paused_from_status}
          status={job.status}
        />
        {children}
      </div>
    </section>
  );
}
