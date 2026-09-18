import { WorkerStageError, type ErrorClass } from "../../queue/retry.js";

/**
 * A classified subscription-CLI failure.
 *
 * The class decides what the queue does next, through the same `failureOutcome` every stage uses:
 * `auth` (CLI missing, signed out, or signed in to a billable account) and `usage_limit` go to
 * `NEEDS_HUMAN` with an actionable message and are never retried or redirected to an API;
 * `transient` and `rate_limit` back off and retry; `permanent_config` fails the stage;
 * `invalid_output` asks an editor. Messages are shown in the console, so they name the command to
 * run but never include a path, token, or account email.
 */
export class CliProviderError extends WorkerStageError {
  constructor(
    readonly cli: "Claude Code" | "Codex",
    message: string,
    errorClass: ErrorClass,
    options?: ErrorOptions,
  ) {
    super(message, errorClass, options);
    this.name = cli === "Claude Code" ? "ClaudeCodeError" : "CodexCliError";
  }
}
