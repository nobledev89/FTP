import { describe, expect, it } from "vitest";

import { stageForStatus } from "@/lib/state-machine/transitions";

import {
  effectiveStatuses,
  filterParams,
  parseJobFilters,
  requiresAction,
  sanitizeSearch,
  statusesForStage,
} from "./job-filters";

describe("parseJobFilters", () => {
  it("defaults to every job", () => {
    const filters = parseJobFilters({});
    expect(filters.group).toBe("all");
    expect(filters.statuses).toEqual([]);
    expect(filters.stage).toBeNull();
    expect(effectiveStatuses(filters)).toBeNull();
  });

  it("expands a group to its statuses", () => {
    expect(parseJobFilters({ group: "blocked" }).statuses).toEqual(["FAILED", "NEEDS_HUMAN"]);
    expect(parseJobFilters({ group: "scheduled" }).statuses).toEqual(["APPROVED", "SCHEDULED"]);
    expect(parseJobFilters({ group: "published" }).statuses).toEqual(["PUBLISHED", "VERIFIED"]);
  });

  it("excludes finished, failed, and paused jobs from the open group", () => {
    const open = parseJobFilters({ group: "open" }).statuses;
    expect(open).toContain("RESEARCHING");
    expect(open).not.toContain("PUBLISHED");
    expect(open).not.toContain("VERIFIED");
    expect(open).not.toContain("FAILED");
    expect(open).not.toContain("PAUSED");
  });

  it("treats action_required as a column filter rather than a status list", () => {
    const filters = parseJobFilters({ group: "action_required" });
    expect(filters.statuses).toEqual([]);
    expect(requiresAction(filters)).toBe(true);
    expect(requiresAction(parseJobFilters({ group: "open" }))).toBe(false);
  });

  it("keeps only recognised statuses and stages", () => {
    const filters = parseJobFilters({ status: "AUDITING,not_a_status,paused", stage: "audit" });
    expect(filters.statuses).toEqual(["AUDITING", "PAUSED"]);
    expect(filters.stage).toBe("audit");
    expect(parseJobFilters({ stage: "nonsense" }).stage).toBeNull();
    expect(parseJobFilters({ group: "nonsense" }).group).toBe("all");
  });
});

describe("sanitizeSearch", () => {
  it("removes the characters that would change a PostgREST filter", () => {
    expect(sanitizeSearch("rates%_,()")).toBe("rates");
    expect(sanitizeSearch("open banking")).toBe("open banking");
    expect(sanitizeSearch("  buy now,  pay later  ")).toBe("buy now pay later");
    expect(sanitizeSearch("Lloyd's")).toBe("Lloyd's");
    expect(sanitizeSearch("euro-zone")).toBe("euro-zone");
  });

  it("keeps non-Latin letters and digits", () => {
    expect(sanitizeSearch("Zahlungsverkehr 2026")).toBe("Zahlungsverkehr 2026");
  });

  it("bounds the length and handles absent values", () => {
    expect(sanitizeSearch(undefined)).toBe("");
    expect(sanitizeSearch(["first", "second"])).toBe("first");
    expect(sanitizeSearch("a".repeat(200)).length).toBe(80);
  });
});

describe("statusesForStage", () => {
  it("matches the state machine's own stage mapping", () => {
    for (const status of statusesForStage("audit")) {
      expect(stageForStatus(status)).toBe("audit");
    }
    expect(statusesForStage("revision")).toEqual(["REVISION_REQUIRED", "REVISING"]);
  });
});

describe("effectiveStatuses", () => {
  it("intersects the group and the stage", () => {
    const filters = parseJobFilters({ group: "blocked", stage: "audit" });
    // FAILED and NEEDS_HUMAN belong to no stage, so the intersection is empty.
    expect(effectiveStatuses(filters)).toEqual([]);
  });

  it("uses the stage alone when no status filter is set", () => {
    const filters = parseJobFilters({ stage: "publish" });
    expect(effectiveStatuses(filters)).toEqual(["SCHEDULED", "PUBLISHING"]);
  });

  it("keeps the overlap when both apply", () => {
    const filters = parseJobFilters({ status: "AUDITING,DRAFTING", stage: "audit" });
    expect(effectiveStatuses(filters)).toEqual(["AUDITING"]);
  });
});

describe("filterParams", () => {
  it("emits only the filters that are set", () => {
    expect(filterParams(parseJobFilters({}))).toEqual({
      group: undefined,
      stage: undefined,
      q: undefined,
    });
    expect(filterParams(parseJobFilters({ group: "open", stage: "draft", q: "payments" }))).toEqual(
      {
        group: "open",
        stage: "draft",
        q: "payments",
      },
    );
  });
});
