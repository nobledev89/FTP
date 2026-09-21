import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

import { parseWorkerEnv, type WorkerEnv } from "../local-worker/src/config/env.ts";
import { resolveSiteOrigin } from "../src/lib/site/config.ts";
import { readSupabaseEnv } from "../src/lib/supabase/env.ts";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

const WEB_REQUIRED_KEYS = [
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "REVALIDATION_SECRET",
] as const;

const WORKER_REQUIRED_KEYS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "PUBLIC_SITE_URL",
  "REVALIDATION_SECRET",
  "WORKER_ID",
] as const;

const WEB_FORBIDDEN_KEYS = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
] as const;

const WORKER_SECRET_KEYS = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "REVALIDATION_SECRET",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
] as const;

const PLACEHOLDER = /(?:replace[-_ ]?with|change[-_ ]?me|your[-_ ].*[-_ ]?here)/i;

type EnvironmentSource = Record<string, string | undefined>;

export type ValidWebEnv = Readonly<{
  siteOrigin: URL;
  supabaseUrl: URL;
  publishableKey: string;
  revalidationSecret: string;
}>;

export class EnvironmentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvironmentValidationError";
  }
}

function required(source: EnvironmentSource, key: string): string {
  const value = source[key]?.trim();
  if (!value) throw new EnvironmentValidationError(`${key} is required`);
  return value;
}

function rejectPlaceholder(key: string, value: string | undefined): void {
  if (value && PLACEHOLDER.test(value)) {
    throw new EnvironmentValidationError(`${key} still contains a template placeholder`);
  }
}

