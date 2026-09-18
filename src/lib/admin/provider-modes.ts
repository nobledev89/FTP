import type { Database } from "@/lib/supabase/database.types";

type ProviderMode = Database["public"]["Enums"]["provider_mode"];

export type SelectableStage = "research" | "draft" | "images" | "audit";

/**
 * Modes the local worker has an adapter for, mirroring `implementedModes` in
 * `local-worker/src/providers/registry.ts` and the modes `admin_update_provider_setting` accepts.
 *
 * The database allows more modes per stage than this, because the API adapters arrive in Phase 10.
 * A job snapshotted onto a mode without an adapter would fail permanently at that stage (the
 * worker never falls back to another mode), so the console offers only these.
 */
export const IMPLEMENTED_MODES: Readonly<Record<SelectableStage, readonly ProviderMode[]>> = {
  research: ["mock", "manual_chatgpt", "codex_cli"],
  draft: ["mock", "manual_claude", "claude_code"],
  images: ["mock", "manual_gemini"],
  audit: ["mock", "manual_chatgpt", "codex_cli"],
};

export function isImplementedMode(stage: SelectableStage, mode: ProviderMode): boolean {
  return IMPLEMENTED_MODES[stage].includes(mode);
}
