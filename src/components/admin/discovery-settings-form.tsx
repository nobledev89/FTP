"use client";

import { useActionState } from "react";

import { idleActionResult } from "@/lib/admin/action-result";
import { requestDiscoveryScanAction, updateDiscoverySettingsAction } from "@/lib/admin/actions";

import { CheckboxField, Field, FormMessage, controlClass } from "./form";
import { SubmitButton } from "./submit-button";

/**
 * Topic discovery settings: the on/off switch, how often the worker scans, whether discovered
 * articles get a ChatGPT hero image, whether they publish on their own once their audit passes,
 * how far apart automatic articles are spaced, and each category's daily target.
 *
 * Automatic publishing is on by default and needs a hero image, so the database refuses the
 * combination of automatic publishing with no image rather than silently holding every article.
 * An article that is a repeat of a live story, or that would exceed the day's article count, is
 * left under Needs your decision with the reason on its card.
 */

type Category = Readonly<{
  id: string;
  name: string;
  guidance: string;
  dailyTarget: number;
  createdToday: number;
}>;

type DiscoverySettingsFormProps = {
  enabled: boolean;
  intervalMinutes: number;
  imageCount: number;
  autoPublish: boolean;
  spacingMinutes: number;
  categories: readonly Category[];
  canEdit: boolean;
};

export function DiscoverySettingsForm({
  enabled,
  intervalMinutes,
  imageCount,
  autoPublish,
  spacingMinutes,
  categories,
  canEdit,
}: DiscoverySettingsFormProps) {
  const [state, formAction] = useActionState(updateDiscoverySettingsAction, idleActionResult);
  const [scanState, scanAction] = useActionState(requestDiscoveryScanAction, idleActionResult);

  return (
    <div className="grid gap-5">
      <form action={formAction} className="grid gap-5">
        <FormMessage state={state} />
        <fieldset className="grid gap-4" disabled={!canEdit}>
          <legend className="sr-only">Discovery</legend>
          <CheckboxField
            defaultChecked={enabled}
            hint="The worker searches recent UK news and writes articles for the categories below."
            id="discoveryEnabled"
            label="Find and write articles automatically"
            name="enabled"
          />
          <CheckboxField
            defaultChecked={autoPublish}
            hint="On: an article goes live once it passes its check, as long as it has an image, is not a story the site already has, and the day still has room. Anything held waits under Needs your decision with the reason. Off: every article waits for you. Applies to articles found from now on."
            id="discoveryAutoPublish"
            label="Publish discovered articles automatically"
            name="autoPublish"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              hint="How often the worker looks for news. Articles are spread through the day."
              htmlFor="intervalMinutes"
              label="Scan every (minutes)"
            >
              <input
                aria-describedby="intervalMinutes-hint"
                className={controlClass}
                defaultValue={intervalMinutes}
                id="intervalMinutes"
                max={720}
                min={15}
                name="intervalMinutes"
                required
                type="number"
              />
            </Field>
            <Field
              hint="Generated with ChatGPT through Codex on the worker PC. No watermark. Automatic publishing needs one."
              htmlFor="imageCount"
              label="Hero image"
            >
              <select
                aria-describedby="imageCount-hint"
                className={controlClass}
                defaultValue={String(imageCount)}
                id="imageCount"
                name="imageCount"
              >
                <option value="1">One ChatGPT image per article</option>
                <option value="0">No image</option>
              </select>
            </Field>
            <Field
              hint="The gap between two articles published automatically, so the front page fills through the day instead of all at once. Publishing an article yourself ignores it."
              htmlFor="spacingMinutes"
              label="Space articles (minutes apart)"
            >
              <input
                aria-describedby="spacingMinutes-hint"
                className={controlClass}
                defaultValue={spacingMinutes}
                id="spacingMinutes"
                max={240}
                min={5}
                name="spacingMinutes"
                required
                type="number"
              />
            </Field>
          </div>
        </fieldset>

        <fieldset className="grid gap-2" disabled={!canEdit}>
          <legend className="mb-1 text-sm font-semibold">Articles per day, by category</legend>
          <p className="text-xs text-text-subtle">0 turns a category off. Up to 12 a day each.</p>
          <ul className="grid gap-2">
            {categories.map((category) => (
              <li
                className="grid gap-2 rounded-control border border-border p-3 sm:grid-cols-[1fr_7rem] sm:items-center"
                key={category.id}
              >
                <div className="grid gap-0.5">
                  <label className="text-sm font-medium" htmlFor={`target-${category.id}`}>
                    {category.name}
                  </label>
                  <p className="text-xs text-text-muted">{category.guidance}</p>
                  <p className="font-mono text-[11px] text-text-subtle">
                    {category.createdToday} created today
                  </p>
                </div>
                <input
                  aria-label={`${category.name} articles per day`}
                  className={controlClass}
                  defaultValue={category.dailyTarget}
                  id={`target-${category.id}`}
                  max={12}
                  min={0}
                  name={`target:${category.id}`}
                  type="number"
                />
              </li>
            ))}
          </ul>
        </fieldset>

        {canEdit ? (
          <div>
            <SubmitButton pendingLabel="Saving…">Save discovery settings</SubmitButton>
          </div>
        ) : null}
      </form>

      {canEdit ? (
        <form action={scanAction} className="grid gap-2 border-t border-border pt-4">
          <FormMessage state={scanState} />
          <p className="text-xs text-text-muted">
            Skip the wait for the next scan. Daily targets still apply.
          </p>
          <div>
            <SubmitButton pendingLabel="Requesting…" variant="secondary">
              Scan now
            </SubmitButton>
          </div>
        </form>
      ) : null}
    </div>
  );
}
