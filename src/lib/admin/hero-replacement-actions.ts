"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";

import { authorizeAdminAction } from "@/lib/auth/dal";
import { PUBLIC_ARTICLES_TAG, publicArticleTag } from "@/lib/publication/repository";
import { toWorkflowError, WorkflowError } from "@/lib/state-machine/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/validation/domain";

import type { ActionResult, ManualImageUploadPreparationResult } from "./action-result";
import { inspectImageFile, type InspectedImage } from "./image-file";

/**
 * Replacing the hero image of a live article.
 *
 * The console owns the request and the editorial decision only. It can never place the bytes on
 * the site: no browser role may write the public bucket, and the web app is denied the service-role
 * key, so the worker does the drawing and the copying on its own lane. These actions therefore
 * write rows and return quickly; the picture appears when the worker next polls.
 */

const UPLOAD_MIME_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/avif": "avif",
} as const;

const requestSchema = z.object({
  jobId: uuidSchema,
  expectedLockVersion: z.coerce.number().int().nonnegative(),
  mode: z.enum(["regenerate", "upload"]),
  direction: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().max(2000, "must be 2000 characters or fewer"))
    .transform((value) => (value.length > 0 ? value : null)),
});

const uploadPreparationSchema = z.object({
  jobId: uuidSchema,
  replacementId: uuidSchema,
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp", "image/avif"]),
  byteSize: z.coerce.number().int().min(1).max(10_485_760),
});

const attachSchema = z.object({
  jobId: uuidSchema,
  replacementId: uuidSchema,
  privatePath: z.string().min(1),
  altText: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1, "is required").max(300, "must be 300 characters or fewer")),
  caption: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().max(500, "must be 500 characters or fewer"))
    .transform((value) => (value.length > 0 ? value : null)),
});

const reviewSchema = z.object({
  jobId: uuidSchema,
  replacementId: uuidSchema,
  approve: z.enum(["yes", "no"]).transform((value) => value === "yes"),
  note: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().max(2000, "must be 2000 characters or fewer"))
    .transform((value) => (value.length > 0 ? value : null)),
});

const cancelSchema = z.object({ jobId: uuidSchema, replacementId: uuidSchema });

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue ? `${issue.path.join(".") || "input"}: ${issue.message}` : "Invalid input.";
}

/** Failures an editor can act on. Anything else stays in the server log, as elsewhere. */
function describe(error: unknown): string {
  const workflowError = toWorkflowError(error);
  switch (workflowError.code) {
    case "INVALID_ARGUMENT":
    case "GATE_NOT_MET":
    case "NOT_AUTHORIZED":
      return workflowError.message;
    case "INVALID_TRANSITION":
      return "This replacement has already moved on. Reload the article to see where it is.";
    case "LEASE_LOST":
      return "The worker is already working on a replacement for this article. Try again shortly.";
    case "STALE_JOB":
      return "The article changed since this page was loaded. Reload it and try again.";
    case "NOT_FOUND":
      return "That replacement no longer exists. Reload the article.";
    default:
      return "Something went wrong. Check the worker log and try again.";
  }
}

function revalidateArticle(jobId: string): void {
  revalidatePath("/admin");
  revalidatePath(`/admin/articles/${jobId}`);
}

export async function requestHeroReplacementAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await authorizeAdminAction("write");
    const parsed = requestSchema.safeParse({
      jobId: formData.get("jobId"),
      expectedLockVersion: formData.get("expectedLockVersion"),
      mode: formData.get("mode"),
      direction: String(formData.get("direction") ?? ""),
    });
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

    const client = await createSupabaseServerClient();
    const { data, error } = await client.rpc("admin_request_hero_replacement", {
      p_job_id: parsed.data.jobId,
      p_expected_lock_version: parsed.data.expectedLockVersion,
      p_mode: parsed.data.mode,
      p_direction: parsed.data.direction ?? undefined,
    });
    if (error) throw toWorkflowError(error);
    if (!data[0]) throw new WorkflowError("DATABASE_ERROR", "The request was not recorded.");

    revalidateArticle(parsed.data.jobId);
    return {
      ok: true,
      message:
        parsed.data.mode === "regenerate"
          ? "Asked for a new image. The worker will draw it and bring it back for approval."
          : "Ready for your file. Upload the image you generated, then approve it.",
    };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

/**
 * A short-lived, path-scoped upload capability, so the browser sends the bytes straight to private
 * Storage. Routing a 10 MiB file through a Server Action would hit the platform's request limit.
 */
