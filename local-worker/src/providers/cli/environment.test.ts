import { describe, expect, it } from "vitest";

import { cliEnvironment } from "./environment.js";

const WORKER_ENV = {
  Path: "C:\\Windows\\system32;C:\\npm",
  SystemRoot: "C:\\Windows",
  USERPROFILE: "C:\\Users\\owner",
  APPDATA: "C:\\Users\\owner\\AppData\\Roaming",
  HTTPS_PROXY: "http://proxy.local:8080",
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
  REVALIDATION_SECRET: "revalidation-secret-value-of-sufficient-length",
  OPENAI_API_KEY: "openai-key",
  ANTHROPIC_API_KEY: "anthropic-key",
  GEMINI_API_KEY: "gemini-key",
  CODEX_API_KEY: "codex-key",
  ANTHROPIC_AUTH_TOKEN: "anthropic-token",
  CLAUDE_CODE_OAUTH_TOKEN: "subscription-oauth-token",
  CLAUDE_CONFIG_DIR: "C:\\Users\\owner\\.claude",
  CODEX_HOME: "C:\\Users\\owner\\.codex",
  CLAUDECODE: "1",
  WORKER_ID: "owner-pc",
  EMPTY: "",
};

describe("cliEnvironment", () => {
  it("never passes worker secrets or API keys to a CLI", () => {
    for (const cli of ["claude", "codex"] as const) {
      const environment = cliEnvironment(cli, WORKER_ENV);
      for (const secret of [
        "SUPABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
        "REVALIDATION_SECRET",
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "GEMINI_API_KEY",
        "CODEX_API_KEY",
        "ANTHROPIC_AUTH_TOKEN",
        "WORKER_ID",
        "CLAUDECODE",
      ]) {
        expect(environment).not.toHaveProperty(secret);
      }
      expect(Object.values(environment)).not.toContain("service-role-secret");
    }
  });

  it("keeps what Windows and the CLI need, in the casing Windows reports", () => {
    const environment = cliEnvironment("claude", WORKER_ENV);
    expect(environment).toMatchObject({
      Path: WORKER_ENV.Path,
      SystemRoot: WORKER_ENV.SystemRoot,
      USERPROFILE: WORKER_ENV.USERPROFILE,
      APPDATA: WORKER_ENV.APPDATA,
      HTTPS_PROXY: WORKER_ENV.HTTPS_PROXY,
      NO_COLOR: "1",
      DISABLE_AUTOUPDATER: "1",
    });
    expect(environment).not.toHaveProperty("EMPTY");
  });

  it("passes each CLI only its own sign-in location", () => {
    expect(cliEnvironment("claude", WORKER_ENV)).toMatchObject({
      CLAUDE_CONFIG_DIR: WORKER_ENV.CLAUDE_CONFIG_DIR,
      CLAUDE_CODE_OAUTH_TOKEN: WORKER_ENV.CLAUDE_CODE_OAUTH_TOKEN,
    });
    expect(cliEnvironment("claude", WORKER_ENV)).not.toHaveProperty("CODEX_HOME");
    expect(cliEnvironment("codex", WORKER_ENV)).toMatchObject({
      CODEX_HOME: WORKER_ENV.CODEX_HOME,
    });
    expect(cliEnvironment("codex", WORKER_ENV)).not.toHaveProperty("CLAUDE_CODE_OAUTH_TOKEN");
  });
});
