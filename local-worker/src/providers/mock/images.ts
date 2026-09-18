import {
  imageArtifactSchema,
  type DraftOutput,
  type ImageArtifact,
} from "../../contracts/artifacts.js";
import {
  idempotencyKeyFor,
  renderTemplate,
  type ExecuteRequest,
  type PreparedRun,
  type RawRunResult,
  type RunContext,
  type StageAdapter,
  type StageFile,
} from "../contract.js";
import { Deterministic } from "./deterministic.js";
import { DIMENSIONS, encodePng, type Rgb } from "./png.js";
import { MockStageError, runDirectives } from "./shared.js";

/**
 * Deterministic images for the mock pipeline.
 *
 * Every brief in the approved draft produces a real PNG, so the stage service uploads real bytes to
 * the private bucket, records a real content hash and real dimensions, and the publishing service
 * later copies a real object into the public bucket. The picture itself is a restrained editorial
 * placeholder in the publication's palette — never a fabricated chart, logo, or person.
 */

export type ImageStageInput = Readonly<{
  draft: DraftOutput;
  draftVersion: number;
}>;

export type ImageStageOutput = Readonly<{
  artifacts: readonly ImageArtifact[];
  files: readonly StageFile[];
}>;

/** Near-neutral editorial palettes, one per slot, chosen deterministically per job. */
const PALETTES: readonly (readonly [Rgb, Rgb])[] = [
  [
    [238, 236, 231],
    [44, 52, 64],
  ],
  [
    [235, 238, 240],
    [38, 60, 72],
  ],
  [
    [240, 235, 228],
    [62, 50, 44],
  ],
  [
    [232, 238, 234],
    [36, 62, 52],
  ],
];

function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  const t = Math.max(0, Math.min(1, amount));
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
  ];
}

/**
 * A calm diagonal field with a single offset band: enough structure to tell two images apart and to
 * show that focal-point cropping works, with nothing that asserts a fact.
 */
function composition(palette: readonly [Rgb, Rgb], bandPosition: number, bandWidth: number) {
  const [light, dark] = palette;
  return (x: number, y: number): Rgb => {
    const diagonal = (x * 0.75 + y * 0.25) * 0.85 + 0.05;
    const base = mix(light, dark, diagonal * 0.55);
    const distance = Math.abs(x - bandPosition);
    if (distance < bandWidth) {
      const edge = 1 - distance / bandWidth;
      return mix(base, dark, 0.35 * edge * edge);
    }
    return base;
  };
}

export class MockImagesAdapter implements StageAdapter<ImageStageInput, ImageStageOutput> {
  readonly stage = "images" as const;
  readonly mode = "mock" as const;
  readonly provider = "gemini" as const;

  async prepare(input: ImageStageInput, context: RunContext): Promise<PreparedRun> {
    const { brief } = context;
    const hero = input.draft.imageBriefs.find((image) => image.slot === 0);
    const prompt = context.template
      ? renderTemplate(context.template.content, {
          styleGuide: context.styleGuide ?? "",
          title: input.draft.title,
          articleType: brief.articleType,
          slot: String(hero?.slot ?? 0),
          role: hero?.role ?? "hero",
          aspectRatio: hero?.aspectRatio ?? "16:9",
          purpose: hero?.purpose ?? "Lead image",
          altText: hero?.altText ?? "",
          prompt: hero?.prompt ?? "",
          schemaVersion: context.schemaVersion,
        })
      : `Produce ${brief.imageCount} editorial images for: ${input.draft.title}`;

    return {
      prompt,
      promptTemplateId: context.template?.id ?? null,
      promptVersion: context.template?.version ?? null,
      inputRefs: {
        draft_version: input.draftVersion,
        briefs: input.draft.imageBriefs.length,
        requested: brief.imageCount,
      },
      schemaVersion: context.schemaVersion,
      provider: this.provider,
      mode: this.mode,
      idempotencyKey: idempotencyKeyFor(this.stage, context),
    };
  }

  async execute(request: ExecuteRequest<ImageStageInput>): Promise<RawRunResult> {
    const directed = await runDirectives(this.stage, request);
    if (directed) return directed;

    const built = buildImages(request.context, request.input);
    return {
      kind: "output",
      value: built.artifacts,
      files: built.files,
      usage: { simulated: true, images: built.files.length },
    };
  }

  async normalize(raw: RawRunResult, context: RunContext): Promise<ImageStageOutput> {
    void context;
    if (raw.kind !== "output") {
      throw new MockStageError("the images stage produced no output", "invalid_output");
    }
    const artifacts = imageArtifactSchema.array().parse(raw.value);
    return { artifacts, files: raw.files ?? [] };
  }
}

/**
 * Builds every image the draft briefs. Exported so the deterministic output can be asserted without
 * a database. `privatePath` is left null: only the stage service knows where it stored the bytes.
 */
export function buildImages(context: RunContext, input: ImageStageInput): ImageStageOutput {
  const { brief } = context;
  const briefs = input.draft.imageBriefs
    .filter((image) => image.slot < brief.imageCount)
    .sort((left, right) => left.slot - right.slot);

  if (briefs.length < brief.imageCount) {
    throw new MockStageError(
      `the approved draft briefs ${briefs.length} images but ${brief.imageCount} were requested`,
      "invalid_output",
    );
  }

  const artifacts: ImageArtifact[] = [];
  const files: StageFile[] = [];

  for (const image of briefs) {
    const random = new Deterministic(brief.jobId, "images", image.slot);
    const [width, height] = DIMENSIONS[image.aspectRatio] ?? [1600, 900];
    const palette = PALETTES[random.integer(0, PALETTES.length - 1)] as readonly [Rgb, Rgb];
    const bandPosition = random.integer(25, 75) / 100;
    const png = encodePng(width, height, composition(palette, bandPosition, 0.18));

    artifacts.push(
      imageArtifactSchema.parse({
        slot: image.slot,
        role: image.role,
        purpose: image.purpose,
        prompt: image.prompt,
        altText: image.altText,
        caption: null,
        aspectRatio: image.aspectRatio,
        focalX: Math.round(bandPosition * 100),
        focalY: 50,
        width: png.width,
        height: png.height,
        mimeType: png.mimeType,
        byteSize: png.byteSize,
        contentHash: png.contentHash,
        // The stage service uploads the bytes and promotes the row to `ready` with its real path.
        status: "uploaded",
        privatePath: null,
      }),
    );

    files.push({
      slot: image.slot,
      bytes: png.bytes,
      mimeType: png.mimeType,
      width: png.width,
      height: png.height,
    });
  }

  return { artifacts, files };
}
