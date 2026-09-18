import { spawn, type ChildProcess } from "node:child_process";

import type { CliCommand } from "./resolve.js";

/**
 * Runs one CLI invocation with hard bounds (plan section 19: "CLI child processes receive a
 * minimal environment and bounded input/output/time").
 *
 * No shell is involved: the command was resolved to a real executable or Node script, and the
 * arguments reach it as an argv array. Input goes through stdin. The run ends when the process
 * exits, when `timeoutMs` passes, when either output stream exceeds `maxOutputBytes`, or when the
 * caller's signal aborts (worker shutdown or a lost lease). In every early case the whole process
 * tree is killed — the Codex entry point is a Node script that starts a native child, and killing
 * only the parent on Windows would leave that child running and still spending the subscription.
 */

export type CliRunRequest = Readonly<{
  command: CliCommand;
  args: readonly string[];
  stdin?: string;
  cwd: string;
  env: Readonly<Record<string, string>>;
  timeoutMs: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
}>;

export type CliRunResult = Readonly<{
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}>;

export type CliRunFailureReason = "not_found" | "spawn_failed" | "timeout" | "output_limit";

export class CliRunError extends Error {
  constructor(
    readonly reason: CliRunFailureReason,
    message: string,
    readonly partial?: Readonly<{ stdout: string; stderr: string }>,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CliRunError";
  }
}

export type CliRunner = (request: CliRunRequest) => Promise<CliRunResult>;

export const runCliProcess: CliRunner = (request) =>
  new Promise((resolve, reject) => {
    const started = Date.now();
    const signal = request.signal;
    if (signal?.aborted) {
      reject(signal.reason ?? abortError());
      return;
    }

    let child: ChildProcess;
    try {
      child = spawn(request.command.file, [...request.command.prefixArgs, ...request.args], {
        cwd: request.cwd,
        // The complete child environment: nothing is inherited from this process.
        env: { ...request.env } as NodeJS.ProcessEnv,
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
        windowsHide: true,
        // A POSIX process group lets the whole tree be signalled at once.
        detached: process.platform !== "win32",
      });
    } catch (error) {
      reject(spawnFailure(error));
      return;
    }

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let pendingFailure: Error | null = null;

    const timer = setTimeout(() => {
      fail(
        new CliRunError(
          "timeout",
          `the CLI did not finish within ${Math.round(request.timeoutMs / 1000)} seconds`,
          partial(),
        ),
      );
    }, request.timeoutMs);

    const onAbort = () => fail(signal?.reason ?? abortError());
    signal?.addEventListener("abort", onAbort, { once: true });

    function partial() {
      return {
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      };
    }

    function cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }

    /** Stops the process and remembers why; the promise settles once the process has exited. */
    function fail(error: Error) {
      if (settled || pendingFailure) return;
      pendingFailure = error;
      killTree(child);
      // A process that ignores termination must not hold the stage forever.
      setTimeout(() => finish(), 5_000).unref();
    }

    function finish(exitCode: number | null = null, exitSignal: NodeJS.Signals | null = null) {
      if (settled) return;
      settled = true;
      cleanup();
      if (pendingFailure) {
        reject(pendingFailure);
        return;
      }
      resolve({
        exitCode,
        signal: exitSignal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        durationMs: Date.now() - started,
      });
    }

    function collect(target: Buffer[], stream: "stdout" | "stderr") {
      return (chunk: Buffer) => {
        const size =
          stream === "stdout" ? (stdoutBytes += chunk.length) : (stderrBytes += chunk.length);
        if (size > request.maxOutputBytes) {
          fail(
            new CliRunError(
              "output_limit",
              `the CLI wrote more than ${request.maxOutputBytes} bytes to ${stream}`,
            ),
          );
          return;
        }
        target.push(chunk);
      };
    }

    child.stdout?.on("data", collect(stdout, "stdout"));
    child.stderr?.on("data", collect(stderr, "stderr"));

    child.once("error", (error) => {
      if (!pendingFailure) pendingFailure = spawnFailure(error);
      finish();
    });
    child.once("close", (code, exitSignal) => finish(code, exitSignal));

    // A CLI that exits before reading its input closes stdin; that is reported by its exit status.
    child.stdin?.on("error", () => {});
    child.stdin?.end(request.stdin ?? "");
  });

function spawnFailure(error: unknown): CliRunError {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "ENOENT"
    ? new CliRunError("not_found", "the CLI executable was not found", undefined, { cause: error })
    : new CliRunError(
        "spawn_failed",
        `the CLI could not be started (${typeof code === "string" ? code : "unknown error"})`,
        undefined,
        { cause: error },
      );
}

function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === "win32") {
    try {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
        shell: false,
      });
      killer.once("error", () => child.kill());
    } catch {
      child.kill();
    }
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

function abortError(): Error {
  return new DOMException("The operation was aborted", "AbortError");
}
