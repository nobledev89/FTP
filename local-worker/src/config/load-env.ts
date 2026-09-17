import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

import { parseWorkerEnv, type WorkerEnv } from "./env.js";

export const workerRoot = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Loads the worker-only environment file from a path fixed relative to this package. This remains
 * correct whether pnpm invokes the command from the repository root or from `local-worker`.
 */
export function loadWorkerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  try {
    loadEnvFile(fileURLToPath(new URL("../../.env.local", import.meta.url)));
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }
  return parseWorkerEnv(source);
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
