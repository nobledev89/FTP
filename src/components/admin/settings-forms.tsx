"use client";

import { useActionState } from "react";

import { idleActionResult } from "@/lib/admin/action-result";
import { updateSiteIdentityAction, updateSiteSettingsAction } from "@/lib/admin/actions";
import type { Site, SiteSettings } from "@/lib/admin/configuration";

import { CheckboxField, Field, FormMessage, controlClass, textAreaClass } from "./form";
import { SubmitButton } from "./submit-button";

/**
 * Settings forms. Both post the complete set of values, so clearing an optional field clears the
 * column; the matching database function re-authorizes and re-validates every one.
 */

export function SiteSettingsForm({
  settings,
  canEdit,
}: {
  settings: SiteSettings;
  canEdit: boolean;
}) {
  const [state, formAction] = useActionState(updateSiteSettingsAction, idleActionResult);

  return (
    <form action={formAction} className="grid gap-5">
      <FormMessage state={state} />

      <fieldset className="grid gap-4" disabled={!canEdit}>
        <legend className="text-sm font-semibold">Editorial defaults</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field htmlFor="defaultBylineName" label="Default byline" required>
            <input
              className={controlClass}
              defaultValue={settings.default_byline_name}
              id="defaultBylineName"
              maxLength={120}
              name="defaultBylineName"
              required
            />
          </Field>
          <Field htmlFor="defaultBylineRole" label="Byline role">
            <input
              className={controlClass}
              defaultValue={settings.default_byline_role ?? ""}
              id="defaultBylineRole"
              maxLength={120}
              name="defaultBylineRole"
            />
          </Field>
          <Field
            hint="Shown on the publication for corrections and right of reply."
            htmlFor="editorialContactEmail"
            label="Editorial contact"
          >
            <input
              aria-describedby="editorialContactEmail-hint"
              className={controlClass}
              defaultValue={settings.editorial_contact_email ?? ""}
              id="editorialContactEmail"
              name="editorialContactEmail"
              type="email"
            />
          </Field>
        </div>
      </fieldset>

      <fieldset className="grid gap-4" disabled={!canEdit}>
        <legend className="text-sm font-semibold">SEO defaults</legend>
        <div className="grid gap-4">
          <Field htmlFor="seoDefaultTitle" label="Default title" meta="Up to 70 characters">
            <input
              className={controlClass}
              defaultValue={settings.seo_default_title ?? ""}
              id="seoDefaultTitle"
              maxLength={70}
              name="seoDefaultTitle"
            />
          </Field>
          <Field
            htmlFor="seoDefaultDescription"
            label="Default description"
            meta="Up to 320 characters"
          >
            <textarea
              className={textAreaClass}
              defaultValue={settings.seo_default_description ?? ""}
              id="seoDefaultDescription"
              maxLength={320}
              name="seoDefaultDescription"
              rows={3}
            />
          </Field>
          <Field
            hint="Storage path of the fallback share image, used when an article has no hero."
            htmlFor="shareImagePath"
            label="Share image path"
          >
            <input
              aria-describedby="shareImagePath-hint"
              className={controlClass}
              defaultValue={settings.share_image_path ?? ""}
              id="shareImagePath"
              maxLength={512}
              name="shareImagePath"
            />
          </Field>
        </div>
      </fieldset>

      <fieldset className="grid gap-4" disabled={!canEdit}>
        <legend className="text-sm font-semibold">Worker and publishing</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            hint="10 to 3600 seconds without a heartbeat before the worker is shown as stale."
            htmlFor="workerStaleAfterSeconds"
            label="Stale after (seconds)"
            required
          >
            <input
              aria-describedby="workerStaleAfterSeconds-hint"
              className={controlClass}
              defaultValue={settings.worker_stale_after_seconds}
              id="workerStaleAfterSeconds"
              max={3600}
              min={10}
              name="workerStaleAfterSeconds"
              required
              type="number"
            />
          </Field>
          <Field
            hint="Must be longer than the stale threshold."
            htmlFor="workerOfflineAfterSeconds"
            label="Offline after (seconds)"
            required
          >
            <input
              aria-describedby="workerOfflineAfterSeconds-hint"
              className={controlClass}
              defaultValue={settings.worker_offline_after_seconds}
              id="workerOfflineAfterSeconds"
              max={7200}
              min={20}
              name="workerOfflineAfterSeconds"
              required
              type="number"
            />
          </Field>
        </div>
        <CheckboxField
          defaultChecked={settings.auto_publish_default}
          hint="Applies to new jobs only; jobs already in the queue keep the value they were created with."
          id="autoPublishDefault"
          label="New jobs publish automatically after a passing audit"
          name="autoPublishDefault"
        />
      </fieldset>

      {canEdit ? (
        <div>
          <SubmitButton pendingLabel="Saving…">Save settings</SubmitButton>
        </div>
      ) : (
        <p className="text-sm text-text-muted">
          This account has read-only access; settings cannot be changed.
        </p>
      )}
    </form>
  );
}

export function SiteIdentityForm({ site, isOwner }: { site: Site; isOwner: boolean }) {
  const [state, formAction] = useActionState(updateSiteIdentityAction, idleActionResult);

  return (
    <form action={formAction} className="grid gap-4">
      <FormMessage state={state} />

      <fieldset className="grid gap-4" disabled={!isOwner}>
        <Field htmlFor="name" label="Publication name" required>
          <input
            className={controlClass}
            defaultValue={site.name}
            id="name"
            maxLength={80}
            name="name"
            required
          />
        </Field>
        <Field htmlFor="description" label="Description" meta="Up to 500 characters">
          <textarea
            className={textAreaClass}
            defaultValue={site.description}
            id="description"
            maxLength={500}
            name="description"
            rows={3}
          />
        </Field>
        <Field
          hint="Shown in the footer of every page. Keep the financial-information disclosure accurate."
          htmlFor="disclosure"
          label="Disclosure"
          meta="Up to 1000 characters"
        >
          <textarea
            aria-describedby="disclosure-hint"
            className={textAreaClass}
            defaultValue={site.disclosure}
            id="disclosure"
            maxLength={1000}
            name="disclosure"
            rows={3}
          />
        </Field>
        <Field
          hint="IANA timezone name, for example Europe/London. Used for scheduling and displayed times."
          htmlFor="timezone"
          label="Timezone"
          required
        >
          <input
            aria-describedby="timezone-hint"
            className={controlClass}
            defaultValue={site.timezone}
            id="timezone"
            maxLength={60}
            name="timezone"
            required
          />
        </Field>
      </fieldset>

      {isOwner ? (
        <div>
          <SubmitButton pendingLabel="Saving…">Save identity</SubmitButton>
        </div>
      ) : (
        <p className="text-sm text-text-muted">
          Publication identity can only be changed by the owner.
        </p>
      )}
    </form>
  );
}
