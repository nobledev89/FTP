import { siteConfig } from "@/lib/site/config";

/**
 * UK-readable day-month-year dates in the editorial timezone (plan section 2.1).
 * Inputs are ISO 8601 timestamps as stored in Postgres `timestamptz` columns.
 */

const shortFormatter = new Intl.DateTimeFormat(siteConfig.locale, {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: siteConfig.timeZone,
});

const longFormatter = new Intl.DateTimeFormat(siteConfig.locale, {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: siteConfig.timeZone,
});

const weekdayFormatter = new Intl.DateTimeFormat(siteConfig.locale, {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: siteConfig.timeZone,
});

function toDate(value: string | Date): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Invalid date value: ${String(value)}`);
  }
  return date;
}

/** `17 Sept 2026` */
export function formatShortDate(value: string | Date): string {
  return shortFormatter.format(toDate(value));
}

/** `17 September 2026` */
export function formatLongDate(value: string | Date): string {
  return longFormatter.format(toDate(value));
}

/** `Thursday 17 September 2026`, used by the masthead dateline. */
export function formatDateline(value: string | Date): string {
  return weekdayFormatter.format(toDate(value)).replace(",", "");
}

/** Machine-readable value for `<time dateTime>`. */
export function toIsoString(value: string | Date): string {
  return toDate(value).toISOString();
}
