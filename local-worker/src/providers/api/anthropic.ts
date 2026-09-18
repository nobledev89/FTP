import type { JsonObject } from "../contract.js";
import { parseJsonObject } from "../cli/structured-output.js";
import { ApiProviderError, requireApiKey } from "./errors.js";
import { numberValue, objectValue, requestJson, type ApiHttpRuntime } from "./http.js";
import type { StructuredApiResult } from "./openai.js";

export type AnthropicSettings = Readonly<{
  apiKey?: string;
  model: string;
  maxTokens?: number;
}>;

export class AnthropicMessagesApi {
  constructor(
    private readonly settings: AnthropicSettings,
    private readonly runtime: ApiHttpRuntime,
  ) {}

  async runStructured(
    input: Readonly<{
      prompt: string;
      schema: Record<string, unknown>;
      schemaName: string;
      signal: AbortSignal;
    }>,
  ): Promise<StructuredApiResult> {
    const apiKey = requireApiKey("Anthropic", this.settings.apiKey);
    const response = await requestJson(
      {
        provider: "Anthropic",
        url: "https://api.anthropic.com/v1/messages",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: {
          model: this.settings.model,
          max_tokens: this.settings.maxTokens ?? 32_768,
          messages: [{ role: "user", content: input.prompt }],
          output_config: {
            format: { type: "json_schema", schema: input.schema },
          },
        },
        signal: input.signal,
      },
      this.runtime,
    );

    if (response.stop_reason === "max_tokens") {
      throw new ApiProviderError(
        "Anthropic",
        "Anthropic API reached its output-token limit before completing the response.",
        "invalid_output",
      );
    }
    if (!Array.isArray(response.content)) {
      throw new ApiProviderError(
        "Anthropic",
        "Anthropic API returned no structured output content.",
        "invalid_output",
      );
    }
    const text = response.content
      .map((part) => objectValue(part))
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part?.text as string)
      .join("");
    if (!text) {
      throw new ApiProviderError(
        "Anthropic",
        "Anthropic API returned no structured output text.",
        "invalid_output",
      );
    }

    let value: unknown;
    try {
      value = parseJsonObject(text);
    } catch (error) {
      throw new ApiProviderError(
        "Anthropic",
        "Anthropic API structured output was not valid JSON.",
        "invalid_output",
        { cause: error },
      );
    }

    const usage = objectValue(response.usage);
    return {
      value,
      usage: compactUsage({
        billing: "metered_api",
        provider: "anthropic",
        model: typeof response.model === "string" ? response.model : this.settings.model,
        response_id: typeof response.id === "string" ? response.id : undefined,
        input_tokens: numberValue(usage?.input_tokens),
        cache_creation_input_tokens: numberValue(usage?.cache_creation_input_tokens),
        cache_read_input_tokens: numberValue(usage?.cache_read_input_tokens),
        output_tokens: numberValue(usage?.output_tokens),
      }),
    };
  }
}

function compactUsage(values: Record<string, string | number | undefined>): JsonObject {
  return Object.fromEntries(
    Object.entries(values).filter(
      (entry): entry is [string, string | number] => entry[1] !== undefined,
    ),
  );
}
