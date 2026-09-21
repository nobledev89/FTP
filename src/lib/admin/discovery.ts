import "server-only";

import { z } from "zod";

import { utcIsoToZonedLocal, zonedLocalToUtcIso } from "@/lib/format/timezone";
import { siteConfig } from "@/lib/site/config";
import { toWorkflowError } from "@/lib/state-machine/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  autoPublishHoldReasonSchema,
  discoverySourceSchema,
  jsonObjectSchema,
  nullableTimestampSchema,
  timestampSchema,
  uuidSchema,
} from "@/lib/validation/domain";

/**
 * Topic discovery reads for the console: settings, categories with today's progress, recent
 * scans, and discovered articles waiting for an editor. All admin-only selects under RLS; writes
 * go through `admin_update_discovery_settings`, `admin_update_topic_category`, and
 * `admin_request_discovery_scan`.
 */

const settingsSchema = z
  .object({
    discovery_enabled: z.boolean(),
    discovery_interval_minutes: z.number().int(),
    discovery_image_count: z.number().int(),
    discovery_auto_publish: z.boolean(),
    auto_publish_spacing_minutes: z.number().int(),
    discovery_last_started_at: nullableTimestampSchema,
  })
  .strict();

const categorySchema = z
  .object({
    id: uuidSchema,
    slug: z.string(),
    name: z.string(),
    guidance: z.string(),
    daily_target: z.number().int(),
    sort_order: z.number().int(),
  })
  .strict();

const runSchema = z
  .object({
    id: z.number().int(),
    worker_id: z.string(),
    status: z.enum(["running", "succeeded", "failed"]),
    categories: z.array(z.string()),
    candidates: z.number().int().nullable(),
    created_job_ids: z.array(uuidSchema),
    error: z.string().nullable(),
    usage: jsonObjectSchema,
    started_at: timestampSchema,
    finished_at: nullableTimestampSchema,
  })
  .strict();

const reviewSchema = z
  .object({
    id: uuidSchema,
    topic: z.string(),
    category: z.string().nullable(),
    origin: z.enum(["editor", "discovery"]),
    discovery_source: discoverySourceSchema.nullable(),
    approved_draft_id: uuidSchema.nullable(),
    auto_publish_hold_reason: autoPublishHoldReasonSchema.nullable(),
    lock_version: z.number().int().nonnegative(),
    updated_at: timestampSchema,
  })
  .strict();

const reviewDraftSchema = z
  .object({ id: uuidSchema, title: z.string(), excerpt: z.string() })
  .strict();

export type DiscoverySettings = z.infer<typeof settingsSchema>;
export type TopicCategory = z.infer<typeof categorySchema> & Readonly<{ createdToday: number }>;
export type DiscoveryRun = z.infer<typeof runSchema>;
export type ReviewItem = z.infer<typeof reviewSchema> &
  Readonly<{ title: string | null; excerpt: string | null }>;

export type DiscoveryOverview = Readonly<{
  settings: DiscoverySettings;
  categories: readonly TopicCategory[];
  runs: readonly DiscoveryRun[];
}>;

/** Midnight today in the publication timezone, as a UTC ISO timestamp. */
function startOfPublicationDay(now: Date): string {
  const local = utcIsoToZonedLocal(now.toISOString(), siteConfig.timeZone);
  return (
    zonedLocalToUtcIso(`${local.slice(0, 10)}T00:00`, siteConfig.timeZone) ?? now.toISOString()
  );
}

export async function getDiscoveryOverview(
  siteId: string,
  now = new Date(),
): Promise<DiscoveryOverview | null> {
  const client = await createSupabaseServerClient();
  const [settings, categories, runs, today] = await Promise.all([
    client
      .from("site_settings")
      .select(
        "discovery_enabled, discovery_interval_minutes, discovery_image_count, discovery_auto_publish, auto_publish_spacing_minutes, discovery_last_started_at",
      )
      .eq("site_id", siteId)
      .maybeSingle(),
    client
      .from("topic_categories")
      .select("id, slug, name, guidance, daily_target, sort_order")
      .eq("site_id", siteId)
      .order("sort_order"),
    client
      .from("topic_discovery_runs")
      .select(
        "id, worker_id, status, categories, candidates, created_job_ids, error, usage, started_at, finished_at",
      )
      .eq("site_id", siteId)
      .order("started_at", { ascending: false })
      .limit(10),
    client
      .from("article_jobs")
      .select("topic_category_id")
      .eq("site_id", siteId)
      .eq("origin", "discovery")
      .gte("created_at", startOfPublicationDay(now)),
  ]);

  for (const result of [settings, categories, runs, today]) {
    if (result.error) throw toWorkflowError(result.error);
  }
  if (!settings.data) return null;

  const createdToday = new Map<string, number>();
  for (const row of today.data ?? []) {
    if (row.topic_category_id) {
      createdToday.set(row.topic_category_id, (createdToday.get(row.topic_category_id) ?? 0) + 1);
    }
  }

  return {
    settings: settingsSchema.parse(settings.data),
    categories: z
      .array(categorySchema)
      .parse(categories.data)
      .map((category) => ({ ...category, createdToday: createdToday.get(category.id) ?? 0 })),
    runs: z.array(runSchema).parse(runs.data),
  };
}

/**
 * Articles that passed their audit and are waiting for an editor to publish, schedule, or discard.
 * Auto-publish jobs are excluded: nobody needs to act on those. Each carries the headline and
 * standfirst of its approved draft, so the decision can be made from the dashboard, and the
 * `lock_version` the card was drawn with, so acting on a stale card is refused.
 */
export async function listReadyForReview(siteId: string): Promise<readonly ReviewItem[]> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("article_jobs")
    .select(
      "id, topic, category, origin, discovery_source, approved_draft_id, auto_publish_hold_reason, lock_version, updated_at",
    )
    .eq("site_id", siteId)
    .eq("status", "APPROVED")
    .eq("auto_publish", false)
    .order("updated_at", { ascending: true })
    .limit(50);
  if (error) throw toWorkflowError(error);
  const jobs = z.array(reviewSchema).parse(data);

  const draftIds = jobs.flatMap((job) => (job.approved_draft_id ? [job.approved_draft_id] : []));
  const drafts = new Map<string, z.infer<typeof reviewDraftSchema>>();
  if (draftIds.length > 0) {
    const result = await client.from("drafts").select("id, title, excerpt").in("id", draftIds);
    if (result.error) throw toWorkflowError(result.error);
    for (const draft of z.array(reviewDraftSchema).parse(result.data)) drafts.set(draft.id, draft);
  }

  return jobs.map((job) => {
    const draft = job.approved_draft_id ? drafts.get(job.approved_draft_id) : undefined;
    return { ...job, title: draft?.title ?? null, excerpt: draft?.excerpt ?? null };
  });
}
