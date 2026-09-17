import { describe, expect, it } from "vitest";

import { planAdminTransition, pausedFromStatus, type AdminTransitionSnapshot } from "./admin-rules";
import { WorkflowError } from "./errors";

function snapshot(overrides: Partial<AdminTransitionSnapshot> = {}): AdminTransitionSnapshot {
  return {
    status: "IDEA",
    lockVersion: 4,
    revisionCount: 0,
    hasLease: false,
    pausedFromStatus: null,
    failedStage: null,
    desiredPublishAt: null,
    ...overrides,
  };
}

describe("admin transition planning", () => {
  it.each([
    [snapshot(), { action: "start", expectedLockVersion: 4 }, "RESEARCH_PENDING"],
    [
      snapshot({ status: "DRAFTING", hasLease: true }),
      { action: "pause", expectedLockVersion: 4 },
      "PAUSED",
    ],
    [
      snapshot({ status: "PAUSED", pausedFromStatus: "DRAFT_PENDING" }),
      { action: "resume", expectedLockVersion: 4 },
      "DRAFT_PENDING",
    ],
    [
      snapshot({ status: "FAILED", failedStage: "draft" }),
      { action: "retry", expectedLockVersion: 4 },
      "DRAFT_PENDING",
    ],
    [
      snapshot({ status: "FAILED", failedStage: "audit", revisionCount: 1 }),
      { action: "retry", expectedLockVersion: 4 },
      "RE_AUDIT_PENDING",
    ],
    [
      snapshot({
        status: "FAILED",
        failedStage: "publish",
        desiredPublishAt: "2026-09-18T10:00:00Z",
      }),
      { action: "retry", expectedLockVersion: 4 },
      "SCHEDULED",
    ],
    [
      snapshot({ status: "AUDIT_PENDING" }),
      { action: "mark_needs_human", expectedLockVersion: 4, note: "Needs editorial judgment" },
      "NEEDS_HUMAN",
    ],
    [
      snapshot({ status: "NEEDS_HUMAN" }),
      {
        action: "resolve",
        expectedLockVersion: 4,
        note: "Resolved by editor",
        toStatus: "AUDIT_PENDING",
      },
      "AUDIT_PENDING",
    ],
    [snapshot({ status: "APPROVED" }), { action: "schedule", expectedLockVersion: 4 }, "SCHEDULED"],
  ] as const)("plans %#", (job, command, destination) => {
    expect(planAdminTransition(job, command)).toBe(destination);
  });

  it("normalizes a leased active stage when it is paused", () => {
    expect(pausedFromStatus(snapshot({ status: "DRAFTING", hasLease: true }))).toBe(
      "DRAFT_PENDING",
    );
    expect(
      pausedFromStatus(snapshot({ status: "AUDITING", revisionCount: 1, hasLease: true })),
    ).toBe("RE_AUDIT_PENDING");
    expect(pausedFromStatus(snapshot({ status: "AUDITING", hasLease: false }))).toBe("AUDITING");
  });

  it.each([
    [snapshot({ status: "PUBLISHED" }), { action: "pause", expectedLockVersion: 4 }],
    [snapshot({ status: "IDEA" }), { action: "resume", expectedLockVersion: 4 }],
    [
      snapshot({ status: "FAILED", failedStage: "draft" }),
      { action: "retry", expectedLockVersion: 3 },
    ],
    [
      snapshot({ status: "NEEDS_HUMAN" }),
      { action: "resolve", expectedLockVersion: 4, note: "ok", toStatus: "PUBLISHED" },
    ],
  ] as const)("rejects invalid intent %#", (job, command) => {
    expect(() => planAdminTransition(job, command)).toThrow(WorkflowError);
  });
});
