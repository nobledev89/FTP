import { describe, expect, it } from "vitest";

import { WorkerStageError, classifyError, failureOutcome, retryAt, retryDelayMs } from "./retry.js";

describe("worker retry policy", () => {
  it("keeps authentication and usage limits out of retry loops", () => {
    expect(classifyError(new Error("Claude is not logged in"))).toBe("auth");
    expect(classifyError(new Error("Usage limit reached"))).toBe("usage_limit");
    expect(failureOutcome("auth", 1, 5)).toBe("needs_human");
    expect(failureOutcome("usage_limit", 1, 5)).toBe("needs_human");
  });

  it("retries malformed provider output and operational failures until the configured ceiling", () => {
    expect(classifyError(new Error("Schema validation failed"))).toBe("invalid_output");
    expect(failureOutcome("invalid_output", 1, 5)).toBe("retry");
    expect(failureOutcome("invalid_output", 5, 5)).toBe("failed");
    expect(failureOutcome("transient", 1, 5)).toBe("retry");
    expect(failureOutcome("rate_limit", 4, 5)).toBe("retry");
    expect(failureOutcome("unknown", 5, 5)).toBe("failed");
    expect(failureOutcome("permanent_config", 1, 5)).toBe("failed");
  });

  it("uses exponential, jittered, stage-capped delays", () => {
    expect(retryDelayMs("research", 1, "transient", () => 0.5)).toBe(5_000);
    expect(retryDelayMs("research", 2, "transient", () => 0.5)).toBe(10_000);
    expect(retryDelayMs("research", 20, "transient", () => 0.5)).toBe(15 * 60_000);
    expect(retryDelayMs("research", 1, "rate_limit", () => 0.5)).toBe(30_000);
    expect(retryDelayMs("images", 1, "transient", () => 0)).toBe(11_250);
  });

  it("returns an absolute UTC retry timestamp", () => {
    expect(retryAt("verify", 1, "transient", new Date("2026-09-18T00:00:00.000Z"), () => 0.5)).toBe(
      "2026-09-18T00:00:30.000Z",
    );
  });

  it("honours explicit stage error classes", () => {
    expect(classifyError(new WorkerStageError("provider disabled", "permanent_config"))).toBe(
      "permanent_config",
    );
  });
});
