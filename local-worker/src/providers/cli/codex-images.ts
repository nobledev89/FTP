import { createHash } from "node:crypto";

import { imageArtifactSchema, type ImageArtifact } from "../../contracts/artifacts.js";
import { imageDimensions } from "../api/image-metadata.js";
import type {
  ExecuteRequest,
  JsonObject,
  PreparedRun,
  RawRunResult,
  RunContext,
  StageAdapter,
  StageFile,
} from "../contract.js";
import { imageSlotPrompts, ManualImagesAdapter } from "../manual/adapters.js";
import type { ImageStageInput, ImageStageOutput } from "../mock/images.js";
import type { CodexCli } from "./codex.js";
import { CliProviderError } from "./errors.js";

/**
 * ChatGPT image generation through Codex on the owner's subscription (mode `codex_image`).
 *
 * Preparation is the manual image adapter's, so the reviewed `image-brief` template and the draft's
 * briefs are the prompt source for every image mode. The shared template asks a person for a file
 * plus JSON metadata; Codex is told to skip that part, because the worker records the metadata
 * from the approved brief exactly as the Gemini API mode does. The file's real type, size,
 * dimensions, and hash are read from the bytes, and an image whose shape does not match the brief's
 * aspect ratio is rejected rather than published with a bad crop.
 */

const ASPECT_RATIOS = { "16:9": 16 / 9, "4:5": 4 / 5, "3:2": 3 / 2, "1:1": 1 } as const;
/** Codex renders 16:9 as 1672×941 (1.777); allow that rounding, not a different shape. */
const ASPECT_TOLERANCE = 0.06;
const MAX_IMAGE_BYTES = 10_485_760;

export function codexImagePrompt(templatePrompt: string, aspectRatio: string): string {
  const orientation =
    aspectRatio === "1:1" ? "square" : aspectRatio === "4:5" ? "portrait" : "landscape";
  return (
    `${templatePrompt.trim()}\n\n` +
    "## How to deliver this image\n\n" +
    "Ignore the metadata and output instructions above: the publishing system records the " +
    "metadata itself. Use your built-in image generation tool to create exactly one image for " +
    `this brief, in ${aspectRatio} ${orientation} format. Do not write, copy, or move any files, ` +
    "and do not return JSON. When the image has been generated, reply with the single word DONE."
  );
}

export class CodexImagesAdapter implements StageAdapter<ImageStageInput, ImageStageOutput> {
  readonly stage = "images" as const;
  readonly mode = "codex_image" as const;
  readonly provider = "openai" as const;
  private readonly delegate = new ManualImagesAdapter();

  constructor(private readonly codex: Pick<CodexCli, "generateImage" | "label">) {}

  async prepare(input: ImageStageInput, context: RunContext): Promise<PreparedRun> {
    const prepared = await this.delegate.prepare(input, context);
    return { ...prepared, mode: this.mode, provider: this.provider };
  }

  async execute(request: ExecuteRequest<ImageStageInput>): Promise<RawRunResult> {
    const slots = imageSlotPrompts(request.input, request.context);
    if (slots.length !== request.context.brief.imageCount) {
      throw new CliProviderError(
        "Codex",
        `the draft contains ${slots.length} usable image briefs but ` +
          `${request.context.brief.imageCount} images were requested`,
        "invalid_output",
      );
    }

    const artifacts: ImageArtifact[] = [];
    const files: StageFile[] = [];
    const perImage: JsonObject[] = [];
    for (const { brief, prompt } of slots) {
      const generated = await this.codex.generateImage({
        prompt: codexImagePrompt(prompt, brief.aspectRatio),
        signal: request.signal,
      });
      const bytes = generated.bytes;
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
        throw new CliProviderError(
          "Codex",
          "Codex produced an empty image or one larger than the 10 MiB artifact limit",
          "invalid_output",
        );
      }
      let dimensions: Readonly<{ width: number; height: number }>;
      try {
        dimensions = imageDimensions(bytes, generated.mimeType);
      } catch (error) {
        throw new CliProviderError(
          "Codex",
          `Codex produced an unreadable ${generated.mimeType} file`,
          "invalid_output",
          { cause: error },
        );
      }
      const expected = ASPECT_RATIOS[brief.aspectRatio];
      const actual = dimensions.width / dimensions.height;
      if (Math.abs(actual - expected) / expected > ASPECT_TOLERANCE) {
        throw new CliProviderError(
          "Codex",
          `Codex produced a ${dimensions.width}×${dimensions.height} image for a ` +
            `${brief.aspectRatio} brief`,
          "invalid_output",
        );
      }

      files.push({ slot: brief.slot, bytes, mimeType: generated.mimeType, ...dimensions });
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
          mimeType: generated.mimeType,
          byteSize: bytes.byteLength,
          contentHash: createHash("sha256").update(bytes).digest("hex"),
          status: "uploaded",
          privatePath: null,
        }),
      );
      perImage.push(generated.usage);
    }

    const first = perImage[0] ?? {};
    return {
      kind: "output",
      value: artifacts,
      files,
      usage: {
        cli: "codex_image",
        cli_version: first.cli_version ?? null,
        billing: "subscription",
        images: files.length,
        per_image: perImage,
      },
    };
  }

  async normalize(raw: RawRunResult, context: RunContext): Promise<ImageStageOutput> {
    try {
      return await this.delegate.normalize(raw, context);
    } catch (error) {
      if (error instanceof CliProviderError) throw error;
      throw new CliProviderError(
        "Codex",
        "Codex image output did not match the shared image artifact schema",
        "invalid_output",
        { cause: error },
      );
    }
  }
}