export async function prepareHeroReplacementUploadAction(
  formData: FormData,
): Promise<ManualImageUploadPreparationResult> {
  try {
    await authorizeAdminAction("write");
    const parsed = uploadPreparationSchema.safeParse({
      jobId: formData.get("jobId"),
      replacementId: formData.get("replacementId"),
      mimeType: formData.get("mimeType"),
      byteSize: formData.get("byteSize"),
    });
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

    const client = await createSupabaseServerClient();
    const extension = UPLOAD_MIME_TYPES[parsed.data.mimeType];
    const path = `jobs/${parsed.data.jobId}/replacement/${parsed.data.replacementId}/hero-${randomUUID()}.${extension}`;
    // The storage policy re-checks that this replacement is open and in upload mode.
    const prepared = await client.storage
      .from("article-work")
      .createSignedUploadUrl(path, { upsert: false });
    if (prepared.error) {
      return { ok: false, error: `Could not prepare the upload: ${prepared.error.message}` };
    }
    return { ok: true, upload: { path, token: prepared.data.token } };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

export async function attachHeroReplacementUploadAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await authorizeAdminAction("write");
    const parsed = attachSchema.safeParse({
      jobId: formData.get("jobId"),
      replacementId: formData.get("replacementId"),
      privatePath: String(formData.get("privatePath") ?? ""),
      altText: String(formData.get("altText") ?? ""),
      caption: String(formData.get("caption") ?? ""),
    });
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

    const expectedPath = new RegExp(
      `^jobs/${parsed.data.jobId}/replacement/${parsed.data.replacementId}/hero-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(png|jpg|webp|avif)$`,
    );
    if (!expectedPath.test(parsed.data.privatePath)) {
      return { ok: false, error: "That uploaded file does not belong to this replacement." };
    }

    const client = await createSupabaseServerClient();
    const downloaded = await client.storage.from("article-work").download(parsed.data.privatePath);
    if (downloaded.error) {
      return { ok: false, error: "The upload could not be read back from private Storage." };
    }
    let inspected: InspectedImage;
    try {
      inspected = await inspectImageFile(downloaded.data);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Unreadable image." };
    }
    if (!parsed.data.privatePath.endsWith(`.${inspected.extension}`)) {
      return { ok: false, error: "The file extension does not match the image bytes." };
    }

    const { data, error } = await client.rpc("admin_attach_hero_replacement_image", {
      p_replacement_id: parsed.data.replacementId,
      p_metadata: {
        altText: parsed.data.altText,
        caption: parsed.data.caption,
        aspectRatio: "16:9",
      },
      p_private_path: parsed.data.privatePath,
      p_mime_type: inspected.mimeType,
      p_byte_size: inspected.byteSize,
      p_content_hash: inspected.contentHash,
      p_width: inspected.width,
      p_height: inspected.height,
    });
    if (error) throw toWorkflowError(error);
    if (!data[0]) throw new WorkflowError("DATABASE_ERROR", "The image was not recorded.");

    revalidateArticle(parsed.data.jobId);
    return { ok: true, message: "Uploaded. Check it below, then approve it to go live." };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

export async function reviewHeroReplacementAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await authorizeAdminAction("write");
    const parsed = reviewSchema.safeParse({
      jobId: formData.get("jobId"),
      replacementId: formData.get("replacementId"),
      approve: formData.get("approve"),
      note: String(formData.get("note") ?? ""),
    });
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

    const client = await createSupabaseServerClient();
    const { error } = await client.rpc("admin_review_hero_replacement", {
      p_replacement_id: parsed.data.replacementId,
      p_approve: parsed.data.approve,
      p_note: parsed.data.note ?? undefined,
    });
    if (error) throw toWorkflowError(error);

    // The live page changes only once the worker copies the bytes, so the public cache is left
    // alone here; the worker revalidates the slug itself when the swap lands.
    revalidateArticle(parsed.data.jobId);
    return {
      ok: true,
      message: parsed.data.approve
        ? "Approved. The worker will put it live within a poll or so."
        : "Turned down. Ask for another one whenever you like.",
    };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

export async function cancelHeroReplacementAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await authorizeAdminAction("write");
    const parsed = cancelSchema.safeParse({
      jobId: formData.get("jobId"),
      replacementId: formData.get("replacementId"),
    });
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

    const client = await createSupabaseServerClient();
    const { error } = await client.rpc("admin_cancel_hero_replacement", {
      p_replacement_id: parsed.data.replacementId,
      p_note: undefined,
    });
    if (error) throw toWorkflowError(error);

    revalidateArticle(parsed.data.jobId);
    return { ok: true, message: "Cancelled. The live image is unchanged." };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

/**
 * Expires the public cache for an article whose hero the worker has already swapped.
 *
 * The worker calls the revalidation endpoint itself, so this is only for the case where that call
 * failed and the editor wants the page refreshed by hand.
 */
export async function refreshArticleCacheAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await authorizeAdminAction("write");
    const slug = String(formData.get("slug") ?? "").trim();
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
      return { ok: false, error: "That is not a valid article slug." };
    }
    updateTag(PUBLIC_ARTICLES_TAG);
    updateTag(publicArticleTag(slug));
    return { ok: true, message: `Cache cleared for /blog/${slug}.` };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}