export function validateWebEnv(source: EnvironmentSource): ValidWebEnv {
  for (const key of WEB_FORBIDDEN_KEYS) {
    if (source[key]?.trim()) {
      throw new EnvironmentValidationError(`${key} is worker-only and must not be in the web file`);
    }
  }

  for (const key of WEB_REQUIRED_KEYS) rejectPlaceholder(key, source[key]);

  const siteOrigin = resolveSiteOrigin(required(source, "NEXT_PUBLIC_SITE_URL"));
  const supabase = readSupabaseEnv({
    url: required(source, "NEXT_PUBLIC_SUPABASE_URL"),
    publishableKey: required(source, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  });
  const revalidationSecret = required(source, "REVALIDATION_SECRET");
  if (revalidationSecret.length < 32) {
    throw new EnvironmentValidationError("REVALIDATION_SECRET must be at least 32 characters");
  }

  return {
    siteOrigin,
    supabaseUrl: new URL(supabase.url),
    publishableKey: supabase.publishableKey,
    revalidationSecret,
  };
}

export function validateWorkerEnv(source: EnvironmentSource): WorkerEnv {
  for (const key of WORKER_SECRET_KEYS) rejectPlaceholder(key, source[key]);
  return parseWorkerEnv(source);
}

export function validateEnvironmentPair(web: ValidWebEnv, worker: WorkerEnv): void {
  const mismatches: string[] = [];
  if (web.supabaseUrl.origin !== new URL(worker.SUPABASE_URL).origin) {
    mismatches.push("NEXT_PUBLIC_SUPABASE_URL and worker SUPABASE_URL must use the same origin");
  }
  if (web.siteOrigin.origin !== new URL(worker.PUBLIC_SITE_URL).origin) {
    mismatches.push("NEXT_PUBLIC_SITE_URL and worker PUBLIC_SITE_URL must use the same origin");
  }
  if (web.revalidationSecret !== worker.REVALIDATION_SECRET) {
    mismatches.push("the web and worker REVALIDATION_SECRET values must match");
  }
  if (mismatches.length > 0) throw new EnvironmentValidationError(mismatches.join("; "));
}

function readEnvironmentFile(path: string): EnvironmentSource {
  try {
    return parseEnv(readFileSync(path, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new EnvironmentValidationError(`Cannot read ${path}: ${message}`);
  }
}

function requireDeclaredKeys(
  source: EnvironmentSource,
  keys: readonly string[],
  label: string,
): void {
  const missing = keys.filter((key) => !Object.hasOwn(source, key));
  if (missing.length > 0) {
    throw new EnvironmentValidationError(`${label} is missing: ${missing.join(", ")}`);
  }
}

function requireSafeExampleValues(
  source: EnvironmentSource,
  keys: readonly string[],
  label: string,
): void {
  const unsafe = keys.filter((key) => {
    const value = source[key]?.trim();
    return value && !PLACEHOLDER.test(value);
  });
  if (unsafe.length > 0) {
    throw new EnvironmentValidationError(
      `${label} may contain real credentials in: ${unsafe.join(", ")}`,
    );
  }
}

export function validateExampleFiles(webPath: string, workerPath: string): void {
  const web = readEnvironmentFile(webPath);
  const worker = readEnvironmentFile(workerPath);
  requireDeclaredKeys(web, WEB_REQUIRED_KEYS, webPath);
  requireDeclaredKeys(worker, WORKER_REQUIRED_KEYS, workerPath);
  requireSafeExampleValues(
    web,
    ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "REVALIDATION_SECRET"],
    webPath,
  );
  requireSafeExampleValues(worker, WORKER_SECRET_KEYS, workerPath);

  const webFixture = validateWebEnv({
    ...web,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example_contract_value_000000",
    REVALIDATION_SECRET: "example-revalidation-secret-at-least-32-characters",
  });
  const workerFixture = validateWorkerEnv({
    ...worker,
    SUPABASE_SERVICE_ROLE_KEY: "example-service-role-contract-value",
    REVALIDATION_SECRET: "example-revalidation-secret-at-least-32-characters",
  });
  validateEnvironmentPair(webFixture, workerFixture);
}

type CliOptions = Readonly<{
  examples: boolean;
  webPath?: string;
  workerPath?: string;
}>;

function parseArguments(args: readonly string[]): CliOptions {
  if (args.includes("--examples")) {
    if (args.length !== 1) {
      throw new EnvironmentValidationError("--examples cannot be combined with other options");
    }
    return { examples: true };
  }

  let webPath: string | undefined;
  let workerPath: string | undefined;
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if ((option !== "--web" && option !== "--worker") || !value || value.startsWith("--")) {
      throw new EnvironmentValidationError(
        "Usage: pnpm env:check [--web <path>] [--worker <path>] or pnpm env:check:examples",
      );
    }
    if (option === "--web") webPath = resolve(value);
    if (option === "--worker") workerPath = resolve(value);
  }

  if (!webPath && !workerPath) {
    webPath = resolve(repositoryRoot, ".env.local");
    workerPath = resolve(repositoryRoot, "local-worker/.env.local");
  }
  return { examples: false, webPath, workerPath };
}

export function runEnvironmentCheck(args: readonly string[]): void {
  const options = parseArguments(args);
  if (options.examples) {
    validateExampleFiles(
      resolve(repositoryRoot, ".env.example"),
      resolve(repositoryRoot, "local-worker/.env.example"),
    );
    console.log("Environment examples match the web and worker contracts.");
    return;
  }

  const web = options.webPath ? validateWebEnv(readEnvironmentFile(options.webPath)) : undefined;
  const worker = options.workerPath
    ? validateWorkerEnv(readEnvironmentFile(options.workerPath))
    : undefined;
  if (web && worker) validateEnvironmentPair(web, worker);

  if (options.webPath) console.log(`Web environment is valid: ${options.webPath}`);
  if (options.workerPath) console.log(`Worker environment is valid: ${options.workerPath}`);
  if (web && worker) console.log("Shared web/worker environment values agree.");
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  try {
    runEnvironmentCheck(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Environment check failed: ${message}`);
    process.exitCode = 1;
  }
}
