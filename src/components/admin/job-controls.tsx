"use client";

import { useActionState } from "react";

import { idleActionResult } from "@/lib/admin/action-result";
import { discardJobAction, jobTransitionAction } from "@/lib/admin/actions";
import {
  CONTROL_LABELS,
  type ControlKind,
  type JobControlSnapshot,
} from "@/lib/admin/job-controls";
import { jobStatusMeaning } from "@/lib/admin/status-display";
import type { JobStatus } from "@/lib/state-machine/transitions";

import {
  CheckboxField,
  Field,
  FormMessage,
  controlClass,
  dangerButtonClass,
  textAreaClass,
} from "./form";
import { SubmitButton } from "./submit-button";

/**
 * Workflow controls for one job.
 *
 * `lock_version` travels with every submission, so two admins acting on the same job cannot both
 * win: the second gets "this job changed since the page was loaded" from `admin_transition_job`
 * rather than silently overwriting the first.
 */

type JobControlsProps = {
  jobId: string;
  lockVersion: number;
  snapshot: JobControlSnapshot;
  controls: readonly ControlKind[];
  resolutions: readonly JobStatus[];
  /** Existing schedule, as a `datetime-local` value in the publication timezone. */
  scheduledLocal: string | null;
  canEdit: boolean;
};

export function JobControls({
  jobId,
  lockVersion,
  snapshot,
  controls,
  resolutions,
  scheduledLocal,
  canEdit,
}: JobControlsProps) {
  const [state, formAction] = useActionState(jobTransitionAction, idleActionResult);
  const [discardState, discardAction] = useActionState(discardJobAction, idleActionResult);

  if (!canEdit) {
    return (
      <p className="text-sm text-text-muted">
        This account has read-only access. {jobStatusMeaning(snapshot.status)}
      </p>
    );
  }

  const has = (kind: ControlKind) => controls.includes(kind);
  const hidden = (
    <>
      <input name="jobId" type="hidden" value={jobId} />
      <input name="expectedLockVersion" type="hidden" value={lockVersion} />
    </>
  );

  return (
    <div className="grid gap-4">
      <FormMessage state={state} />
      <p className="text-sm text-text-muted">{jobStatusMeaning(snapshot.status)}</p>

      {has("start") || has("pause") || has("resume") || has("retry") ? (
        <form action={formAction} className="flex flex-wrap gap-2">
          {hidden}
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

      {has("schedule") ? (
        <form action={formAction} className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          {hidden}
          <input name="action" type="hidden" value="schedule" />
          <Field
            hint="Wall-clock time in Europe/London. Leave unchanged to keep the existing time."
            htmlFor="desiredPublishAt"
            label="Publish at"
          >
            <input
              aria-describedby="desiredPublishAt-hint"
              className={controlClass}
              defaultValue={scheduledLocal ?? ""}
              id="desiredPublishAt"
              name="desiredPublishAt"
              type="datetime-local"
            />
          </Field>
          <SubmitButton>Schedule</SubmitButton>
        </form>
      ) : null}

      {has("escalate") ? (
        <form action={formAction} className="grid gap-2">
          {hidden}
          <input name="action" type="hidden" value="mark_needs_human" />
          <Field
            hint="Recorded on the job timeline. At least 3 characters."
            htmlFor="escalateNote"
            label="Escalation note"
            required
          >
            <textarea
              aria-describedby="escalateNote-hint"
              className={textAreaClass}
              id="escalateNote"
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
      ) : null}

      {has("resolve") ? (
        <form action={formAction} className="grid gap-2">
          {hidden}
          <input name="action" type="hidden" value="resolve" />
          {resolutions.length === 0 ? (
            <p className="text-sm text-danger">
              No resolution is available yet. The missing artifact has to exist first, or the job
              has used both automatic revision cycles.
            </p>
          ) : (
            <>
              <Field
                hint="Where the pipeline continues from. Destinations that would skip a stage are not listed."
                htmlFor="toStatus"
                label="Continue from"
                required
              >
                <select
                  aria-describedby="toStatus-hint"
                  className={controlClass}
                  defaultValue={resolutions[0]}
                  id="toStatus"
                  name="toStatus"
                  required
                >
                  {resolutions.map((destination) => (
                    <option key={destination} value={destination}>
                      {destination === "APPROVED"
                        ? "APPROVED — approve for publication"
                        : destination}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                hint="What was decided and why. Recorded on the timeline."
                htmlFor="resolveNote"
                label="Resolution note"
                required
              >
                <textarea
                  aria-describedby="resolveNote-hint"
                  className={textAreaClass}
                  id="resolveNote"
                  name="note"
                  required
                  rows={2}
                />
              </Field>
              <div>
                <SubmitButton>{CONTROL_LABELS.resolve}</SubmitButton>
              </div>
            </>
          )}
        </form>
      ) : null}

      {has("discard") ? (
        <form action={discardAction} className="grid gap-2 border-t border-border pt-4">
          {hidden}
          <FormMessage state={discardState} />
          <Field
            hint="Recorded on the job timeline. The job is kept but will never be published."
            htmlFor="discardReason"
            label="Reason for discarding"
            required
          >
            <textarea
              aria-describedby="discardReason-hint"
              className={textAreaClass}
              id="discardReason"
              maxLength={500}
              minLength={3}
              name="reason"
              required
              rows={2}
            />
          </Field>
          <CheckboxField
            id="discardConfirm"
            label="I understand a discarded article cannot be restored."
            name="confirm"
            required
          />
          <div>
            <SubmitButton pendingLabel="Discarding…" variant="danger">
              {CONTROL_LABELS.discard}
            </SubmitButton>
          </div>
        </form>
      ) : null}

      {controls.length === 0 &&
      snapshot.status !== "VERIFIED" &&
      snapshot.status !== "DISCARDED" ? (
        <p className="text-sm text-text-muted">
          No admin action applies to this status. The worker moves it on from here.
        </p>
      ) : null}
    </div>
  );
}
