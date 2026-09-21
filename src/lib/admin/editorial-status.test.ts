import { describe, expect, it } from "vitest";

import { JOB_STATUSES, PIPELINE_STAGES, type JobStatus } from "@/lib/state-machine/transitions";

import {
  EDITORIAL_STEPS,
  editorialLabel,
  editorialState,
  editorialTone,
  resolutionChoiceLabel,
  stepForStage,
  stepLabel,
  stepTracker,
} from "./editorial-status";

describe("editorialState", () => {
  it("gives every database status a plain label", () => {
    for (const status of JOB_STATUSES) {
      const state = editorialState({ status });
      expect(editorialLabel(state).length, status).toBeGreaterThan(3);
      expect(editorialTone(state), status).toBeTypeOf("string");
    }
  });

  it("puts the states an editor must act on under Needs you", () => {
    expect(editorialState({ status: "IDEA" })).toBe("needs_you");
    expect(editorialState({ status: "FAILED" })).toBe("needs_you");
    expect(editorialState({ status: "NEEDS_HUMAN" })).toBe("needs_you");
    // A manual provider step stops the pipeline on a person even mid-stage.
    expect(editorialState({ status: "DRAFTING", actionRequiredKind: "manual_input" })).toBe(
      "needs_you",
    );
    expect(editorialState({ status: "DRAFTING" })).toBe("in_progress");
  });

  it("separates an article waiting for a decision from one waiting for its time", () => {
    expect(editorialState({ status: "APPROVED" })).toBe("ready");
    expect(editorialState({ status: "APPROVED", autoPublish: true })).toBe("scheduled");
    expect(editorialState({ status: "SCHEDULED" })).toBe("scheduled");
  });

  it("treats a withdrawn article as stopped, whatever the job says", () => {
    expect(editorialState({ status: "VERIFIED" })).toBe("live");
    expect(editorialState({ status: "VERIFIED", articleStatus: "withdrawn" })).toBe("stopped");
  });
});

describe("stepTracker", () => {
  const states = (status: JobStatus, extra = {}) =>
    stepTracker({ status, imageCount: 1, ...extra }).map((step) => step.state);

  it("marks earlier steps done and later ones upcoming", () => {
    expect(states("DRAFTING")).toEqual(["done", "current", "upcoming", "upcoming", "upcoming"]);
    expect(states("AUDITING")).toEqual(["done", "done", "done", "current", "upcoming"]);
  });

  it("counts the check as done once the article is ready or scheduled", () => {
    expect(states("APPROVED")).toEqual(["done", "done", "done", "done", "current"]);
    expect(states("SCHEDULED")).toEqual(["done", "done", "done", "done", "current"]);
  });

  it("marks every step done once the article is live", () => {
    expect(states("VERIFIED")).toEqual(["done", "done", "done", "done", "done"]);
    expect(states("PUBLISHED")).toEqual(["done", "done", "done", "done", "done"]);
  });

  it("skips the image step when no image was asked for", () => {
    expect(stepTracker({ status: "AUDITING", imageCount: 0 })[2]).toMatchObject({
      step: "image",
      state: "skipped",
    });
  });

  it("marks where a stopped article stopped", () => {
    expect(states("FAILED", { failedStage: "draft" })).toEqual([
      "done",
      "blocked",
      "upcoming",
      "upcoming",
      "upcoming",
    ]);
    expect(states("PAUSED", { pausedFromStatus: "IMAGES_PENDING" })[2]).toBe("blocked");
    expect(states("NEEDS_HUMAN", { needsHumanStage: "audit" })[3]).toBe("blocked");
    expect(states("DRAFTING", { actionRequiredKind: "manual_input" })[1]).toBe("blocked");
  });

  it("has no steps for a discarded article and none started for a new one", () => {
    expect(stepTracker({ status: "DISCARDED", imageCount: 1 })).toEqual([]);
    expect(states("IDEA")).toEqual(["upcoming", "upcoming", "upcoming", "upcoming", "upcoming"]);
  });

  it("names a step for every pipeline stage", () => {
    for (const stage of PIPELINE_STAGES) {
      expect(EDITORIAL_STEPS, stage).toContain(stepForStage(stage));
      expect(stepLabel(stepForStage(stage)).length, stage).toBeGreaterThan(3);
    }
  });
});

describe("resolutionChoiceLabel", () => {
  it("describes each destination as a choice rather than a status", () => {
    expect(resolutionChoiceLabel("APPROVED")).toBe("Approve it as it is");
    expect(resolutionChoiceLabel("REVISION_REQUIRED")).toMatch(/rewrite/i);
    // An unmapped status still renders something rather than nothing.
    expect(resolutionChoiceLabel("PUBLISHING")).toBe("PUBLISHING");
  });
});
