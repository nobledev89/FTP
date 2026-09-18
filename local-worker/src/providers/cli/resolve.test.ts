import { describe, expect, it } from "vitest";

import { CliResolutionError, resolveCliCommand } from "./resolve.js";

const NPM = "C:\\Users\\owner\\AppData\\Roaming\\npm";
const NODE = "C:\\node\\node.exe";

// The shims below are the ones npm generated for Claude Code 2.1.275 and codex-cli 0.146.0.
const CLAUDE_SHIM = [
  "@ECHO off",
  "GOTO start",
  ":find_dp0",
  "SET dp0=%~dp0",
  "EXIT /b",
  ":start",
  "SETLOCAL",
  "CALL :find_dp0",
  '"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*',
].join("\r\n");

const CODEX_SHIM = [
  "@ECHO off",
  "GOTO start",
  ":find_dp0",
  "SET dp0=%~dp0",
  "EXIT /b",
  ":start",
  "SETLOCAL",
  "CALL :find_dp0",
  'IF EXIST "%dp0%\\node.exe" (',
  '  SET "_prog=%dp0%\\node.exe"',
  ") ELSE (",
  '  SET "_prog=node"',
  ")",
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*',
].join("\r\n");

function windows(files: Readonly<Record<string, string>>) {
  const normalized = new Map(
    Object.entries(files).map(([file, text]) => [file.toLowerCase(), text] as const),
  );
  return {
    platform: "win32" as const,
    nodePath: NODE,
    env: { Path: `C:\\Windows\\system32;${NPM}`, PATHEXT: ".COM;.EXE;.BAT;.CMD" },
    isFile: (candidate: string) => normalized.has(candidate.toLowerCase()),
    readText: (file: string) => normalized.get(file.toLowerCase()) ?? "",
  };
}

describe("resolveCliCommand", () => {
  it("resolves the Claude Code npm shim to its native executable, bypassing cmd.exe", () => {
    const exe = `${NPM}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`;
    const options = windows({
      [`${NPM}\\claude`]: "#!/bin/sh",
      [`${NPM}\\claude.cmd`]: CLAUDE_SHIM,
      [exe]: "",
    });
    expect(resolveCliCommand("claude", options)).toEqual({ file: exe, prefixArgs: [] });
  });

  it("resolves the Codex npm shim to its Node entry point run by the worker's Node", () => {
    const script = `${NPM}\\node_modules\\@openai\\codex\\bin\\codex.js`;
    const options = windows({
      [`${NPM}\\codex`]: "#!/bin/sh",
      [`${NPM}\\codex.cmd`]: CODEX_SHIM,
      [script]: "",
    });
    expect(resolveCliCommand("codex", options)).toEqual({ file: NODE, prefixArgs: [script] });
  });

  it("prefers a native executable found earlier in PATHEXT order", () => {
    const options = windows({ [`${NPM}\\claude.exe`]: "", [`${NPM}\\claude.cmd`]: CLAUDE_SHIM });
    expect(resolveCliCommand("claude", options)).toEqual({
      file: `${NPM}\\claude.exe`,
      prefixArgs: [],
    });
  });

  it("accepts an explicit absolute path with its extension", () => {
    const exe = "D:\\tools\\claude\\claude.exe";
    expect(resolveCliCommand(exe, windows({ [exe]: "" }))).toEqual({ file: exe, prefixArgs: [] });
  });

  it("reports a missing CLI and a shim whose target is not installed as not found", () => {
    expect(() => resolveCliCommand("claude", windows({}))).toThrow(
      expect.objectContaining({ reason: "not_found" }),
    );
    expect(() =>
      resolveCliCommand("claude", windows({ [`${NPM}\\claude.cmd`]: CLAUDE_SHIM })),
    ).toThrow(expect.objectContaining({ reason: "not_found" }));
  });

  it("refuses a batch file it cannot map to a program rather than running it through a shell", () => {
    const options = windows({ [`${NPM}\\claude.cmd`]: "@echo off\r\ncall other.bat %*" });
    expect(() => resolveCliCommand("claude", options)).toThrow(CliResolutionError);
    expect(() => resolveCliCommand("claude", options)).toThrow(
      expect.objectContaining({ reason: "unlaunchable" }),
    );
  });

  it("runs a configured Node script with Node on every platform", () => {
    const script = "/opt/fintechpulse/fake-claude.mjs";
    expect(
      resolveCliCommand(script, {
        platform: "linux",
        nodePath: "/usr/bin/node",
        isFile: (candidate) => candidate === script,
      }),
    ).toEqual({ file: "/usr/bin/node", prefixArgs: [script] });
  });

  it("leaves PATH lookup to spawn outside Windows", () => {
    expect(resolveCliCommand("claude", { platform: "linux" })).toEqual({
      file: "claude",
      prefixArgs: [],
    });
  });
});
