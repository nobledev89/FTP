import type { Json } from "../../db/database.types.js";
import type { JsonObject } from "../contract.js";
import {
  classifyProviderMessage,
  SubscriptionCli,
  type CliAccount,
  type CliRuntimeOptions,
  type StructuredRequest,
  type StructuredResult,
} from "./base.js";
import type { CliProviderError } from "./errors.js";
import type { CliRunResult } from "./process.js";
import { parseJsonObject } from "./structured-output.js";

/**
 * Claude Code in non-interactive print mode, on the owner's Claude subscription (plan section 10.4).
 *
 * Checked against Claude Code 2.1.275 on 2026-09-18. One run is:
 *
 *   claude -p --output-format json --json-schema <schema> --tools "" --system-prompt <text>
 *     --no-session-persistence --setting-sources "" --strict-mcp-config --safe-mode
 *     --permission-mode dontAsk [--model <model>]
 *
 * with the prompt on stdin, in an empty scratch directory. Writing needs no tools, so none are
 * offered; `--safe-mode`, `--setting-sources ""`, and `--strict-mcp-config` keep the owner's
 * CLAUDE.md files, hooks, plugins, skills, and MCP servers out of the run; the default coding-agent
 * system prompt is replaced by a short editorial one. The schema is passed inline because the
 * option accepts JSON only, which is safe because the executable is spawned without a shell.
 *
 * `claude auth status` reports the sign-in as JSON without contacting the model. Only a
 * subscription sign-in (`claude.ai`, or `oauth_token` from `claude setup-token`) against Anthropic
 * directly is accepted; an API key or a cloud provider bills per request and is refused.
 */

export type ClaudeCodeSettings = Readonly<{ bin: string; model?: string }>;

const SUBSCRIPTION_METHODS = new Set(["claude.ai", "oauth_token"]);

const SYSTEM_PROMPT =
  "You are the editorial model for FinTechPulse, a UK financial and fintech publication, running " +
  "non-interactively inside its publishing pipeline. Follow the user's instructions exactly, use " +
  "only the material they provide, and return your answer only through the structured output.";

export class ClaudeCodeCli extends SubscriptionCli {
  readonly mode = "claude_code" as const;
  readonly label = "Claude Code" as const;
  protected readonly cliName = "claude" as const;
  protected readonly binVariable = "CLAUDE_BIN";
  protected readonly versionArgs = ["--version"];
  protected readonly helpArgs = ["--help"];
  protected readonly requiredOptions = [
    "--print",
    "--output-format",
    "--json-schema",
    "--tools",
    "--system-prompt",
    "--no-session-persistence",
    "--setting-sources",
    "--strict-mcp-config",
    "--safe-mode",
    "--permission-mode",
  ];

  constructor(
    private readonly settings: ClaudeCodeSettings,
    options: CliRuntimeOptions,
  ) {
    super(settings.bin, options);
  }

  protected async readAuth(
    signal?: AbortSignal,
  ): Promise<Readonly<{ account: CliAccount; problem: string | null }>> {
    const run = await this.exec(this.command(), ["auth", "status"], {
      timeoutMs: 30_000,
      ...(signal ? { signal } : {}),
    });
    return interpretClaudeAuth(run);
  }

  async runStructured(request: StructuredRequest): Promise<StructuredResult> {
    const version = await this.ensureReady(request.signal);
    const command = this.command();
    const args = [
      "-p",
      "--output-format",
      "json",
      "--json-schema",
      JSON.stringify(request.schema),
      "--tools",
      "",
      "--system-prompt",
      SYSTEM_PROMPT,
      "--no-session-persistence",
      "--setting-sources",
      "",
      "--strict-mcp-config",
      "--safe-mode",
      "--permission-mode",
      "dontAsk",
      ...(this.settings.model ? ["--model", this.settings.model] : []),
    ];

    const run = await this.withScratchDirectory((directory) =>
      this.exec(command, args, { stdin: request.prompt, cwd: directory, signal: request.signal }),
    );
    return interpretClaudeRun(run, version, (message, errorClass, detail) =>
      this.failure(message, errorClass, detail),
    );
  }
}

