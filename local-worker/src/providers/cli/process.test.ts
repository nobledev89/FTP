import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { CliRunError, runCliProcess, type CliRunRequest } from "./process.js";

/** Runs a small Node program through the real runner: no shell, argv only, stdin for input. */
function node(code: string, overrides: Partial<CliRunRequest> = {}): Promise<unknown> {
  return runCliProcess({
    command: { file: process.execPath, prefixArgs: ["-e", code] },
    args: [],
    cwd: tmpdir(),
    env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "" },
    timeoutMs: 10_000,
    maxOutputBytes: 1024 * 1024,
    ...overrides,
  });
}

describe("runCliProcess", () => {
  it("passes arguments verbatim without a shell and input through stdin", async () => {
    const tricky = '{"type":"object","a":"%PATH% & echo ^pwned | more"}';
    const result = await node(
      `let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{process.stdout.write(JSON.stringify({argv:process.argv.slice(1),stdin:s}));process.stderr.write("warn");process.exitCode=3});`,
      { args: [tricky, ""], stdin: "the prompt" },
    );
    expect(result).toMatchObject({
      exitCode: 3,
      stderr: "warn",
      stdout: JSON.stringify({ argv: [tricky, ""], stdin: "the prompt" }),
    });
  });

  it("kills a process that runs past its timeout", async () => {
    const started = Date.now();
    await expect(node("setTimeout(()=>{}, 60_000)", { timeoutMs: 300 })).rejects.toMatchObject({
      name: "CliRunError",
      reason: "timeout",
    });
    expect(Date.now() - started).toBeLessThan(8_000);
  });

  it("stops a process that exceeds the output limit", async () => {
    await expect(
      node("setInterval(()=>process.stdout.write('x'.repeat(4096)), 1)", {
        maxOutputBytes: 64 * 1024,
      }),
    ).rejects.toMatchObject({ reason: "output_limit" });
  });

  it("stops the process when the stage is cancelled", async () => {
    const controller = new AbortController();
    const running = node("setTimeout(()=>{}, 60_000)", { signal: controller.signal });
    setTimeout(() => controller.abort(new DOMException("shutdown", "AbortError")), 200);
    await expect(running).rejects.toMatchObject({ name: "AbortError" });
  });

  it("reports a missing executable as not found", async () => {
    await expect(
      runCliProcess({
        command: { file: "fintechpulse-no-such-cli-binary", prefixArgs: [] },
        args: [],
        cwd: tmpdir(),
        env: { PATH: process.env.PATH ?? "" },
        timeoutMs: 5_000,
        maxOutputBytes: 1024,
      }),
    ).rejects.toSatisfy((error) => error instanceof CliRunError && error.reason === "not_found");
  });
});
