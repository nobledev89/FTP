"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useActionState, useState } from "react";

import {
  completeManualImagesAction,
  importUploadedManualImageAction,
  importManualTextAction,
  prepareManualImageUploadAction,
} from "@/lib/admin/manual-actions";
import { idleActionResult, type ActionResult } from "@/lib/admin/action-result";
import type { ManualActionRun } from "@/lib/admin/jobs";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

import { Field, FormMessage, controlClass, secondaryButtonClass, textAreaClass } from "./form";
import { SubmitButton } from "./submit-button";

type ImageBrief = Readonly<{
  slot: number;
  role: "hero" | "supporting";
  purpose: string;
  prompt: string;
  altText: string;
  aspectRatio: "16:9" | "4:5" | "3:2" | "1:1";
}>;

type ExistingImage = Readonly<{
  slot: number;
  version: number;
  status: "briefed" | "uploaded" | "ready" | "published" | "rejected";
  providerRunId: string | null;
}>;

type ManualActionPanelProps = {
  run: ManualActionRun;
  canEdit: boolean;
  imageBriefs: readonly ImageBrief[];
  existingImages: readonly ExistingImage[];
  imageCount: number;
};

const PROVIDER_URLS: Readonly<Record<string, string>> = {
  manual_chatgpt: "https://chatgpt.com/",
  manual_claude: "https://claude.ai/new",
  manual_gemini: "https://gemini.google.com/app",
};

const EXAMPLES: Readonly<Record<string, unknown>> = {
  research: {
    topicInterpretation: "How the topic affects UK firms and customers.",
    angle: "The practical change and what remains uncertain.",
    facts: [],
    claims: [],
    statistics: [],
    dates: [],
    entities: [],
    sources: [
      {
        sourceKey: "fca-source",
        url: "https://www.fca.org.uk/",
        title: "Financial Conduct Authority",
        publisher: "FCA",
        publishedOn: null,
        sourceType: "regulator",
        quality: "primary",
        jurisdiction: "GB",
        accessedAt: "2026-09-18T09:00:00Z",
        excerpt: null,
        isPrivate: false,
      },
    ],
    contradictions: [],
    uncertainties: [],
    questions: [],
    recommendedStructure: ["What changed", "What happens next"],
  },
  draft: {
    title: "A concise UK fintech headline",
    slug: "concise-uk-fintech-headline",
    excerpt: "A short, factual standfirst.",
    bodyMarkdown: "## What changed\n\nArticle body.",
    metaTitle: "A concise UK fintech headline",
    metaDescription: "A search description.",
    category: "Payments",
    internalLinks: [],
    imageBriefs: [],
    sourceReferences: ["fca-source"],
  },
  revision: {
    title: "A concise UK fintech headline",
    slug: "concise-uk-fintech-headline",
    excerpt: "A corrected standfirst.",
    bodyMarkdown: "## What changed\n\nComplete corrected article body.",
    metaTitle: "A concise UK fintech headline",
    metaDescription: "A corrected search description.",
    category: "Payments",
    internalLinks: [],
    imageBriefs: [],
    sourceReferences: ["fca-source"],
  },
  audit: { verdict: "PASS", summary: "The draft is publishable.", findings: [] },
};

function CopyPromptButton({ prompt }: { prompt: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
  }
  return (
    <div className="flex items-center gap-2">
      <button className={secondaryButtonClass} onClick={copy} type="button">
        Copy prompt
      </button>
      <span aria-live="polite" className="text-xs text-text-subtle">
        {status === "copied"
          ? "Copied."
          : status === "failed"
            ? "Copy failed; select the prompt below."
            : ""}
      </span>
    </div>
  );
}

function PromptTools({ run }: { run: ManualActionRun }) {
  const providerUrl = PROVIDER_URLS[run.mode];
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <CopyPromptButton prompt={run.prompt_snapshot} />
        {providerUrl ? (
          <a className={secondaryButtonClass} href={providerUrl} rel="noreferrer" target="_blank">
            Open{" "}
            {run.provider === "openai"
              ? "ChatGPT"
              : run.provider === "anthropic"
                ? "Claude"
                : "Gemini"}
          </a>
        ) : null}
      </div>
      <details>
        <summary className="cursor-pointer text-sm font-medium text-accent">
          View exact prompt
        </summary>
        <pre className="mt-2 max-h-[34rem] overflow-auto whitespace-pre-wrap rounded-control border border-border bg-canvas p-3 font-mono text-[11px] leading-relaxed">
          {run.prompt_snapshot}
        </pre>
      </details>
    </div>
  );
}

