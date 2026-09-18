"use client";

import { useActionState, useState } from "react";

import { idleActionResult } from "@/lib/admin/action-result";
import { createArticleJobAction } from "@/lib/admin/actions";
import { isBillableMode, providerModeLabel } from "@/lib/admin/status-display";
import type { Database } from "@/lib/supabase/database.types";
import type { PipelineStage } from "@/lib/state-machine/transitions";

import { CheckboxField, Field, FormMessage, controlClass, textAreaClass } from "./form";
import { SubmitButton } from "./submit-button";

type ProviderMode = Database["public"]["Enums"]["provider_mode"];
type ArticleType = Database["public"]["Enums"]["article_type"];

export type StageChoice = Readonly<{
  stage: Extract<PipelineStage, "research" | "draft" | "images" | "audit">;
  field: "researchMode" | "writingMode" | "imagesMode" | "auditMode";
  label: string;
  /** The mode that applies when the form leaves this stage on "publication default". */
  defaultMode: ProviderMode | null;
  /** False when the publication default has no worker adapter yet; a mode must then be chosen. */
  defaultAvailable: boolean;
  options: readonly ProviderMode[];
}>;

const ARTICLE_TYPES: ReadonlyArray<readonly [ArticleType, string]> = [
  ["analysis", "Analysis"],
  ["news", "News"],
  ["explainer", "Explainer"],
  ["guide", "Guide"],
  ["company", "Company"],
  ["interview", "Interview"],
];

/**
 * Creates an `IDEA` job (plan section 12). Provider modes default to publication settings; a
 * billable API mode can only be chosen here if it has already been confirmed in provider settings,
 * which `create_article_job` verifies again.
 */
export function NewArticleForm({
  stages,
  autoPublishDefault,
}: {
  stages: readonly StageChoice[];
  autoPublishDefault: boolean;
}) {
  const [state, formAction] = useActionState(createArticleJobAction, idleActionResult);
  const [selected, setSelected] = useState<Readonly<Record<string, string>>>({});

  const billableStages = stages.filter((stage) => {
    const chosen = selected[stage.field];
    const mode = chosen && chosen !== "default" ? (chosen as ProviderMode) : stage.defaultMode;
    return mode ? isBillableMode(mode) : false;
  });

  return (
    <form action={formAction} className="grid gap-5">
      <FormMessage state={state} />

      <fieldset className="grid gap-4">
        <legend className="text-sm font-semibold">Brief</legend>

        <Field
          hint="What the article is about, in a sentence. The research stage interprets this."
          htmlFor="topic"
          label="Topic"
          required
        >
          <input
            aria-describedby="topic-hint"
            className={controlClass}
            id="topic"
            maxLength={300}
            minLength={3}
            name="topic"
            required
          />
        </Field>

        <Field hint="Comma separated, up to 20." htmlFor="keywords" label="Keywords">
          <input
            aria-describedby="keywords-hint"
            className={controlClass}
            id="keywords"
            name="keywords"
          />
        </Field>

        <Field
          hint="Angle, must-cover points, sources to prefer, things to avoid."
          htmlFor="requirements"
          label="Requirements"
        >
          <textarea
            aria-describedby="requirements-hint"
            className={textAreaClass}
            id="requirements"
            maxLength={5000}
            name="requirements"
            rows={4}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field htmlFor="articleType" label="Type" required>
            <select
              className={controlClass}
              defaultValue="analysis"
              id="articleType"
              name="articleType"
              required
            >
              {ARTICLE_TYPES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>

          <Field
            hint="300 to 6000. Blank uses the writer's judgement."
            htmlFor="targetWordCount"
            label="Target words"
          >
            <input
              aria-describedby="targetWordCount-hint"
              className={controlClass}
              id="targetWordCount"
              inputMode="numeric"
              max={6000}
              min={300}
              name="targetWordCount"
              type="number"
            />
          </Field>

          {/* "Image count", not "Images": the provider-mode section below has its own Images field. */}
          <Field hint="0 to 3. Slot 0 is the hero image." htmlFor="imageCount" label="Image count">
            <input
              aria-describedby="imageCount-hint"
              className={controlClass}
              defaultValue={1}
              id="imageCount"
              max={3}
              min={0}
              name="imageCount"
              required
              type="number"
            />
          </Field>

          <Field hint="Optional section label." htmlFor="category" label="Category">
            <input
              aria-describedby="category-hint"
              className={controlClass}
              id="category"
              maxLength={60}
              name="category"
            />
          </Field>
        </div>
      </fieldset>

      <fieldset className="grid gap-4">
        <legend className="text-sm font-semibold">Publication</legend>

        <Field
          hint="Wall-clock time in Europe/London. Leave blank to decide after the audit."
          htmlFor="desiredPublishAt"
          label="Desired publish time"
        >
          <input
            aria-describedby="desiredPublishAt-hint"
            className={controlClass}
            id="desiredPublishAt"
            name="desiredPublishAt"
            type="datetime-local"
          />
        </Field>

        <CheckboxField
          defaultChecked={autoPublishDefault}
          hint="Publish without a further approval step once the audit passes."
          id="autoPublish"
          label="Publish automatically after a passing audit"
          name="autoPublish"
        />
      </fieldset>

      <fieldset className="grid gap-4">
        <legend className="text-sm font-semibold">Provider modes</legend>
        <p className="text-xs text-text-muted">
          The mode is recorded on the job when it is created, so changing publication settings later
          does not alter a job already in the queue.
        </p>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stages.map((stage) => (
            <Field htmlFor={stage.field} key={stage.field} label={stage.label}>
              <select
                className={controlClass}
                defaultValue={stage.defaultAvailable ? "default" : ""}
                id={stage.field}
                name={stage.field}
                onChange={(event) =>
                  setSelected((current) => ({ ...current, [stage.field]: event.target.value }))
                }
                required
              >
                {stage.defaultAvailable ? null : (
                  <option disabled value="">
                    Choose a mode
                  </option>
                )}
                <option disabled={!stage.defaultAvailable} value="default">
                  {stage.defaultMode
                    ? `Publication default (${providerModeLabel(stage.defaultMode)})${
                        stage.defaultAvailable ? "" : ", not available yet"
                      }`
                    : "Publication default"}
                </option>
                {stage.options.map((mode) => (
                  <option key={mode} value={mode}>
                    {providerModeLabel(mode)}
                    {isBillableMode(mode) ? " — billed" : ""}
                  </option>
                ))}
              </select>
            </Field>
          ))}
        </div>

        {billableStages.length > 0 ? (
          <p
            aria-live="polite"
            className="rounded-panel border border-warning/25 bg-warning-bg px-3 py-2 text-xs text-warning"
          >
            A billable API mode is selected for{" "}
            {billableStages.map((stage) => stage.label.toLowerCase()).join(", ")}. These calls are
            charged by the provider. Mock, manual, and subscription CLI modes are not.
          </p>
        ) : null}
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Creating…">Create article job</SubmitButton>
        <p className="text-xs text-text-muted">
          The job is created as <span className="font-mono">IDEA</span>. Nothing runs until it is
          started.
        </p>
      </div>
    </form>
  );
}
