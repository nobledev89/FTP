"use client";

import { useActionState, useId, useState, type ReactNode } from "react";

import { idleActionResult, type ActionResult } from "@/lib/admin/action-result";
import { discardJobAction, publishNowAction, schedulePublicationAction } from "@/lib/admin/actions";
import { siteConfig } from "@/lib/site/config";

import {
  CheckboxField,
  Field,
  FormMessage,
  controlClass,
  dangerButtonClass,
  secondaryButtonClass,
  textAreaClass,
} from "./form";
import { SubmitButton } from "./submit-button";

/**
 * The editor's publishing decisions, shared by the article page and the dashboard cards. Every
 * form carries the `lock_version` it was drawn with, so acting on a stale card is refused rather
 * than overwriting someone else's decision. Ids come from `useId` because a dashboard renders one
 * set per card.
 */

type JobRef = Readonly<{ jobId: string; lockVersion: number }>;

/** The idle state is an empty success, so a result region is only worth laying out once filled. */
function hasMessage(state: ActionResult): boolean {
  return state.ok ? state.message.length > 0 : true;
}

function Hidden({ jobId, lockVersion }: JobRef) {
  return (
    <>
      <input name="jobId" type="hidden" value={jobId} />
      <input name="expectedLockVersion" type="hidden" value={lockVersion} />
    </>
  );
}

export function PublishNowForm({ jobId, lockVersion }: JobRef) {
  const [state, action] = useActionState(publishNowAction, idleActionResult);
  return (
    <form action={action} className="contents">
      <Hidden jobId={jobId} lockVersion={lockVersion} />
      <SubmitButton pendingLabel="Publishing…">Publish now</SubmitButton>
      {hasMessage(state) ? (
        <div className="basis-full">
          <FormMessage state={state} />
        </div>
      ) : null}
    </form>
  );
}

export type ActionPanel = Readonly<{
  key: string;
  label: string;
  tone?: "secondary" | "danger";
  content: ReactNode;
}>;

/**
 * A row of decision buttons. `children` are immediate actions (Publish now, Resume); each panel is
 * a button that opens a small form beneath the whole row, one at a time, so a destructive form is
 * never on screen until it is asked for.
 */
export function ActionBar({
  children,
  panels = [],
}: {
  children?: ReactNode;
  panels?: readonly ActionPanel[];
}) {
  const [open, setOpen] = useState<string | null>(null);
  const baseId = useId();
  const active = panels.find((panel) => panel.key === open);

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {children}
        {panels.map((panel) => {
          const expanded = open === panel.key;
          return (
            <button
              aria-controls={`${baseId}-${panel.key}`}
              aria-expanded={expanded}
              className={
                panel.tone === "danger"
                  ? `${dangerButtonClass} gap-1.5`
                  : `${secondaryButtonClass} gap-1.5`
              }
              key={panel.key}
              onClick={() => setOpen(expanded ? null : panel.key)}
              type="button"
            >
              {panel.label}
              <span
                aria-hidden="true"
                className={`text-[10px] transition-transform ${expanded ? "rotate-180" : ""}`}
              >
                ▾
              </span>
            </button>
          );
        })}
      </div>
      {active ? (
        <div
          className="rounded-panel border border-border bg-canvas p-3"
          id={`${baseId}-${active.key}`}
        >
          {active.content}
        </div>
      ) : null}
    </div>
  );
}

export function ScheduleForm({
  jobId,
  lockVersion,
  scheduledLocal,
}: JobRef & { scheduledLocal: string | null }) {
  const [state, action] = useActionState(schedulePublicationAction, idleActionResult);
  const id = useId();
  return (
    <form action={action} className="grid gap-2 sm:grid-cols-[minmax(0,16rem)_auto] sm:items-end">
      <Hidden jobId={jobId} lockVersion={lockVersion} />
      {hasMessage(state) ? (
        <div className="sm:col-span-2">
          <FormMessage state={state} />
        </div>
      ) : null}
      <Field
        hint={`Site time (${siteConfig.timeZone}). A time that has passed publishes now.`}
        htmlFor={`${id}-at`}
        label="Publish at"
        required
      >
        <input
          aria-describedby={`${id}-at-hint`}
          className={controlClass}
          defaultValue={scheduledLocal ?? ""}
          id={`${id}-at`}
          name="desiredPublishAt"
          required
          type="datetime-local"
        />
      </Field>
      <div className="sm:pb-5">
        <SubmitButton pendingLabel="Scheduling…">
          {scheduledLocal ? "Save new time" : "Schedule"}
        </SubmitButton>
      </div>
    </form>
  );
}

export function DiscardForm({ jobId, lockVersion }: JobRef) {
  const [state, action] = useActionState(discardJobAction, idleActionResult);
  const id = useId();
  return (
    <form action={action} className="grid gap-2">
      <Hidden jobId={jobId} lockVersion={lockVersion} />
      <FormMessage state={state} />
      <Field
        hint="Kept on the article's history. It will never be published."
        htmlFor={`${id}-reason`}
        label="Reason for discarding"
        required
      >
        <textarea
          aria-describedby={`${id}-reason-hint`}
          className={textAreaClass}
          id={`${id}-reason`}
          maxLength={500}
          minLength={3}
          name="reason"
          required
          rows={2}
        />
      </Field>
      <CheckboxField
        id={`${id}-confirm`}
        label="I understand a discarded article cannot be restored."
        name="confirm"
        required
      />
      <div>
        <SubmitButton pendingLabel="Discarding…" variant="danger">
          Discard article
        </SubmitButton>
      </div>
    </form>
  );
}
