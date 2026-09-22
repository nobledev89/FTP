"use server";

import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { authorizeAdminAction } from "@/lib/auth/dal";
import { PUBLIC_ARTICLES_TAG, publicArticleTag } from "@/lib/publication/repository";
import { planAdminTransition, type AdminAction } from "@/lib/state-machine/admin-rules";
import { WorkflowError, toWorkflowError } from "@/lib/state-machine/errors";
import { createAdminWorkflowService } from "@/lib/state-machine/supabase";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/database.types";
import { zonedLocalToUtcIso } from "@/lib/format/timezone";
import { siteConfig } from "@/lib/site/config";
import {
  articleJobSchema,
  articleTypeSchema,
  jobStatusSchema,
  providerModeSchema,
  uuidSchema,
} from "@/lib/validation/domain";

import type { ActionResult } from "./action-result";
import { listProviderSettings } from "./configuration";
import { IMPLEMENTED_MODES, isImplementedMode, type SelectableStage } from "./provider-modes";
import { resolutionChoiceLabel } from "./editorial-status";
import { providerModeLabel } from "./status-display";

/**
 * Server Actions for the admin console.
 *
 * Each one authorizes independently (`authorizeAdminAction`) before it validates its input, because
 * a Server Action is reachable as a POST to the route that renders it and is not protected by the
 * proxy or by the page that drew the button. The database repeats every check: `authenticated` has
 * no table writes, and `create_article_job`/`admin_transition_job` re-derive the caller's
 * membership and enforce the state machine and `lock_version`.
 *
 * A `"use server"` module may export async functions only, so `ActionResult` and its idle value
 * live in `./action-result`.
 */

type ProviderMode = Database["public"]["Enums"]["provider_mode"];

/** Messages for the failure classes an admin can actually act on. */
function describe(error: unknown): string {
  const workflowError = toWorkflowError(error);
  switch (workflowError.code) {
    case "STALE_JOB":
      return "This job changed since the page was loaded. Reload it and try again.";
    case "INVALID_TRANSITION":
      return "That action is not allowed from the job's current status. Reload the job.";
    case "GATE_NOT_MET":
      return "The stage is missing a required artifact. Produce it, or escalate instead.";
    case "NOT_AUTHORIZED":
      return workflowError.message;
    case "NOT_FOUND":
      return "That job no longer exists.";
    case "INVALID_ARGUMENT":
      return workflowError.message;
    case "SLUG_CONFLICT":
      return "Another article already uses that slug.";
    default:
      // Database text can quote provider output; keep it on the server.
      console.error("admin action failed", {
        code: workflowError.code,
        sqlState: workflowError.sqlState,
      });
      return "The action could not be completed. Check the logs and try again.";
  }
}

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "The submitted values were not valid.";
  const field = issue.path.join(".");
  return field ? `${field}: ${issue.message}` : issue.message;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

