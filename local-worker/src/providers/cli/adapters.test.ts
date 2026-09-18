import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { RunContext } from "../contract.js";
import { buildAudit } from "../mock/audit.js";
import { buildDraft } from "../mock/draft.js";
import { buildResearchPacket } from "../mock/research.js";
import { resolveAdapter } from "../registry.js";
import { createCliAdapters } from "./adapters.js";
import type { CliProviderError } from "./errors.js";
import { createFakeCli, type FakeCliScenario } from "./testing/fake-cli.js";

const SECRETS = {
  SUPABASE_SERVICE_ROLE_KEY: "service-role-must-not-leak",
  REVALIDATION_SECRET: "revalidation-must-not-leak",
  ANTHROPIC_API_KEY: "anthropic-key-must-not-leak",
  OPENAI_API_KEY: "openai-key-must-not-leak",
  CODEX_API_KEY: "codex-key-must-not-leak",
};

function context(stage: RunContext["stage"], mode: RunContext["mode"]): RunContext {
  return {
    stage,
    mode,
    cycle: 0,
    attempt: 1,
    claimVersion: 4,
    brief: {
      jobId: "33333333-3333-4333-8333-333333333333",
      topic: "UK Consumer Duty and payment firms",
      keywords: ["payments"],
      requirements: null,
      articleType: "analysis",
      category: "Payments",
      targetWordCount: 900,
      imageCount: 1,
      siteName: "FinTechPulse",
      timezone: "Europe/London",
      today: "2026-09-18",
    },
    template: null,
    styleGuide: null,
    schemaVersion: stage === "research" ? "research-1" : stage === "audit" ? "audit-1" : "draft-1",
  };
}

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "fintechpulse-cli-test-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function setup(claude: FakeCliScenario, codex?: FakeCliScenario, timeoutMs = 30_000) {
  const claudeCli = await createFakeCli(path.join(directory, "claude"), claude);
  const codexCli = await createFakeCli(
    path.join(directory, "codex"),
    codex ?? { kind: "codex", responses: [] },
  );
  const adapters = createCliAdapters({
    claude: { bin: claudeCli.bin, model: "sonnet" },
    codex: { bin: codexCli.bin, reasoningEffort: "high" },
    runtime: { timeoutMs, sourceEnv: { ...process.env, ...SECRETS }, tempRoot: directory },
  });
  return { adapters, claudeCli, codexCli };
}

async function runStage<S extends "research" | "draft" | "audit">(
  adapters: ReturnType<typeof createCliAdapters>,
  stage: S,
  input: unknown,
) {
  const mode = stage === "draft" ? "claude_code" : "codex_cli";
  const adapter = resolveAdapter(stage, mode, adapters) as unknown as {
    prepare(input: unknown, context: RunContext): Promise<import("../contract.js").PreparedRun>;
    execute(request: unknown): Promise<import("../contract.js").RawRunResult>;
    normalize(raw: import("../contract.js").RawRunResult, context: RunContext): Promise<unknown>;
  };
  const runContext = context(stage, mode);
  const prepared = await adapter.prepare(input, runContext);
  const raw = await adapter.execute({
    prepared,
    input,
    context: runContext,
    signal: new AbortController().signal,
  });
  return { prepared, raw, output: await adapter.normalize(raw, runContext) };
}

async function failure(promise: Promise<unknown>): Promise<CliProviderError> {
  try {
    await promise;
  } catch (error) {
    return error as CliProviderError;
  }
  throw new Error("expected the stage to fail");
}

const packet = buildResearchPacket(context("research", "mock"));
const draft = buildDraft(context("draft", "mock"), { packet });

