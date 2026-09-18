"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { authorizeAdminAction } from "@/lib/auth/dal";
import { toWorkflowError, WorkflowError } from "@/lib/state-machine/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { pipelineStageSchema, providerModeSchema, uuidSchema } from "@/lib/validation/domain";

import type { ActionResult } from "./action-result";
import { inspectImageFile, type InspectedImage } from "./image-file";
import {
  manualImageMetadataSchema,
  manualValidationError,
  parseManualTextOutput,
} from "./manual-validation";

const idSchema = z.object({ jobId: uuidSchema, runId: uuidSchema });

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue ? `${issue.path.join(".") || "input"}: ${issue.message}` : "Invalid input.";
}

/**
 * Messages for failures an editor can act on. The import functions raise their own validation text
 * (`22023`, `FT005`), which names the problem without quoting the response, so it is shown as is.
 * Anything unexpected stays in the server log, matching the other console actions.
 */
function describe(error: unknown): string {
  const workflowError = toWorkflowError(error);
  switch (workflowError.code) {
    case "INVALID_ARGUMENT":
    case "GATE_NOT_MET":
    case "NOT_AUTHORIZED":
      return workflowError.message;
    case "INVALID_TRANSITION":
      return "The job is not at this manual step any more; it may be paused or have moved on. Reload the job.";
    case "STALE_JOB":
      return "This manual step changed since the page was loaded. Reload the job and try again.";
    case "IMMUTABLE_HISTORY":
      return "A response for this step was already accepted. Reload the job to see it.";
    case "NOT_FOUND":
      return "That job, provider run, or uploaded file no longer exists. Reload the job.";
    default:
      console.error("manual import failed", {
        code: workflowError.code,
        sqlState: workflowError.sqlState,
      });
      return "The import could not be completed. Check the logs and try again.";
  }
}

function resultLabel(outputRef: unknown): string {
  if (!outputRef || typeof outputRef !== "object") return "the accepted artifact";
  const ref = outputRef as Record<string, unknown>;
  const version = typeof ref.version === "number" ? ` v${ref.version}` : "";
  if (typeof ref.research_packet_id === "string") return `research packet${version}`;
  if (typeof ref.draft_id === "string") return `draft${version}`;
  if (typeof ref.audit_id === "string") return `audit${version}`;
  return "the accepted artifact";
}

/**
 * Loads the run and whether its job is waiting on it right now. The database repeats this check
 * inside the import transaction; checking first keeps a paused job from receiving an upload that
 * could never be attached (working objects are immutable, so it could not be removed either).
 */
async function loadManualRun(jobId: string, runId: string) {
  const client = await createSupabaseServerClient();
  const [runResult, jobResult] = await Promise.all([
    client
      .from("provider_runs")
      .select("id, job_id, stage, mode, status, output_ref")
      .eq("id", runId)
      .eq("job_id", jobId)
      .maybeSingle(),
    client
      .from("article_jobs")
      .select("status, image_count, action_required_kind, action_required_run_id")
      .eq("id", jobId)
      .maybeSingle(),
  ]);
  if (runResult.error) throw toWorkflowError(runResult.error);
  if (jobResult.error) throw toWorkflowError(jobResult.error);
  if (!runResult.data || !jobResult.data) {
    throw new WorkflowError("NOT_FOUND", "That manual provider run no longer exists.");
  }
  const job = jobResult.data;
  return {
    client,
    run: runResult.data,
    imageCount: job.image_count,
    paused: job.status === "PAUSED",
    waiting:
      job.status !== "PAUSED" &&
      job.action_required_kind === "manual_input" &&
      job.action_required_run_id === runId,
  };
}

const PAUSED_MESSAGE = "The job is paused. Resume it before continuing this manual step.";
const NOT_WAITING_MESSAGE =
  "The job is not waiting for this manual step any more. Reload the job to see where it is.";

export async function importManualTextAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await authorizeAdminAction("write");
    const ids = idSchema.safeParse({ jobId: formData.get("jobId"), runId: formData.get("runId") });
    if (!ids.success) return { ok: false, error: firstIssue(ids.error) };

    const { client, run, paused, waiting } = await loadManualRun(ids.data.jobId, ids.data.runId);
    if (run.status === "succeeded") {
      return {
        ok: true,
        message: `This response was already accepted as ${resultLabel(run.output_ref)}.`,
      };
    }
    if (run.status !== "action_required") {
      return { ok: false, error: `This provider run is ${run.status}, not waiting for input.` };
    }
    if (paused) return { ok: false, error: PAUSED_MESSAGE };
    if (!waiting) return { ok: false, error: NOT_WAITING_MESSAGE };

    const stage = pipelineStageSchema.parse(run.stage);
    const mode = providerModeSchema.parse(run.mode);
    const expectedMode =
      stage === "research" || stage === "audit"
        ? "manual_chatgpt"
        : stage === "draft" || stage === "revision"
          ? "manual_claude"
          : null;
    if (mode !== expectedMode) {
      return { ok: false, error: `The ${stage} run does not accept a pasted manual response.` };
    }

    const parsed = parseManualTextOutput(stage, String(formData.get("response") ?? ""));
    if (!parsed.ok) return { ok: false, error: parsed.error };

    const { data, error } = await client.rpc("admin_import_manual_result", {
      p_job_id: ids.data.jobId,
      p_run_id: ids.data.runId,
      p_output: parsed.value,
    });
    if (error) throw toWorkflowError(error);
    const imported = data[0];
    if (!imported) throw new WorkflowError("DATABASE_ERROR", "The response was not imported.");

    revalidatePath("/admin");
    revalidatePath(`/admin/articles/${ids.data.jobId}`);
    return {
      ok: true,
      message: `${stage === "research" ? "Research packet" : stage === "audit" ? "Audit" : "Draft"} v${imported.artifact_version} accepted.`,
    };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