function ManualTextImport({ run, canEdit }: { run: ManualActionRun; canEdit: boolean }) {
  const [state, action] = useActionState(importManualTextAction, idleActionResult);
  const [response, setResponse] = useState("");
  const example = EXAMPLES[run.stage];
  return (
    <div className="grid gap-4">
      <PromptTools run={run} />
      <details>
        <summary className="cursor-pointer text-sm font-medium text-accent">
          Expected {run.schema_version} JSON example
        </summary>
        <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-control border border-border bg-canvas p-3 font-mono text-[11px] leading-relaxed">
          {JSON.stringify(example, null, 2)}
        </pre>
      </details>
      <form action={action} className="grid gap-3">
        <FormMessage state={state} />
        <input name="jobId" type="hidden" value={run.job_id} />
        <input name="runId" type="hidden" value={run.id} />
        <Field
          htmlFor="manual-provider-response"
          hint="Plain JSON is preferred; one outer ```json fence is also accepted. Validation errors keep this text in place."
          label="Provider response"
          meta={`${response.length.toLocaleString()} / 1,000,000`}
          required
        >
          <textarea
            aria-describedby="manual-provider-response-hint"
            className={`${textAreaClass} min-h-[22rem] font-mono text-xs leading-relaxed`}
            disabled={!canEdit}
            id="manual-provider-response"
            maxLength={1_000_000}
            name="response"
            onChange={(event) => setResponse(event.currentTarget.value)}
            required
            spellCheck={false}
            value={response}
          />
        </Field>
        <div className="flex justify-end">
          <SubmitButton disabled={!canEdit} pendingLabel="Validating and importing…">
            Validate and continue
          </SubmitButton>
        </div>
      </form>
    </div>
  );
}