export function interpretClaudeAuth(
  run: CliRunResult,
): Readonly<{ account: CliAccount; problem: string | null }> {
  let report: { loggedIn?: unknown; authMethod?: unknown; apiProvider?: unknown };
  try {
    report = JSON.parse(run.stdout) as typeof report;
  } catch {
    return {
      account: "unknown",
      problem: "Claude Code did not report its sign-in state as JSON; update it",
    };
  }
  if (report.loggedIn !== true) {
    return {
      account: "signed_out",
      problem:
        "Claude Code is not signed in on the worker PC. Run `claude auth login` with the Claude " +
        "subscription account, then retry the stage.",
    };
  }
  const method = typeof report.authMethod === "string" ? report.authMethod : "unknown";
  const provider = typeof report.apiProvider === "string" ? report.apiProvider : "unknown";
  if (!SUBSCRIPTION_METHODS.has(method) || provider !== "firstParty") {
    return {
      account: "billable",
      problem:
        `Claude Code is signed in with ${method === "api_key" ? "an API key" : `"${method}" via ${provider}`}, ` +
        "which bills per request. Claude Code mode runs only on a Claude subscription sign-in: run " +
        "`claude auth login` with the subscription account, or choose the Anthropic API mode " +
        "deliberately.",
    };
  }
  return { account: "subscription", problem: null };
}

type FailureFactory = (
  message: string,
  errorClass: CliProviderError["errorClass"],
  detail?: string,
) => CliProviderError;

type ResultEnvelope = {
  type?: unknown;
  subtype?: unknown;
  is_error?: unknown;
  result?: unknown;
  structured_output?: unknown;
  api_error_status?: unknown;
  duration_ms?: unknown;
  num_turns?: unknown;
  total_cost_usd?: unknown;
  usage?: Record<string, unknown>;
  modelUsage?: Record<string, unknown>;
};

/** Reads the single `--output-format json` result object. Exported for fixture tests. */
export function interpretClaudeRun(
  run: CliRunResult,
  version: string,
  fail: FailureFactory,
): StructuredResult {
  const envelope = findResultEnvelope(run.stdout);
  if (!envelope) {
    const text = `${run.stdout}\n${run.stderr}`;
    const errorClass =
      classifyProviderMessage(text) ?? (run.exitCode === 0 ? "invalid_output" : "unknown");
    throw fail(
      errorClass === "auth"
        ? "Claude Code is not signed in on the worker PC; run `claude auth login`, then retry"
        : `Claude Code exited with code ${run.exitCode ?? "none"} and no result`,
      errorClass,
      text,
    );
  }

  const resultText = typeof envelope.result === "string" ? envelope.result : "";
  if (envelope.is_error === true || run.exitCode !== 0) {
    const status =
      typeof envelope.api_error_status === "number" ? ` ${envelope.api_error_status}` : "";
    const errorClass =
      classifyProviderMessage(`${resultText}${status}`) ??
      (envelope.api_error_status === 401 || envelope.api_error_status === 403 ? "auth" : "unknown");
    const lead: Readonly<Record<string, string>> = {
      auth: "Claude Code is not signed in on the worker PC; run `claude auth login`, then retry",
      usage_limit:
        "The Claude subscription usage limit was reached. The stage was not retried and no API " +
        "was used; retry it from the console after the limit resets",
      rate_limit: "Claude Code was rate limited",
      transient: "Claude Code hit a temporary error",
    };
    throw fail(lead[errorClass] ?? "Claude Code reported an error", errorClass, resultText);
  }

  let value = envelope.structured_output;
  if (value === undefined || value === null) {
    try {
      value = parseJsonObject(resultText);
    } catch {
      throw fail(
        `Claude Code returned no structured output (${String(envelope.subtype ?? "unknown")})`,
        "invalid_output",
        resultText,
      );
    }
  }
  return { value, usage: claudeUsage(envelope, version) };
}

function findResultEnvelope(stdout: string): ResultEnvelope | null {
  const candidates = [stdout.trim(), ...stdout.trim().split(/\r?\n/).reverse()];
  for (const candidate of candidates) {
    if (!candidate.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(candidate) as ResultEnvelope;
      if (parsed && typeof parsed === "object" && parsed.type === "result") return parsed;
    } catch {
      // Not the result line.
    }
  }
  return null;
}

/**
 * Usage as the CLI reports it. `total_cost_usd` is Claude Code's list-price estimate; a
 * subscription run is not billed per request, so it is kept as an estimate in `usage` and never
 * written to the run's cost columns.
 */
function claudeUsage(envelope: ResultEnvelope, version: string): JsonObject {
  const usage = envelope.usage ?? {};
  const number = (value: unknown): Json => (typeof value === "number" ? value : null);
  return {
    cli: "claude_code",
    cli_version: version,
    billing: "subscription",
    models: Object.keys(envelope.modelUsage ?? {}),
    duration_ms: number(envelope.duration_ms),
    turns: number(envelope.num_turns),
    input_tokens: number(usage.input_tokens),
    output_tokens: number(usage.output_tokens),
    cache_read_input_tokens: number(usage.cache_read_input_tokens),
    cache_creation_input_tokens: number(usage.cache_creation_input_tokens),
    list_price_estimate_usd: number(envelope.total_cost_usd),
  };
}
