"use client";

import { useRouter } from "next/navigation";
import { useActionState, useId, useState, type FormEvent } from "react";

import { idleActionResult, type ActionResult } from "@/lib/admin/action-result";
import {
  attachHeroReplacementUploadAction,
  cancelHeroReplacementAction,
  prepareHeroReplacementUploadAction,
  requestHeroReplacementAction,
  reviewHeroReplacementAction,
} from "@/lib/admin/hero-replacement-actions";
import type { HeroReplacement } from "@/lib/admin/jobs";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

import { Field, FormMessage, controlClass, textAreaClass } from "./form";
import { SubmitButton } from "./submit-button";

/**
 * Replacing the picture on an article that is already live.
 *
 * The panel shows the hero the reader currently sees next to whatever candidate is in flight, so
 * the decision is a comparison rather than a leap of faith. Nothing here touches the article's
 * words: approving a candidate swaps the image and nothing else.
 *
 * Two routes in. "Draw a new one" asks the worker to run the image prompt again, which needs the
 * job's image stage to be on an automatic provider. "I'll supply the file" is always available and
 * is the route when the stage is manual, or when the editor simply wants a specific picture.
 */

export type HeroPreview = Readonly<{
  url: string;
  alt: string;
  caption: string | null;
  width: number | null;
  height: number | null;
}>;

type PanelProps = Readonly<{
  jobId: string;
  lockVersion: number;
  slug: string;
  canEdit: boolean;
  /** True when the job's images stage can draw unattended (gemini_api or codex_image). */
  canRegenerate: boolean;
  imagesMode: string;
  live: HeroPreview | null;
  candidate: HeroPreview | null;
  replacement: HeroReplacement | null;
}>;

const OPEN_STATUSES = new Set(["pending", "drawing", "awaiting_review", "approved", "applying"]);

const STATUS_TEXT: Readonly<Record<HeroReplacement["status"], string>> = {
  pending: "Waiting for the worker to pick it up.",
  drawing: "The worker is drawing a new image now.",
  awaiting_review: "A new image is ready for your decision.",
  approved: "Approved. The worker is about to put it live.",
  applying: "Going live now.",
  applied: "This image is live on the article.",
  rejected: "You turned this one down.",
  cancelled: "Cancelled. The live image was left alone.",
  failed: "The worker could not produce an image.",
};

