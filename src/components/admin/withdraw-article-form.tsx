"use client";

import { useActionState } from "react";

import { idleActionResult } from "@/lib/admin/action-result";
import { withdrawArticleAction } from "@/lib/admin/actions";

import { CheckboxField, Field, FormMessage, textAreaClass } from "./form";
import { SubmitButton } from "./submit-button";

/**
 * Takes a live article off the public site. The reason is required and recorded on the timeline,
 * and the confirmation checkbox stands in for a dialog: withdrawal cannot be undone from the
 * console, so it must never happen from a single stray click.
 */

type WithdrawArticleFormProps = {
  jobId: string;
  lockVersion: number;
  slug: string;
};

export function WithdrawArticleForm({ jobId, lockVersion, slug }: WithdrawArticleFormProps) {
  const [state, formAction] = useActionState(withdrawArticleAction, idleActionResult);

  return (
    <form action={formAction} className="grid gap-3">
      <input name="jobId" type="hidden" value={jobId} />
      <input name="expectedLockVersion" type="hidden" value={lockVersion} />
      <FormMessage state={state} />
      <p className="text-sm text-text-muted">
        Withdrawing removes <span className="font-mono">/blog/{slug}</span> from the site, the
        archive, the feed, and the sitemap. The record is kept, the slug stays reserved, and the
        article cannot be republished from this job.
      </p>
      <Field
        hint="Recorded on the job timeline. 3 to 500 characters."
        htmlFor="withdrawReason"
        label="Reason for withdrawal"
        required
      >
        <textarea
          aria-describedby="withdrawReason-hint"
          className={textAreaClass}
          id="withdrawReason"
          maxLength={500}
          minLength={3}
          name="reason"
          required
          rows={2}
        />
      </Field>
      <CheckboxField
        id="withdrawConfirm"
        label="I understand this takes the article off the public site."
        name="confirm"
        required
      />
      <div>
        <SubmitButton pendingLabel="Withdrawing…" variant="danger">
          Withdraw article
        </SubmitButton>
      </div>
    </form>
  );
}
