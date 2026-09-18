import type { Database, Json } from "../db/database.types.js";

/**
 * The shared stage adapter contract (plan section 10.1, ADR 0003).
 *
 * An adapter turns a brief into a prompt, runs a provider, and normalizes the result into typed
 * data. It is deliberately given no Supabase client, no Storage client, and no way to reach the
 * publication boundary: the stage service owns every write. Swapping `mock` for `claude_code` or
 * `manual_claude` therefore changes which adapter is selected and nothing else.
 */

export type PipelineStage = Database["public"]["Enums"]["pipeline_stage"];
export type ProviderMode = Database["public"]["Enums"]["provider_mode"];
export type ProviderKind = Database["public"]["Enums"]["provider_kind"];
export type ArticleType = Database["public"]["Enums"]["article_type"];

export type JsonObject = Record<string, Json>;

/** The job brief, as every stage sees it. Carries no database row and no identifiers to write to. */
export type StageBrief = Readonly<{
  jobId: string;
  topic: string;
  keywords: readonly string[];
  requirements: string | null;
  articleType: ArticleType;
  category: string | null;
  targetWordCount: number | null;
  imageCount: number;
  siteName: string;
  timezone: string;
  today: string;
}>;

/** A prompt template snapshot, resolved from the database before the adapter runs. */
export type PromptTemplate = Readonly<{
  id: string;
  key: string;
  version: number;
  content: string;
}>;

export type RunContext = Readonly<{
  stage: PipelineStage;
  mode: ProviderMode;
  /** 0 on the first pass, then one per completed revision. */
  cycle: number;
  /** 1 on the first try of this stage; incremented by the queue on every retry. */
  attempt: number;
  /**
   * The job's `lock_version` as returned by the claim. Every claim bumps it, so it tells two claims
   * apart even when an admin retry or resolution has reset `attempt` to 1.
   */
  claimVersion: number;
  brief: StageBrief;
  template: PromptTemplate | null;
  styleGuide: string | null;
  schemaVersion: string;
}>;

/**
 * Everything needed to execute and to record the run. `inputRefs` holds references only — artifact
 * ids, versions, counts — never bodies, paths, or credentials, because it is shown in the console.
 */
export type PreparedRun = Readonly<{
  prompt: string;
  promptTemplateId: string | null;
  promptVersion: number | null;
  inputRefs: JsonObject;
  schemaVersion: string;
  provider: ProviderKind;
  mode: ProviderMode;
  idempotencyKey: string;
}>;

/** A binary produced by a stage, handed to the stage service to store. Adapters never upload. */
export type StageFile = Readonly<{
  slot: number;
  bytes: Uint8Array;
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/avif";
  width: number;
  height: number;
}>;

export type RawRunResult =
  | Readonly<{
      kind: "output";
      /** The provider's raw response, still unvalidated. */
      value: unknown;
      usage?: JsonObject;
      cost?: Readonly<{ amount: number; currency: string }>;
      files?: readonly StageFile[];
    }>
  | Readonly<{
      kind: "manual_action";
      /** Shown to the operator in the console. Must contain no paths, tokens, or emails. */
      message: string;
    }>;

/** Everything `execute` may see. A real adapter uses `prepared.prompt`; a mock reads the input. */
export type ExecuteRequest<TInput> = Readonly<{
  prepared: PreparedRun;
  input: TInput;
  context: RunContext;
  signal: AbortSignal;
}>;

export interface StageAdapter<TInput, TOutput> {
  readonly stage: PipelineStage;
  readonly mode: ProviderMode;
  readonly provider: ProviderKind;
  prepare(input: TInput, context: RunContext): Promise<PreparedRun>;
  execute(request: ExecuteRequest<TInput>): Promise<RawRunResult>;
  normalize(raw: RawRunResult, context: RunContext): Promise<TOutput>;
}

/**
 * A stable key for one provider attempt within one claim. Re-running inside the same claim reuses
 * the run row rather than creating a second one. The claim version keeps a stage that an admin
 * retried or resolved (which resets `attempt` to 1) from reopening the finished run of an earlier
 * claim, which is immutable history.
 */
export function idempotencyKeyFor(stage: PipelineStage, context: RunContext): string {
  return `${context.brief.jobId}:${stage}:c${context.cycle}:a${context.attempt}:v${context.claimVersion}`;
}

/** Substitutes `{{name}}` placeholders. An unknown placeholder is left in place, never guessed. */
export function renderTemplate(
  template: string,
  variables: Readonly<Record<string, string>>,
): string {
  return template.replace(/\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g, (match, name: string) =>
    Object.hasOwn(variables, name) ? (variables[name] ?? "") : match,
  );
}