const keywordsSchema = z
  .string()
  .max(1200)
  .transform((value) =>
    value
      .split(/[,\n]/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  )
  .pipe(z.array(z.string().min(1).max(60)).max(20));

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((value) => value.trim())
    .transform((value) => (value.length === 0 ? null : value));

const optionalInteger = (min: number, max: number) =>
  z
    .string()
    .max(10)
    .transform((value) => value.trim())
    .refine((value) => value === "" || /^\d+$/.test(value), "must be a whole number")
    .transform((value) => (value === "" ? null : Number.parseInt(value, 10)))
    .refine(
      (value) => value === null || (value >= min && value <= max),
      `must be between ${min} and ${max}`,
    );

const createJobSchema = z.object({
  topic: z.string().trim().min(3, "must be at least 3 characters").max(300),
  keywords: keywordsSchema,
  requirements: optionalText(5000),
  articleType: articleTypeSchema,
  targetWordCount: optionalInteger(300, 6000),
  imageCount: z.coerce.number().int().min(0).max(3),
  desiredPublishAt: z.string().max(40),
  autoPublish: z.boolean(),
  category: optionalText(60),
  researchMode: providerModeSchema.nullable(),
  writingMode: providerModeSchema.nullable(),
  imagesMode: providerModeSchema.nullable(),
  auditMode: providerModeSchema.nullable(),
});

const MODE_FIELDS = [
  ["research", "researchMode", "Research"],
  ["draft", "writingMode", "Writing"],
  ["images", "imagesMode", "Images"],
  ["audit", "auditMode", "Audit"],
] as const satisfies ReadonlyArray<
  readonly [SelectableStage, "researchMode" | "writingMode" | "imagesMode" | "auditMode", string]
>;

/**
 * Resolves each stage's effective mode (the explicit choice, else the publication default) and
 * describes the first one the worker has no adapter for. Such a job would fail permanently at that
 * stage, and the worker never substitutes another mode.
 */
async function modeWithoutAdapter(
  siteId: string,
  chosen: Readonly<Record<(typeof MODE_FIELDS)[number][1], ProviderMode | null>>,
): Promise<string | null> {
  const defaults = new Map(
    (await listProviderSettings(siteId)).map((setting) => [setting.stage, setting.mode]),
  );
  for (const [stage, field, label] of MODE_FIELDS) {
    const mode = chosen[field] ?? defaults.get(stage) ?? "mock";
    if (!isImplementedMode(stage, mode)) {
      const available = IMPLEMENTED_MODES[stage].map(providerModeLabel).join(" or ");
      return `${label}: ${providerModeLabel(mode)} is not available yet. Choose ${available}.`;
    }
  }
  return null;
}

function readMode(formData: FormData, field: string): string | null {
  const value = formData.get(field);
  if (typeof value !== "string" || value === "" || value === "default") return null;
  return value;
}

export async function createArticleJobAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  let jobId: string;
  try {
    const session = await authorizeAdminAction("write");

    const parsed = createJobSchema.safeParse({
      topic: String(formData.get("topic") ?? ""),
      keywords: String(formData.get("keywords") ?? ""),
      requirements: String(formData.get("requirements") ?? ""),
      articleType: formData.get("articleType"),
      targetWordCount: String(formData.get("targetWordCount") ?? ""),
      imageCount: String(formData.get("imageCount") ?? "1"),
      desiredPublishAt: String(formData.get("desiredPublishAt") ?? ""),
      autoPublish: formData.get("autoPublish") === "on",
      category: String(formData.get("category") ?? ""),
      researchMode: readMode(formData, "researchMode"),
      writingMode: readMode(formData, "writingMode"),
      imagesMode: readMode(formData, "imagesMode"),
      auditMode: readMode(formData, "auditMode"),
    });
    if (!parsed.success) {
      return { ok: false, error: firstIssue(parsed.error) };
    }

    // A `datetime-local` value is wall-clock time in the publication timezone.
    let publishAt: string | null = null;
    if (parsed.data.desiredPublishAt.trim().length > 0) {
      publishAt = zonedLocalToUtcIso(parsed.data.desiredPublishAt, siteConfig.timeZone);
      if (!publishAt) {
        return { ok: false, error: "Enter the desired publish time as a date and time." };
      }
    }

    const unavailable = await modeWithoutAdapter(session.siteId, parsed.data);
    if (unavailable) return { ok: false, error: unavailable };

    const client = await createSupabaseServerClient();
    // Arguments with a SQL default are omitted rather than sent as null: the generated types treat
    // them as optional, and the function's own defaults are what should apply when a field is blank.
    const { data, error } = await client.rpc("create_article_job", {
      p_topic: parsed.data.topic,
      p_keywords: parsed.data.keywords,
      p_article_type: parsed.data.articleType,
      p_image_count: parsed.data.imageCount,
      p_auto_publish: parsed.data.autoPublish,
      ...(parsed.data.requirements ? { p_requirements: parsed.data.requirements } : {}),
      ...(parsed.data.targetWordCount !== null
        ? { p_target_word_count: parsed.data.targetWordCount }
        : {}),
      ...(publishAt ? { p_desired_publish_at: publishAt } : {}),
      ...(parsed.data.category ? { p_category: parsed.data.category } : {}),
      ...(parsed.data.researchMode ? { p_research_mode: parsed.data.researchMode } : {}),
      ...(parsed.data.writingMode ? { p_writing_mode: parsed.data.writingMode } : {}),
      ...(parsed.data.imagesMode ? { p_images_mode: parsed.data.imagesMode } : {}),
      ...(parsed.data.auditMode ? { p_audit_mode: parsed.data.auditMode } : {}),
    });
    if (error) throw error;

    jobId = uuidSchema.parse(data);
  } catch (error) {
    return { ok: false, error: describe(error) };
  }

  revalidatePath("/admin");
  // `redirect` throws; it stays outside the try so it is never reported as a failure.
  redirect(`/admin/articles/${jobId}`);
}

