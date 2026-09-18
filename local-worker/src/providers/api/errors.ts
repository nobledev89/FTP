import { redactText } from "../../logging/redact.js";
import { WorkerStageError, type ErrorClass } from "../../queue/retry.js";

export type ApiProviderName = "OpenAI" | "Anthropic" | "Gemini";

/** A provider failure whose class is consumed by the queue's existing retry/escalation policy. */
export class ApiProviderError extends WorkerStageError {
  constructor(
    readonly providerName: ApiProviderName,
    message: string,
    errorClass: ErrorClass,
    options?: ErrorOptions,
  ) {
    super(redactText(message), errorClass, options);
    this.name = `${providerName}ApiError`;
  }
}

export function requireApiKey(provider: ApiProviderName, apiKey: string | undefined): string {
  if (apiKey) return apiKey;
  const variable =
    provider === "OpenAI"
      ? "OPENAI_API_KEY"
      : provider === "Anthropic"
        ? "ANTHROPIC_API_KEY"
        : "GEMINI_API_KEY";
  throw new ApiProviderError(
    provider,
    `${variable} is required on the local worker because this stage uses ${provider} API mode.`,
    "auth",
  );
}