function ManualImageSlotForm({
  run,
  brief,
  canEdit,
  readyVersion,
}: {
  run: ManualActionRun;
  brief: ImageBrief;
  canEdit: boolean;
  readyVersion: number | null;
}) {
  const [state, setState] = useState<ActionResult>(idleActionResult);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function uploadImage(event: FormEvent<HTMLFormElement>) {
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
      preparation.set("jobId", run.job_id);
      preparation.set("runId", run.id);
      preparation.set("slot", String(brief.slot));
      preparation.set("mimeType", file.type);
      preparation.set("byteSize", String(file.size));
      const prepared = await prepareManualImageUploadAction(preparation);
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

      // The bytes have already gone directly to Supabase. The small action gets only a path and
      // metadata, reads the private object back, and derives all file facts from those stored bytes.
      formData.delete("file");
      formData.set("privatePath", prepared.upload.path);
      const imported = await importUploadedManualImageAction(formData);
      setState(imported);
      if (imported.ok) router.refresh();
    } catch (error) {
      setState({
        ok: false,
        error: error instanceof Error ? error.message : "The image upload could not be completed.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="grid gap-3 rounded-panel border border-border p-3" onSubmit={uploadImage}>
      <FormMessage state={state} />
      <input name="jobId" type="hidden" value={run.job_id} />
      <input name="runId" type="hidden" value={run.id} />
      <input name="slot" type="hidden" value={brief.slot} />
      <input name="role" type="hidden" value={brief.role} />
      <input name="purpose" type="hidden" value={brief.purpose} />
      <input name="prompt" type="hidden" value={brief.prompt} />
      <input name="aspectRatio" type="hidden" value={brief.aspectRatio} />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">
          Slot {brief.slot} · {brief.role}
        </h3>
        <span className="font-mono text-[11px] text-text-subtle">
          {readyVersion ? `ready · v${readyVersion}` : brief.aspectRatio}
        </span>
      </div>
      <p className="text-xs text-text-muted">{brief.purpose}</p>
      <details>
        <summary className="cursor-pointer text-xs font-medium text-accent">Image prompt</summary>
        <p className="mt-1 whitespace-pre-wrap text-xs text-text-muted">{brief.prompt}</p>
      </details>
      <Field
        htmlFor={`manual-image-${brief.slot}`}
        hint="PNG, JPEG, WebP, or AVIF; 10 MB maximum."
        label="Image file"
        required
      >
        <input
          accept="image/png,image/jpeg,image/webp,image/avif"
          className={controlClass}
          disabled={!canEdit}
          id={`manual-image-${brief.slot}`}
          name="file"
          required
          type="file"
        />
      </Field>
      <Field htmlFor={`manual-alt-${brief.slot}`} label="Alt text" meta="300 chars max" required>
        <input
          className={controlClass}
          defaultValue={brief.altText}
          disabled={!canEdit}
          id={`manual-alt-${brief.slot}`}
          maxLength={300}
          name="altText"
          required
        />
      </Field>
      <Field
        htmlFor={`manual-caption-${brief.slot}`}
        label="Caption"
        meta="optional · 500 chars max"
      >
        <input
          className={controlClass}
          disabled={!canEdit}
          id={`manual-caption-${brief.slot}`}
          maxLength={500}
          name="caption"
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          htmlFor={`manual-focal-x-${brief.slot}`}
          hint="Leave both blank, or enter 0–100."
          label="Focal X"
        >
          <input
            className={controlClass}
            disabled={!canEdit}
            id={`manual-focal-x-${brief.slot}`}
            max={100}
            min={0}
            name="focalX"
            step="0.01"
            type="number"
          />
        </Field>
        <Field
          htmlFor={`manual-focal-y-${brief.slot}`}
          hint="Leave both blank, or enter 0–100."
          label="Focal Y"
        >
          <input
            className={controlClass}
            disabled={!canEdit}
            id={`manual-focal-y-${brief.slot}`}
            max={100}
            min={0}
            name="focalY"
            step="0.01"
            type="number"
          />
        </Field>
      </div>
      <div className="flex justify-end">
        <button
          aria-disabled={pending || !canEdit ? "true" : undefined}
          className={secondaryButtonClass}
          disabled={pending || !canEdit}
          type="submit"
        >
          {pending
            ? "Checking and uploading…"
            : readyVersion
              ? "Upload replacement"
              : "Upload image"}
        </button>
      </div>
    </form>
  );
}

function ManualImagesImport({
  run,
  canEdit,
  imageBriefs,
  existingImages,
  imageCount,
}: Omit<ManualActionPanelProps, "run"> & { run: ManualActionRun }) {
  const [completeState, completeAction] = useActionState(
    completeManualImagesAction,
    idleActionResult,
  );
  const readyBySlot = new Map<number, number>();
  for (const image of existingImages) {
    if (image.providerRunId !== run.id || !["ready", "published"].includes(image.status)) continue;
    readyBySlot.set(image.slot, Math.max(readyBySlot.get(image.slot) ?? 0, image.version));
  }
  const requiredBriefs = imageBriefs.filter((brief) => brief.slot < imageCount);
  const allReady =
    requiredBriefs.length === imageCount &&
    requiredBriefs.every((brief) => readyBySlot.has(brief.slot));

  return (
    <div className="grid gap-4">
      <PromptTools run={run} />
      <p className="text-sm text-text-muted">
        Generate each requested image in Gemini, upload the real file with its editorial metadata,
        then continue. Files stay private until the publishing service copies approved versions.
      </p>
      <div className="grid gap-3 lg:grid-cols-2">
        {requiredBriefs.map((brief) => (
          <ManualImageSlotForm
            brief={brief}
            canEdit={canEdit}
            key={brief.slot}
            readyVersion={readyBySlot.get(brief.slot) ?? null}
            run={run}
          />
        ))}
      </div>
      <form action={completeAction} className="grid gap-3 rounded-panel border border-border p-3">
        <FormMessage state={completeState} />
        <input name="jobId" type="hidden" value={run.job_id} />
        <input name="runId" type="hidden" value={run.id} />
        <p className="text-sm text-text-muted">
          {readyBySlot.size} of {imageCount} requested slots are ready for this run.
        </p>
        <div className="flex justify-end">
          <SubmitButton disabled={!canEdit || !allReady} pendingLabel="Continuing…">
            Continue to audit
          </SubmitButton>
        </div>
      </form>
    </div>
  );
}

export function ManualActionPanel(props: ManualActionPanelProps) {
  return props.run.stage === "images" ? (
    <ManualImagesImport {...props} />
  ) : (
    <ManualTextImport canEdit={props.canEdit} run={props.run} />
  );
}
