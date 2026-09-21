import { describe, expect, it } from "vitest";

import { planAdminTransition } from "@/lib/state-machine/admin-rules";
import { JOB_STATUSES, canTransition, type JobStatus } from "@/lib/state-machine/transitions";

import { availableControls, resolutionDestinations, type JobControlSnapshot } from "./job-controls";

function snapshot(overrides: Partial<JobControlSnapshot> = {}): JobControlSnapshot {
  return {
    status: "IDEA",
    pausedFromStatus: null,
    failedStage: null,
    needsHumanStage: null,
    revisionCount: 0,
    hasAudit: false,
    hasValidDraft: false,
    ...overrides,
  };
}

describe("availableControls", () => {
  it("offers only what the status allows", () => {
    expect(availableControls(snapshot({ status: "IDEA" }))).toEqual([
      "start",
      "pause",
      "escalate",
      "discard",
    ]);
    expect(availableControls(snapshot({ status: "AUDITING" }))).toEqual([
      "pause",
      "escalate",
      "discard",
    ]);
    expect(availableControls(snapshot({ status: "APPROVED" }))).toEqual([
      "publish_now",
      "schedule",
      "pause",
      "escalate",
      "discard",
    ]);
    expect(
      availableControls(snapshot({ status: "PAUSED", pausedFromStatus: "DRAFT_PENDING" })),
    ).toEqual(["resume", "discard"]);
    expect(availableControls(snapshot({ status: "FAILED", failedStage: "draft" }))).toEqual([
      "retry",
      "discard",
    ]);
    expect(
      availableControls(snapshot({ status: "NEEDS_HUMAN", needsHumanStage: "audit" })),
    ).toEqual(["resolve", "discard"]);
    expect(availableControls(snapshot({ status: "SCHEDULED" }))).toEqual([
      "publish_now",
      "schedule",
      "pause",
      "escalate",
      "discard",
    ]);
  });

  it("offers nothing once the worker owns the outcome", () => {
    expect(availableControls(snapshot({ status: "PUBLISHING" }))).toEqual([]);
    expect(availableControls(snapshot({ status: "PUBLISHED" }))).toEqual([]);
    expect(availableControls(snapshot({ status: "VERIFIED" }))).toEqual([]);
    expect(availableControls(snapshot({ status: "DISCARDED" }))).toEqual([]);
  });

  it("never offers a control the pure planner would reject", () => {
    const actions = {
      start: "start",
      pause: "pause",
      resume: "resume",
      retry: "retry",
      escalate: "mark_needs_human",
      resolve: "resolve",
      schedule: "schedule",
      publish_now: "schedule",
      // Discarding is `admin_discard_job`, not a planner action; it follows the transition map.
      discard: null,
    } as const;

    for (const status of JOB_STATUSES) {
      const current = snapshot({
        status,
        pausedFromStatus: status === "PAUSED" ? "DRAFT_PENDING" : null,
        failedStage: status === "FAILED" ? "draft" : null,
        needsHumanStage: status === "NEEDS_HUMAN" ? "audit" : null,
        hasAudit: true,
        hasValidDraft: true,
      });

      for (const control of availableControls(current)) {
        const action = actions[control];
        if (action === null) {
          expect(canTransition(status, "DISCARDED"), `${status} / discard`).toBe(true);
          continue;
        }
        // Moving a scheduled job is `admin_reschedule_job`, which keeps the status.
        if (status === "SCHEDULED" && action === "schedule") continue;
        const toStatus: JobStatus | undefined =
          action === "resolve" ? resolutionDestinations(current)[0] : undefined;
        expect(
          () =>
            planAdminTransition(
              {
                status: current.status,
                lockVersion: 4,
                revisionCount: current.revisionCount,
                hasLease: false,
                pausedFromStatus: current.pausedFromStatus,
                failedStage: current.failedStage,
                desiredPublishAt: "2026-09-20T09:30:00.000Z",
              },
              {
                action,
                expectedLockVersion: 4,
                note: "a sufficient note",
                ...(toStatus ? { toStatus } : {}),
              },
            ),
          `${status} / ${control}`,
        ).not.toThrow();
      }
    }
  });
});

describe("resolutionDestinations", () => {
  it("is empty unless the job is escalated", () => {
    expect(resolutionDestinations(snapshot({ status: "AUDITING" }))).toEqual([]);
  });

  it("does not let an early escalation skip ahead", () => {
    const destinations = resolutionDestinations(
      snapshot({ status: "NEEDS_HUMAN", needsHumanStage: "research", hasAudit: true }),
    );
    expect(destinations).toEqual(["RESEARCH_PENDING"]);
  });

  it("lets an image-stage escalation go back, but no further forward", () => {
    // `admin_transition_job` refuses a destination past the stage the job stopped at, so the audit
    // is not offered here even though NEEDS_HUMAN -> AUDIT_PENDING exists in the transition map.
    const destinations = resolutionDestinations(
      snapshot({ status: "NEEDS_HUMAN", needsHumanStage: "images", hasAudit: false }),
    );
    expect(destinations).toEqual(["RESEARCH_PENDING", "DRAFT_PENDING", "IMAGES_PENDING"]);
  });

  it("offers approval only after an audit, with a valid draft", () => {
    const base = { status: "NEEDS_HUMAN", hasAudit: true, hasValidDraft: true } as const;
    expect(resolutionDestinations(snapshot({ ...base, needsHumanStage: "audit" }))).toContain(
      "APPROVED",
    );
    expect(resolutionDestinations(snapshot({ ...base, needsHumanStage: "draft" }))).not.toContain(
      "APPROVED",
    );
    expect(
      resolutionDestinations(snapshot({ ...base, needsHumanStage: "audit", hasValidDraft: false })),
    ).not.toContain("APPROVED");
  });

  it("withdraws the revision route once both cycles are used", () => {
    const used = snapshot({
      status: "NEEDS_HUMAN",
      needsHumanStage: "revision",
      revisionCount: 2,
      hasAudit: true,
      hasValidDraft: true,
    });
    expect(resolutionDestinations(used)).not.toContain("REVISION_REQUIRED");

    const available = snapshot({
      status: "NEEDS_HUMAN",
      needsHumanStage: "revision",
      revisionCount: 1,
      hasAudit: true,
      hasValidDraft: true,
    });
    expect(resolutionDestinations(available)).toContain("REVISION_REQUIRED");
  });

  it("requires an audit before a revision can be requested", () => {
    const noAudit = snapshot({
      status: "NEEDS_HUMAN",
      needsHumanStage: "audit",
      revisionCount: 0,
      hasAudit: false,
    });
    expect(resolutionDestinations(noAudit)).not.toContain("REVISION_REQUIRED");
  });
});
