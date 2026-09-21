import { describe, expect, it } from "vitest";

import {
  JOB_STATUSES,
  JOB_TRANSITIONS,
  allowedTransitionsFrom,
  canTransition,
  pendingStatusForStage,
  stageForStatus,
  transitionFor,
  type JobStatus,
} from "./transitions";

describe("job transition map", () => {
  it("contains the complete normal and exceptional transition contract", () => {
    const counts = Object.groupBy(JOB_TRANSITIONS, (transition) => transition.path);
    expect(
      Object.fromEntries(Object.entries(counts).map(([path, rows]) => [path, rows?.length])),
    ).toEqual({
      normal: 22,
      pause: 16,
      resume: 16,
      failure: 6,
      retry: 8,
      escalate: 16,
      resolve: 7,
      recovery: 8,
      discard: 19,
    });
    expect(JOB_TRANSITIONS).toHaveLength(118);
    expect(new Set(JOB_TRANSITIONS.map(({ from, to }) => `${from}>${to}`)).size).toBe(118);
  });

  it.each(JOB_TRANSITIONS)("allows $from -> $to via $path", ({ from, to, path }) => {
    expect(canTransition(from, to)).toBe(true);
    expect(transitionFor(from, to)?.path).toBe(path);
  });

  it("rejects every status pair outside the transition map", () => {
    const allowed = new Set(JOB_TRANSITIONS.map(({ from, to }) => `${from}>${to}`));
    const rejected = JOB_STATUSES.flatMap((from) =>
      JOB_STATUSES.filter((to) => !allowed.has(`${from}>${to}`)).map((to) => [from, to] as const),
    );

    expect(rejected).toHaveLength(JOB_STATUSES.length ** 2 - JOB_TRANSITIONS.length);
    for (const [from, to] of rejected) {
      expect(canTransition(from, to), `${from} -> ${to}`).toBe(false);
      expect(transitionFor(from, to), `${from} -> ${to}`).toBeUndefined();
    }
  });

  it("keeps publication and terminal-state boundaries explicit", () => {
    expect(canTransition("APPROVED", "PUBLISHED")).toBe(false);
    expect(canTransition("PUBLISHED", "FAILED")).toBe(false);
    expect(allowedTransitionsFrom("VERIFIED")).toEqual([]);
    expect(allowedTransitionsFrom("DISCARDED")).toEqual([]);
    expect(canTransition("APPROVED", "DISCARDED")).toBe(true);
    expect(canTransition("PUBLISHING", "DISCARDED")).toBe(false);
    expect(canTransition("PUBLISHED", "DISCARDED")).toBe(false);
    expect(transitionFor("AUDITING", "NEEDS_HUMAN")?.path).toBe("normal");
  });
});

describe("stage mapping", () => {
  it.each([
    ["IDEA", "research"],
    ["RESEARCHING", "research"],
    ["DRAFT_COMPLETE", "draft"],
    ["IMAGES_PROCESSING", "images"],
    ["APPROVED", "audit"],
    ["REVISING", "revision"],
    ["PUBLISHING", "publish"],
    ["VERIFIED", "verify"],
    ["PAUSED", null],
    ["FAILED", null],
    ["NEEDS_HUMAN", null],
  ] as const)("maps %s to %s", (status, stage) => {
    expect(stageForStatus(status as JobStatus)).toBe(stage);
  });

  it("selects the re-audit queue only after a completed revision", () => {
    expect(pendingStatusForStage("audit", 0)).toBe("AUDIT_PENDING");
    expect(pendingStatusForStage("audit", 1)).toBe("RE_AUDIT_PENDING");
    expect(pendingStatusForStage("verify", 0)).toBeNull();
  });
});
