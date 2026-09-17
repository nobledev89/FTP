import { describe, expect, it } from "vitest";

import { formatDateline, formatLongDate, formatShortDate, toIsoString } from "./date";

describe("UK date formatting", () => {
  it("uses day-month-year order in en-GB", () => {
    expect(formatShortDate("2026-01-31T12:00:00Z")).toBe("31 Jan 2026");
    expect(formatLongDate("2026-01-31T12:00:00Z")).toBe("31 January 2026");
  });

  it("converts to Europe/London across the BST boundary", () => {
    // 23:30 UTC on 17 September is 00:30 BST on 18 September.
    expect(formatShortDate("2026-09-17T23:30:00Z")).toBe("18 Sept 2026");
    // 23:30 UTC on 31 January is still 31 January in GMT.
    expect(formatLongDate("2026-01-31T23:30:00Z")).toBe("31 January 2026");
  });

  it("formats the masthead dateline without a comma", () => {
    expect(formatDateline("2026-09-17T09:00:00Z")).toBe("Thursday 17 September 2026");
  });

  it("returns ISO strings for time elements", () => {
    expect(toIsoString("2026-09-17T09:00:00+01:00")).toBe("2026-09-17T08:00:00.000Z");
  });

  it("rejects invalid dates instead of rendering 'Invalid Date'", () => {
    expect(() => formatShortDate("not a date")).toThrow(RangeError);
  });
});
