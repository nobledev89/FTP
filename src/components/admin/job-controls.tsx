"use client";

import { useActionState, useId } from "react";

import { idleActionResult } from "@/lib/admin/action-result";
import { jobTransitionAction } from "@/lib/admin/actions";
import { resolutionChoiceLabel } from "@/lib/admin/editorial-status";
import {
  CONTROL_LABELS,
  type ControlKind,
  type JobControlSnapshot,
} from "@/lib/admin/job-controls";
import type { JobStatus } from "@/lib/state-machine/transitions";

import { Field, FormMessage, dangerButtonClass, textAreaClass } from "./form";
import {
  ActionBar,
  DiscardForm,
  PublishNowForm,
  ScheduleForm,
  type ActionPanel,
} from "./publication-controls";
import { SubmitButton } from "./submit-button";
import { WithdrawArticleForm } from "./withdraw-article-form";

/**
 * The decisions an editor can make about one job, in the order they are most likely to want them:
 * the main decision first as a filled button, then the reversible ones, then the destructive ones
 * behind a button that opens their form. The set comes from `availableControls`, which mirrors
 * `admin_transition_job`, so nothing is drawn that the database would refuse.
 *
 * `lock_version` travels with every submission, so two admins acting on the same job cannot both
 * win: the second gets "this job changed since the page was loaded" rather than silently
 * overwriting the first.
 */

type JobControlsProps = {
  jobId: string;
  lockVersion: number;
  snapshot: JobControlSnapshot;
  controls: readonly ControlKind[];
  resolutions: readonly JobStatus[];
  /** Existing schedule, as a `datetime-local` value in the publication timezone. */
  scheduledLocal: string | null;
  /** The live article, when it can still be withdrawn. */
  withdrawable: Readonly<{ slug: string }> | null;
  canEdit: boolean;
};

/** Most useful first: approving is the decision an escalated audit most often ends in. */
const RESOLUTION_ORDER: readonly JobStatus[] = [
  "APPROVED",
  "REVISION_REQUIRED",
  "RE_AUDIT_PENDING",
  "AUDIT_PENDING",
  "IMAGES_PENDING",
  "DRAFT_PENDING",
  "RESEARCH_PENDING",
];

export function JobControls({
  jobId,
  lockVersion,
  snapshot,
  controls,
  resolutions,
  scheduledLocal,
  withdrawable,
  canEdit,
}: JobControlsProps) {
  // One action state for every transition form: the result has to outlive the button that caused
  // it, and a successful transition removes that button from the panel.
  const [state, formAction] = useActionState(jobTransitionAction, idleActionResult);

  if (!canEdit) {
    return (
      <p className="text-sm text-text-muted">
        This account has read-only access, so there is nothing to decide here.
      </p>
    );
  }

  const has = (kind: ControlKind) => controls.includes(kind);
  const ref = { jobId, lockVersion };

  const panels: ActionPanel[] = [];
  if (has("schedule")) {
    panels.push({
      key: "schedule",
      label: snapshot.status === "SCHEDULED" ? "Change time" : "Schedule",
      content: <ScheduleForm {...ref} scheduledLocal={scheduledLocal} />,
    });
  }
  if (has("escalate")) {
    panels.push({
      key: "escalate",
      label: CONTROL_LABELS.escalate,
      content: <EscalateForm {...ref} formAction={formAction} />,
    });
  }
  if (has("discard")) {
    panels.push({
      key: "discard",
      label: "Discard",
      tone: "danger",
      content: <DiscardForm {...ref} />,
    });
  }
  if (withdrawable) {
    panels.push({
      key: "withdraw",
      label: "Withdraw from site",
      tone: "danger",
      content: <WithdrawArticleForm {...ref} slug={withdrawable.slug} />,
    });
  }

  const ordered = RESOLUTION_ORDER.filter((status) => resolutions.includes(status));

  return (
    <div className="grid gap-4">
      <FormMessage state={state} />
      {has("resolve") ? (
        <ResolveForm {...ref} destinations={ordered} formAction={formAction} />
      ) : null}
      {controls.length > 0 || withdrawable ? (
        <ActionBar panels={panels}>
          {has("publish_now") ? <PublishNowForm {...ref} /> : null}
          {has("start") || has("resume") || has("retry") || has("pause") ? (
            <form action={formAction} className="contents">
              <Hidden {...ref} />
              {has("start") ? (
                <SubmitButton name="action" value="start">
                  {CONTROL_LABELS.start}
                </SubmitButton>
              ) : null}
              {has("resume") ? (
                <SubmitButton name="action" value="resume">
                  {CONTROL_LABELS.resume}
                </SubmitButton>
              ) : null}
              {has("retry") ? (
                <SubmitButton name="action" value="retry">
                  {CONTROL_LABELS.retry}
                </SubmitButton>
              ) : null}
              {has("pause") ? (
                <SubmitButton name="action" value="pause" variant="secondary">
                  {CONTROL_LABELS.pause}
                </SubmitButton>
              ) : null}
            </form>
          ) : null}
        </ActionBar>
      ) : null}
    </div>
  );
}