export async function uploadManualImageAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await authorizeAdminAction("write");
    const ids = idSchema.safeParse({ jobId: formData.get("jobId"), runId: formData.get("runId") });
    if (!ids.success) return { ok: false, error: firstIssue(ids.error) };
    const metadata = manualImageMetadataSchema.safeParse({
      slot: formData.get("slot"),
      role: formData.get("role"),
      purpose: String(formData.get("purpose") ?? ""),
      prompt: String(formData.get("prompt") ?? ""),
      altText: String(formData.get("altText") ?? ""),
      caption: String(formData.get("caption") ?? ""),
      aspectRatio: formData.get("aspectRatio"),
      focalX: String(formData.get("focalX") ?? ""),
      focalY: String(formData.get("focalY") ?? ""),
    });
    if (!metadata.success) return { ok: false, error: manualValidationError(metadata.error) };

    const file = formData.get("file");
    if (!(file instanceof File)) return { ok: false, error: "Choose an image file." };
    let inspected: InspectedImage;
    try {
      inspected = await inspectImageFile(file);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Unreadable image." };
    }
    const { client, run, imageCount, paused, waiting } = await loadManualRun(
      ids.data.jobId,
      ids.data.runId,
    );
    if (paused) return { ok: false, error: PAUSED_MESSAGE };
    if (
      !waiting ||
      run.status !== "action_required" ||
      run.stage !== "images" ||
      run.mode !== "manual_gemini"
    ) {
      return { ok: false, error: "This job is no longer waiting for a manual Gemini image." };
    }
    if (metadata.data.slot >= imageCount) {
      return { ok: false, error: `Slot ${metadata.data.slot} was not requested for this job.` };
    }

    const path = `jobs/${ids.data.jobId}/manual/${ids.data.runId}/slot-${metadata.data.slot}-${randomUUID()}.${inspected.extension}`;
    const uploaded = await client.storage.from("article-work").upload(path, inspected.bytes, {
      contentType: inspected.mimeType,
      upsert: false,
    });
    if (uploaded.error) {
      return { ok: false, error: `Could not upload the image: ${uploaded.error.message}` };
    }

    const { data, error } = await client.rpc("admin_import_manual_image", {
      p_job_id: ids.data.jobId,
      p_run_id: ids.data.runId,
      p_slot: metadata.data.slot,
      p_metadata: metadata.data,
      p_private_path: path,
      p_mime_type: inspected.mimeType,
      p_byte_size: inspected.byteSize,
      p_content_hash: inspected.contentHash,
      p_width: inspected.width,
      p_height: inspected.height,
    });
    if (error) throw toWorkflowError(error);
    const imported = data[0];
    if (!imported)
      throw new WorkflowError("DATABASE_ERROR", "The image metadata was not recorded.");

    revalidatePath("/admin");
    revalidatePath(`/admin/articles/${ids.data.jobId}`);
    return {
      ok: true,
      message: `Slot ${metadata.data.slot} image v${imported.image_version} is ready.`,
    };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

export async function completeManualImagesAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await authorizeAdminAction("write");
    const ids = idSchema.safeParse({ jobId: formData.get("jobId"), runId: formData.get("runId") });
    if (!ids.success) return { ok: false, error: firstIssue(ids.error) };
    const { client, paused, waiting } = await loadManualRun(ids.data.jobId, ids.data.runId);
    if (paused) return { ok: false, error: PAUSED_MESSAGE };
    if (!waiting) return { ok: false, error: NOT_WAITING_MESSAGE };
    const { error } = await client.rpc("admin_complete_manual_images", {
      p_job_id: ids.data.jobId,
      p_run_id: ids.data.runId,
    });
    if (error) throw toWorkflowError(error);

    revalidatePath("/admin");
    revalidatePath(`/admin/articles/${ids.data.jobId}`);
    return { ok: true, message: "Images accepted; the audit stage is ready." };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}
