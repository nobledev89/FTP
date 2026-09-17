/**
 * Conversions between a wall-clock time in the publication's timezone and a UTC instant.
 *
 * An admin scheduling a post types "20/09/2026, 09:30" meaning 09:30 in London, while the database
 * stores `timestamptz`. `datetime-local` inputs carry no offset, so the conversion has to happen
 * explicitly — guessing UTC would move every scheduled post by an hour for half the year.
 */

const PART_KEYS = ["year", "month", "day", "hour", "minute", "second"] as const;

type Parts = Record<(typeof PART_KEYS)[number], number>;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

function partsAt(instantMs: number, timeZone: string): Parts {
  const parts = formatterFor(timeZone).formatToParts(new Date(instantMs));
  const values: Partial<Parts> = {};
  for (const part of parts) {
    if ((PART_KEYS as readonly string[]).includes(part.type)) {
      values[part.type as keyof Parts] = Number.parseInt(part.value, 10);
    }
  }
  for (const key of PART_KEYS) {
    if (typeof values[key] !== "number" || Number.isNaN(values[key])) {
      throw new RangeError(`Unsupported timezone for formatting: ${timeZone}`);
    }
  }
  return values as Parts;
}

/** Offset in milliseconds that the zone was at the given instant (positive east of UTC). */
function zoneOffsetMs(instantMs: number, timeZone: string): number {
  const parts = partsAt(instantMs, timeZone);
  const asIfUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asIfUtc - instantMs;
}

const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Resolves a naive wall-clock instant to the real UTC instant in `timeZone`.
 *
 * Candidate offsets are sampled a day either side, which covers both daylight-saving edges. A
 * candidate is real when re-reading the zone at that instant reproduces the wall-clock time asked
 * for. Two real candidates means the hour repeats (autumn): the earlier one is used. No real
 * candidate means the hour does not exist (spring): the clock moves forward. This is the same
 * disambiguation the Temporal API calls "compatible".
 */
function resolveWallClock(naive: number, timeZone: string): number {
  const candidates = [
    naive - zoneOffsetMs(naive - DAY_MS, timeZone),
    naive - zoneOffsetMs(naive + DAY_MS, timeZone),
  ];
  const real = candidates.filter(
    (candidate) => zoneOffsetMs(candidate, timeZone) === naive - candidate,
  );
  if (real.length > 0) return Math.min(...real);
  return Math.max(...candidates);
}

/**
 * Converts a `datetime-local` value ("2026-09-20T09:30") in `timeZone` to a UTC ISO timestamp.
 * Returns null for values that are not a well-formed local date and time.
 */
export function zonedLocalToUtcIso(local: string, timeZone: string): string | null {
  const match = LOCAL_INPUT.exec(local.trim());
  if (!match) return null;

  const [, year, month, day, hour, minute, second] = match;
  const numbers = [year, month, day, hour, minute, second ?? "00"].map((value) =>
    Number.parseInt(value ?? "", 10),
  ) as [number, number, number, number, number, number];
  if (numbers.some((value) => Number.isNaN(value))) return null;
  if (numbers[1] < 1 || numbers[1] > 12 || numbers[2] < 1 || numbers[2] > 31) return null;
  if (numbers[3] > 23 || numbers[4] > 59 || numbers[5] > 59) return null;

  const naive = Date.UTC(
    numbers[0],
    numbers[1] - 1,
    numbers[2],
    numbers[3],
    numbers[4],
    numbers[5],
  );
  const instant = resolveWallClock(naive, timeZone);

  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return null;
  // Reject a rolled-over calendar date (for example 31 February).
  const rendered = partsAt(instant, timeZone);
  if (rendered.day !== numbers[2] || rendered.month !== numbers[1]) return null;
  return date.toISOString();
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

/** Renders a UTC ISO timestamp as a `datetime-local` input value in `timeZone`. */
export function utcIsoToZonedLocal(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Invalid timestamp: ${iso}`);
  }
  const parts = partsAt(date.getTime(), timeZone);
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}
