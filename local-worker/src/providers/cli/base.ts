import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { Json } from "../../db/database.types.js";
import { redactText } from "../../logging/redact.js";
import type { ErrorClass } from "../../queue/retry.js";
import type { JsonObject } from "../contract.js";
import { cliEnvironment, type CliName } from "./environment.js";
import { CliProviderError } from "./errors.js";
import { CliRunError, runCliProcess, type CliRunner, type CliRunResult } from "./process.js";
import { CliResolutionError, resolveCliCommand, type CliCommand } from "./resolve.js";
import { excerpt } from "./structured-output.js";

/**
 * What every subscription CLI client shares: resolving the configured command, a minimal
 * environment, bounded execution, and a capability probe (plan section 10.3/10.4 and Phase 9:
 * "re-inspect installed help/auth status", "capability probes").
 *
 * The probe runs before every stage execution, not only at start-up, because a subscription
 * sign-in can expire between runs. It is cheap — version, cached help, and the CLI's own offline
 * sign-in report — and it never sends a prompt, so a signed-out or billable sign-in is caught
 * before any usage is spent or any API is billed.
 */

export type CliMode = "claude_code" | "codex_cli";

export type CliAccount = "subscription" | "billable" | "signed_out" | "unknown";

/** Safe for the console and the heartbeat: no paths, tokens, or account emails. */
export type CliProbe = Readonly<{
  mode: CliMode;
  installed: boolean;
  version: string | null;
  supported: boolean;
  account: CliAccount;
  ready: boolean;
  problem: string | null;
  checkedAt: string;
}>;

export type CliRuntimeOptions = Readonly<{
  timeoutMs: number;
  /** Per stream. Defaults to 8 MiB, well above the largest artifact the schemas admit. */
  maxOutputBytes?: number;
  /** Where per-run scratch directories are created. Defaults to the OS temporary directory. */
  tempRoot?: string;
  /** The worker's environment, from which the child's allowlisted environment is built. */
  sourceEnv?: Readonly<Record<string, string | undefined>>;
  run?: CliRunner;
  resolve?: (bin: string) => CliCommand;
  now?: () => Date;
}>;

export type StructuredRequest = Readonly<{
  stage: "research" | "draft" | "revision" | "audit" | "discovery";
  prompt: string;
  schema: Readonly<Record<string, unknown>>;
  signal: AbortSignal;
}>;

export type StructuredResult = Readonly<{ value: unknown; usage: JsonObject }>;

/** The part of a CLI client a stage adapter uses. */
export interface StructuredCli {
  readonly mode: CliMode;
  readonly label: "Claude Code" | "Codex";
  probe(signal?: AbortSignal): Promise<CliProbe>;
  runStructured(request: StructuredRequest): Promise<StructuredResult>;
}

const PROBE_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

type AuthReport = Readonly<{ account: CliAccount; problem: string | null }>;

export abstract class SubscriptionCli implements StructuredCli {
  abstract readonly mode: CliMode;
  abstract readonly label: "Claude Code" | "Codex";
  protected abstract readonly cliName: CliName;
  /** The environment variable an operator sets to point at the CLI, for messages. */
  protected abstract readonly binVariable: string;
  protected abstract readonly versionArgs: readonly string[];
  protected abstract readonly helpArgs: readonly string[];
  /** Options the adapter relies on; a CLI whose help lacks one is too old or too new to trust. */
  protected abstract readonly requiredOptions: readonly string[];
  protected abstract readAuth(signal?: AbortSignal): Promise<AuthReport>;
  abstract runStructured(request: StructuredRequest): Promise<StructuredResult>;

  protected readonly options: Required<Omit<CliRuntimeOptions, "resolve">> &
    Pick<CliRuntimeOptions, "resolve">;
  private readonly helpChecks = new Map<string, readonly string[]>();

