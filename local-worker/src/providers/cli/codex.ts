import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

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
 * Codex `exec` on the owner's ChatGPT subscription (plan section 10.3).
 *
 * Checked against codex-cli 0.146.0 on 2026-09-18. One run is:
 *
 *   codex exec --ignore-user-config --strict-config --ignore-rules --ephemeral
 *     --skip-git-repo-check --sandbox read-only --color never --json -C <empty dir>
 *     --output-schema <schema file> -o <last message file> -c web_search="live"|"disabled"
 *     [-m <model>] [-c model_reasoning_effort="<effort>"] -
 *
 * with the prompt on stdin. `--ignore-user-config` keeps the owner's own Codex configuration —
 * notify hooks, MCP servers, plugins, trusted projects — out of the run while the sign-in under
 * CODEX_HOME still applies; `--strict-config` makes Codex reject a mistyped override instead of
 * silently ignoring it. The agent runs read-only in an empty directory. Research is given live web
 * search, because it must cite real sources; the audit judges the draft against the research
 * packet and gets none.
 *
 * `codex login status` reports the sign-in without contacting the model. Only "Logged in using
 * ChatGPT" is accepted: an API-key sign-in bills per request, and a signed-out Codex otherwise
 * spends about a minute retrying 401s before it gives up.
 */

export type CodexReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

export type CodexSettings = Readonly<{
  bin: string;
  model?: string;
  reasoningEffort?: CodexReasoningEffort;
}>;

export class CodexCli extends SubscriptionCli {
  readonly mode = "codex_cli" as const;
  readonly label = "Codex" as const;
  protected readonly cliName = "codex" as const;
  protected readonly binVariable = "CODEX_BIN";
  protected readonly versionArgs = ["--version"];
  protected readonly helpArgs = ["exec", "--help"];
  protected readonly requiredOptions = [
    "--json",
    "--output-schema",
    "--output-last-message",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--strict-config",
    "--skip-git-repo-check",
    "--sandbox",
    "--cd",
  ];

  constructor(
    private readonly settings: CodexSettings,
    options: CliRuntimeOptions,
  ) {
    super(settings.bin, options);
  }

  protected async readAuth(
    signal?: AbortSignal,
  ): Promise<Readonly<{ account: CliAccount; problem: string | null }>> {
    const run = await this.exec(this.command(), ["login", "status"], {
      timeoutMs: 30_000,
      ...(signal ? { signal } : {}),
    });
    return interpretCodexAuth(run);
  }

  /**
   * Generates one image with Codex's built-in image tool on the ChatGPT subscription.
   *
   * `codex exec` has no option to name an output file, and the read-only sandbox (rightly) stops
   * the agent from copying one anywhere. Codex itself saves every generated image under
   * `<CODEX_HOME>/generated_images/<thread id>/`, and the thread id is the first JSONL event, so
   * the worker reads the file from there and then deletes that run's folder. Web search is off:
   * the brief is already fixed by the approved draft.
   */
  async generateImage(request: ImageRequest): Promise<GeneratedImage> {
    const version = await this.ensureReady(request.signal);
    const command = this.command();

    return this.withScratchDirectory(async (directory) => {
      const workspace = path.join(directory, "workspace");
      await mkdir(workspace);
      const run = await this.exec(
        command,
        [
          "exec",
          "--ignore-user-config",
          "--strict-config",
          "--ignore-rules",
          "--ephemeral",
          "--skip-git-repo-check",
          "--sandbox",
          "read-only",
          "--color",
          "never",
          "--json",
          "--cd",
          workspace,
          "-c",
          'web_search="disabled"',
          "-",
        ],
        { stdin: request.prompt, cwd: directory, signal: request.signal },
      );
      const fail: FailureFactory = (message, errorClass, detail) =>
        this.failure(message, errorClass, detail);
      const { threadId, usage } = interpretCodexImageRun(run, version, fail);

      const folder = path.join(this.codexHome(), "generated_images", threadId);
      try {
        const file = await newestImage(folder);
        if (!file) {
          throw fail("Codex finished without generating an image", "invalid_output", run.stderr);
        }
        const bytes = new Uint8Array(await readFile(file.path));
        return { bytes, mimeType: file.mimeType, usage };
      } finally {
        await rm(folder, { recursive: true, force: true }).catch(() => undefined);
      }
    });
  }