// ---------------------------------------------------------------------------
// Workflow transitions
// ---------------------------------------------------------------------------

const ACTION_LABELS = {
  start: "Job started.",
  pause: "Job paused.",
  resume: "Job resumed.",
  retry: "Retry queued.",
  mark_needs_human: "Job escalated for a person to resolve.",
  resolve: "Escalation resolved.",
  schedule: "Publication scheduled.",
} as const satisfies Record<AdminAction, string>;

const transitionFormSchema = z.object({
  jobId: uuidSchema,
  action: z.enum(["start", "pause", "resume", "retry", "mark_needs_human", "resolve", "schedule"]),
  expectedLockVersion: z.coerce.number().int().nonnegative(),
  note: z
    .string()
    .max(2000)
    .transform((value) => value.trim())
    .optional(),
  toStatus: jobStatusSchema.optional(),
  desiredPublishAt: z.string().max(40).optional(),
});

/**
 * Applies one admin transition. The Phase 3 pure planner runs first so a stale page or an
 * impossible action is reported without a round trip; `admin_transition_job` then re-validates the
 * same rules against the committed row, which is what actually decides the outcome.
 */
export async function jobTransitionAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await authorizeAdminAction("write");

    const parsed = transitionFormSchema.safeParse({
      jobId: formData.get("jobId"),
      action: formData.get("action"),
      expectedLockVersion: formData.get("expectedLockVersion"),
      note: formData.get("note") === null ? undefined : String(formData.get("note")),
      toStatus: formData.get("toStatus") === null ? undefined : formData.get("toStatus"),
      desiredPublishAt:
        formData.get("desiredPublishAt") === null
          ? undefined
          : String(formData.get("desiredPublishAt")),
    });
    if (!parsed.success) {
      return { ok: false, error: firstIssue(parsed.error) };
    }
    const command = parsed.data;

    const client = await createSupabaseServerClient();
    const jobResult = await client
      .from("article_jobs")
      .select("*")
      .eq("id", command.jobId)
      .maybeSingle();
    if (jobResult.error) throw jobResult.error;
    if (!jobResult.data) return { ok: false, error: "That job no longer exists." };
    const job = articleJobSchema.parse(jobResult.data);

    let publishAt: string | undefined;
    if (command.action === "schedule") {
      const local = command.desiredPublishAt?.trim() ?? "";
      if (local.length > 0) {
        const converted = zonedLocalToUtcIso(local, siteConfig.timeZone);
        if (!converted) {
          return { ok: false, error: "Enter the publication time as a date and time." };
        }
        publishAt = converted;
      } else if (!job.desired_publish_at) {
        return { ok: false, error: "Choose when this article should be published." };
      }
    }

    planAdminTransition(
      {
        status: job.status,
        lockVersion: job.lock_version,
        revisionCount: job.revision_count,
        hasLease: job.lease_token !== null,
        pausedFromStatus: job.paused_from_status,
        failedStage: job.failed_stage,
        desiredPublishAt: publishAt ?? job.desired_publish_at,
      },
      {
        action: command.action,
        expectedLockVersion: command.expectedLockVersion,
        ...(command.note ? { note: command.note } : {}),
        ...(command.toStatus ? { toStatus: command.toStatus } : {}),
        ...(publishAt ? { desiredPublishAt: publishAt } : {}),
      },
    );

    const workflow = createAdminWorkflowService(client);
    switch (command.action) {
      case "start":
        await workflow.start(command.jobId, command.expectedLockVersion);
        break;
      case "pause":
        await workflow.pause(command.jobId, command.expectedLockVersion);
        break;
      case "resume":
        await workflow.resume(command.jobId, command.expectedLockVersion);
        break;
      case "retry":
        await workflow.retry(command.jobId, command.expectedLockVersion);
        break;
      case "mark_needs_human":
        if (!command.note) {
          return { ok: false, error: "Escalating requires a note explaining why." };
        }
        await workflow.markNeedsHuman(command.jobId, command.expectedLockVersion, command.note);
        break;
      case "resolve":
        if (!command.toStatus) {
          return { ok: false, error: "Choose what should happen next." };
        }
        // The database records a note with every resolution. When the editor adds none, the
        // choice itself is the record.
        await workflow.resolve(
          command.jobId,
          command.expectedLockVersion,
          command.toStatus,
          command.note || `Editor chose: ${resolutionChoiceLabel(command.toStatus)}.`,
        );
        break;
      case "schedule":
        await workflow.schedule(command.jobId, command.expectedLockVersion, publishAt);
        break;
    }

    revalidatePath("/admin");
    revalidatePath(`/admin/articles/${command.jobId}`);
    return { ok: true, message: ACTION_LABELS[command.action] };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

