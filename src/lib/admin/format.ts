import { siteConfig } from "@/lib/site/config";

/**
 * Admin-console formatting. Denser than the publication's (docs/DESIGN-SYSTEM.md section 10): an
 * operator needs the time of day and how long ago something happened, not an editorial dateline.
 * All times are shown in the publication timezone so they match what the scheduler will do.
 */

const dateTimeFormatter = new Intl.DateTimeFormat(siteConfig.locale, {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: siteConfig.timeZone,
});

const timeFormatter = new Intl.DateTimeFormat(siteConfig.locale, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  timeZone: siteConfig.timeZone,
});

function toDate(value: string | Date): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Invalid date value: ${String(value)}`);
  }
  return date;
}

/** `17 Sept 2026, 09:14` */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return dateTimeFormatter.format(toDate(value));
}

/** `09:14:02`, for timeline rows that already sit under a date heading. */
export function formatTimeOfDay(value: string | Date): string {
  return timeFormatter.format(toDate(value));
}

const UNITS: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 60 * 60 * 1000],
  ["month", 30 * 24 * 60 * 60 * 1000],
  ["day", 24 * 60 * 60 * 1000],
  ["hour", 60 * 60 * 1000],
  ["minute", 60 * 1000],
  ["second", 1000],
];

const relativeFormatter = new Intl.RelativeTimeFormat(siteConfig.locale, { numeric: "auto" });

/**
 * `12 seconds ago`, `in 3 hours`. Rendered on the server, so it is accurate at render time and
 * stale afterwards — pages that show it state when they were generated.
 */
export function formatRelativeTime(
  value: string | Date | null | undefined,
  now: Date = new Date(),
): string {
  if (!value) return "—";
  const difference = toDate(value).getTime() - now.getTime();
  const magnitude = Math.abs(difference);
  for (const [unit, milliseconds] of UNITS) {
    if (magnitude >= milliseconds || unit === "second") {
      return relativeFormatter.format(Math.round(difference / milliseconds), unit);
    }
  }
  return relativeFormatter.format(0, "second");
}

/** `1.4s`, `2m 03s`, `—`. Durations come from provider runs and verification checks. */
export function formatDuration(milliseconds: number | null | undefined): string {
  if (typeof milliseconds !== "number" || !Number.isFinite(milliseconds) || milliseconds < 0) {
    return "—";
  }
  if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`;
  const totalSeconds = milliseconds / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

/** Elapsed time between two timestamps, for provider runs that have finished. */
export function formatElapsed(
  startedAt: string | null | undefined,
  finishedAt: string | null | undefined,
): string {
  if (!startedAt || !finishedAt) return "—";
  return formatDuration(toDate(finishedAt).getTime() - toDate(startedAt).getTime());
}

/** Provider cost. `numeric` columns arrive as strings from PostgREST, so both shapes are accepted. */
export function formatCost(
  amount: number | string | null | undefined,
  currency: string | null | undefined,
): string {
  if (amount === null || amount === undefined) return "—";
  const value = typeof amount === "string" ? Number.parseFloat(amount) : amount;
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(siteConfig.locale, {
    style: "currency",
    currency: currency ?? siteConfig.currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value);
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat(siteConfig.locale).format(value);
}
