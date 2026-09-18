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
 * one (plan section 2, decision 6).
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

export function resolveAdapter<S extends AdapterStage>(
  stage: S,
  mode: ProviderMode,
): AdapterMap[S] {
  if (mode === "mock") return MOCK_ADAPTERS[stage];
  const manual = MANUAL_ADAPTERS[stage];
  if (manual?.mode === mode) return manual as AdapterMap[S];
  throw new UnsupportedModeError(stage, mode);
}

/** Modes with a working adapter today. Phases 9 and 10 add CLI and API modes. */
export function implementedModes(stage: PipelineStage): readonly ProviderMode[] {
  switch (stage) {
    case "research":
    case "audit":
      return ["mock", "manual_chatgpt"];
    case "draft":
    case "revision":
      return ["mock", "manual_claude"];
    case "images":
      return ["mock", "manual_gemini"];
    default:
      return ["internal"];
  }
}
