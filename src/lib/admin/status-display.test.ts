import { describe, expect, it } from "vitest";

import { readColourTokens, contrastRatio } from "@/lib/design/contrast";
import { JOB_STATUSES, PIPELINE_STAGES } from "@/lib/state-machine/transitions";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  actionRequiredLabel,
  isBillableMode,
  jobStatusMeaning,
  jobStatusTone,
  providerModeLabel,
  shortId,
  stageLabel,
  workerStateTone,
} from "./status-display";

describe("job status presentation", () => {
  it("labels and explains every status", () => {
    for (const status of JOB_STATUSES) {
      expect(jobStatusTone(status), status).toBeTypeOf("string");
      expect(jobStatusMeaning(status).length, status).toBeGreaterThan(10);
    }
  });

  it("reserves danger for the states that need a person", () => {
    expect(jobStatusTone("FAILED")).toBe("danger");
    expect(jobStatusTone("NEEDS_HUMAN")).toBe("danger");
    expect(jobStatusTone("VERIFIED")).toBe("success");
    expect(jobStatusTone("PUBLISHED")).toBe("success");
    // A queued job is not a warning; it is simply waiting for the worker.
    expect(jobStatusTone("RESEARCH_PENDING")).toBe("neutral");
  });

  it("uses tones that pass contrast in the admin stylesheet", () => {
    const tokens = readColourTokens(
      readFileSync(path.join(process.cwd(), "src/styles/admin.css"), "utf8"),
    );
    const tones = new Set(JOB_STATUSES.map(jobStatusTone));
    for (const tone of tones) {
      const foreground = tokens.get(tone);
      const background = tokens.get(`${tone}-bg`);
      expect(foreground, tone).toBeDefined();
      expect(background, tone).toBeDefined();
      expect(
        contrastRatio(foreground as string, background as string),
        tone,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("vocabulary", () => {
  it("labels every pipeline stage", () => {
    for (const stage of PIPELINE_STAGES) {
      expect(stageLabel(stage), stage).toBeTypeOf("string");
    }
    expect(stageLabel("draft")).toBe("Writing");
  });

  it("marks exactly the metered modes as billable", () => {
    expect(isBillableMode("openai_api")).toBe(true);
    expect(isBillableMode("anthropic_api")).toBe(true);
    expect(isBillableMode("gemini_api")).toBe(true);
    for (const mode of [
      "mock",
      "manual_chatgpt",
      "codex_cli",
      "claude_code",
      "internal",
    ] as const) {
      expect(isBillableMode(mode), mode).toBe(false);
    }
  });

  it("names provider modes and action kinds in plain words", () => {
    expect(providerModeLabel("codex_cli")).toBe("Codex CLI");
    expect(actionRequiredLabel("cli_auth")).toBe("CLI sign-in needed");
  });

  it("maps worker health to a tone", () => {
    expect(workerStateTone("online")).toBe("success");
    expect(workerStateTone("stale")).toBe("warning");
    expect(workerStateTone("offline")).toBe("danger");
  });
});

describe("shortId", () => {
  it("takes the first eight characters", () => {
    expect(shortId("2c6e3f22-0000-4000-8000-000000000000")).toBe("2c6e3f22");
  });
});
