import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The archive must treat a page past the end as a missing page, not a database failure
 * (docs/SEO-GROWTH-PLAN.md section 4.3). PostgREST rejects such a range with PGRST103 rather than
 * returning an empty list, so the repository has to recover the total separately.
 */

type Result = {
  data: unknown;
  error: { code: string; message: string } | null;
  count: number | null;
};

const calls: { head: boolean; filters: [string, unknown][] }[] = [];
let rangeResult: Result;
let countResult: Result;

function builder(head: boolean) {
  const call = { head, filters: [] as [string, unknown][] };
  calls.push(call);
  const chain = {
    in(column: string, values: unknown) {
      call.filters.push([column, values]);
      return chain;
    },
    eq(column: string, value: unknown) {
      call.filters.push([column, value]);
      return chain;
    },
    order() {
      return chain;
    },
    range() {
      return Promise.resolve(rangeResult);
    },
    then(resolve: (value: Result) => unknown) {
      return Promise.resolve(countResult).then(resolve);
    },
  };
  return chain;
}

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_cache: (fn: () => unknown) => fn }));
vi.mock("@/lib/supabase/env", () => ({
  readSupabaseEnv: () => ({
    url: "https://example.supabase.co",
    publishableKey: "sb_publishable_test_key_for_unit_tests",
  }),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => ({
      select: (_columns: string, options?: { head?: boolean }) => builder(Boolean(options?.head)),
    }),
  }),
}));

const { getPublicArticlePage } = await import("./repository");

describe("getPublicArticlePage", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("answers an out-of-range page with the true total instead of throwing", async () => {
    rangeResult = {
      data: null,
      error: { code: "PGRST103", message: "Requested range not satisfiable" },
      count: null,
    };
    countResult = { data: null, error: null, count: 27 };

    const page = await getPublicArticlePage(4, 10);

    expect(page).toMatchObject({ articles: [], page: 4, total: 27, totalPages: 3 });
    expect(calls.map((call) => call.head)).toEqual([false, true]);
  });

  it("applies the same topic filter to the recovery count", async () => {
    rangeResult = {
      data: null,
      error: { code: "PGRST103", message: "Requested range not satisfiable" },
      count: null,
    };
    countResult = { data: null, error: null, count: 0 };

    const page = await getPublicArticlePage(2, 10, { categories: ["Payments"] });

    expect(page.totalPages).toBe(0);
    expect(calls.every((call) => call.filters[0]?.[0] === "category")).toBe(true);
  });

  it("still surfaces genuine database failures", async () => {
    rangeResult = {
      data: null,
      error: { code: "57014", message: "statement timeout" },
      count: null,
    };

    await expect(getPublicArticlePage(1, 10)).rejects.toThrow(/statement timeout/);
  });
});
