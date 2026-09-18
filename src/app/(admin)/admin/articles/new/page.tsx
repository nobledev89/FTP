import type { Metadata } from "next";

import { AdminShell } from "@/components/admin/admin-shell";
import { NewArticleForm, type StageChoice } from "@/components/admin/new-article-form";
import { Notice, Panel } from "@/components/admin/panel";
import { getPublicationConfiguration, listProviderSettings } from "@/lib/admin/configuration";
import { isImplementedMode } from "@/lib/admin/provider-modes";
import { requireAdminSession } from "@/lib/auth/dal";
import type { Database } from "@/lib/supabase/database.types";

export const metadata: Metadata = {
  title: "New article",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type ProviderMode = Database["public"]["Enums"]["provider_mode"];

/**
 * Per-stage mode options (plan section 10.2). Only modes the database accepts for that stage are
 * listed; `provider_settings` has the same CHECK via `private.provider_mode_allowed`.
 */
const STAGE_OPTIONS: ReadonlyArray<Omit<StageChoice, "defaultMode" | "defaultAvailable">> = [
  {
    stage: "research",
    field: "researchMode",
    label: "Research",
    options: ["mock", "manual_chatgpt", "codex_cli", "openai_api"],
  },
  {
    stage: "draft",
    field: "writingMode",
    label: "Writing",
    options: ["mock", "claude_code", "manual_claude", "anthropic_api"],
  },
  {
    stage: "images",
    field: "imagesMode",
    label: "Images",
    options: ["mock", "manual_gemini", "gemini_api"],
  },
  {
    stage: "audit",
    field: "auditMode",
    label: "Audit",
    options: ["mock", "manual_chatgpt", "codex_cli", "openai_api"],
  },
];

export default async function NewArticlePage() {
  const session = await requireAdminSession();
  const [configuration, providerSettings] = await Promise.all([
    getPublicationConfiguration(session.siteId),
    listProviderSettings(session.siteId),
  ]);

  const defaults = new Map(providerSettings.map((setting) => [setting.stage, setting]));
  const confirmed = new Set(
    providerSettings
      .filter((setting) => setting.api_mode_confirmed_at !== null)
      .map((setting) => `${setting.stage}:${setting.mode}`),
  );

  const stages: readonly StageChoice[] = STAGE_OPTIONS.map((stage) => {
    const defaultMode = defaults.get(stage.stage)?.mode ?? null;
    return {
      ...stage,
      defaultMode,
      defaultAvailable: defaultMode === null || isImplementedMode(stage.stage, defaultMode),
      // Only modes with a worker adapter are offered, and a billable API mode only where provider
      // settings already confirm it, matching the check inside create_article_job.
      options: stage.options.filter(
        (mode: ProviderMode) =>
          isImplementedMode(stage.stage, mode) &&
          (!mode.endsWith("_api") || confirmed.has(`${stage.stage}:${mode}`)),
      ),
    };
  });

  return (
    <AdminShell currentHref="/admin/articles/new" session={session} title="New article">
      <div className="grid gap-4">
        {session.canEdit ? null : (
          <Notice tone="warning">
            This account has read-only access. Creating a job requires an editor or owner
            membership.
          </Notice>
        )}

        <Panel
          description="Creates the job in IDEA. Start it from the article page when you are ready for the worker to pick it up."
          title="Article brief"
        >
          {session.canEdit ? (
            <NewArticleForm
              autoPublishDefault={configuration?.settings.auto_publish_default ?? false}
              stages={stages}
            />
          ) : (
            <p className="text-sm text-text-muted">Nothing to fill in without edit access.</p>
          )}
        </Panel>
      </div>
    </AdminShell>
  );
}
