import { describe, expect, it } from "vitest";

import { utcIsoToZonedLocal, zonedLocalToUtcIso } from "./timezone";

const LONDON = "Europe/London";

describe("zonedLocalToUtcIso", () => {
  it("treats winter times as UTC in London", () => {
    expect(zonedLocalToUtcIso("2026-01-15T09:30", LONDON)).toBe("2026-01-15T09:30:00.000Z");
  });

  it("subtracts the British Summer Time offset", () => {
    expect(zonedLocalToUtcIso("2026-07-15T09:30", LONDON)).toBe("2026-07-15T08:30:00.000Z");
  });

  it("handles the day either side of each transition", () => {
    // BST begins 29 March 2026 at 01:00 UTC; ends 25 October 2026 at 02:00 local.
    expect(zonedLocalToUtcIso("2026-03-28T12:00", LONDON)).toBe("2026-03-28T12:00:00.000Z");
    expect(zonedLocalToUtcIso("2026-03-30T12:00", LONDON)).toBe("2026-03-30T11:00:00.000Z");
    expect(zonedLocalToUtcIso("2026-10-24T12:00", LONDON)).toBe("2026-10-24T11:00:00.000Z");
    expect(zonedLocalToUtcIso("2026-10-26T12:00", LONDON)).toBe("2026-10-26T12:00:00.000Z");
  });

  it("resolves the spring-forward gap forwards", () => {
    // 01:30 on 29 March 2026 does not exist in London.
    expect(zonedLocalToUtcIso("2026-03-29T01:30", LONDON)).toBe("2026-03-29T01:30:00.000Z");
  });

  it("resolves the autumn repeat to the earlier occurrence", () => {
    // 01:30 on 25 October 2026 happens twice; BST (00:30 UTC) comes first.
    expect(zonedLocalToUtcIso("2026-10-25T01:30", LONDON)).toBe("2026-10-25T00:30:00.000Z");
    // 02:30 that morning is unambiguous: BST has already ended.
    expect(zonedLocalToUtcIso("2026-10-25T02:30", LONDON)).toBe("2026-10-25T02:30:00.000Z");
  });

  it("accepts seconds and rejects malformed values", () => {
    expect(zonedLocalToUtcIso("2026-01-15T09:30:45", LONDON)).toBe("2026-01-15T09:30:45.000Z");
    for (const value of ["", "2026-01-15", "15/01/2026 09:30", "2026-01-15T25:00", "not a date"]) {
      expect(zonedLocalToUtcIso(value, LONDON), value).toBeNull();
    }
  });

  it("rejects a date that does not exist rather than rolling it over", () => {
    expect(zonedLocalToUtcIso("2026-02-31T09:00", LONDON)).toBeNull();
    expect(zonedLocalToUtcIso("2026-13-01T09:00", LONDON)).toBeNull();
  });

  it("works for other zones", () => {
    expect(zonedLocalToUtcIso("2026-07-15T09:30", "UTC")).toBe("2026-07-15T09:30:00.000Z");
    expect(zonedLocalToUtcIso("2026-07-15T09:30", "Asia/Singapore")).toBe(
      "2026-07-15T01:30:00.000Z",
    );
  });
});

describe("utcIsoToZonedLocal", () => {
  it("renders an input value in the publication timezone", () => {
    expect(utcIsoToZonedLocal("2026-01-15T09:30:00.000Z", LONDON)).toBe("2026-01-15T09:30");
    expect(utcIsoToZonedLocal("2026-07-15T08:30:00.000Z", LONDON)).toBe("2026-07-15T09:30");
  });

  it("round-trips through zonedLocalToUtcIso", () => {
    for (const local of ["2026-01-15T09:30", "2026-07-15T23:05", "2026-12-31T00:00"]) {
      const utc = zonedLocalToUtcIso(local, LONDON);
      expect(utc).not.toBeNull();
      expect(utcIsoToZonedLocal(utc as string, LONDON)).toBe(local);
    }
  });

  it("rejects an unusable timestamp", () => {
    expect(() => utcIsoToZonedLocal("not a timestamp", LONDON)).toThrow(RangeError);
  });
});