// ---------------------------------------------------------------------------
// Publication timing
// ---------------------------------------------------------------------------

const publicationFormSchema = z.object({
  jobId: uuidSchema,
  expectedLockVersion: z.coerce.number().int().nonnegative(),
});

const SCHEDULE_HORIZON_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Sets when a ready or scheduled article goes live; `null` means now. An APPROVED job is scheduled
 * through `admin_transition_job`, and a SCHEDULED one is moved through `admin_reschedule_job`.
 * Either way the job is SCHEDULED afterwards and the worker claims it once the time arrives, so a
 * time of now is picked up on the worker's next poll.
 */
async function setPublicationTime(
  jobId: string,
  expectedLockVersion: number,
  publishAt: string | null,
): Promise<ActionResult | null> {
  const client = await createSupabaseServerClient();
  const jobResult = await client
    .from("article_jobs")
    .select("status, lock_version")
    .eq("id", jobId)
    .maybeSingle();
  if (jobResult.error) throw jobResult.error;
  if (!jobResult.data) return { ok: false, error: "That job no longer exists." };
  if (jobResult.data.lock_version !== expectedLockVersion) {
    return {
      ok: false,
      error: "This job changed since the page was loaded. Reload it and try again.",
    };
  }

  if (jobResult.data.status === "APPROVED") {
    await createAdminWorkflowService(client).schedule(
      jobId,
      expectedLockVersion,
      publishAt ?? undefined,
    );
  } else if (jobResult.data.status === "SCHEDULED") {
    const { error } = await client.rpc("admin_reschedule_job", {
      p_job_id: jobId,
      p_expected_lock_version: expectedLockVersion,
      ...(publishAt ? { p_desired_publish_at: publishAt } : {}),
    });
    if (error) throw error;
  } else {
    return {
      ok: false,
      error: "Only an article that is ready or scheduled can be published. Reload the page.",
    };
  }
  return null;
}

/** Publishes a ready or scheduled article as soon as the worker next polls. */
export async function publishNowAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await authorizeAdminAction("write");
    const parsed = publicationFormSchema.safeParse({
      jobId: formData.get("jobId"),
      expectedLockVersion: formData.get("expectedLockVersion"),
    });
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

    const refused = await setPublicationTime(
      parsed.data.jobId,
      parsed.data.expectedLockVersion,
      null,
    );
    if (refused) return refused;

    revalidatePath("/admin");
    revalidatePath(`/admin/articles/${parsed.data.jobId}`);
    return {
      ok: true,
      message: "Publishing now. It goes live within a minute, then the site checks it.",
    };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

