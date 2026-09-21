import { createHash } from "node:crypto";

import { imageArtifactSchema, type ImageArtifact } from "../../contracts/artifacts.js";
import type {
  JsonObject,
  PreparedRun,
  RawRunResult,
  RunContext,
  StageAdapter,
  StageFile,
} from "../contract.js";
import { imageSlotPrompts, ManualImagesAdapter } from "../manual/adapters.js";
import type { ImageStageInput, ImageStageOutput } from "../mock/images.js";
import { ApiProviderError, requireApiKey } from "./errors.js";
import { imageDimensions, type SupportedImageMime } from "./image-metadata.js";
import { numberValue, objectValue, requestJson, type ApiHttpRuntime } from "./http.js";

export type GeminiSettings = Readonly<{
  apiKey?: string;
  model: string;
}>;

const MIME_TYPES = new Set<SupportedImageMime>(["image/png", "image/jpeg", "image/webp"]);

/** Gemini makes one request per reviewed image brief and returns bytes to the stage service. */
export class GeminiImagesApiAdapter implements StageAdapter<ImageStageInput, ImageStageOutput> {
  readonly stage = "images" as const;
  readonly mode = "gemini_api" as const;
  readonly provider = "gemini" as const;
  private readonly delegate = new ManualImagesAdapter();

  constructor(
    private readonly settings: GeminiSettings,
    private readonly runtime: ApiHttpRuntime,
  ) {}

  async prepare(input: ImageStageInput, context: RunContext): Promise<PreparedRun> {
    const prepared = await this.delegate.prepare(input, context);
    return { ...prepared, mode: this.mode };
  }

  async execute(request: {
    prepared: PreparedRun;
    input: ImageStageInput;
    context: RunContext;
    signal: AbortSignal;
  }): Promise<RawRunResult> {
    requireApiKey("Gemini", this.settings.apiKey);
    const slots = imageSlotPrompts(request.input, request.context);
    if (slots.length !== request.context.brief.imageCount) {
      throw new ApiProviderError(
        "Gemini",
        `The draft contains ${slots.length} usable image briefs but ${request.context.brief.imageCount} images were requested.`,
        "invalid_output",
      );
    }

    const artifacts: ImageArtifact[] = [];
    const files: StageFile[] = [];
    const perRequest: JsonObject[] = [];
    for (const { brief, prompt } of slots) {
      const drawn = await drawGeminiImage(this.settings, this.runtime, {
        prompt,
        aspectRatio: brief.aspectRatio,
        signal: request.signal,
      });
      const { bytes, mimeType, contentHash } = drawn;
      const dimensions = { width: drawn.width, height: drawn.height };
      files.push({ slot: brief.slot, bytes, mimeType, ...dimensions });
      artifacts.push(
        imageArtifactSchema.parse({
          slot: brief.slot,
          role: brief.role,
          purpose: brief.purpose,
          prompt: brief.prompt,
          altText: brief.altText,
          caption: null,
          aspectRatio: brief.aspectRatio,
          focalX: 50,
          focalY: 50,
          ...dimensions,
          mimeType,
          byteSize: bytes.byteLength,
          contentHash,
          status: "uploaded",
          privatePath: null,
        }),
      );
      perRequest.push(drawn.usage);
    }

    return {
      kind: "output",
      value: artifacts,
      files,
      usage: {
        billing: "metered_api",
        provider: "gemini",
        model: this.settings.model,
        requests: slots.length,
        images: files.length,
        per_request: perRequest,
      },
    };
  }

  async normalize(raw: RawRunResult, context: RunContext): Promise<ImageStageOutput> {
    try {
      return await this.delegate.normalize(raw, context);
    } catch (error) {
      if (error instanceof ApiProviderError) throw error;
      throw new ApiProviderError(
        "Gemini",
        "Gemini image output did not match the shared image artifact schema.",
        "invalid_output",
        { cause: error },
      );
    }
  }
}

export type DrawnImage = Readonly<{
  bytes: Uint8Array;
  mimeType: SupportedImageMime;
  width: number;
  height: number;
  contentHash: string;
  usage: JsonObject;
}>;

/**
 * One prompt in, one image out.
 *
 * Shared by the images stage and the hero replacement lane, so a replacement is drawn by exactly
 * the request the original was drawn by. Callers own what happens to the bytes afterwards.
 */
export async function drawGeminiImage(
  settings: GeminiSettings,
  runtime: ApiHttpRuntime,
  request: Readonly<{ prompt: string; aspectRatio: string; signal: AbortSignal }>,
): Promise<DrawnImage> {
  const apiKey = requireApiKey("Gemini", settings.apiKey);
  const response = await requestJson(
    {
      provider: "Gemini",
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(settings.model)}:generateContent`,
      headers: { "x-goog-api-key": apiKey },
      body: {
        contents: [{ role: "user", parts: [{ text: request.prompt }] }],
        generationConfig: {
          responseModalities: ["IMAGE"],
          imageConfig: { aspectRatio: request.aspectRatio },
        },
      },
      signal: request.signal,
    },
    runtime,
  );
  const generated = generatedImage(response);
  const bytes = Uint8Array.from(Buffer.from(generated.data, "base64"));
  if (bytes.byteLength === 0 || bytes.byteLength > 10_485_760) {
    throw new ApiProviderError(
      "Gemini",
      "Gemini returned an empty image or one larger than the 10 MiB artifact limit.",
      "invalid_output",
    );
  }
  return {
    bytes,
    mimeType: generated.mimeType,
    ...imageDimensions(bytes, generated.mimeType),
    contentHash: createHash("sha256").update(bytes).digest("hex"),
    usage: geminiUsage(response),
  };
}

function generatedImage(response: Record<string, unknown>): {
  data: string;
  mimeType: SupportedImageMime;
} {
  const candidates = Array.isArray(response.candidates) ? response.candidates : [];
  for (const candidate of candidates) {
    const content = objectValue(objectValue(candidate)?.content);
    const parts = Array.isArray(content?.parts) ? content.parts : [];
    for (const part of parts) {
      const node = objectValue(part);
      if (node?.thought === true) continue;
      const inline = objectValue(node?.inlineData ?? node?.inline_data);
      const mime = inline?.mimeType ?? inline?.mime_type;
      if (
        typeof inline?.data === "string" &&
        typeof mime === "string" &&
        MIME_TYPES.has(mime as SupportedImageMime)
      ) {
        return { data: inline.data, mimeType: mime as SupportedImageMime };
      }
    }
  }
  throw new ApiProviderError(
    "Gemini",
    "Gemini returned no supported image (PNG, JPEG, or WebP).",
    "invalid_output",
  );
}

function geminiUsage(response: Record<string, unknown>): JsonObject {
  const usage = objectValue(response.usageMetadata ?? response.usage_metadata);
  const values: Record<string, string | number | undefined> = {
    response_id: typeof response.responseId === "string" ? response.responseId : undefined,
    prompt_tokens: numberValue(usage?.promptTokenCount ?? usage?.prompt_token_count),
    candidate_tokens: numberValue(usage?.candidatesTokenCount ?? usage?.candidates_token_count),
    thoughts_tokens: numberValue(usage?.thoughtsTokenCount ?? usage?.thoughts_token_count),
    total_tokens: numberValue(usage?.totalTokenCount ?? usage?.total_token_count),
  };
  return Object.fromEntries(
    Object.entries(values).filter(
      (entry): entry is [string, string | number] => entry[1] !== undefined,
    ),
  );
}
