import { describe, expect, it } from "vitest";

import { archivePageHref, parseArchivePage } from "./page-number";

describe("parseArchivePage", () => {
  it("treats a missing value as the first page", () => {
    expect(parseArchivePage(undefined)).toBe(1);
  });

  it("accepts plain positive integers", () => {
    expect(parseArchivePage("1")).toBe(1);
    expect(parseArchivePage("4")).toBe(4);
    expect(parseArchivePage("999")).toBe(999);
  });

  it("rejects zero, negatives, arrays, and non-numeric values", () => {
    for (const value of ["0", "-1", "01", "1.5", "+2", "abc", "", " 2", "100001"]) {
      expect(parseArchivePage(value)).toBeNull();
    }
    expect(parseArchivePage(["1", "2"])).toBeNull();
  });
});

describe("archivePageHref", () => {
  it("keeps page 1 on the bare path and numbers later pages", () => {
    expect(archivePageHref("/blog", 1)).toBe("/blog");
    expect(archivePageHref("/topics/payments", 3)).toBe("/topics/payments?page=3");
  });
});
