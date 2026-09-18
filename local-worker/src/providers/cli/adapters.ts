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
  RawRunResult,
  RunContext,
  StageAdapter,
} from "../contract.js";
import { MockAuditAdapter, type AuditStageInput } from "../mock/audit.js";
import { MockDraftAdapter, MockRevisionAdapter, type DraftStageInput } from "../mock/draft.js";
import { MockResearchAdapter, type ResearchStageInput } from "../mock/research.js";
import type { CliMode, StructuredCli } from "./base.js";
import { ClaudeCodeCli, type ClaudeCodeSettings } from "./claude-code.js";
import { CodexCli, type CodexSettings } from "./codex.js";
import { CliProviderError } from "./errors.js";
import type { CliRuntimeOptions } from "./base.js";
import { providerJsonSchema } from "./structured-output.js";

/**
 * Stage adapters for the subscription CLIs.
 *
 * Preparation is shared with the mock adapters, exactly as the manual adapters share it: the same
 * reviewed template, variables, input references, and idempotency key, so a prompt snapshot means
 * the same thing whichever mode produced it. Only execution differs. Normalization applies the
 * same Zod artifact schema that validates mock output and manual imports, so a CLI result is
 * stored and gated identically (Phase 9 exit: "normalized identically to manual/mock output").
 */

type TextStage = "research" | "draft" | "revision" | "audit";

class CliTextAdapter<TInput, TOutput> implements StageAdapter<TInput, TOutput> {
  private schema: Record<string, unknown> | null = null;

  constructor(
    readonly stage: TextStage,
    readonly mode: CliMode,
    readonly provider: ProviderKind,
    private readonly delegate: StageAdapter<TInput, TOutput>,
    private readonly cli: StructuredCli,
    private readonly outputSchema: z.ZodType<TOutput>,
  ) {}

  async prepare(input: TInput, context: RunContext): Promise<PreparedRun> {
    const prepared = await this.delegate.prepare(input, { ...context, mode: "mock" });
    return { ...prepared, mode: this.mode, provider: this.provider };
  }

  async execute(request: ExecuteRequest<TInput>): Promise<RawRunResult> {
    this.schema ??= providerJsonSchema(this.outputSchema);
    const result = await this.cli.runStructured({
      stage: this.stage,
      prompt: request.prepared.prompt,
      schema: this.schema,
      signal: request.signal,
    });
    return { kind: "output", value: result.value, usage: result.usage };
  }

  async normalize(raw: RawRunResult, context: RunContext): Promise<TOutput> {
    if (raw.kind !== "output") {
      throw new CliProviderError(
        this.cli.label,
        `the ${this.stage} stage produced no output`,
        "invalid_output",
      );
    }
    const parsed = this.outputSchema.safeParse(raw.value);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      throw new CliProviderError(
        this.cli.label,
        `${this.cli.label} returned JSON that does not match ${context.schemaVersion} ` +
          `(${parsed.error.issues.length} issue${parsed.error.issues.length === 1 ? "" : "s"}): ${issues}`,
        "invalid_output",
      );
    }
    return parsed.data;
  }
}

export type CliAdapterSet = Readonly<{
  research: StageAdapter<ResearchStageInput, ResearchPacketOutput>;
  draft: StageAdapter<DraftStageInput, DraftOutput>;
  revision: StageAdapter<DraftStageInput, DraftOutput>;
  audit: StageAdapter<AuditStageInput, AuditOutput>;
  clis: readonly StructuredCli[];
}>;

export type CliSettings = Readonly<{
  claude: ClaudeCodeSettings;
  codex: CodexSettings;
  runtime: CliRuntimeOptions;
}>;

/** Claude Code writes and revises; Codex researches and audits (plan section 10.2). */
export function createCliAdapters(settings: CliSettings): CliAdapterSet {
  const claude = new ClaudeCodeCli(settings.claude, settings.runtime);
  const codex = new CodexCli(settings.codex, settings.runtime);
  return {
    research: new CliTextAdapter(
      "research",
      "codex_cli",
      "openai",
      new MockResearchAdapter(),
      codex,
      researchPacketOutputSchema,
    ),
    draft: new CliTextAdapter(
      "draft",
      "claude_code",
      "anthropic",
      new MockDraftAdapter(),
      claude,
      draftOutputSchema,
    ),
    revision: new CliTextAdapter(
      "revision",
      "claude_code",
      "anthropic",
      new MockRevisionAdapter(),
      claude,
      draftOutputSchema,
    ),
    audit: new CliTextAdapter(
      "audit",
      "codex_cli",
      "openai",
      new MockAuditAdapter(),
      codex,
      auditOutputSchema,
    ),
    clis: [claude, codex],
  };
}