function ImageCard({
  heading,
  preview,
  empty,
}: {
  heading: string;
  preview: HeroPreview | null;
  empty: string;
}) {
  return (
    <figure className="grid gap-2">
      <figcaption className="text-xs font-medium text-text-muted">{heading}</figcaption>
      {preview ? (
        <>
          {/* A signed private-bucket URL, so the optimiser is bypassed deliberately. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt={preview.alt}
            className="w-full rounded-panel border border-border bg-canvas"
            src={preview.url}
          />
          <span className="text-[11px] text-text-subtle">{preview.alt}</span>
        </>
      ) : (
        <div className="grid aspect-video place-items-center rounded-panel border border-dashed border-border text-xs text-text-subtle">
          {empty}
        </div>
      )}
    </figure>
  );
}

function RequestForm({
  jobId,
  lockVersion,
  mode,
  canRegenerate,
  imagesMode,
}: Pick<PanelProps, "jobId" | "lockVersion" | "canRegenerate" | "imagesMode"> & {
  mode: "regenerate" | "upload";
}) {
  const [state, action] = useActionState(requestHeroReplacementAction, idleActionResult);
  const id = useId();
  const blocked = mode === "regenerate" && !canRegenerate;

  return (
    <form action={action} className="grid gap-2">
      <input name="jobId" type="hidden" value={jobId} />
      <input name="expectedLockVersion" type="hidden" value={lockVersion} />
      <input name="mode" type="hidden" value={mode} />
      <FormMessage state={state} />
      {blocked ? (
        <p className="text-xs text-text-muted">
          This article&rsquo;s image stage is set to <code>{imagesMode}</code>, which cannot draw on
          its own. Supply the file instead, or change the images provider in Settings.
        </p>
      ) : (
        <Field
          hint="Optional. Say what was wrong with the current picture, or what you want instead. The house style is applied regardless."
          htmlFor={`${id}-direction`}
          label="Extra direction"
        >
          <textarea
            aria-describedby={`${id}-direction-hint`}
            className={textAreaClass}
            id={`${id}-direction`}
            maxLength={2000}
            name="direction"
            rows={3}
          />
        </Field>
      )}
      <div>
        <SubmitButton disabled={blocked} pendingLabel="Asking…">
          {mode === "regenerate" ? "Draw a new one" : "I'll supply the file"}
        </SubmitButton>
      </div>
    </form>
  );
}

function UploadForm({
  jobId,
  replacementId,
  canEdit,
}: {
  jobId: string;
  replacementId: string;
  canEdit: boolean;
}) {
  const [state, setState] = useState<ActionResult>(idleActionResult);
  const [pending, setPending] = useState(false);
  const router = useRouter();
  const id = useId();

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit || pending) return;

    const formData = new FormData(event.currentTarget);
    const file = formData.get("file");
    if (!(file instanceof File) || file.size < 1) {
      setState({ ok: false, error: "Choose a non-empty image file." });
      return;
    }
    if (file.size > 10_485_760) {
      setState({ ok: false, error: "The image is larger than the 10 MB limit." });
      return;
    }
    if (!["image/png", "image/jpeg", "image/webp", "image/avif"].includes(file.type)) {
      setState({ ok: false, error: "Choose a PNG, JPEG, WebP, or AVIF image." });
      return;
    }

    setPending(true);
    setState(idleActionResult);
    try {
      const preparation = new FormData();
      preparation.set("jobId", jobId);
      preparation.set("replacementId", replacementId);
      preparation.set("mimeType", file.type);
      preparation.set("byteSize", String(file.size));
      const prepared = await prepareHeroReplacementUploadAction(preparation);
      if (!prepared.ok) {
        setState(prepared);
        return;
      }

      const uploaded = await getSupabaseBrowserClient()
        .storage.from("article-work")
        .uploadToSignedUrl(prepared.upload.path, prepared.upload.token, file, {
          contentType: file.type,
          upsert: false,
        });
      if (uploaded.error) {
        setState({ ok: false, error: `Could not upload the image: ${uploaded.error.message}` });
        return;
      }

      // The bytes went straight to Storage; the action reads them back and derives the file facts.
      formData.delete("file");
      formData.set("privatePath", prepared.upload.path);
      const attached = await attachHeroReplacementUploadAction(idleActionResult, formData);
      setState(attached);
      if (attached.ok) router.refresh();
    } catch (error) {
      setState({
        ok: false,
        error: error instanceof Error ? error.message : "The upload could not be completed.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="grid gap-3" onSubmit={upload}>
      <FormMessage state={state} />
      <input name="jobId" type="hidden" value={jobId} />
      <input name="replacementId" type="hidden" value={replacementId} />
      <Field
        htmlFor={`${id}-file`}
        label="Replacement image"
        meta="PNG, JPEG, WebP or AVIF"
        required
      >
        <input
          accept="image/png,image/jpeg,image/webp,image/avif"
          className={controlClass}
          id={`${id}-file`}
          name="file"
          required
          type="file"
        />
      </Field>
      <Field
        hint="What is in the picture, for a reader who cannot see it. Not the headline."
        htmlFor={`${id}-alt`}
        label="Alt text"
        required
      >
        <input
          aria-describedby={`${id}-alt-hint`}
          className={controlClass}
          id={`${id}-alt`}
          maxLength={300}
          name="altText"
          required
          type="text"
        />
      </Field>
      <Field htmlFor={`${id}-caption`} label="Caption" meta="Optional">
        <input
          className={controlClass}
          id={`${id}-caption`}
          maxLength={500}
          name="caption"
          type="text"
        />
      </Field>
      <div>
        <button className={controlClass} disabled={!canEdit || pending} type="submit">
          {pending ? "Uploading…" : "Upload"}
        </button>
      </div>
    </form>
  );
}

function ReviewForm({ jobId, replacementId }: { jobId: string; replacementId: string }) {
  const [state, action] = useActionState(reviewHeroReplacementAction, idleActionResult);
  const id = useId();
  return (
    <form action={action} className="grid gap-2">
      <input name="jobId" type="hidden" value={jobId} />
      <input name="replacementId" type="hidden" value={replacementId} />
      <FormMessage state={state} />
      <Field htmlFor={`${id}-note`} label="Note" meta="Optional, kept on the article's history">
        <input
          className={controlClass}
          id={`${id}-note`}
          maxLength={2000}
          name="note"
          type="text"
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <SubmitButton name="approve" pendingLabel="Approving…" value="yes">
          Use this image
        </SubmitButton>
        <SubmitButton name="approve" pendingLabel="Discarding…" value="no" variant="danger">
          Turn it down
        </SubmitButton>
      </div>
    </form>
  );
}

function CancelForm({ jobId, replacementId }: { jobId: string; replacementId: string }) {
  const [state, action] = useActionState(cancelHeroReplacementAction, idleActionResult);
  return (
    <form action={action} className="grid gap-2">
      <input name="jobId" type="hidden" value={jobId} />
      <input name="replacementId" type="hidden" value={replacementId} />
      <FormMessage state={state} />
      <div>
        <SubmitButton pendingLabel="Cancelling…" variant="secondary">
          Cancel this replacement
        </SubmitButton>
      </div>
    </form>
  );
}

export function HeroReplacementPanel({
  jobId,
  lockVersion,
  slug,
  canEdit,
  canRegenerate,
  imagesMode,
  live,
  candidate,
  replacement,
}: PanelProps) {
  const open = replacement !== null && OPEN_STATUSES.has(replacement.status);

  return (
    <section className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <ImageCard
          empty="This article has no hero image."
          heading="On the site now"
          preview={live}
        />
        <ImageCard
          empty={open ? "Nothing to look at yet." : "No replacement in progress."}
          heading="Proposed replacement"
          preview={candidate}
        />
      </div>

      {replacement ? (
        <div className="grid gap-1 rounded-panel border border-border bg-canvas p-3">
          <p className="text-sm">{STATUS_TEXT[replacement.status]}</p>
          {replacement.direction ? (
            <p className="text-xs text-text-muted">
              Your direction: <span className="italic">{replacement.direction}</span>
            </p>
          ) : null}
          {replacement.error_summary ? (
            <p className="font-mono text-[11px] text-text-subtle">{replacement.error_summary}</p>
          ) : null}
        </div>
      ) : null}

      {!canEdit ? (
        <p className="text-xs text-text-muted">You do not have permission to change images.</p>
      ) : !open ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <RequestForm
            canRegenerate={canRegenerate}
            imagesMode={imagesMode}
            jobId={jobId}
            lockVersion={lockVersion}
            mode="regenerate"
          />
          <RequestForm
            canRegenerate={canRegenerate}
            imagesMode={imagesMode}
            jobId={jobId}
            lockVersion={lockVersion}
            mode="upload"
          />
        </div>
      ) : (
        <div className="grid gap-4">
          {replacement.status === "pending" && replacement.mode === "upload" ? (
            <UploadForm canEdit={canEdit} jobId={jobId} replacementId={replacement.id} />
          ) : null}
          {replacement.status === "awaiting_review" ? (
            <ReviewForm jobId={jobId} replacementId={replacement.id} />
          ) : null}
          {replacement.status !== "applying" ? (
            <CancelForm jobId={jobId} replacementId={replacement.id} />
          ) : null}
        </div>
      )}

      <p className="text-[11px] text-text-subtle">
        Swapping the image republishes nothing else: the words, the sources and the byline of{" "}
        <code>/blog/{slug}</code> are untouched.
      </p>
    </section>
  );
}