/** Schedules a ready article, or moves a scheduled one, to a wall-clock time in the site timezone. */
export async function schedulePublicationAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await authorizeAdminAction("write");
    const parsed = publicationFormSchema
      .extend({ desiredPublishAt: z.string().trim().max(40) })
      .safeParse({
        jobId: formData.get("jobId"),
        expectedLockVersion: formData.get("expectedLockVersion"),
        desiredPublishAt: String(formData.get("desiredPublishAt") ?? ""),
      });
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
    if (parsed.data.desiredPublishAt.length === 0) {
      return { ok: false, error: "Choose a date and time, or use Publish now." };
    }
    const publishAt = zonedLocalToUtcIso(parsed.data.desiredPublishAt, siteConfig.timeZone);
    if (!publishAt) {
      return { ok: false, error: "Enter the publication time as a date and time." };
    }
    if (Date.parse(publishAt) - Date.now() > SCHEDULE_HORIZON_MS) {
      return { ok: false, error: "Choose a time within the next year." };
    }

    const refused = await setPublicationTime(
      parsed.data.jobId,
      parsed.data.expectedLockVersion,
      publishAt,
    );
    if (refused) return refused;

    revalidatePath("/admin");
    revalidatePath(`/admin/articles/${parsed.data.jobId}`);
    return {
      ok: true,
      message:
        Date.parse(publishAt) <= Date.now()
          ? "That time has passed, so it is publishing now."
          : "Publication scheduled.",
    };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

// ---------------------------------------------------------------------------
// Withdrawal
// ---------------------------------------------------------------------------

const withdrawFormSchema = z.object({
  jobId: uuidSchema,
  expectedLockVersion: z.coerce.number().int().nonnegative(),
  reason: z
    .string()
    .transform((value) => value.trim())
    .pipe(
      z
        .string()
        .min(3, "must be at least 3 characters")
        .max(500, "must be 500 characters or fewer"),
    ),
});

/**
 * Takes a published article off the site. `admin_withdraw_article` re-authorizes the editor,
 * checks `lock_version`, marks the article withdrawn, cancels any pending verification, and
 * records the reason on the timeline; RLS then hides the article and its old slugs from public
 * reads. Every public cache entry carries the shared articles tag, so expiring it here removes the
 * page, the archive listing, the feed, the sitemap entry, and any aliased slug on the next request.
 */
export async function withdrawArticleAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await authorizeAdminAction("write");
    const parsed = withdrawFormSchema.safeParse({
      jobId: formData.get("jobId"),
      expectedLockVersion: formData.get("expectedLockVersion"),
      reason: String(formData.get("reason") ?? ""),
    });
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

    const client = await createSupabaseServerClient();
    const { data, error } = await client.rpc("admin_withdraw_article", {
      p_job_id: parsed.data.jobId,
      p_expected_lock_version: parsed.data.expectedLockVersion,
      p_reason: parsed.data.reason,
    });
    if (error) {
      const workflowError = toWorkflowError(error);
      if (workflowError.code === "LEASE_LOST") {
        return {
          ok: false,
          error: "The worker is verifying this article right now. Try again in a minute.",
        };
      }
      if (workflowError.code === "INVALID_TRANSITION") {
        return {
          ok: false,
          error: "This article is not live, or it was already withdrawn. Reload the job.",
        };
      }
      throw error;
    }
    const withdrawn = data[0];
    if (!withdrawn) throw new WorkflowError("NOT_FOUND", "That article no longer exists.");

    updateTag(PUBLIC_ARTICLES_TAG);
    updateTag(publicArticleTag(withdrawn.slug));
    revalidatePath("/admin");
    revalidatePath(`/admin/articles/${parsed.data.jobId}`);
    return { ok: true, message: `Withdrawn. /blog/${withdrawn.slug} no longer shows the article.` };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

