import { describe, expect, it } from "vitest";

import { WorkerConfigError, parseWorkerEnv } from "./env.js";

const base = {
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-test-value",
  PUBLIC_SITE_URL: "http://localhost:3000",
  REVALIDATION_SECRET: "x".repeat(32),
  WORKER_ID: "home-pc-1",
};

describe("parseWorkerEnv", () => {
  it("boots without optional API keys and applies defaults", () => {
    const env = parseWorkerEnv(base);
    expect(env.WORKER_POLL_INTERVAL_MS).toBe(10_000);
    expect(env.WORKER_LEASE_SECONDS).toBe(900);
    expect(env.CLAUDE_BIN).toBe("claude");
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });

  it("treats empty template values as unset", () => {
    const env = parseWorkerEnv({ ...base, WORKER_MAX_ATTEMPTS: "", GEMINI_API_KEY: "  " });
    expect(env.WORKER_MAX_ATTEMPTS).toBe(5);
    expect(env.GEMINI_API_KEY).toBeUndefined();
  });

  it("requires an API key only for providers selected in API mode", () => {
    expect(() => parseWorkerEnv(base, ["anthropic"])).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => parseWorkerEnv({ ...base, ANTHROPIC_API_KEY: "k" }, ["anthropic"])).not.toThrow();
  });

  it("reports invalid variables without echoing secret values", () => {
    const secret = "short-secret";
    try {
      parseWorkerEnv({ ...base, REVALIDATION_SECRET: secret, WORKER_ID: "Bad ID" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(WorkerConfigError);
      const message = (error as Error).message;
      expect(message).toContain("REVALIDATION_SECRET");
      expect(message).toContain("WORKER_ID");
      expect(message).not.toContain(secret);
    }
  });
});