describe("Claude Code adapter", () => {
  it("drafts through the isolated CLI and normalizes exactly like mock output", async () => {
    const { adapters, claudeCli } = await setup({
      kind: "claude",
      responses: [{ structured: draft }],
    });

    const { prepared, raw, output } = await runStage(adapters, "draft", { packet });

    expect(prepared).toMatchObject({ mode: "claude_code", provider: "anthropic" });
    expect(output).toEqual(draft);
    expect(raw).toMatchObject({
      kind: "output",
      usage: { cli: "claude_code", billing: "subscription" },
    });

    const [run] = await claudeCli.promptRuns();
    expect(run?.promptLength).toBe(prepared.prompt.length);
    expect(run?.args).toEqual(
      expect.arrayContaining([
        "-p",
        "--json-schema",
        "--safe-mode",
        "--no-session-persistence",
        "--strict-mcp-config",
      ]),
    );
    const args = run?.args ?? [];
    expect(args[args.indexOf("--tools") + 1]).toBe("");
    expect(args[args.indexOf("--setting-sources") + 1]).toBe("");
    expect(args[args.indexOf("--model") + 1]).toBe("sonnet");
    expect(run?.schema).toMatchObject({ type: "object", additionalProperties: false });

    // Every invocation — probes included — ran without the worker's secrets or any API key.
    for (const invocation of await claudeCli.invocations()) {
      for (const secret of Object.keys(SECRETS)) expect(invocation.envKeys).not.toContain(secret);
    }
  });

  it("stops before sending a prompt when Claude Code is signed out or billable", async () => {
    for (const auth of [
      { loggedIn: false, authMethod: "none", apiProvider: "firstParty" },
      { loggedIn: true, authMethod: "api_key", apiProvider: "firstParty" },
    ]) {
      const { adapters, claudeCli } = await setup({
        kind: "claude",
        auth,
        responses: [{ structured: draft }],
      });
      const error = await failure(runStage(adapters, "draft", { packet }));
      expect(error.errorClass).toBe("auth");
      expect(await claudeCli.promptRuns()).toHaveLength(0);
    }
  });

  it("refuses a Claude Code build that lacks a required option", async () => {
    const { adapters, claudeCli } = await setup({
      kind: "claude",
      help: "--print --output-format",
      responses: [{ structured: draft }],
    });
    const error = await failure(runStage(adapters, "draft", { packet }));
    expect(error.errorClass).toBe("permanent_config");
    expect(error.message).toMatch(/lacks --json-schema/);
    expect(await claudeCli.promptRuns()).toHaveLength(0);
  });

  it("reports a usage limit for an editor and never falls back", async () => {
    const { adapters } = await setup({
      kind: "claude",
      responses: [{ error: "Claude AI usage limit reached|1758200000", status: 429 }],
    });
    const error = await failure(runStage(adapters, "draft", { packet }));
    expect(error.errorClass).toBe("usage_limit");
    expect(error.message).toMatch(/no API was used/);
  });

  it("classifies schema-invalid JSON as invalid output with the failing fields", async () => {
    const { adapters } = await setup({
      kind: "claude",
      responses: [{ structured: { ...draft, slug: "Not A Slug", imageBriefs: [] } }],
    });
    const error = await failure(runStage(adapters, "draft", { packet }));
    expect(error.errorClass).toBe("invalid_output");
    expect(error.message).toMatch(/does not match draft-1/);
    expect(error.message).toMatch(/slug/);
  });

  it("kills a run that exceeds the configured timeout and treats it as transient", async () => {
    const { adapters } = await setup(
      { kind: "claude", responses: [{ sleepMs: 20_000 }] },
      undefined,
      1_500,
    );
    const error = await failure(runStage(adapters, "draft", { packet }));
    expect(error.errorClass).toBe("transient");
    expect(error.message).toMatch(/did not finish/);
  });
});

describe("Codex adapter", () => {
  it("researches with live web search and audits without it, both through strict schemas", async () => {
    const audit = buildAudit(context("audit", "mock"), { packet, draft, draftVersion: 1 });
    const { adapters, codexCli } = await setup(
      { kind: "claude", responses: [] },
      { kind: "codex", responses: [{ message: packet }, { message: audit }] },
    );

    const research = await runStage(adapters, "research", {});
    expect(research.output).toEqual(packet);
    expect(research.prepared).toMatchObject({ mode: "codex_cli", provider: "openai" });
    expect(research.raw).toMatchObject({ usage: { cli: "codex_cli", web_searches: 1 } });

    const audited = await runStage(adapters, "audit", { packet, draft, draftVersion: 1 });
    expect(audited.output).toEqual(audit);

    const [researchRun, auditRun] = await codexCli.promptRuns();
    for (const run of [researchRun, auditRun]) {
      expect(run?.args).toEqual(
        expect.arrayContaining([
          "--ignore-user-config",
          "--strict-config",
          "--ephemeral",
          "--sandbox",
          "read-only",
          "--output-schema",
          "--output-last-message",
        ]),
      );
      expect(run?.args.at(-1)).toBe("-");
      expect(run?.args).toContain('model_reasoning_effort="high"');
      expect(run?.schema).toMatchObject({ type: "object", additionalProperties: false });
    }
    expect(researchRun?.args).toContain('web_search="live"');
    expect(auditRun?.args).toContain('web_search="disabled"');
    for (const invocation of await codexCli.invocations()) {
      for (const secret of Object.keys(SECRETS)) expect(invocation.envKeys).not.toContain(secret);
    }
  });

  it("refuses an API-key sign-in before any prompt is sent", async () => {
    const { adapters, codexCli } = await setup(
      { kind: "claude", responses: [] },
      {
        kind: "codex",
        login: "Logged in using an API key - sk-proj-***abcd",
        responses: [{ message: packet }],
      },
    );
    const error = await failure(runStage(adapters, "research", {}));
    expect(error.errorClass).toBe("auth");
    expect(error.message).toMatch(/bills per request/);
    expect(await codexCli.promptRuns()).toHaveLength(0);
  });

  it("classifies the subscription usage limit and does not retry it", async () => {
    const { adapters } = await setup(
      { kind: "claude", responses: [] },
      {
        kind: "codex",
        responses: [{ fail: "You've hit your usage limit. Try again at 2:00 PM." }],
      },
    );
    const error = await failure(runStage(adapters, "research", {}));
    expect(error.errorClass).toBe("usage_limit");
  });
});
