/**
 * Server-side pagination (plan section 12: tables and timelines page on the server; full histories
 * are never shipped to the client). PostgREST ranges are inclusive on both ends.
 */

export const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const MAX_PAGE = 10_000;

export type Paged<T> = Readonly<{
  items: readonly T[];
  page: number;
  pageSize: number;
  /** Total matching rows, or null when the source could not supply an exact count. */
  total: number | null;
  pageCount: number;
}>;

/** Reads a 1-based page number from a search param, ignoring anything that is not a page. */
export function parsePage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string" || !/^\d{1,5}$/.test(raw)) return 1;
  const page = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(page) || page < 1) return 1;
  return Math.min(page, MAX_PAGE);
}

export function parsePageSize(
  value: string | string[] | undefined,
  fallback: number = DEFAULT_PAGE_SIZE,
): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string" || !/^\d{1,3}$/.test(raw)) return fallback;
  const size = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(size) || size < 1) return fallback;
  return Math.min(size, MAX_PAGE_SIZE);
}

/** Inclusive `[from, to]` row range for a page, as `PostgrestFilterBuilder.range` expects. */
export function rangeFor(page: number, pageSize: number): Readonly<{ from: number; to: number }> {
  const safePage = Math.max(1, Math.trunc(page));
  const safeSize = Math.min(Math.max(1, Math.trunc(pageSize)), MAX_PAGE_SIZE);
  const from = (safePage - 1) * safeSize;
  return { from, to: from + safeSize - 1 };
}

export function pageCountFor(total: number | null, pageSize: number): number {
  if (total === null || total <= 0) return 1;
  const safeSize = Math.min(Math.max(1, Math.trunc(pageSize)), MAX_PAGE_SIZE);
  return Math.max(1, Math.ceil(total / safeSize));
}

export function paged<T>(
  items: readonly T[],
  page: number,
  pageSize: number,
  total: number | null,
): Paged<T> {
  return { items, page, pageSize, total, pageCount: pageCountFor(total, pageSize) };
}

/**
 * Rebuilds the current query string with a new page, dropping `page=1` so the first page has one
 * canonical URL. Only keys already present are carried over.
 */
export function pageHref(
  basePath: string,
  params: Readonly<Record<string, string | undefined>>,
  page: number,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key !== "page" && typeof value === "string" && value.length > 0) {
      search.set(key, value);
    }
  }
  if (page > 1) search.set("page", String(page));
  const query = search.toString();
  return query ? `${basePath}?${query}` : basePath;
}
