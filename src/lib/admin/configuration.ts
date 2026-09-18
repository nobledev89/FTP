import "server-only";

import { z } from "zod";

import { toWorkflowError } from "@/lib/state-machine/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  jsonObjectSchema,
  nullableTimestampSchema,
  pipelineStageSchema,
  providerModeSchema,
  timestampSchema,
  uuidSchema,
} from "@/lib/validation/domain";

/**
 * Publication configuration reads: site identity, settings, prompt versions, and per-stage provider
 * modes. All four are admin-only selects under RLS.
 *
 * Writes: settings, identity, and immutable prompt version activation have authorized RPCs.
 * Provider-mode changes arrive with Phases 8-10, which add the modes worth switching to.
 */

const siteSchema = z
  .object({
    id: uuidSchema,
    slug: z.string(),
    name: z.string(),
    canonical_origin: z.string(),
    locale: z.string(),
    timezone: z.string(),
    currency: z.string(),
    description: z.string(),
    disclosure: z.string(),
    updated_at: timestampSchema,
  })
  .strict();

const siteSettingsSchema = z
  .object({
    site_id: uuidSchema,
    default_byline_name: z.string(),
    default_byline_role: z.string().nullable(),
    editorial_contact_email: z.string().nullable(),
    seo_default_title: z.string().nullable(),
    seo_default_description: z.string().nullable(),
    share_image_path: z.string().nullable(),
    worker_stale_after_seconds: z.number().int().positive(),
    worker_offline_after_seconds: z.number().int().positive(),
    auto_publish_default: z.boolean(),
    style_guide_template_id: uuidSchema.nullable(),
    extra: jsonObjectSchema,
    updated_at: timestampSchema,
  })
  .strict();

export type Site = z.infer<typeof siteSchema>;
export type SiteSettings = z.infer<typeof siteSettingsSchema>;

export type PublicationConfiguration = Readonly<{
  site: Site;
  settings: SiteSettings;
}>;

/** Site identity plus editable settings for the caller's site. */
export async function getPublicationConfiguration(
  siteId: string,
): Promise<PublicationConfiguration | null> {
  const client = await createSupabaseServerClient();
  const [site, settings] = await Promise.all([
    client
      .from("sites")
      .select(
        "id, slug, name, canonical_origin, locale, timezone, currency, description, disclosure, updated_at",
      )
      .eq("id", siteId)
      .maybeSingle(),
    client
      .from("site_settings")
      .select(
        "site_id, default_byline_name, default_byline_role, editorial_contact_email, seo_default_title, seo_default_description, share_image_path, worker_stale_after_seconds, worker_offline_after_seconds, auto_publish_default, style_guide_template_id, extra, updated_at",
      )
      .eq("site_id", siteId)
      .maybeSingle(),
  ]);

  if (site.error) throw toWorkflowError(site.error);
  if (settings.error) throw toWorkflowError(settings.error);
  if (!site.data || !settings.data) return null;

  return {
    site: siteSchema.parse(site.data),
    settings: siteSettingsSchema.parse(settings.data),
  };
}

const promptTemplateSchema = z
  .object({
    id: uuidSchema,
    key: z.string(),
    version: z.number().int().positive(),
    notes: z.string().nullable(),
    is_active: z.boolean(),
    created_at: timestampSchema,
    // Length only: the body is loaded on demand, not for a version list.
    content: z.string(),
  })
  .strict();

export type PromptTemplateSummary = Readonly<{
  id: string;
  key: string;
  version: number;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  characters: number;
}>;

/** Every prompt version, grouped by key with the newest version first. */
export async function listPromptTemplates(
  siteId: string,
): Promise<ReadonlyMap<string, readonly PromptTemplateSummary[]>> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("prompt_templates")
    .select("id, key, version, notes, is_active, created_at, content")
    .eq("site_id", siteId)
    .order("key", { ascending: true })
    .order("version", { ascending: false });
  if (error) throw toWorkflowError(error);

  const grouped = new Map<string, PromptTemplateSummary[]>();
  for (const row of promptTemplateSchema.array().parse(data ?? [])) {
    const summary: PromptTemplateSummary = {
      id: row.id,
      key: row.key,
      version: row.version,
      notes: row.notes,
      isActive: row.is_active,
      createdAt: row.created_at,
      characters: row.content.length,
    };
    const existing = grouped.get(row.key);
    if (existing) existing.push(summary);
    else grouped.set(row.key, [summary]);
  }
  return grouped;
}

/** One prompt version's body, for the preview panel. */
export async function getPromptTemplateContent(
  siteId: string,
  templateId: string,
): Promise<Readonly<{
  id: string;
  key: string;
  version: number;
  content: string;
  notes: string | null;
  isActive: boolean;
}> | null> {
  if (!uuidSchema.safeParse(templateId).success) return null;

  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("prompt_templates")
    .select("id, key, version, content, notes, is_active")
    .eq("site_id", siteId)
    .eq("id", templateId)
    .maybeSingle();
  if (error) throw toWorkflowError(error);
  if (!data) return null;
  return {
    id: data.id,
    key: data.key,
    version: data.version,
    content: data.content,
    notes: data.notes,
    isActive: data.is_active,
  };
}

const providerSettingSchema = z
  .object({
    id: uuidSchema,
    stage: pipelineStageSchema,
    mode: providerModeSchema,
    settings: jsonObjectSchema,
    api_mode_confirmed_at: nullableTimestampSchema,
    updated_at: timestampSchema,
  })
  .strict();

export type ProviderSetting = z.infer<typeof providerSettingSchema>;

export async function listProviderSettings(siteId: string): Promise<readonly ProviderSetting[]> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("provider_settings")
    .select("id, stage, mode, settings, api_mode_confirmed_at, updated_at")
    .eq("site_id", siteId);
  if (error) throw toWorkflowError(error);
  return providerSettingSchema.array().parse(data ?? []);
}

const workerSchema = z
  .object({
    worker_id: z.string(),
    host_label: z.string().nullable(),
    version: z.string().nullable(),
    started_at: timestampSchema,
    last_seen_at: timestampSchema,
    current_job_id: uuidSchema.nullable(),
    current_stage: pipelineStageSchema.nullable(),
    // Parsed field by field where it is shown (`cliCapabilities`); the worker owns its shape.
    health: z.record(z.string(), z.unknown()),
  })
  .strict();

export type WorkerInstance = z.infer<typeof workerSchema>;

export async function listWorkerInstances(): Promise<readonly WorkerInstance[]> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("worker_instances")
    .select(
      "worker_id, host_label, version, started_at, last_seen_at, current_job_id, current_stage, health",
    )
    .order("last_seen_at", { ascending: false });
  if (error) throw toWorkflowError(error);
  return workerSchema.array().parse(data ?? []);
}
