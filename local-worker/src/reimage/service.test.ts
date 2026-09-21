import { describe, expect, it } from "vitest";

import {
  heroReplacementPrompt,
  HeroReplacementService,
  type DrawnCandidate,
  type HeroBrief,
  type HeroDrawingContext,
  type HeroReplacementClaim,
  type HeroReplacementStore,
} from "./service.js";

const brief: HeroBrief = {
  title: "The UK's new payments levy",
  articleType: "news",
  purpose: "Carry the story at the top of the page",
  prompt: "A single bank card standing upright on a bare floor, far larger than life.",
  altText: "An oversized bank card standing upright on an empty floor.",
  aspectRatio: "16:9",
};

const context: HeroDrawingContext = {
  brief,
  template:
    "# Image stage\n\n{{prompt}}\n\nIt should read as: {{altText}}\n\n" +
    "- Article: {{title}}\n- Placement: slot {{slot}}, the {{role}} image, {{aspectRatio}}.",
  styleGuide: "Never used by the image stage.",
};

function claim(overrides: Partial<HeroReplacementClaim> = {}): HeroReplacementClaim {
  return {
    replacementId: "44444444-4444-4444-8444-444444444444",
    work: "draw",
    jobId: "55555555-5555-4555-8555-555555555555",
    articleId: "66666666-6666-4666-8666-666666666666",
    slug: "uk-payments-levy",
    mode: "regenerate",
    direction: null,
    imageId: null,
    imagePrivatePath: null,
    imageMimeType: null,
    imagesMode: "gemini_api",
    siteId: "77777777-7777-4777-8777-777777777777",
    ...overrides,
  };
}

/** A PNG header is all `imageDimensions` reads; the body is irrelevant to these tests. */
function png(width = 1600, height = 900): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

type Recorded = {
  saved: DrawnCandidate[];
  savedPrompts: string[];
  applied: number;
  failures: { error: string; retry: boolean }[];
};

function fakeStore(next: HeroReplacementClaim | null, recorded: Recorded): HeroReplacementStore {
  return {
    async claim() {
      return next;
    },
    async drawingContext() {
      return context;
    },
    async saveCandidate(_claim, drawn, _brief, prompt) {
      recorded.saved.push(drawn);
      recorded.savedPrompts.push(prompt);
    },
    async applyCandidate() {
      recorded.applied += 1;
      return { publicPath: "articles/uk-payments-levy/hero-x.png" };
    },
    async fail(_claim, error, retry) {
      recorded.failures.push({ error, retry });
    },
  };
}

function recorder(): Recorded {
  return { saved: [], savedPrompts: [], applied: 0, failures: [] };
}

describe("heroReplacementPrompt", () => {
  it("renders the brief into the active image template", () => {
    const prompt = heroReplacementPrompt(context, null);
    expect(prompt).toContain("A single bank card standing upright");
    expect(prompt).toContain("It should read as: An oversized bank card");
    expect(prompt).toContain("slot 0, the hero image, 16:9");
  });

  it("does not leak the writing style guide into an image prompt", () => {
    expect(heroReplacementPrompt(context, null)).not.toContain("Never used by the image stage");
  });

  it("appends the editor's steer without disturbing the brief", () => {
    const prompt = heroReplacementPrompt(context, "  Less literal, try a locked door.  ");
    expect(prompt).toContain("A single bank card standing upright");
    expect(prompt).toContain("## Extra direction for this attempt");
    expect(prompt).toContain("Less literal, try a locked door.");
  });

  it("leaves the prompt alone when no steer was given", () => {
    expect(heroReplacementPrompt(context, "   ")).toBe(heroReplacementPrompt(context, null));
  });

  it("falls back to the brief when no template is active", () => {
    const prompt = heroReplacementPrompt({ ...context, template: null }, null);
    expect(prompt).toContain("The UK's new payments levy");
    expect(prompt).toContain("A single bank card standing upright");
  });
});

describe("HeroReplacementService", () => {
  const drawn: DrawnCandidate = {
    bytes: png(),
    mimeType: "image/png",
    width: 1600,
    height: 900,
    contentHash: "a".repeat(64),
  };

  function service(
    store: HeroReplacementStore,
    draw: () => Promise<{ bytes: Uint8Array; mimeType: string }>,
  ): HeroReplacementService {
    return new HeroReplacementService(store, "worker-1", {
      codex: { label: "Codex", generateImage: draw } as never,
    });
  }

  it("is idle when nothing is waiting", async () => {
    const recorded = recorder();
    const subject = service(fakeStore(null, recorded), async () => drawn);
    expect(await subject.runNext(new AbortController().signal)).toEqual({ state: "idle" });
  });

  it("draws a candidate and hands it back for review", async () => {
    const recorded = recorder();
    const subject = service(
      fakeStore(claim({ imagesMode: "codex_image", direction: "Try a locked door." }), recorded),
      async () => ({ bytes: png(), mimeType: "image/png" }),
    );

    const result = await subject.runNext(new AbortController().signal);

    expect(result.state).toBe("drawn");
    expect(recorded.saved).toHaveLength(1);
    expect(recorded.savedPrompts[0]).toContain("Try a locked door.");
    expect(recorded.failures).toHaveLength(0);
  });

  it("publishes an approved candidate", async () => {
    const recorded = recorder();
    const subject = service(fakeStore(claim({ work: "apply" }), recorded), async () => drawn);

    const result = await subject.runNext(new AbortController().signal);

    expect(result).toMatchObject({ state: "applied", slug: "uk-payments-levy" });
    expect(recorded.applied).toBe(1);
  });

  it("refuses to draw for a stage that cannot draw unattended", async () => {
    const recorded = recorder();
    const subject = service(
      fakeStore(claim({ imagesMode: "manual_gemini" }), recorded),
      async () => drawn,
    );

    const result = await subject.runNext(new AbortController().signal);

    expect(result.state).toBe("failed");
    expect(recorded.failures[0]?.error).toContain("upload mode");
    expect(recorded.failures[0]?.retry).toBe(false);
    expect(recorded.saved).toHaveLength(0);
  });

  it("records a provider failure against the replacement, not the job queue", async () => {
    const recorded = recorder();
    const subject = service(fakeStore(claim({ imagesMode: "codex_image" }), recorded), async () => {
      throw new Error("Codex is signed out");
    });

    const result = await subject.runNext(new AbortController().signal);

    expect(result).toMatchObject({ state: "failed" });
    expect(recorded.failures[0]?.error).toContain("Codex is signed out");
    expect(recorded.failures[0]?.retry).toBe(false);
  });
});
