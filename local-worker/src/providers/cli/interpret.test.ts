import { describe, expect, it } from "vitest";

import type { ErrorClass } from "../../queue/retry.js";
import { interpretClaudeAuth, interpretClaudeRun } from "./claude-code.js";
import { interpretCodexAuth, interpretCodexRun } from "./codex.js";
import { CliProviderError } from "./errors.js";
import type { CliRunResult } from "./process.js";

/**
 * Fixtures are trimmed copies of real output captured on 2026-09-18 from Claude Code 2.1.275 and
 * codex-cli 0.146.0: a successful structured run, a signed-out run, an API-key sign-in, and Codex's
 * real usage-limit and 401 event streams.
 */

function run(stdout: string, exitCode = 0, stderr = ""): CliRunResult {
  return { exitCode, signal: null, stdout, stderr, durationMs: 10 };
}

const fail =
  (cli: "Claude Code" | "Codex") => (message: string, errorClass: ErrorClass, detail?: string) =>
    new CliProviderError(cli, detail ? `${message}: ${detail}` : message, errorClass);

function classOf(action: () => unknown): ErrorClass | undefined {
  try {
    action();
  } catch (error) {
    return (error as CliProviderError).errorClass;
  }
  return undefined;
}

const CLAUDE_SUCCESS = JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: false,
  duration_ms: 1548,
  num_turns: 2,
  result: '{"city":"London","n":7}',
  structured_output: { city: "London", n: 7 },
  stop_reason: "tool_use",
  total_cost_usd: 0.040716,
  usage: {
    input_tokens: 2,
    cache_creation_input_tokens: 9757,
    cache_read_input_tokens: 0,
    output_tokens: 72,
  },
  modelUsage: { "claude-haiku-4-5-20251001": {}, "claude-sonnet-5": {} },
  api_error_status: null,
  terminal_reason: "completed",
});

const CLAUDE_SIGNED_OUT = JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: true,
  duration_ms: 94,
  num_turns: 1,
  result: "Not logged in · Please run /login",
  total_cost_usd: 0,
  api_error_status: null,
  terminal_reason: "api_error",
});

const CODEX_USAGE_LIMIT = [
  '{"type":"thread.started","thread_id":"01a0b2d6-f595-7d51-8c06-ae5769ac82d9"}',
  '{"type":"turn.started"}',
  `{"type":"error","message":"You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 2:00 PM."}`,
  `{"type":"turn.failed","error":{"message":"You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 2:00 PM."}}`,
].join("\n");

const CODEX_UNAUTHORIZED = [
  '{"type":"thread.started","thread_id":"01a0b2d7-4005-7f53-9c20-4d5a13fcb137"}',
  '{"type":"turn.started"}',
  '{"type":"error","message":"Reconnecting... 2/5 (unexpected status 401 Unauthorized: Missing bearer or basic authentication in header, url: wss://api.openai.com/v1/responses)"}',
  '{"type":"error","message":"unexpected status 401 Unauthorized: Missing bearer or basic authentication in header, url: https://api.openai.com/v1/responses"}',
  '{"type":"turn.failed","error":{"message":"unexpected status 401 Unauthorized: Missing bearer or basic authentication in header, url: https://api.openai.com/v1/responses"}}',
].join("\n");

