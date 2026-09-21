import type { Database } from "@/lib/supabase/database.types";

type ProviderMode = Database["public"]["Enums"]["provider_mode"];

export type SelectableStage = "research" | "draft" | "images" | "audit";

/**
 * Modes the local worker has an adapter for, mirroring `implementedModes` in
 * `local-worker/src/providers/registry.ts` and the modes `admin_update_provider_setting` accepts.
 *
 * A job snapshotted onto a mode without an adapter would fail permanently at that stage (the
 * worker never falls back to another mode), so this remains an explicit allowlist.
 */
export const IMPLEMENTED_MODES: Readonly<Record<SelectableStage, readonly ProviderMode[]>> = {
  research: ["mock", "manual_chatgpt", "codex_cli", "openai_api"],
  draft: ["mock", "manual_claude", "claude_code", "anthropic_api"],
  images: ["mock", "manual_gemini", "codex_image", "gemini_api"],
  audit: ["mock", "manual_chatgpt", "codex_cli", "openai_api"],
};

export function isImplementedMode(stage: SelectableStage, mode: ProviderMode): boolean {
  return IMPLEMENTED_MODES[stage].includes(mode);
}
