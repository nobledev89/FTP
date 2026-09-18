import { describe, expect, it } from "vitest";

import { cliCapabilities, cliStateDisplay } from "./cli-capability";

const probe = (overrides: Record<string, unknown> = {}) => ({
  installed: true,
  version: "2.1.275",
  supported: true,
  account: "subscription",
  ready: true,
  problem: null,
  checked_at: "2026-09-18T05:00:55.598Z",
  ...overrides,
});

describe("cliCapabilities", () => {
  it("reads both CLIs from the worker heartbeat", () => {
    expect(
      cliCapabilities({
        state: "idle",
        providers: {
          claude_code: probe(),
          codex_cli: probe({
            version: "0.146.0",
            account: "signed_out",
            ready: false,
            problem: "Codex is not signed in on the worker PC. Run `codex login`.",
          }),
        },
      }),
    ).toEqual([
      {
        mode: "claude_code",
        version: "2.1.275",
        state: "ready",
        problem: null,
        checkedAt: "2026-09-18T05:00:55.598Z",
      },
      {
        mode: "codex_cli",
        version: "0.146.0",
        state: "sign_in",
        problem: "Codex is not signed in on the worker PC. Run `codex login`.",
        checkedAt: "2026-09-18T05:00:55.598Z",
      },
    ]);
  });

  it("distinguishes missing, outdated, and billable CLIs", () => {
    const states = (providers: Record<string, unknown>) =>
      cliCapabilities({ providers }).map((capability) => capability.state);
    expect(
      states({
        claude_code: probe({ installed: false, supported: false, ready: false, version: null }),
        codex_cli: probe({ supported: false, ready: false, account: "unknown" }),
      }),
    ).toEqual(["not_installed", "unsupported"]);
    expect(
      states({ claude_code: probe({ account: "billable", ready: false }), codex_cli: probe() }),
    ).toEqual(["billable", "ready"]);
  });

  it("treats a worker that has not reported CLIs, or reports nonsense, as unknown", () => {
    expect(cliCapabilities({ state: "idle" }).map((capability) => capability.state)).toEqual([
      "unknown",
      "unknown",
    ]);
    expect(cliCapabilities({ providers: { claude_code: { ready: "yes" } } })[0]?.state).toBe(
      "unknown",
    );
    expect(cliCapabilities(null)).toHaveLength(2);
  });

  it("redacts worker-originated problem text", () => {
    const [claude] = cliCapabilities({
      providers: {
        claude_code: probe({
          ready: false,
          account: "signed_out",
          problem: "Not signed in for owner@example.com at C:\\Users\\owner\\.claude",
        }),
      },
    });
    expect(claude?.problem).not.toContain("owner@example.com");
    expect(claude?.problem).not.toContain("C:\\Users");
  });

  it("gives every state a label and a tone", () => {
    expect(cliStateDisplay("ready")).toEqual({ label: "ready", tone: "success" });
    expect(cliStateDisplay("billable").tone).toBe("danger");
  });
});
