import type { JsonObject } from "../contract.js";
import { parseJsonObject } from "../cli/structured-output.js";
import { ApiProviderError, requireApiKey } from "./errors.js";
import { numberValue, objectValue, requestJson, type ApiHttpRuntime } from "./http.js";

export type OpenAiSettings = Readonly<{
  apiKey?: string;
  model: string;
}>;

export type StructuredApiResult = Readonly<{ value: unknown; usage: JsonObject }>;

export class OpenAiResponsesApi {
  constructor(
    private readonly settings: OpenAiSettings,
    private readonly runtime: ApiHttpRuntime,
  ) {}

  async runStructured(
    input: Readonly<{
      prompt: string;
      schema: Record<string, unknown>;
      schemaName: string;
      webSearch: boolean;
      signal: AbortSignal;
    }>,
  ): Promise<StructuredApiResult> {
    const apiKey = requireApiKey("OpenAI", this.settings.apiKey);
    const response = await requestJson(
      {
        provider: "OpenAI",
        url: "https://api.openai.com/v1/responses",
        headers: { authorization: `Bearer ${apiKey}` },
        body: {
          model: this.settings.model,
          input: [{ role: "user", content: [{ type: "input_text", text: input.prompt }] }],
          text: {
            format: {
              type: "json_schema",
              name: input.schemaName,
              schema: input.schema,
              strict: true,
            },
          },
          ...(input.webSearch ? { tools: [{ type: "web_search" }] } : {}),
          store: false,
        },
        signal: input.signal,
      },
      this.runtime,
    );

    const status = typeof response.status === "string" ? response.status : undefined;
    if (status && status !== "completed") {
      const detail = objectValue(response.incomplete_details);
      const reason = typeof detail?.reason === "string" ? detail.reason : status;
      throw new ApiProviderError(
        "OpenAI",
        `OpenAI API did not complete the structured response (${reason}).`,
        reason.includes("max_output") ? "invalid_output" : "transient",
      );
    }

    const text = responseText(response);
    if (!text) {
      throw new ApiProviderError(
        "OpenAI",
        "OpenAI API returned no structured output text.",
        "invalid_output",
      );
    }

    let value: unknown;
    try {
      value = parseJsonObject(text);
    } catch (error) {
      throw new ApiProviderError(
        "OpenAI",
        "OpenAI API structured output was not valid JSON.",
        "invalid_output",
        { cause: error },
      );
    }

    const usage = objectValue(response.usage);
    const inputDetails = objectValue(usage?.input_tokens_details);
    const outputDetails = objectValue(usage?.output_tokens_details);
    const output = Array.isArray(response.output) ? response.output : [];
    return {
      value,
      usage: compactUsage({
        billing: "metered_api",
        provider: "openai",
        model: typeof response.model === "string" ? response.model : this.settings.model,
        response_id: typeof response.id === "string" ? response.id : undefined,
        input_tokens: numberValue(usage?.input_tokens),
        cached_input_tokens: numberValue(inputDetails?.cached_tokens),
        output_tokens: numberValue(usage?.output_tokens),
        reasoning_tokens: numberValue(outputDetails?.reasoning_tokens),
        total_tokens: numberValue(usage?.total_tokens),
        web_search_calls: output.filter((entry) => objectValue(entry)?.type === "web_search_call")
          .length,
      }),
    };
  }
}

function responseText(response: Record<string, unknown>): string | null {
  if (typeof response.output_text === "string") return response.output_text;
  if (!Array.isArray(response.output)) return null;
  const chunks: string[] = [];
  for (const item of response.output) {
    const message = objectValue(item);
    if (!message || message.type !== "message" || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      const content = objectValue(part);
      if (content?.type === "refusal") {
        throw new ApiProviderError(
          "OpenAI",
          "OpenAI refused the structured request.",
          "invalid_output",
        );
      }
      if (content?.type === "output_text" && typeof content.text === "string") {
        chunks.push(content.text);
      }
    }
  }
  return chunks.length > 0 ? chunks.join("") : null;
}

function compactUsage(values: Record<string, string | number | undefined>): JsonObject {
  return Object.fromEntries(
    Object.entries(values).filter(
      (entry): entry is [string, string | number] => entry[1] !== undefined,
    ),
  );
}
