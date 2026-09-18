import { z } from "zod";

import { redactLogText } from "./redact";
import type { StatusTone } from "./status-display";

/**
 * The subscription CLIs' state as the local worker last reported it in its heartbeat
 * (`worker_instances.health.providers`). The console never contacts the PC; this is the worker's
 * own probe — installed, supported, and signed in to a subscription rather than a billable API
 * account — refreshed at start-up and every ten minutes. Each stage run probes again before it
 * sends a prompt, so this view is for the operator, not a gate.
 */

export const CLI_MODES = ["claude_code", "codex_cli"] as const;
export type CliMode = (typeof CLI_MODES)[number];

const probeSchema = z.object({
  installed: z.boolean(),
  version: z.string().max(80).nullable(),
  supported: z.boolean(),
  account: z.enum(["subscription", "billable", "signed_out", "unknown"]),
  ready: z.boolean(),
  problem: z.string().nullable(),
  checked_at: z.string().max(40),
});

export type CliCapability = Readonly<{
  mode: CliMode;
  /** Null when the worker has not reported this CLI (an older worker, or never probed). */
  version: string | null;
  state: "ready" | "sign_in" | "billable" | "not_installed" | "unsupported" | "unknown";
  problem: string | null;
  checkedAt: string | null;
}>;

export function cliCapabilities(health: unknown): readonly CliCapability[] {
  const providers =
    typeof health === "object" && health !== null && "providers" in health
      ? (health as { providers?: unknown }).providers
      : undefined;

  return CLI_MODES.map((mode) => {
    const raw =
      typeof providers === "object" && providers !== null
        ? (providers as Record<string, unknown>)[mode]
        : undefined;
    const parsed = probeSchema.safeParse(raw);
    if (!parsed.success) {
      return { mode, version: null, state: "unknown", problem: null, checkedAt: null };
    }
    const probe = parsed.data;
    const state: CliCapability["state"] = probe.ready
      ? "ready"
      : !probe.installed
        ? "not_installed"
        : !probe.supported
          ? "unsupported"
          : probe.account === "billable"
            ? "billable"
            : probe.account === "signed_out"
              ? "sign_in"
              : "unknown";
    return {
      mode,
      version: probe.version,
      state,
      problem: redactLogText(probe.problem, 300),
      checkedAt: probe.checked_at,
    };
  });
}

const STATE_DISPLAY: Readonly<Record<CliCapability["state"], { label: string; tone: StatusTone }>> =
  {
    ready: { label: "ready", tone: "success" },
    sign_in: { label: "sign in", tone: "warning" },
    billable: { label: "billable sign-in", tone: "danger" },
    not_installed: { label: "not installed", tone: "danger" },
    unsupported: { label: "update needed", tone: "danger" },
    unknown: { label: "not reported", tone: "neutral" },
  };

export function cliStateDisplay(state: CliCapability["state"]): {
  label: string;
  tone: StatusTone;
} {
  return STATE_DISPLAY[state];
}