type JobRef = Readonly<{ jobId: string; lockVersion: number }>;

/** The shared transition action, passed down so every form reports into one message. */
type FormAction = (formData: FormData) => void;

function Hidden({ jobId, lockVersion }: JobRef) {
  return (
    <>
      <input name="jobId" type="hidden" value={jobId} />
      <input name="expectedLockVersion" type="hidden" value={lockVersion} />
    </>
  );
}

function EscalateForm({ formAction, ...ref }: JobRef & { formAction: FormAction }) {
  const id = useId();
  return (
    <form action={formAction} className="grid gap-2">
      <Hidden {...ref} />
      <input name="action" type="hidden" value="mark_needs_human" />
      <p className="text-sm text-text-muted">
        Stops the pipeline and moves this article to Needs your decision, so nothing more happens
        until you choose what to do.
      </p>
      <Field
        hint="What needs looking at. At least 3 characters."
        htmlFor={`${id}-note`}
        label="Note"
        required
      >
        <textarea
          aria-describedby={`${id}-note-hint`}
          className={textAreaClass}
          id={`${id}-note`}
          minLength={3}
          name="note"
          required
          rows={2}
        />
      </Field>
      <div>
        <button className={dangerButtonClass} type="submit">
          {CONTROL_LABELS.escalate}
        </button>
      </div>
    </form>
  );
}

function ResolveForm({
  destinations,
  formAction,
  ...ref
}: JobRef & { destinations: readonly JobStatus[]; formAction: FormAction }) {
  const id = useId();

  if (destinations.length === 0) {
    return (
      <p className="text-sm text-danger">
        Nothing can continue yet: the step it stopped at has to produce its result first, or the
        article has used both automatic rewrites. Discard it, or create a new article.
      </p>
    );
  }

  return (
    <form
      action={formAction}
      className="grid gap-3 rounded-panel border border-border bg-canvas p-3"
    >
      <Hidden {...ref} />
      <input name="action" type="hidden" value="resolve" />
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-semibold">What should happen next?</legend>
        {destinations.map((destination, index) => (
          <label className="flex items-center gap-2 text-sm" key={destination}>
            <input
              className="size-4 accent-accent"
              defaultChecked={index === 0}
              name="toStatus"
              required
              type="radio"
              value={destination}
            />
            {resolutionChoiceLabel(destination)}
          </label>
        ))}
      </fieldset>
      <Field hint="Optional. Kept on the article's history." htmlFor={`${id}-note`} label="Note">
        <textarea
          aria-describedby={`${id}-note-hint`}
          className={textAreaClass}
          id={`${id}-note`}
          name="note"
          rows={2}
        />
      </Field>
      <div>
        <SubmitButton pendingLabel="Continuing…">{CONTROL_LABELS.resolve}</SubmitButton>
      </div>
    </form>
  );
}
