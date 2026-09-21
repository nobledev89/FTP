import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { RunContext } from "../contract.js";
import { buildDraft } from "../mock/draft.js";
import type { ImageStageOutput } from "../mock/images.js";
import { buildResearchPacket } from "../mock/research.js";
import { resolveAdapter } from "../registry.js";
import { createCliAdapters } from "./adapters.js";
import { CodexCli, interpretCodexImageRun } from "./codex.js";
import { codexImagePrompt, CodexImagesAdapter } from "./codex-images.js";
import { CliProviderError } from "./errors.js";
import type { CliRunRequest, CliRunResult } from "./process.js";

const THREAD = "01a0c289-7b91-7633-8f08-c92e220f8bc3";

/** A PNG header is all `imageDimensions` reads; the body is irrelevant to these tests. */
function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function context(): RunContext {
  return {
    stage: "images",
    mode: "codex_image",
    cycle: 0,
    attempt: 1,
    claimVersion: 3,
    brief: {
      jobId: "44444444-4444-4444-8444-444444444444",
      topic: "UK payment safeguarding rules",
      keywords: ["payments"],
      requirements: null,
      articleType: "analysis",
      category: "Payments",
      targetWordCount: 900,
      imageCount: 1,
      siteName: "FinTechPulse",
      timezone: "Europe/London",
      today: "2026-09-21",
    },
    template: null,
    styleGuide: null,
    schemaVersion: "image-1",
  };
}

const draftContext = { ...context(), stage: "draft" as const, mode: "mock" as const };
const packet = buildResearchPacket({ ...draftContext, stage: "research" });
const draft = buildDraft(draftContext, { packet });
const input = { draft, draftVersion: 1 };

function events(lines: readonly object[]): string {
  return lines.map((line) => JSON.stringify(line)).join("\n");
}

function result(stdout: string, exitCode = 0): CliRunResult {
  return { exitCode, signal: null, stdout, stderr: "", durationMs: 5 };
}

const fail = (message: string, errorClass: CliProviderError["errorClass"]) =>
  new CliProviderError("Codex", message, errorClass);

describe("interpretCodexImageRun", () => {
  it("returns the thread id that names Codex's generated-images folder", () => {
    const run = result(
      events([
        { type: "thread.started", thread_id: THREAD },
        { type: "turn.completed", usage: { input_tokens: 10, output_tokens: 2 } },
      ]),
    );
    expect(interpretCodexImageRun(run, "0.146.0", fail)).toMatchObject({
      threadId: THREAD,
      usage: { billing: "subscription", images: 1, input_tokens: 10 },
    });
  });

  it("refuses a thread id that is not a UUID, so it can never become a path", () => {
    const run = result(events([{ type: "thread.started", thread_id: "../../etc" }]));
    expect(() => interpretCodexImageRun(run, "0.146.0", fail)).toThrow(/thread id/);
  });

  it("classifies a usage limit like any other Codex run", () => {
    const run = result(
      events([
        { type: "thread.started", thread_id: THREAD },
        { type: "turn.failed", error: { message: "You've hit your usage limit." } },
      ]),
      1,
    );
    try {
      interpretCodexImageRun(run, "0.146.0", fail);
      expect.unreachable();
    } catch (error) {
      expect((error as { errorClass: string }).errorClass).toBe("usage_limit");
    }
  });
});

