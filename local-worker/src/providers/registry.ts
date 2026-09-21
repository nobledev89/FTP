import type { CliAdapterSet } from "./cli/adapters.js";
import type { ApiAdapterSet } from "./api/adapters.js";
import type { PipelineStage, ProviderMode, StageAdapter } from "./contract.js";
import {
  ManualImagesAdapter,
  manualAuditAdapter,
  manualDraftAdapter,
  manualResearchAdapter,
  manualRevisionAdapter,
} from "./manual/adapters.js";
import { MockAuditAdapter, type AuditStageInput } from "./mock/audit.js";
import { MockDraftAdapter, MockRevisionAdapter, type DraftStageInput } from "./mock/draft.js";
import { MockImagesAdapter, type ImageStageInput, type ImageStageOutput } from "./mock/images.js";
import { MockResearchAdapter, type ResearchStageInput } from "./mock/research.js";

import type { AuditOutput, DraftOutput, ResearchPacketOutput } from "../contracts/artifacts.js";

/**
 * Resolves the adapter for a stage and mode.
 *
 * The job's mode was snapshotted at creation, so a setting changed mid-flight never switches a
 * running job onto a different provider. A mode with no adapter is a configuration error, not a
 * reason to fall back to another mode: falling back is how a free run silently becomes a billable
 * one (plan section 2, decision 6). That includes a subscription CLI that is signed out or over
 * its usage limit — its adapter reports that to an editor rather than handing the stage to an API.
 */

export class UnsupportedModeError extends Error {
  readonly errorClass = "permanent_config" as const;

  constructor(stage: PipelineStage, mode: ProviderMode) {
    super(
      `No adapter is implemented for the ${stage} stage in ${mode} mode. ` +
        `Change the job's mode, or implement the adapter; the worker never falls back to another mode.`,
    );
    this.name = "UnsupportedModeError";
  }
}

type AdapterMap = {
  research: StageAdapter<ResearchStageInput, ResearchPacketOutput>;
  draft: StageAdapter<DraftStageInput, DraftOutput>;
  revision: StageAdapter<DraftStageInput, DraftOutput>;
  images: StageAdapter<ImageStageInput, ImageStageOutput>;
  audit: StageAdapter<AuditStageInput, AuditOutput>;
};

type AdapterStage = keyof AdapterMap;

const MOCK_ADAPTERS: AdapterMap = {
  research: new MockResearchAdapter(),
  draft: new MockDraftAdapter(),
  revision: new MockRevisionAdapter(),
  images: new MockImagesAdapter(),
  audit: new MockAuditAdapter(),
};

const MANUAL_ADAPTERS: Partial<{ [S in AdapterStage]: AdapterMap[S] }> = {
  research: manualResearchAdapter,
  draft: manualDraftAdapter,
  revision: manualRevisionAdapter,
  images: new ManualImagesAdapter(),
  audit: manualAuditAdapter,
};

/** Stages served by a provider adapter. `publish` and `verify` are internal services, not adapters. */
export const ADAPTER_STAGES: readonly AdapterStage[] = [
  "research",
  "draft",
  "revision",
  "images",
  "audit",
];

/**
 * `cli` carries the configured subscription-CLI adapters. The worker CLI always supplies them;
 * code that runs without them (unit and integration suites for other modes) gets the same refusal
 * as any other unimplemented mode.
 */
export function resolveAdapter<S extends AdapterStage>(
  stage: S,
  mode: ProviderMode,
  cli?: CliAdapterSet,
  api?: ApiAdapterSet,
): AdapterMap[S] {
  if (mode === "mock") return MOCK_ADAPTERS[stage];
  const manual = MANUAL_ADAPTERS[stage];
  if (manual?.mode === mode) return manual as AdapterMap[S];
  if (cli) {
    const adapter = cli[stage];
    if (adapter.mode === mode) return adapter as AdapterMap[S];
  }
  if (api) {
    const adapter = api[stage];
    if (adapter.mode === mode) return adapter as AdapterMap[S];
  }
  throw new UnsupportedModeError(stage, mode);
}

/**
 * Modes with a working adapter, mirroring `IMPLEMENTED_MODES` in the web console and the modes
 * `admin_update_provider_setting` accepts. Phase 10 adds the API modes.
 */
export function implementedModes(stage: PipelineStage): readonly ProviderMode[] {
  switch (stage) {
    case "research":
    case "audit":
      return ["mock", "manual_chatgpt", "codex_cli", "openai_api"];
    case "draft":
    case "revision":
      return ["mock", "manual_claude", "claude_code", "anthropic_api"];
    case "images":
      return ["mock", "manual_gemini", "codex_image", "gemini_api"];
    default:
      return ["internal"];
  }
}
