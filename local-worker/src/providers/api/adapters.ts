import type { z } from "zod";

import {
  auditOutputSchema,
  draftOutputSchema,
  researchPacketOutputSchema,
  type AuditOutput,
  type DraftOutput,
  type ResearchPacketOutput,
} from "../../contracts/artifacts.js";
import type {
  ExecuteRequest,
  PreparedRun,
  ProviderKind,
  ProviderMode,
  RawRunResult,
  RunContext,
  StageAdapter,
} from "../contract.js";
import { providerJsonSchema } from "../cli/structured-output.js";
import { MockAuditAdapter, type AuditStageInput } from "../mock/audit.js";
import { MockDraftAdapter, MockRevisionAdapter, type DraftStageInput } from "../mock/draft.js";
import type { ImageStageInput, ImageStageOutput } from "../mock/images.js";
import { MockResearchAdapter, type ResearchStageInput } from "../mock/research.js";
import { AnthropicMessagesApi, type AnthropicSettings } from "./anthropic.js";
import { ApiProviderError, type ApiProviderName } from "./errors.js";
import { GeminiImagesApiAdapter, type GeminiSettings } from "./gemini.js";
import type { ApiHttpRuntime } from "./http.js";
import { OpenAiResponsesApi, type OpenAiSettings, type StructuredApiResult } from "./openai.js";

type TextStage = "research" | "draft" | "revision" | "audit";

class ApiTextAdapter<TInput, TOutput> implements StageAdapter<TInput, TOutput> {
  private jsonSchema: Record<string, unknown> | null = null;

  constructor(
    readonly stage: TextStage,
    readonly mode: ProviderMode,
    readonly provider: ProviderKind,
    private readonly providerName: ApiProviderName,
    private readonly delegate: StageAdapter<TInput, TOutput>,
    private readonly outputSchema: z.ZodType<TOutput>,
    private readonly run: (
      input: Readonly<{
        prompt: string;
        schema: Record<string, unknown>;
        schemaName: string;
        signal: AbortSignal;
      }>,
    ) => Promise<StructuredApiResult>,
  ) {}

  async prepare(input: TInput, context: RunContext): Promise<PreparedRun> {
    const prepared = await this.delegate.prepare(input, { ...context, mode: "mock" });
    return { ...prepared, mode: this.mode, provider: this.provider };
  }

  async execute(request: ExecuteRequest<TInput>): Promise<RawRunResult> {
    this.jsonSchema ??= providerJsonSchema(this.outputSchema);
    const result = await this.run({
      prompt: request.prepared.prompt,
      schema: this.jsonSchema,
      schemaName: `${this.stage}_${request.context.schemaVersion.replaceAll("-", "_")}`,
      signal: request.signal,
    });
    return { kind: "output", value: result.value, usage: result.usage };
  }

  async normalize(raw: RawRunResult, context: RunContext): Promise<TOutput> {
    if (raw.kind !== "output") {
      throw new ApiProviderError(
        this.providerName,
        `${this.providerName} API produced no ${this.stage} output.`,
        "invalid_output",
      );
    }
    const parsed = this.outputSchema.safeParse(raw.value);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      throw new ApiProviderError(
        this.providerName,
        `${this.providerName} API returned JSON that does not match ${context.schemaVersion} ` +
          `(${parsed.error.issues.length} issue${parsed.error.issues.length === 1 ? "" : "s"}): ${issues}`,
        "invalid_output",
      );
    }
    return parsed.data;
  }
}

export type ApiAdapterSet = Readonly<{
  research: StageAdapter<ResearchStageInput, ResearchPacketOutput>;
  draft: StageAdapter<DraftStageInput, DraftOutput>;
  revision: StageAdapter<DraftStageInput, DraftOutput>;
  images: StageAdapter<ImageStageInput, ImageStageOutput>;
  audit: StageAdapter<AuditStageInput, AuditOutput>;
}>;

export type ApiSettings = Readonly<{
  openai: OpenAiSettings;
  anthropic: AnthropicSettings;
  gemini: GeminiSettings;
  runtime: ApiHttpRuntime;
}>;

export function createApiAdapters(settings: ApiSettings): ApiAdapterSet {
  const openai = new OpenAiResponsesApi(settings.openai, settings.runtime);
  const anthropic = new AnthropicMessagesApi(settings.anthropic, settings.runtime);
  return {
    research: new ApiTextAdapter(
      "research",
      "openai_api",
      "openai",
      "OpenAI",
      new MockResearchAdapter(),
      researchPacketOutputSchema,
      (input) => openai.runStructured({ ...input, webSearch: true }),
    ),
    draft: new ApiTextAdapter(
      "draft",
      "anthropic_api",
      "anthropic",
      "Anthropic",
      new MockDraftAdapter(),
      draftOutputSchema,
      (input) => anthropic.runStructured(input),
    ),
    revision: new ApiTextAdapter(
      "revision",
      "anthropic_api",
      "anthropic",
      "Anthropic",
      new MockRevisionAdapter(),
      draftOutputSchema,
      (input) => anthropic.runStructured(input),
    ),
    images: new GeminiImagesApiAdapter(settings.gemini, settings.runtime),
    audit: new ApiTextAdapter(
      "audit",
      "openai_api",
      "openai",
      "OpenAI",
      new MockAuditAdapter(),
      auditOutputSchema,
      (input) => openai.runStructured({ ...input, webSearch: false }),
    ),
  };
}
