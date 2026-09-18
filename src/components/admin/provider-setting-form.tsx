"use client";

import { useActionState } from "react";

import { idleActionResult } from "@/lib/admin/action-result";
import { updateProviderSettingAction } from "@/lib/admin/provider-actions";
import { IMPLEMENTED_MODES, type SelectableStage } from "@/lib/admin/provider-modes";
import { providerModeLabel, stageLabel } from "@/lib/admin/status-display";
import type { Database } from "@/lib/supabase/database.types";

import { Field, FormMessage, controlClass } from "./form";
import { SubmitButton } from "./submit-button";

type ProviderMode = Database["public"]["Enums"]["provider_mode"];

export function ProviderSettingForm({
  stage,
  currentMode,
  canEdit,
}: {
  stage: SelectableStage;
  currentMode: ProviderMode;
  canEdit: boolean;
}) {
  const [state, action] = useActionState(updateProviderSettingAction, idleActionResult);
  const id = `provider-default-${stage}`;
  const options = IMPLEMENTED_MODES[stage];
  // A stored default can predate its adapter (the seed selects Claude Code for writing). Show it
  // as it is rather than letting the select fall back to displaying its first option.
  const unavailable = options.includes(currentMode) ? null : currentMode;
  return (
    <form action={action} className="grid gap-3 rounded-panel border border-border p-3">
      <FormMessage state={state} />
      <input name="stage" type="hidden" value={stage} />
      <Field
        htmlFor={id}
        hint={stage === "draft" ? "The same selection is used for revision runs." : undefined}
        label={stage === "draft" ? "Writing and revision" : stageLabel(stage)}
      >
        <select
          className={controlClass}
          defaultValue={currentMode}
          disabled={!canEdit}
          id={id}
          name="mode"
        >
          {unavailable ? (
            <option disabled value={unavailable}>
              {providerModeLabel(unavailable)} (not available yet)
            </option>
          ) : null}
          {options.map((mode) => (
            <option key={mode} value={mode}>
              {providerModeLabel(mode)}
            </option>
          ))}
        </select>
      </Field>
      <div className="flex justify-end">
        <SubmitButton disabled={!canEdit} pendingLabel="Saving…" variant="secondary">
          Save default
        </SubmitButton>
      </div>
    </form>
  );
}
