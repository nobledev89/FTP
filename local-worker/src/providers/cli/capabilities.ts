import type { Json } from "../../db/database.types.js";
import { probeToJson, type CliProbe, type StructuredCli } from "./base.js";

/**
 * Keeps a recent capability probe of each subscription CLI for the worker heartbeat.
 *
 * The console learns whether Claude Code and Codex are installed, supported, and signed in to a
 * subscription only through what the worker writes to `worker_instances.health` — Vercel never
 * connects to the PC. Stage runs do not rely on this snapshot: each run probes again immediately
 * before it executes.
 */
export class CliCapabilityMonitor {
  private latest: readonly CliProbe[] = [];
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly clis: readonly StructuredCli[],
    private readonly refreshIntervalMs = 10 * 60_000,
  ) {}

  async refresh(signal?: AbortSignal): Promise<readonly CliProbe[]> {
    this.latest = await Promise.all(this.clis.map((cli) => cli.probe(signal)));
    return this.latest;
  }

  /** Refreshes in the background until stopped; a failed refresh keeps the previous snapshot. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.refresh().catch(() => undefined);
    }, this.refreshIntervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** `{ claude_code: {...}, codex_cli: {...} }`, or an empty object before the first probe. */
  health(): Record<string, Json> {
    return Object.fromEntries(this.latest.map((probe) => [probe.mode, probeToJson(probe)]));
  }
}