describe("Claude Code sign-in", () => {
  it("accepts a claude.ai or setup-token subscription sign-in", () => {
    for (const authMethod of ["claude.ai", "oauth_token"]) {
      expect(
        interpretClaudeAuth(
          run(JSON.stringify({ loggedIn: true, authMethod, apiProvider: "firstParty" })),
        ),
      ).toEqual({ account: "subscription", problem: null });
    }
  });

  it("refuses an API-key or cloud-provider sign-in as billable", () => {
    const apiKey = interpretClaudeAuth(
      run(
        JSON.stringify({
          loggedIn: true,
          authMethod: "api_key",
          apiProvider: "firstParty",
          apiKeySource: "ANTHROPIC_API_KEY",
        }),
      ),
    );
    expect(apiKey.account).toBe("billable");
    expect(apiKey.problem).toMatch(/an API key, which bills per request/);
    expect(
      interpretClaudeAuth(
        run(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", apiProvider: "bedrock" })),
      ).account,
    ).toBe("billable");
  });

  it("reports a signed-out CLI with the command to run", () => {
    const report = interpretClaudeAuth(
      run(JSON.stringify({ loggedIn: false, authMethod: "none", apiProvider: "firstParty" }), 1),
    );
    expect(report.account).toBe("signed_out");
    expect(report.problem).toMatch(/claude auth login/);
  });

  it("does not guess when the status is not JSON", () => {
    expect(interpretClaudeAuth(run("Logged in")).account).toBe("unknown");
  });
});

describe("Claude Code run output", () => {
  it("returns the structured output and subscription usage without a billed cost", () => {
    const result = interpretClaudeRun(run(CLAUDE_SUCCESS), "2.1.275", fail("Claude Code"));
    expect(result.value).toEqual({ city: "London", n: 7 });
    expect(result.usage).toMatchObject({
      cli: "claude_code",
      cli_version: "2.1.275",
      billing: "subscription",
      output_tokens: 72,
      list_price_estimate_usd: 0.040716,
      models: ["claude-haiku-4-5-20251001", "claude-sonnet-5"],
    });
  });

  it("falls back to the result text when no structured output is attached", () => {
    const envelope = {
      ...JSON.parse(CLAUDE_SUCCESS),
      structured_output: undefined,
      result: '```json\n{"a":1}\n```',
    };
    expect(
      interpretClaudeRun(run(JSON.stringify(envelope)), "2.1.275", fail("Claude Code")).value,
    ).toEqual({ a: 1 });
  });

  it("classifies sign-in, usage-limit, rate-limit, and malformed results", () => {
    const interpret =
      (stdout: string, exitCode = 1) =>
      () =>
        interpretClaudeRun(run(stdout, exitCode), "2.1.275", fail("Claude Code"));
    const errorEnvelope = (result: string, status: number | null = null) =>
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: true,
        result,
        api_error_status: status,
      });

    expect(classOf(interpret(CLAUDE_SIGNED_OUT))).toBe("auth");
    expect(
      classOf(interpret(errorEnvelope("OAuth token has expired. Please obtain a new token.", 401))),
    ).toBe("auth");
    expect(classOf(interpret(errorEnvelope("Claude AI usage limit reached|1758200000", 429)))).toBe(
      "usage_limit",
    );
    expect(
      classOf(interpret(errorEnvelope("You've hit your limit · resets 3pm (Europe/London)"))),
    ).toBe("usage_limit");
    expect(classOf(interpret(errorEnvelope("API Error: 529 Overloaded", 529)))).toBe("rate_limit");
    expect(classOf(interpret(errorEnvelope("Request timed out")))).toBe("transient");
    expect(
      classOf(
        interpret(
          JSON.stringify({
            ...JSON.parse(CLAUDE_SUCCESS),
            structured_output: null,
            result: "Here is your article.",
          }),
          0,
        ),
      ),
    ).toBe("invalid_output");
    expect(classOf(interpret("", 0))).toBe("invalid_output");
    expect(classOf(interpret("Not logged in · Please run /login"))).toBe("auth");
  });

  it("says a usage limit was not retried and no API was used", () => {
    try {
      interpretClaudeRun(
        run(
          JSON.stringify({
            type: "result",
            is_error: true,
            result: "Claude AI usage limit reached",
          }),
          1,
        ),
        "2.1.275",
        fail("Claude Code"),
      );
    } catch (error) {
      expect((error as Error).message).toMatch(/not retried and no API was used/);
    }
  });
});

describe("Codex sign-in", () => {
  it("accepts only a ChatGPT sign-in", () => {
    expect(interpretCodexAuth(run("", 0, "Logged in using ChatGPT\n"))).toEqual({
      account: "subscription",
      problem: null,
    });
    const apiKey = interpretCodexAuth(
      run("", 0, "Logged in using an API key - sk-fake-***00000\n"),
    );
    expect(apiKey.account).toBe("billable");
    expect(apiKey.problem).toMatch(/codex logout/);
    expect(apiKey.problem).not.toMatch(/sk-/);
    expect(interpretCodexAuth(run("", 1, "Not logged in\n")).account).toBe("signed_out");
  });
});

describe("Codex run output", () => {
  const events = (message: string) =>
    [
      '{"type":"thread.started","thread_id":"t"}',
      '{"type":"turn.started"}',
      '{"type":"item.completed","item":{"id":"item_0","type":"web_search","query":"fca"}}',
      JSON.stringify({
        type: "item.completed",
        item: { id: "item_1", type: "agent_message", text: message },
      }),
      '{"type":"turn.completed","usage":{"input_tokens":5000,"cached_input_tokens":1000,"output_tokens":700,"reasoning_output_tokens":300}}',
    ].join("\n");

  it("reads the last-message file and records token and search usage", () => {
    const result = interpretCodexRun(run(events('{"x":1}')), '{"x":2}', "0.146.0", fail("Codex"));
    expect(result.value).toEqual({ x: 2 });
    expect(result.usage).toMatchObject({
      cli: "codex_cli",
      billing: "subscription",
      turns: 1,
      web_searches: 1,
      input_tokens: 5000,
      output_tokens: 700,
      reasoning_tokens: 300,
    });
  });

  it("falls back to the final agent message when no file was written", () => {
    expect(interpretCodexRun(run(events('{"x":1}')), null, "0.146.0", fail("Codex")).value).toEqual(
      { x: 1 },
    );
  });

  it("classifies the real usage-limit and 401 streams without retrying them", () => {
    const interpret = (stdout: string) => () =>
      interpretCodexRun(run(stdout, 1), null, "0.146.0", fail("Codex"));
    expect(classOf(interpret(CODEX_USAGE_LIMIT))).toBe("usage_limit");
    expect(classOf(interpret(CODEX_UNAUTHORIZED))).toBe("auth");
    expect(
      classOf(
        interpret(
          '{"type":"turn.failed","error":{"message":"stream disconnected before completion"}}',
        ),
      ),
    ).toBe("transient");
  });

  it("treats a finished turn without JSON as invalid output", () => {
    expect(
      classOf(() =>
        interpretCodexRun(run(events("I could not find sources.")), null, "0.146.0", fail("Codex")),
      ),
    ).toBe("invalid_output");
  });
});