describe("CodexImagesAdapter", () => {
  function adapter(width: number, height: number) {
    const prompts: string[] = [];
    const codex = {
      label: "Codex" as const,
      generateImage: async ({ prompt }: { prompt: string }) => {
        prompts.push(prompt);
        return {
          bytes: png(width, height),
          mimeType: "image/png" as const,
          usage: { cli_version: "0.146.0", billing: "subscription" },
        };
      },
    };
    return { images: new CodexImagesAdapter(codex), prompts };
  }

  async function run(images: CodexImagesAdapter) {
    const prepared = await images.prepare(input, context());
    const raw = await images.execute({
      prepared,
      input,
      context: context(),
      signal: new AbortController().signal,
    });
    return { prepared, raw, output: await images.normalize(raw, context()) };
  }

  it("records the brief's metadata and the file's real dimensions, hash, and size", async () => {
    const { images, prompts } = adapter(1672, 941);
    const { prepared, raw, output } = await run(images);

    expect(prepared).toMatchObject({ mode: "codex_image", provider: "openai" });
    expect(prompts[0]).toContain(draft.imageBriefs[0]!.prompt);
    expect(prompts[0]).toContain("16:9 landscape");
    expect(prompts[0]).toContain("reply with the single word DONE");
    const artifact = (output as ImageStageOutput).artifacts[0];
    expect(artifact).toMatchObject({
      slot: 0,
      altText: draft.imageBriefs[0]!.altText,
      width: 1672,
      height: 941,
      mimeType: "image/png",
      byteSize: 64,
      status: "uploaded",
    });
    expect(artifact?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(raw).toMatchObject({
      usage: { cli: "codex_image", billing: "subscription", images: 1 },
    });
  });

  it("rejects an image whose shape does not match the brief's aspect ratio", async () => {
    const { images } = adapter(1024, 1024);
    await expect(run(images)).rejects.toMatchObject({ errorClass: "invalid_output" });
  });

  it("is what the registry resolves for the images stage in codex_image mode", () => {
    const set = createCliAdapters({
      claude: { bin: "claude" },
      codex: { bin: "codex" },
      runtime: { timeoutMs: 1_000 },
    });
    expect(resolveAdapter("images", "codex_image", set)).toBeInstanceOf(CodexImagesAdapter);
  });

  it("tells Codex which orientation to draw", () => {
    expect(codexImagePrompt("Brief", "4:5")).toContain("4:5 portrait");
    expect(codexImagePrompt("Brief", "1:1")).toContain("1:1 square");
  });
});

describe("CodexCli.generateImage", () => {
  let codexHome: string;

  beforeEach(async () => {
    codexHome = await mkdtemp(path.join(tmpdir(), "fintechpulse-codex-home-"));
  });

  afterEach(async () => {
    await rm(codexHome, { recursive: true, force: true });
  });

  function cli(onExec: (request: CliRunRequest) => Promise<CliRunResult>): CodexCli {
    return new CodexCli(
      { bin: "codex" },
      {
        timeoutMs: 5_000,
        sourceEnv: { CODEX_HOME: codexHome },
        resolve: () => ({ file: "codex", prefixArgs: [] }),
        run: async (request) => {
          const [first] = request.args;
          if (first === "--version") return result("codex-cli 0.146.0");
          if (first === "login") return result("Logged in using ChatGPT");
          if (request.args.includes("--help")) {
            return result(
              "--json --output-schema --output-last-message --ephemeral --ignore-user-config " +
                "--ignore-rules --strict-config --skip-git-repo-check --sandbox --cd",
            );
          }
          return onExec(request);
        },
      },
    );
  }

  it("reads the image Codex saved for this thread, then deletes that thread's folder", async () => {
    const folder = path.join(codexHome, "generated_images", THREAD);
    let sent: CliRunRequest | undefined;
    const codex = cli(async (request) => {
      sent = request;
      await mkdir(folder, { recursive: true });
      await writeFile(path.join(folder, "exec-1.png"), png(1672, 941));
      return result(events([{ type: "thread.started", thread_id: THREAD }]));
    });

    const image = await codex.generateImage({
      prompt: "Draw the brief",
      signal: new AbortController().signal,
    });

    expect(image.mimeType).toBe("image/png");
    expect(image.bytes.byteLength).toBe(64);
    expect(existsSync(folder)).toBe(false);
    expect(sent?.args).toEqual(
      expect.arrayContaining(["exec", "--sandbox", "read-only", "--ephemeral", "--json"]),
    );
    expect(sent?.args).toContain('web_search="disabled"');
    expect(sent?.stdin).toBe("Draw the brief");
  });

  it("reports a run that produced no image as invalid output", async () => {
    const codex = cli(async () => result(events([{ type: "thread.started", thread_id: THREAD }])));
    await expect(
      codex.generateImage({ prompt: "Draw", signal: new AbortController().signal }),
    ).rejects.toMatchObject({ errorClass: "invalid_output" });
  });
});
