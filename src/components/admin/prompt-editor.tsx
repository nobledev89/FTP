"use client";

import { useActionState } from "react";

import { activatePromptTemplateAction, createPromptVersionAction } from "@/lib/admin/actions";
import { idleActionResult } from "@/lib/admin/action-result";

import { CheckboxField, Field, FormMessage, controlClass, textAreaClass } from "./form";
import { SubmitButton } from "./submit-button";

type PromptEditorProps = {
  template: Readonly<{
    id: string;
    key: string;
    version: number;
    content: string;
    notes: string | null;
    isActive: boolean;
  }>;
  canEdit: boolean;
};

/** Creates immutable prompt versions and makes an old version active again for rollback. */
export function PromptEditor({ template, canEdit }: PromptEditorProps) {
  const [saveState, saveAction] = useActionState(createPromptVersionAction, idleActionResult);
  const [activateState, activateAction] = useActionState(
    activatePromptTemplateAction,
    idleActionResult,
  );

  return (
    <div className="grid gap-5">
      {!template.isActive ? (
        <form action={activateAction} className="grid gap-3 rounded-panel border border-border p-3">
          <FormMessage state={activateState} />
          <input name="templateId" type="hidden" value={template.id} />
          <p className="text-sm text-text-muted">
            Roll back by making this immutable version active. Existing provider-run snapshots do
            not change.
          </p>
          <div className="flex justify-end">
            <SubmitButton disabled={!canEdit} pendingLabel="Activating…" variant="secondary">
              Activate this version
            </SubmitButton>
          </div>
        </form>
      ) : null}

      <form action={saveAction} className="grid gap-4">
        <FormMessage state={saveState} />
        <input name="key" type="hidden" value={template.key} />
        <Field
          htmlFor="prompt-content"
          hint="Saving creates a new immutable version; it never rewrites this one."
          label="Prompt Markdown"
          meta="100,000 chars max"
          required
        >
          <textarea
            aria-describedby="prompt-content-hint"
            className={`${textAreaClass} min-h-[28rem] font-mono text-xs leading-relaxed`}
            defaultValue={template.content}
            disabled={!canEdit}
            id="prompt-content"
            maxLength={100_000}
            name="content"
            required
          />
        </Field>
        <Field htmlFor="prompt-notes" label="Version note" meta="2,000 chars max">
          <input
            className={controlClass}
            defaultValue={template.notes ?? ""}
            disabled={!canEdit}
            id="prompt-notes"
            maxLength={2000}
            name="notes"
          />
        </Field>
        <CheckboxField
          defaultChecked
          disabled={!canEdit}
          hint="Clear this to save a draft version without changing the worker's active prompt."
          id="prompt-activate"
          label="Activate the new version"
          name="activate"
        />
        <div className="flex justify-end">
          <SubmitButton disabled={!canEdit} pendingLabel="Saving…">
            Save new version
          </SubmitButton>
        </div>
      </form>
    </div>
  );
}