const discardFormSchema = z.object({
  jobId: uuidSchema,
  expectedLockVersion: z.coerce.number().int().nonnegative(),
  reason: z
    .string()
    .transform((value) => value.trim())
    .pipe(
      z
        .string()
        .min(3, "must be at least 3 characters")
        .max(500, "must be 500 characters or fewer"),
    ),
});

/**
 * Turns down an unpublished job for good. `admin_discard_job` re-authorizes the editor, checks
 * `lock_version` and the transition map, refuses a stage running under a live lease, and records
 * the reason. Nothing public changes: an unpublished job was never on the site.
 */
export async function discardJobAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await authorizeAdminAction("write");
    const parsed = discardFormSchema.safeParse({
      jobId: formData.get("jobId"),
      expectedLockVersion: formData.get("expectedLockVersion"),
      reason: String(formData.get("reason") ?? ""),
    });
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

    const client = await createSupabaseServerClient();
    const { error } = await client.rpc("admin_discard_job", {
      p_job_id: parsed.data.jobId,
      p_expected_lock_version: parsed.data.expectedLockVersion,
      p_reason: parsed.data.reason,
    });
    if (error) {
      if (toWorkflowError(error).code === "LEASE_LOST") {
        return {
          ok: false,
          error: "The worker is running a stage of this job. Pause it first, or try again shortly.",
        };
      }
      throw error;
    }

    revalidatePath("/admin");
    revalidatePath(`/admin/articles/${parsed.data.jobId}`);
    return { ok: true, message: "Discarded. It will not be published." };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

// ---------------------------------------------------------------------------
// Topic discovery
// ---------------------------------------------------------------------------

const discoverySettingsSchema = z.object({
  enabled: z.boolean(),
  intervalMinutes: z.coerce.number().int().min(15).max(720),
  imageCount: z.coerce.number().int().min(0).max(1),
  autoPublish: z.boolean(),
  spacingMinutes: z.coerce.number().int().min(5).max(240),
  processingWindowHours: z.coerce.number().int().min(1).max(24),
  processingMaxArticles: z.coerce.number().int().min(1).max(24),
  backlogLimit: z.coerce.number().int().min(1).max(50),
  targets: z.array(
    z.object({ categoryId: uuidSchema, dailyTarget: z.coerce.number().int().min(0).max(12) }),
  ),
});

/**
 * Saves the discovery switch, interval, image count, and every category's daily target. Each
 * target is its own authorized RPC; the form posts them all so a cleared field is saved as 0.
 */
