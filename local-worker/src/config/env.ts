import { z } from "zod";

/**
 * Local worker environment contract (implementation plan, section 15).
 *
 * Optional AI API keys are validated only when a stage actually selects an
 * `api` mode. The worker must boot without them in mock, manual, and
 * subscription CLI modes.
 */

const boundedInt = (fallback: number, minimum: number, maximum: number) =>
  z.coerce.number().int().min(minimum).max(maximum).default(fallback);

const nonEmpty = z.string().trim().min(1);

export const workerEnvSchema = z
  .object({
    SUPABASE_URL: z.url(),
    SUPABASE_SERVICE_ROLE_KEY: nonEmpty,
    PUBLIC_SITE_URL: z.url(),
    REVALIDATION_SECRET: z.string().min(32, "REVALIDATION_SECRET must be at least 32 characters"),
    WORKER_ID: z
      .string()
      .trim()
      .regex(
        /^[a-z0-9][a-z0-9-]{1,62}$/,
        "WORKER_ID must be lowercase letters, digits, or hyphens",
      ),
    WORKER_HOST_LABEL: z.string().trim().min(1).max(80).optional(),
    WORKER_POLL_INTERVAL_MS: boundedInt(10_000, 250, 300_000),
    WORKER_HEARTBEAT_INTERVAL_MS: boundedInt(30_000, 1_000, 300_000),
    WORKER_OFFLINE_AFTER_SECONDS: boundedInt(120, 10, 7_200),
    WORKER_LEASE_SECONDS: boundedInt(900, 30, 3_600),
    WORKER_MAX_ATTEMPTS: boundedInt(5, 1, 20),
    WORKER_SHUTDOWN_TIMEOUT_MS: boundedInt(30_000, 1_000, 300_000),
    PUBLISH_VERIFY_TIMEOUT_MS: boundedInt(15_000, 1_000, 300_000),
    CODEX_BIN: nonEmpty.default("codex"),
    CLAUDE_BIN: nonEmpty.default("claude"),
    // Optional overrides for the subscription CLIs (Phase 9). Unset means the CLI's own default.
    CLAUDE_MODEL: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._:[\]-]{1,100}$/, "CLAUDE_MODEL must be a model alias or name")
      .optional(),
    CODEX_MODEL: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._:-]{1,100}$/, "CODEX_MODEL must be a model name")
      .optional(),
    CODEX_REASONING_EFFORT: z.enum(["minimal", "low", "medium", "high", "xhigh"]).optional(),
    /** One CLI stage run, including web research. The lease is renewed while it runs. */
    CLI_TIMEOUT_MS: boundedInt(1_200_000, 60_000, 3_600_000),
    /** One provider HTTP request. Image generation makes one bounded request per slot. */
    API_TIMEOUT_MS: boundedInt(300_000, 10_000, 1_200_000),
    API_MAX_RESPONSE_BYTES: boundedInt(16_000_000, 100_000, 25_000_000),
    OPENAI_API_KEY: nonEmpty.optional(),
    ANTHROPIC_API_KEY: nonEmpty.optional(),
    GEMINI_API_KEY: nonEmpty.optional(),
    OPENAI_API_MODEL: nonEmpty.default("gpt-5"),
    ANTHROPIC_API_MODEL: nonEmpty.default("claude-sonnet-5"),
    GEMINI_IMAGE_MODEL: nonEmpty.default("gemini-3.1-flash-image"),
  })
  .superRefine((value, context) => {
    if (value.WORKER_HEARTBEAT_INTERVAL_MS * 2 > value.WORKER_LEASE_SECONDS * 1_000) {
      context.addIssue({
        code: "custom",
        path: ["WORKER_HEARTBEAT_INTERVAL_MS"],
        message: "must be at most half of WORKER_LEASE_SECONDS",
      });
    }
    if (value.WORKER_OFFLINE_AFTER_SECONDS * 1_000 <= value.WORKER_HEARTBEAT_INTERVAL_MS) {
      context.addIssue({
        code: "custom",
        path: ["WORKER_OFFLINE_AFTER_SECONDS"],
        message: "must be longer than WORKER_HEARTBEAT_INTERVAL_MS",
      });
    }
  });

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export type ApiProvider = "openai" | "anthropic" | "gemini";

const apiKeyByProvider = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
} as const satisfies Record<ApiProvider, keyof WorkerEnv>;

export class WorkerConfigError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid worker configuration:\n- ${issues.join("\n- ")}`);
    this.name = "WorkerConfigError";
    this.issues = issues;
  }
}

/**
 * Applies the second half of the environment contract once the worker has read the site's current
 * provider settings. Free modes never require an API key; a selected API mode does.
 */
export function requireApiProviderCredentials(
  env: WorkerEnv,
  apiProvidersInUse: readonly ApiProvider[],
): void {
  const missing = [...new Set(apiProvidersInUse)]
    .map((provider) => apiKeyByProvider[provider])
    .filter((key) => env[key] === undefined)
    .map((key) => `${key}: required because a stage is configured for API mode`);
  if (missing.length > 0) throw new WorkerConfigError(missing);
}

/**
 * Parses worker configuration. `apiProvidersInUse` lists providers whose
 * stages are currently configured for `api` mode; only their keys are required.
 * Error messages name variables but never echo their values.
 */
export function parseWorkerEnv(
  source: Record<string, string | undefined>,
  apiProvidersInUse: readonly ApiProvider[] = [],
): WorkerEnv {
  // Treat empty strings from `.env` templates as unset.
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value.trim() !== ""),
  );

  const result = workerEnvSchema.safeParse(cleaned);
  if (!result.success) {
    throw new WorkerConfigError(
      result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
    );
  }

  requireApiProviderCredentials(result.data, apiProvidersInUse);

  return result.data;
}
