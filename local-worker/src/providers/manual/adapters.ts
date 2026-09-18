import {
  auditOutputSchema,
  draftOutputSchema,
  imageArtifactSchema,
  researchPacketOutputSchema,
  type AuditOutput,
  type DraftOutput,
  type ResearchPacketOutput,
} from "../../contracts/artifacts.js";
import type { AuditStageInput } from "../mock/audit.js";
import type { DraftStageInput } from "../mock/draft.js";
import type { ImageStageInput, ImageStageOutput } from "../mock/images.js";
import type { ResearchStageInput } from "../mock/research.js";
import {
  idempotencyKeyFor,
  renderTemplate,
  type ExecuteRequest,
  type PreparedRun,
  type ProviderKind,
  type ProviderMode,
  type RawRunResult,
  type RunContext,
  type StageAdapter,
} from "../contract.js";
import { MockAuditAdapter } from "../mock/audit.js";
import { MockDraftAdapter, MockRevisionAdapter } from "../mock/draft.js";
import { MockResearchAdapter } from "../mock/research.js";

/**
 * Manual adapters stop after preparing the exact provider prompt. The database keeps that prompt
 * on the provider run, releases the worker lease, and lets an authenticated editor import the
 * response through the same artifact schemas used by mock/CLI/API modes.
 */

type TextStage = "research" | "draft" | "revision" | "audit";

class ManualTextAdapter<TInput, TOutput> implements StageAdapter<TInput, TOutput> {
  constructor(
    readonly stage: TextStage,
    readonly mode: ProviderMode,
    readonly provider: ProviderKind,
    private readonly delegate: StageAdapter<TInput, TOutput>,
    private readonly providerName: string,
  ) {}

  async prepare(input: TInput, context: RunContext): Promise<PreparedRun> {
    // Prompt construction is deliberately shared with the already-tested mock adapter. Only the
    // execution mode/provider change; the prompt template snapshot and input references do not.
    const prepared = await this.delegate.prepare(input, { ...context, mode: "mock" });
    return { ...prepared, mode: this.mode, provider: this.provider };
  }

  async execute(_request: ExecuteRequest<TInput>): Promise<RawRunResult> {
    void _request;
    return {
      kind: "manual_action",
      message: `Copy the prepared prompt into ${this.providerName}, then paste the JSON response here.`,
    };
  }

  async normalize(raw: RawRunResult, context: RunContext): Promise<TOutput> {
    return this.delegate.normalize(raw, context);
  }
}

export const manualResearchAdapter: StageAdapter<ResearchStageInput, ResearchPacketOutput> =
  new ManualTextAdapter(
    "research",
    "manual_chatgpt",
    "openai",
    new MockResearchAdapter(),
    "ChatGPT",
  );

export const manualDraftAdapter: StageAdapter<DraftStageInput, DraftOutput> = new ManualTextAdapter(
  "draft",
  "manual_claude",
  "anthropic",
  new MockDraftAdapter(),
  "Claude",
);

export const manualRevisionAdapter: StageAdapter<DraftStageInput, DraftOutput> =
  new ManualTextAdapter(
    "revision",
    "manual_claude",
    "anthropic",
    new MockRevisionAdapter(),
    "Claude",
  );

export const manualAuditAdapter: StageAdapter<AuditStageInput, AuditOutput> = new ManualTextAdapter(
  "audit",
  "manual_chatgpt",
  "openai",
  new MockAuditAdapter(),
  "ChatGPT",
);

/** Gemini is file-oriented, so its prepared prompt contains one complete section per image slot. */
export class ManualImagesAdapter implements StageAdapter<ImageStageInput, ImageStageOutput> {
  readonly stage = "images" as const;
  readonly mode = "manual_gemini" as const;
  readonly provider = "gemini" as const;

  async prepare(input: ImageStageInput, context: RunContext): Promise<PreparedRun> {
    const briefs = input.draft.imageBriefs
      .filter((brief) => brief.slot < context.brief.imageCount)
      .sort((left, right) => left.slot - right.slot);
    const prompt = briefs
      .map((brief) => {
        const body = context.template
          ? renderTemplate(context.template.content, {
              styleGuide: context.styleGuide ?? "",
              title: input.draft.title,
              articleType: context.brief.articleType,
              slot: String(brief.slot),
              role: brief.role,
              aspectRatio: brief.aspectRatio,
              purpose: brief.purpose,
              altText: brief.altText,
              prompt: brief.prompt,
              schemaVersion: context.schemaVersion,
            })
          : `Generate the ${brief.role} image for ${input.draft.title}: ${brief.prompt}`;
        return `===== IMAGE SLOT ${brief.slot} (${brief.role}) =====\n\n${body}`;
      })
      .join("\n\n");

    return {
      prompt,
      promptTemplateId: context.template?.id ?? null,
      promptVersion: context.template?.version ?? null,
      inputRefs: {
        draft_version: input.draftVersion,
        briefs: briefs.length,
        requested: context.brief.imageCount,
        slots: briefs.map((brief) => brief.slot),
      },
      schemaVersion: context.schemaVersion,
      provider: this.provider,
      mode: this.mode,
      idempotencyKey: idempotencyKeyFor(this.stage, context),
    };
  }

  async execute(_request: ExecuteRequest<ImageStageInput>): Promise<RawRunResult> {
    void _request;
    return {
      kind: "manual_action",
      message: "Copy the prepared image prompts into Gemini, upload each result, then continue.",
    };
  }

  async normalize(raw: RawRunResult, _context: RunContext): Promise<ImageStageOutput> {
    void _context;
    if (raw.kind !== "output") throw new Error("the manual image stage produced no output");
    return {
      artifacts: imageArtifactSchema.array().parse(raw.value),
      files: raw.files ?? [],
    };
  }
}

// Keep direct schema references in this module so contract drift breaks the worker build even
// though normalization normally happens in the web import boundary for manual runs.
void researchPacketOutputSchema;
void draftOutputSchema;
void auditOutputSchema;