export async function updateDiscoverySettingsAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await authorizeAdminAction("write");
    const targets = [...formData.entries()]
      .filter(([key]) => key.startsWith("target:"))
      .map(([key, value]) => ({
        categoryId: key.slice("target:".length),
        dailyTarget: String(value).trim() === "" ? "0" : String(value),
      }));
    const parsed = discoverySettingsSchema.safeParse({
      enabled: formData.get("enabled") === "on",
      intervalMinutes: formData.get("intervalMinutes"),
      imageCount: formData.get("imageCount"),
      autoPublish: formData.get("autoPublish") === "on",
      spacingMinutes: formData.get("spacingMinutes"),
      processingWindowHours: formData.get("processingWindowHours"),
      processingMaxArticles: formData.get("processingMaxArticles"),
      backlogLimit: formData.get("backlogLimit"),
      targets,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return {
        ok: false,
        error:
          issue?.path[0] === "targets"
            ? "Daily targets must be whole numbers from 0 to 12."
            : firstIssue(parsed.error),
      };
    }

    const client = await createSupabaseServerClient();
    const { error } = await client.rpc("admin_update_discovery_settings", {
      p_enabled: parsed.data.enabled,
      p_interval_minutes: parsed.data.intervalMinutes,
      p_image_count: parsed.data.imageCount,
      p_auto_publish: parsed.data.autoPublish,
      p_spacing_minutes: parsed.data.spacingMinutes,
      p_processing_window_minutes: parsed.data.processingWindowHours * 60,
      p_processing_max_articles: parsed.data.processingMaxArticles,
      p_backlog_limit: parsed.data.backlogLimit,
    });
    if (error) throw error;
    for (const target of parsed.data.targets) {
      const result = await client.rpc("admin_update_topic_category", {
        p_category_id: target.categoryId,
        p_daily_target: target.dailyTarget,
      });
      if (result.error) throw result.error;
    }

    revalidatePath("/admin/settings");
    const total = parsed.data.targets.reduce((sum, target) => sum + target.dailyTarget, 0);
    return {
      ok: true,
      message: parsed.data.enabled
        ? `Discovery is on: up to ${total} article${total === 1 ? "" : "s"} a day, with no more than ${parsed.data.processingMaxArticles} entering processing every ${parsed.data.processingWindowHours} hours${
            parsed.data.autoPublish
              ? `, published ${parsed.data.spacingMinutes} minutes apart once each passes its check`
              : ""
          }.`
        : "Discovery settings saved. Discovery is off.",
    };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

/** Makes the worker's next poll scan now instead of waiting out the interval. */
export async function requestDiscoveryScanAction(): Promise<ActionResult> {
  try {
    await authorizeAdminAction("write");
    const client = await createSupabaseServerClient();
    const { error } = await client.rpc("admin_request_discovery_scan");
    if (error) throw error;
    revalidatePath("/admin/settings");
    return {
      ok: true,
      message:
        "Scan requested. The worker starts it within a minute if a category still needs an article today.",
    };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

// ---------------------------------------------------------------------------
// Prompt versions
// ---------------------------------------------------------------------------

const promptVersionSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/, "is not a valid prompt key"),
  content: z.string().trim().min(1, "is required").max(100_000),
  notes: optionalText(2000),
  activate: z.boolean(),
});

const activatePromptSchema = z.object({ templateId: uuidSchema });

function variablesSchemaFor(content: string): Json {
  const names = [
    ...new Set([...content.matchAll(/\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g)].map((match) => match[1]!)),
  ].sort();
  return {
    type: "object",
    properties: Object.fromEntries(names.map((name) => [name, { type: "string" }])),
    required: names,
    additionalProperties: false,
  };
}

/** Saves an edit as a new immutable version and normally makes it active immediately. */
export async function createPromptVersionAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await authorizeAdminAction("write");
    const parsed = promptVersionSchema.safeParse({
      key: formData.get("key"),
      content: String(formData.get("content") ?? ""),
      notes: String(formData.get("notes") ?? ""),
      activate: formData.get("activate") === "on",
    });
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

    const client = await createSupabaseServerClient();
    const { data, error } = await client.rpc("admin_create_prompt_version", {
      p_key: parsed.data.key,
      p_content: parsed.data.content,
      p_notes: parsed.data.notes ?? "",
      p_variables_schema: variablesSchemaFor(parsed.data.content),
      p_activate: parsed.data.activate,
    });
    if (error) throw error;
    const version = data[0]?.version;
    if (!version) throw new WorkflowError("NOT_FOUND", "The prompt version was not created.");

    revalidatePath("/admin/prompts");
    return {
      ok: true,
      message: `Prompt version ${version} saved${parsed.data.activate ? " and activated" : ""}.`,
    };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

/** Activating an older immutable version is the prompt rollback operation. */
export async function activatePromptTemplateAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await authorizeAdminAction("write");
    const parsed = activatePromptSchema.safeParse({ templateId: formData.get("templateId") });
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

    const client = await createSupabaseServerClient();
    const { data, error } = await client.rpc("admin_activate_prompt_template", {
      p_template_id: parsed.data.templateId,
    });
    if (error) throw error;
    const activated = data[0];
    if (!activated) throw new WorkflowError("NOT_FOUND", "That prompt version no longer exists.");

    revalidatePath("/admin/prompts");
    return { ok: true, message: `${activated.key} v${activated.version} is active.` };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const settingsSchema = z
  .object({
    defaultBylineName: z.string().trim().min(1, "is required").max(120),
    defaultBylineRole: optionalText(120),
    editorialContactEmail: optionalText(200).refine(
      (value) => value === null || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value),
      "must be an email address",
    ),
    seoDefaultTitle: optionalText(70),
    seoDefaultDescription: optionalText(320),
    shareImagePath: optionalText(512),
    workerStaleAfterSeconds: z.coerce.number().int().min(10).max(3600),
    workerOfflineAfterSeconds: z.coerce.number().int().min(20).max(7200),
    autoPublishDefault: z.boolean(),
  })
  .refine((value) => value.workerOfflineAfterSeconds > value.workerStaleAfterSeconds, {
    message: "Offline threshold must be longer than the stale threshold",
    path: ["workerOfflineAfterSeconds"],
  });

