import { readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Turns a configured CLI name (`CLAUDE_BIN`, `CODEX_BIN`) into something that can be spawned
 * without a shell.
 *
 * On Windows, npm installs each CLI as a `.cmd` batch shim. Node refuses to spawn a batch file
 * without `shell: true`, and a shell would re-parse every argument — including the JSON Schema
 * passed to `claude --json-schema` — through `cmd.exe` quoting rules. So the worker never uses a
 * shell. A shim is read and resolved to the program it launches: a native `.exe`, which is spawned
 * directly, or a Node script, which is run with the worker's own Node binary. A batch file that
 * does anything else is refused rather than guessed at.
 *
 * A path ending in `.js`, `.cjs`, or `.mjs` is also accepted on every platform and run with Node.
 * That is how the tests substitute a scripted stand-in for a real CLI.
 */

export type CliCommand = Readonly<{
  /** The file handed to `spawn`. */
  file: string;
  /** Arguments that precede the caller's own, such as the script path when `file` is Node. */
  prefixArgs: readonly string[];
}>;

export class CliResolutionError extends Error {
  constructor(
    readonly reason: "not_found" | "unlaunchable",
    message: string,
  ) {
    super(message);
    this.name = "CliResolutionError";
  }
}

export type ResolveOptions = Readonly<{
  platform?: NodeJS.Platform;
  env?: Readonly<Record<string, string | undefined>>;
  /** The Node binary used for script targets. Defaults to the worker's own. */
  nodePath?: string;
  isFile?: (candidate: string) => boolean;
  readText?: (file: string) => string;
}>;

const SCRIPT = /\.(?:c|m)?js$/i;
const NATIVE = /\.(?:exe|com)$/i;
const BATCH = /\.(?:cmd|bat)$/i;

function defaultIsFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/** Windows variable names are case-insensitive; a plain object (as in tests) is not. */
function readVariable(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
}

export function resolveCliCommand(bin: string, options: ResolveOptions = {}): CliCommand {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const nodePath = options.nodePath ?? process.execPath;
  const isFile = options.isFile ?? defaultIsFile;
  const readText = options.readText ?? ((file: string) => readFileSync(file, "utf8"));
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const name = bin.trim();

  if (SCRIPT.test(name)) {
    const script = pathApi.resolve(name);
    if (!isFile(script)) {
      throw new CliResolutionError(
        "not_found",
        `the script ${pathApi.basename(name)} does not exist`,
      );
    }
    return { file: nodePath, prefixArgs: [script] };
  }

  // Elsewhere `spawn` searches PATH itself and reports ENOENT, which the process runner classifies.
  if (platform !== "win32") return { file: name, prefixArgs: [] };

  const found = findOnWindowsPath(name, env, isFile);
  if (!found) {
    throw new CliResolutionError("not_found", `${name} was not found on PATH`);
  }
  if (NATIVE.test(found)) return { file: found, prefixArgs: [] };
  if (SCRIPT.test(found)) return { file: nodePath, prefixArgs: [found] };
  if (BATCH.test(found)) return resolveShim(found, nodePath, isFile, readText);
  throw new CliResolutionError(
    "unlaunchable",
    `${path.win32.basename(found)} is not an executable the worker can launch without a shell`,
  );
}

function findOnWindowsPath(
  name: string,
  env: Readonly<Record<string, string | undefined>>,
  isFile: (candidate: string) => boolean,
): string | null {
  const extensions = (readVariable(env, "PATHEXT") ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((extension) => extension.trim().toLowerCase())
    .filter((extension) => extension.startsWith("."));
  const explicitExtension = extensions.includes(path.win32.extname(name).toLowerCase());
  const hasDirectory = /[\\/]/.test(name) || path.win32.isAbsolute(name);
  const directories = hasDirectory
    ? [""]
    : (readVariable(env, "PATH") ?? "")
        .split(";")
        .map((directory) => directory.trim().replace(/^"(.*)"$/, "$1"))
        .filter(Boolean);

  for (const directory of directories) {
    const base = directory ? path.win32.join(directory, name) : path.win32.resolve(name);
    if (explicitExtension) {
      if (isFile(base)) return base;
      continue;
    }
    // An extensionless file beside an npm shim is its POSIX shell script; Windows cannot run it.
    for (const extension of extensions) {
      if (isFile(`${base}${extension}`)) return `${base}${extension}`;
    }
  }
  return null;
}

/**
 * Reads an npm-style shim. The launched program is the last quoted `%dp0%`-relative path that is
 * an executable or a Node script; the Codex shim, for instance, names `node.exe` first and the
 * `codex.js` it runs last.
 */
function resolveShim(
  shim: string,
  nodePath: string,
  isFile: (candidate: string) => boolean,
  readText: (file: string) => string,
): CliCommand {
  const directory = path.win32.dirname(shim);
  const targets = [...readText(shim).matchAll(/"%~?dp0%?\\([^"%]+)"/gi)]
    .map((match) => match[1] as string)
    .filter((relative) => NATIVE.test(relative) || SCRIPT.test(relative));
  const relative = targets.at(-1);
  if (!relative) {
    throw new CliResolutionError(
      "unlaunchable",
      `${path.win32.basename(shim)} is a batch file whose target the worker cannot identify; ` +
        "set the variable to the CLI's .exe or .js entry point",
    );
  }
  const target = path.win32.join(directory, relative);
  if (!isFile(target)) {
    throw new CliResolutionError(
      "not_found",
      `${path.win32.basename(shim)} points at a program that is not installed`,
    );
  }
  return NATIVE.test(target)
    ? { file: target, prefixArgs: [] }
    : { file: nodePath, prefixArgs: [target] };
}
