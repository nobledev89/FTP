/**
 * Parses an archive `?page=` value. Absent means page 1; anything other than one plain positive
 * integer (arrays, zero, negatives, signs, decimals, huge values) is `null`, which routes answer
 * with a 404.
 */
export function parseArchivePage(value: string | string[] | undefined): number | null {
  if (value === undefined) return 1;
  if (Array.isArray(value) || !/^[1-9]\d*$/.test(value)) return null;
  const page = Number(value);
  return Number.isSafeInteger(page) && page <= 100_000 ? page : null;
}

/** Canonical URL path for one page of a paginated listing; page 1 has no query string. */
export function archivePageHref(basePath: string, page: number): string {
  return page === 1 ? basePath : `${basePath}?page=${page}`;
}
