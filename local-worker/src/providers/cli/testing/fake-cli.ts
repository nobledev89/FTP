import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * A scripted stand-in for the Claude Code and Codex CLIs, for tests.
 *
 * `createFakeCli` writes a Node script and its scenario into a directory. Pointing `CLAUDE_BIN` or
 * `CODEX_BIN` at the script exercises the real resolver, process runner, argument construction,
 * environment allowlist, and output parsing: only the model is replaced. The script records every
 * invocation (arguments, the names of the environment variables it received, the prompt length)
 * so a test can assert what the worker sent and, as importantly, what it did not send.
 */

export type FakeClaudeResponse =
  | Readonly<{ structured: unknown }>
  | Readonly<{ error: string; status?: number }>
  | Readonly<{ raw: string; exitCode?: number }>
  | Readonly<{ sleepMs: number }>;

export type FakeCodexResponse =
  | Readonly<{ message: unknown }>
  | Readonly<{ messageText: string }>
  | Readonly<{ fail: string }>
  | Readonly<{ raw: string; exitCode?: number }>;

export type FakeCliScenario =
  | Readonly<{
      kind: "claude";
      version?: string;
      help?: string;
      auth?: Readonly<Record<string, unknown>>;
      responses: readonly FakeClaudeResponse[];
    }>
  | Readonly<{
      kind: "codex";
      version?: string;
      help?: string;
      login?: string;
      loginExitCode?: number;
      responses: readonly FakeCodexResponse[];
    }>;

export type FakeInvocation = Readonly<{
  args: readonly string[];
  envKeys: readonly string[];
  promptLength: number;
  promptHead: string;
  schema: unknown;
}>;

export type FakeCli = Readonly<{
  bin: string;
  invocations(): Promise<readonly FakeInvocation[]>;
  /** Invocations that sent a prompt, as opposed to version, help, and sign-in probes. */
  promptRuns(): Promise<readonly FakeInvocation[]>;
}>;

const SCRIPT = String.raw`
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const scenario = JSON.parse(readFileSync(path.join(directory, "scenario.json"), "utf8"));
const log = path.join(directory, "invocations.jsonl");
const args = process.argv.slice(2);
const prompt = await new Promise((resolve) => {
  let text = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => (text += chunk));
  process.stdin.on("end", () => resolve(text));
});

const isPromptRun =
  scenario.kind === "claude" ? args.includes("-p") : args[0] === "exec" && args.at(-1) === "-";
const schemaPath = args[args.indexOf("--output-schema") + 1];
const schema =
  scenario.kind === "claude"
    ? args.includes("--json-schema") ? JSON.parse(args[args.indexOf("--json-schema") + 1]) : null
    : args.includes("--output-schema") && existsSync(schemaPath)
      ? JSON.parse(readFileSync(schemaPath, "utf8"))
      : null;
const previous = existsSync(log)
  ? readFileSync(log, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line))
  : [];
const index = previous.filter((entry) => entry.promptRun).length;
appendFileSync(
  log,
  JSON.stringify({
    args,
    envKeys: Object.keys(process.env).sort(),
    promptLength: prompt.length,
    promptHead: prompt.slice(0, 200),
    schema,
    promptRun: isPromptRun,
  }) + "\n",
);

const flags = {
  claude: "--print --output-format --json-schema --tools --system-prompt --no-session-persistence --setting-sources --strict-mcp-config --safe-mode --permission-mode",
  codex: "--json --output-schema --output-last-message --ephemeral --ignore-user-config --ignore-rules --strict-config --skip-git-repo-check --sandbox --cd",
};

function out(text, code = 0) {
  process.stdout.write(text);
  process.exitCode = code;
}

if (args[0] === "--version") {
  out((scenario.version ?? (scenario.kind === "claude" ? "2.1.275 (Claude Code)" : "codex-cli 0.146.0")) + "\n");
} else if (args.includes("--help")) {
  out(scenario.help ?? flags[scenario.kind]);
} else if (scenario.kind === "claude" && args[0] === "auth" && args[1] === "status") {
  const auth = scenario.auth ?? { loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty" };
  out(JSON.stringify(auth, null, 2), auth.loggedIn ? 0 : 1);
} else if (scenario.kind === "codex" && args[0] === "login" && args[1] === "status") {
  process.stderr.write((scenario.login ?? "Logged in using ChatGPT") + "\n");
  process.exitCode = scenario.loginExitCode ?? 0;
} else if (isPromptRun) {
  const response = scenario.responses[index] ?? scenario.responses.at(-1);
  if (response.sleepMs) {
    await new Promise((resolve) => setTimeout(resolve, response.sleepMs));
  }
  if (response.raw !== undefined) {
    out(response.raw, response.exitCode ?? 0);
  } else if (scenario.kind === "claude") {
    const envelope = { type: "result", subtype: "success", is_error: false, duration_ms: 1200, num_turns: 2,
      total_cost_usd: 0.04, usage: { input_tokens: 10, output_tokens: 900, cache_read_input_tokens: 0,
      cache_creation_input_tokens: 1000 }, modelUsage: { "claude-sonnet-5": {} }, api_error_status: null };
    if (response.error !== undefined) {
      out(JSON.stringify({ ...envelope, is_error: true, result: response.error,
        api_error_status: response.status ?? null }), 1);
    } else {
      out(JSON.stringify({ ...envelope, result: JSON.stringify(response.structured),
        structured_output: response.structured }));
    }
  } else {
    const lastMessage = args[args.indexOf("--output-last-message") + 1];
    const events = [{ type: "thread.started", thread_id: "fake" }, { type: "turn.started" }];
    if (response.fail !== undefined) {
      events.push({ type: "error", message: response.fail }, { type: "turn.failed", error: { message: response.fail } });
      out(events.map((event) => JSON.stringify(event)).join("\n") + "\n", 1);
    } else {
      const text = response.messageText ?? JSON.stringify(response.message);
      writeFileSync(lastMessage, text);
      events.push(
        { type: "item.completed", item: { id: "item_0", type: "web_search", query: "fca" } },
        { type: "item.completed", item: { id: "item_1", type: "agent_message", text } },
        { type: "turn.completed", usage: { input_tokens: 5000, cached_input_tokens: 1000, output_tokens: 700, reasoning_output_tokens: 300 } },
      );
      out(events.map((event) => JSON.stringify(event)).join("\n") + "\n");
    }
  }
} else {
  process.stderr.write("fake cli: unexpected arguments " + JSON.stringify(args) + "\n");
  process.exitCode = 2;
}
`;

export async function createFakeCli(
  directory: string,
  scenario: FakeCliScenario,
): Promise<FakeCli> {
  await mkdir(directory, { recursive: true });
  const bin = path.join(directory, `fake-${scenario.kind}.mjs`);
  await writeFile(bin, SCRIPT, "utf8");
  await writeFile(path.join(directory, "scenario.json"), JSON.stringify(scenario), "utf8");
  const log = path.join(directory, "invocations.jsonl");

  async function invocations(): Promise<readonly (FakeInvocation & { promptRun: boolean })[]> {
    const text = await readFile(log, "utf8").catch(() => "");
    return text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as FakeInvocation & { promptRun: boolean });
  }

  return {
    bin,
    invocations,
    async promptRuns() {
      return (await invocations()).filter((entry) => entry.promptRun);
    },
  };
}
