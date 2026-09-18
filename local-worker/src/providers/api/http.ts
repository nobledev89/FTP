import { safeSummary } from "../../logging/redact.js";
import type { ErrorClass } from "../../queue/retry.js";
import { ApiProviderError, type ApiProviderName } from "./errors.js";

export type ApiHttpRuntime = Readonly<{
  fetch?: typeof fetch;
  timeoutMs: number;
  maxResponseBytes: number;
}>;

type JsonRequest = Readonly<{
  provider: ApiProviderName;
  url: string;
  headers: Readonly<Record<string, string>>;
  body: unknown;
  signal: AbortSignal;
}>;

const USAGE_LIMIT = /quota|billing|credit|spend|usage.?limit|insufficient_quota/i;

function httpErrorClass(status: number, body: string): ErrorClass {
  if (status === 401 || status === 403) return "auth";
  if (status === 402 || (status === 429 && USAGE_LIMIT.test(body))) return "usage_limit";
  if (status === 408 || status === 409 || status === 425 || status === 429 || status >= 500) {
    return status === 429 ? "rate_limit" : "transient";
  }
  return "permanent_config";
}

/**
 * Sends one bounded JSON request. It never logs headers, and any short response excerpt passes
 * through the central credential/path/email redactor before becoming an operator-facing error.
 */
export async function requestJson(
  request: JsonRequest,
  runtime: ApiHttpRuntime,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const abort = () => controller.abort(request.signal.reason);
  if (request.signal.aborted) abort();
  else request.signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(
    () => controller.abort(new DOMException(`${request.provider} API timed out`, "TimeoutError")),
    runtime.timeoutMs,
  );
  timeout.unref?.();

  try {
    const response = await (runtime.fetch ?? fetch)(request.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...request.headers },
      body: JSON.stringify(request.body),
      signal: controller.signal,
    });

    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > runtime.maxResponseBytes) {
      throw new ApiProviderError(
        request.provider,
        `${request.provider} API response exceeds the ${runtime.maxResponseBytes}-byte limit.`,
        "invalid_output",
      );
    }

    const text = await readBoundedText(response, request.provider, runtime.maxResponseBytes);
    if (!response.ok) {
      const detail = safeSummary(text || response.statusText, 400);
      throw new ApiProviderError(
        request.provider,
        `${request.provider} API request failed (${response.status}): ${detail}`,
        httpErrorClass(response.status, text),
      );
    }

    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch (error) {
      throw new ApiProviderError(
        request.provider,
        `${request.provider} API returned malformed JSON.`,
        "invalid_output",
        { cause: error },
      );
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new ApiProviderError(
        request.provider,
        `${request.provider} API returned a non-object response.`,
        "invalid_output",
      );
    }
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ApiProviderError) throw error;
    const timedOut = controller.signal.aborted && !request.signal.aborted;
    throw new ApiProviderError(
      request.provider,
      timedOut
        ? `${request.provider} API timed out after ${runtime.timeoutMs}ms.`
        : request.signal.aborted
          ? `${request.provider} API request was cancelled.`
          : `${request.provider} API request failed: ${safeSummary(error, 400)}`,
      "transient",
      { cause: error },
    );
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", abort);
  }
}

async function readBoundedText(
  response: Response,
  provider: ApiProviderName,
  maximum: number,
): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximum) {
      await reader.cancel();
      throw new ApiProviderError(
        provider,
        `${provider} API response exceeds the ${maximum}-byte limit.`,
        "invalid_output",
      );
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