  constructor(
    protected readonly bin: string,
    options: CliRuntimeOptions,
  ) {
    this.options = {
      timeoutMs: options.timeoutMs,
      maxOutputBytes: options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
      tempRoot: options.tempRoot ?? tmpdir(),
      sourceEnv: options.sourceEnv ?? process.env,
      run: options.run ?? runCliProcess,
      now: options.now ?? (() => new Date()),
      ...(options.resolve ? { resolve: options.resolve } : {}),
    };
  }

  /** A report that never throws (except on abort), for the heartbeat and `worker:status`. */
  async probe(signal?: AbortSignal): Promise<CliProbe> {
    try {
      return await this.inspect(signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      const notInstalled = error instanceof CliProviderError && error.errorClass === "auth";
      return {
        mode: this.mode,
        checkedAt: this.options.now().toISOString(),
        installed: !notInstalled,
        version: null,
        supported: false,
        account: "unknown",
        ready: false,
        problem: error instanceof Error ? redactText(error.message) : "probe failed",
      };
    }
  }

  /**
   * Throws the classified reason a stage cannot run now, or returns the verified version.
   * A missing or signed-out CLI is `auth` (the database records it as a `cli_auth` action), a
   * billable sign-in is `auth` too, and an unsupported version is `permanent_config`. A probe that
   * times out keeps its own `transient` class and is retried like any other network wobble.
   */
  protected async ensureReady(signal: AbortSignal): Promise<string> {
    const probe = await this.inspect(signal);
    if (probe.ready && probe.version) return probe.version;
    const problem = probe.problem ?? `${this.label} is not ready`;
    if (!probe.installed || probe.account === "signed_out" || probe.account === "billable") {
      throw new CliProviderError(this.label, problem, "auth");
    }
    throw new CliProviderError(this.label, problem, "permanent_config");
  }

  /** Version, supported options, then sign-in. Execution problems throw, classified. */
  private async inspect(signal?: AbortSignal): Promise<CliProbe> {
    const base = { mode: this.mode, checkedAt: this.options.now().toISOString(), installed: true };
    const command = this.command();
    const versionRun = await this.exec(command, this.versionArgs, {
      timeoutMs: PROBE_TIMEOUT_MS,
      ...(signal ? { signal } : {}),
    });
    const version = /\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.]+)?/.exec(
      `${versionRun.stdout} ${versionRun.stderr}`,
    )?.[0];
    if (versionRun.exitCode !== 0 || !version) {
      return {
        ...base,
        version: null,
        supported: false,
        account: "unknown",
        ready: false,
        problem: `${this.label} did not report a version; reinstall it`,
      };
    }

    const missing = await this.missingOptions(command, version, signal);
    if (missing.length > 0) {
      return {
        ...base,
        version,
        supported: false,
        account: "unknown",
        ready: false,
        problem: `${this.label} ${version} lacks ${missing.join(", ")}; update it`,
      };
    }