export async function updateSiteSettingsAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await authorizeAdminAction("write");

    const parsed = settingsSchema.safeParse({
      defaultBylineName: String(formData.get("defaultBylineName") ?? ""),
      defaultBylineRole: String(formData.get("defaultBylineRole") ?? ""),
      editorialContactEmail: String(formData.get("editorialContactEmail") ?? ""),
      seoDefaultTitle: String(formData.get("seoDefaultTitle") ?? ""),
      seoDefaultDescription: String(formData.get("seoDefaultDescription") ?? ""),
      shareImagePath: String(formData.get("shareImagePath") ?? ""),
      workerStaleAfterSeconds: String(formData.get("workerStaleAfterSeconds") ?? ""),
      workerOfflineAfterSeconds: String(formData.get("workerOfflineAfterSeconds") ?? ""),
      autoPublishDefault: formData.get("autoPublishDefault") === "on",
    });
    if (!parsed.success) {
      return { ok: false, error: firstIssue(parsed.error) };
    }

    const client = await createSupabaseServerClient();
    // The function turns an empty string back into null, which is how an optional value is cleared.
    const { error } = await client.rpc("admin_update_site_settings", {
      p_default_byline_name: parsed.data.defaultBylineName,
      p_default_byline_role: parsed.data.defaultBylineRole ?? "",
      p_editorial_contact_email: parsed.data.editorialContactEmail ?? "",
      p_seo_default_title: parsed.data.seoDefaultTitle ?? "",
      p_seo_default_description: parsed.data.seoDefaultDescription ?? "",
      p_share_image_path: parsed.data.shareImagePath ?? "",
      p_worker_stale_after_seconds: parsed.data.workerStaleAfterSeconds,
      p_worker_offline_after_seconds: parsed.data.workerOfflineAfterSeconds,
      p_auto_publish_default: parsed.data.autoPublishDefault,
    });
    if (error) throw error;

    revalidatePath("/admin/settings");
    revalidatePath("/admin");
    return { ok: true, message: "Settings saved." };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

const identitySchema = z.object({
  name: z.string().trim().min(1, "is required").max(80),
  description: z.string().trim().max(500),
  disclosure: z.string().trim().max(1000),
  timezone: z.string().trim().min(1, "is required").max(60),
});

export async function updateSiteIdentityAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await authorizeAdminAction("own");

    const parsed = identitySchema.safeParse({
      name: String(formData.get("name") ?? ""),
      description: String(formData.get("description") ?? ""),
      disclosure: String(formData.get("disclosure") ?? ""),
      timezone: String(formData.get("timezone") ?? ""),
    });
    if (!parsed.success) {
      return { ok: false, error: firstIssue(parsed.error) };
    }

    const client = await createSupabaseServerClient();
    const { error } = await client.rpc("admin_update_site_identity", {
      p_name: parsed.data.name,
      p_description: parsed.data.description,
      p_disclosure: parsed.data.disclosure,
      p_timezone: parsed.data.timezone,
    });
    if (error) {
      // The database validates the timezone against pg_timezone_names.
      if (toWorkflowError(error).sqlState === "22023") {
        throw new WorkflowError("INVALID_ARGUMENT", "That is not a recognised timezone name.");
      }
      throw error;
    }

    revalidatePath("/admin/settings");
    return { ok: true, message: "Publication identity saved." };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}