  private codexHome(): string {
    const env = this.options.sourceEnv;
    const configured = env.CODEX_HOME?.trim();
    if (configured) return configured;
    return path.join(env.USERPROFILE?.trim() || env.HOME?.trim() || homedir(), ".codex");
  }

  async runStructured(request: StructuredRequest): Promise<StructuredResult> {
    const version = await this.ensureReady(request.signal);
    const command = this.command();

    return this.withScratchDirectory(async (directory) => {
      const workspace = path.join(directory, "workspace");
      const schemaFile = path.join(directory, "output-schema.json");
      const lastMessageFile = path.join(directory, "last-message.txt");
      await mkdir(workspace);
      await writeFile(schemaFile, JSON.stringify(request.schema), "utf8");

      const args = [
        "exec",
        "--ignore-user-config",
        "--strict-config",
        "--ignore-rules",
        "--ephemeral",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--color",
        "never",
        "--json",
        "--cd",
        workspace,
        "--output-schema",
        schemaFile,
        "--output-last-message",
        lastMessageFile,
        "-c",
        `web_search="${request.stage === "research" || request.stage === "discovery" ? "live" : "disabled"}"`,
        ...(this.settings.model ? ["--model", this.settings.model] : []),
        ...(this.settings.reasoningEffort
          ? ["-c", `model_reasoning_effort="${this.settings.reasoningEffort}"`]
          : []),
        "-",
      ];

      const run = await this.exec(command, args, {
        stdin: request.prompt,
        cwd: directory,
        signal: request.signal,
      });
      const lastMessage = await readFile(lastMessageFile, "utf8").catch(() => null);
      return interpretCodexRun(run, lastMessage, version, (message, errorClass, detail) =>
        this.failure(message, errorClass, detail),
      );
    });
  }
}

export type ImageRequest = Readonly<{ prompt: string; signal: AbortSignal }>;

export type GeneratedImage = Readonly<{
  bytes: Uint8Array;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  usage: JsonObject;
}>;

const IMAGE_EXTENSIONS: Readonly<Record<string, GeneratedImage["mimeType"]>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

async function newestImage(
  folder: string,
): Promise<Readonly<{ path: string; mimeType: GeneratedImage["mimeType"] }> | null> {
  const names = await readdir(folder).catch(() => [] as string[]);
  let newest: { path: string; mimeType: GeneratedImage["mimeType"]; modified: number } | null =
    null;
  for (const name of names) {
    const mimeType = IMAGE_EXTENSIONS[path.extname(name).toLowerCase()];
    if (!mimeType) continue;
    const file = path.join(folder, name);
    const info = await stat(file);
    if (!info.isFile()) continue;
    if (!newest || info.mtimeMs > newest.modified) {
      newest = { path: file, mimeType, modified: info.mtimeMs };
    }
  }
  return newest ? { path: newest.path, mimeType: newest.mimeType } : null;
}

export function interpretCodexAuth(
  run: CliRunResult,
): Readonly<{ account: CliAccount; problem: string | null }> {
  const text = `${run.stdout}\n${run.stderr}`;
  if (/not logged in/i.test(text) || (run.exitCode !== 0 && !/logged in using/i.test(text))) {
    return {
      account: "signed_out",
      problem:
        "Codex is not signed in on the worker PC. Run `codex login` and choose Sign in with " +
        "ChatGPT, then retry the stage.",
    };
  }
  if (/logged in using chatgpt/i.test(text)) return { account: "subscription", problem: null };
  if (/api key/i.test(text)) {
    return {
      account: "billable",
      problem:
        "Codex is signed in with an API key, which bills per request. Codex mode runs only on a " +
        "ChatGPT subscription sign-in: run `codex logout`, then `codex login` with ChatGPT, or " +
        "choose the OpenAI API mode deliberately.",
    };
  }
  return { account: "unknown", problem: "Codex did not report a recognisable sign-in; update it" };
}

type FailureFactory = (
  message: string,
  errorClass: CliProviderError["errorClass"],
  detail?: string,
) => CliProviderError;

type CodexEvent = {
  type?: unknown;
  thread_id?: unknown;
  message?: unknown;
  error?: { message?: unknown };
  usage?: Record<string, unknown>;
  item?: { type?: unknown; text?: unknown };
};