    const auth = await this.readAuth(signal);
    return {
      ...base,
      version,
      supported: true,
      account: auth.account,
      ready: auth.account === "subscription",
      problem: auth.problem,
    };
  }

  protected command(): CliCommand {
    try {
      return this.options.resolve
        ? this.options.resolve(this.bin)
        : resolveCliCommand(this.bin, { env: this.options.sourceEnv });
    } catch (error) {
      if (error instanceof CliResolutionError && error.reason === "not_found") {
        throw this.notInstalled(error);
      }
      throw new CliProviderError(
        this.label,
        `${this.label} cannot be launched: ${error instanceof Error ? error.message : String(error)}. ` +
          `Point ${this.binVariable} at the CLI's executable.`,
        "permanent_config",
        { cause: error },
      );
    }
  }

  protected notInstalled(cause?: unknown): CliProviderError {
    return new CliProviderError(
      this.label,
      `${this.label} was not found on the worker PC (${this.binVariable}=${path.basename(this.bin)}). ` +
        "Install it and sign in with the subscription account, then retry the stage.",
      "auth",
      cause === undefined ? undefined : { cause },
    );
  }

  protected async exec(
    command: CliCommand,
    args: readonly string[],
    options: Readonly<{ stdin?: string; cwd?: string; timeoutMs?: number; signal?: AbortSignal }>,
  ): Promise<CliRunResult> {
    try {
      return await this.options.run({
        command,
        args,
        ...(options.stdin === undefined ? {} : { stdin: options.stdin }),
        cwd: options.cwd ?? this.options.tempRoot,
        env: cliEnvironment(this.cliName, this.options.sourceEnv),
        timeoutMs: options.timeoutMs ?? this.options.timeoutMs,
        maxOutputBytes: this.options.maxOutputBytes,
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (error) {
      if (!(error instanceof CliRunError)) throw error;
      const classes: Readonly<Record<CliRunError["reason"], ErrorClass>> = {
        not_found: "auth",
        spawn_failed: "permanent_config",
        timeout: "transient",
        output_limit: "invalid_output",
      };
      if (error.reason === "not_found") throw this.notInstalled(error);
      throw new CliProviderError(
        this.label,
        `${this.label} ${error.message}`,
        classes[error.reason],
        { cause: error },
      );
    }
  }

  /** A fresh scratch directory for one run, always removed afterwards. */
  protected async withScratchDirectory<T>(work: (directory: string) => Promise<T>): Promise<T> {
    const directory = await mkdtemp(
      path.join(this.options.tempRoot, `fintechpulse-${this.cliName}-`),
    );
    try {
      return await work(directory);
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  protected failure(message: string, errorClass: ErrorClass, detail?: string): CliProviderError {
    const suffix = detail ? `: ${excerpt(redactText(detail))}` : "";
    return new CliProviderError(this.label, `${message}${suffix}`, errorClass);
  }

  private async missingOptions(
    command: CliCommand,
    version: string,
    signal?: AbortSignal,
  ): Promise<readonly string[]> {
    const key = `${command.file}|${command.prefixArgs.join("|")}|${version}`;
    const cached = this.helpChecks.get(key);
    if (cached) return cached;
    const help = await this.exec(command, this.helpArgs, {
      timeoutMs: PROBE_TIMEOUT_MS,
      ...(signal ? { signal } : {}),
    });
    const text = `${help.stdout}\n${help.stderr}`;
    const missing = this.requiredOptions.filter((option) => !text.includes(option));
    this.helpChecks.set(key, missing);
    return missing;
  }
}

/** The probe as stored in the worker heartbeat. */
export function probeToJson(probe: CliProbe): Json {
  return {
    installed: probe.installed,
    version: probe.version,
    supported: probe.supported,
    account: probe.account,
    ready: probe.ready,
    problem: probe.problem,
    checked_at: probe.checkedAt,
  };
}

/** Classifies a provider's failure text. Order matters: a usage limit often arrives as a 429. */
export function classifyProviderMessage(text: string): ErrorClass | null {
  const lower = text.toLowerCase();
  if (
    /usage limit|hit your (?:usage )?limit|limit reached|out of (?:extra )?usage|weekly limit|session limit|purchase more credits|quota/.test(
      lower,
    )
  ) {
    return "usage_limit";
  }
  if (
    /not logged in|please run \/login|log ?in again|login required|401\b|unauthori[sz]ed|authentication[_ ]error|invalid (?:api key|bearer)|token (?:has )?expired|oauth token|missing bearer/.test(
      lower,
    )
  ) {
    return "auth";
  }
  if (/rate[ _-]?limit|too many requests|\b429\b|overloaded|\b529\b/.test(lower)) {
    return "rate_limit";
  }
  if (
    /timed? ?out|econnreset|econnrefused|enotfound|eai_again|network|fetch failed|socket|stream disconnected|\b50[0234]\b|service unavailable|internal server error/.test(
      lower,
    )
  ) {
    return "transient";
  }
  return null;
}
