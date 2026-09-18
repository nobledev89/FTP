"use client";

import { useActionState, useState } from "react";

import { idleActionResult } from "@/lib/admin/action-result";
import { updateProviderSettingAction } from "@/lib/admin/provider-actions";
import { IMPLEMENTED_MODES, type SelectableStage } from "@/lib/admin/provider-modes";
import { isBillableMode, providerModeLabel, stageLabel } from "@/lib/admin/status-display";
import type { Database } from "@/lib/supabase/database.types";

import { CheckboxField, Field, FormMessage, controlClass } from "./form";
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
  const [selectedMode, setSelectedMode] = useState<ProviderMode>(currentMode);
  // Keep an unknown stored mode visible instead of allowing the select to display its first item.
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
          value={selectedMode}
          disabled={!canEdit}
          id={id}
          name="mode"
          onChange={(event) => setSelectedMode(event.target.value as ProviderMode)}
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
      {isBillableMode(selectedMode) ? (
        <div className="rounded-panel border border-warning-border bg-warning-subtle p-3">
          <CheckboxField
            disabled={!canEdit}
            hint="This confirmation is recorded with the provider setting. Usage is logged, but the provider account controls the actual budget and charges."
            id={`${id}-cost-confirmation`}
            label={`I understand that every ${providerModeLabel(selectedMode)} run is metered and billed by the provider.`}
            name="confirmApi"
            required
          />
        </div>
      ) : null}
      <div className="flex justify-end">
        <SubmitButton disabled={!canEdit} pendingLabel="Saving…" variant="secondary">
          Save default
        </SubmitButton>
      </div>
    </form>
  );
}
