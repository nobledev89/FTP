import { describe, expect, it } from "vitest";

import {
  DEFAULT_PAGE_SIZE,
  pageCountFor,
  pageHref,
  paged,
  parsePage,
  parsePageSize,
  rangeFor,
} from "./pagination";

describe("parsePage", () => {
  it("reads a positive integer and defaults to the first page", () => {
    expect(parsePage("3")).toBe(3);
    expect(parsePage(["4", "9"])).toBe(4);
    expect(parsePage(undefined)).toBe(1);
    expect(parsePage("0")).toBe(1);
    expect(parsePage("-2")).toBe(1);
    expect(parsePage("2.5")).toBe(1);
    expect(parsePage("1e3")).toBe(1);
    expect(parsePage("abc")).toBe(1);
  });

  it("clamps absurd page numbers instead of computing a huge offset", () => {
    expect(parsePage("99999")).toBe(10_000);
  });
});

describe("parsePageSize", () => {
  it("defaults and clamps", () => {
    expect(parsePageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
    expect(parsePageSize("50")).toBe(50);
    expect(parsePageSize("999")).toBe(100);
    expect(parsePageSize("0")).toBe(DEFAULT_PAGE_SIZE);
    expect(parsePageSize("x", 10)).toBe(10);
  });
});

describe("rangeFor", () => {
  it("produces inclusive PostgREST ranges", () => {
    expect(rangeFor(1, 25)).toEqual({ from: 0, to: 24 });
    expect(rangeFor(2, 25)).toEqual({ from: 25, to: 49 });
    expect(rangeFor(4, 10)).toEqual({ from: 30, to: 39 });
  });

  it("treats out-of-range input as the first page", () => {
    expect(rangeFor(0, 25)).toEqual({ from: 0, to: 24 });
    expect(rangeFor(-3, 25)).toEqual({ from: 0, to: 24 });
  });
});

describe("pageCountFor", () => {
  it("never reports fewer than one page", () => {
    expect(pageCountFor(0, 25)).toBe(1);
    expect(pageCountFor(null, 25)).toBe(1);
    expect(pageCountFor(1, 25)).toBe(1);
    expect(pageCountFor(25, 25)).toBe(1);
    expect(pageCountFor(26, 25)).toBe(2);
    expect(pageCountFor(100, 25)).toBe(4);
  });
});

describe("paged", () => {
  it("carries the page metadata alongside the rows", () => {
    expect(paged(["a", "b"], 2, 2, 5)).toEqual({
      items: ["a", "b"],
      page: 2,
      pageSize: 2,
      total: 5,
      pageCount: 3,
    });
  });
});

describe("pageHref", () => {
  it("keeps the current filters and drops page=1", () => {
    expect(pageHref("/admin", { group: "blocked" }, 1)).toBe("/admin?group=blocked");
    expect(pageHref("/admin", { group: "blocked" }, 3)).toBe("/admin?group=blocked&page=3");
  });

  it("omits empty filters and any inherited page value", () => {
    expect(pageHref("/admin/logs", { source: "events", state: undefined, page: "7" }, 2)).toBe(
      "/admin/logs?source=events&page=2",
    );
    expect(pageHref("/admin", {}, 1)).toBe("/admin");
  });

  it("encodes values that would otherwise change the query string", () => {
    expect(pageHref("/admin", { q: "rates & fees" }, 2)).toBe("/admin?q=rates+%26+fees&page=2");
  });
});