/** Reads the JSONL event stream and the last-message file. Exported for fixture tests. */
export function interpretCodexRun(
  run: CliRunResult,
  lastMessage: string | null,
  version: string,
  fail: FailureFactory,
): StructuredResult {
  const events = parseEvents(run.stdout);
  assertCodexSucceeded(run, events, fail);

  const agentMessage = events
    .filter((event) => event.type === "item.completed" && event.item?.type === "agent_message")
    .map((event) => (typeof event.item?.text === "string" ? event.item.text : ""))
    .at(-1);
  const text = lastMessage?.trim() ? lastMessage : (agentMessage ?? "");
  let value: unknown;
  try {
    value = parseJsonObject(text);
  } catch {
    throw fail("Codex finished without a JSON result", "invalid_output", text || run.stderr);
  }
  return { value, usage: codexUsage(events, version) };
}

const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reads an image run's event stream: the same failure handling as a structured run, then the
 * thread id that names Codex's generated-images folder. The id is checked as a UUID before it is
 * ever joined into a path. Exported for fixture tests.
 */
export function interpretCodexImageRun(
  run: CliRunResult,
  version: string,
  fail: FailureFactory,
): Readonly<{ threadId: string; usage: JsonObject }> {
  const events = parseEvents(run.stdout);
  assertCodexSucceeded(run, events, fail);
  const threadId = events.find((event) => event.type === "thread.started")?.thread_id;
  if (typeof threadId !== "string" || !THREAD_ID.test(threadId)) {
    throw fail("Codex did not report a thread id for the image run", "invalid_output", run.stderr);
  }
  return { threadId, usage: { ...codexUsage(events, version), images: 1 } };
}

function assertCodexSucceeded(
  run: CliRunResult,
  events: readonly CodexEvent[],
  fail: FailureFactory,
): void {
  const failed = events.findLast((event) => event.type === "turn.failed");
  const lastError = events.findLast(
    (event) =>
      event.type === "error" &&
      typeof event.message === "string" &&
      !event.message.startsWith("Reconnecting"),
  );
  const failureText =
    (typeof failed?.error?.message === "string" ? failed.error.message : null) ??
    (typeof lastError?.message === "string" ? lastError.message : null);

  if (failed || run.exitCode !== 0) {
    const detail = failureText ?? run.stderr;
    const errorClass = classifyProviderMessage(detail) ?? "unknown";
    const lead: Readonly<Record<string, string>> = {
      auth: "Codex is not signed in on the worker PC; run `codex login` with ChatGPT, then retry",
      usage_limit:
        "The ChatGPT subscription's Codex usage limit was reached. The stage was not retried and " +
        "no API was used; retry it from the console after the limit resets",
      rate_limit: "Codex was rate limited",
      transient: "Codex hit a temporary error",
    };
    throw fail(
      lead[errorClass] ?? `Codex exited with code ${run.exitCode ?? "none"}`,
      errorClass,
      detail,
    );
  }
}

function parseEvents(stdout: string): CodexEvent[] {
  const events: CodexEvent[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === "object") events.push(parsed as CodexEvent);
    } catch {
      // Codex writes the occasional non-JSON diagnostic; the event stream is what matters.
    }
  }
  return events;
}

function codexUsage(events: readonly CodexEvent[], version: string): JsonObject {
  const totals = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_tokens: 0 };
  let turns = 0;
  for (const event of events) {
    if (event.type !== "turn.completed" || !event.usage) continue;
    turns += 1;
    const read = (key: string) => (typeof event.usage?.[key] === "number" ? event.usage[key] : 0);
    totals.input_tokens += read("input_tokens");
    totals.cached_input_tokens += read("cached_input_tokens");
    totals.output_tokens += read("output_tokens");
    totals.reasoning_tokens += read("reasoning_output_tokens");
  }
  const webSearches = events.filter(
    (event) => event.type === "item.completed" && event.item?.type === "web_search",
  ).length;
  const usage: Record<string, Json> = {
    cli: "codex_cli",
    cli_version: version,
    billing: "subscription",
    turns,
    web_searches: webSearches,
    ...totals,
  };
  return usage;
}
