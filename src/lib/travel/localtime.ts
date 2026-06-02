/**
 * Destination local time from an IANA timezone (e.g. from geocode().timezone).
 * Uses native Intl.DateTimeFormat — no library, no network, SSR-safe.
 */

export interface LocalTime {
  timezone: string;
  /** "14:32" (24h) */
  time: string;
  /** "Mon, 2 Jun" */
  date: string;
  /** Offset label like "GMT+2" (best-effort; "" if unavailable). */
  offset: string;
  /** Raw Date the formatting was based on. */
  at: Date;
}

function safeFormat(
  tz: string,
  at: Date,
  opts: Intl.DateTimeFormatOptions,
): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: tz, ...opts }).format(at);
  } catch {
    return "";
  }
}

/**
 * Current wall-clock time at `timezone`. Returns null if the tz is invalid.
 * Pass `at` to format a specific instant (defaults to now).
 */
export function destLocalTime(
  timezone: string,
  at: Date = new Date(),
): LocalTime | null {
  if (!timezone) return null;
  // Validate the tz once — invalid zones throw in DateTimeFormat.
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: timezone }).format(at);
  } catch {
    return null;
  }

  const time = safeFormat(timezone, at, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const date = safeFormat(timezone, at, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  let offset = "";
  const tzName = safeFormat(timezone, at, { timeZoneName: "short" });
  const m = tzName.match(/(GMT|UTC)[+-]\d+(?::\d+)?/);
  if (m) offset = m[0];

  return { timezone, time, date, offset, at };
}

/**
 * Difference in whole hours between `timezone` and the viewer's local zone.
 * Positive = destination is ahead. Null if tz invalid or run server-side
 * where the host zone is ambiguous (still works, uses host offset).
 */
export function hoursAhead(timezone: string, at: Date = new Date()): number | null {
  if (!timezone) return null;
  try {
    const destParts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
      day: "numeric",
    }).formatToParts(at);
    const localParts = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      day: "numeric",
    }).formatToParts(at);
    const get = (parts: Intl.DateTimeFormatPart[], t: string) =>
      Number(parts.find((p) => p.type === t)?.value ?? "0");
    const destH = get(destParts, "hour") + get(destParts, "day") * 24;
    const localH = get(localParts, "hour") + get(localParts, "day") * 24;
    return destH - localH;
  } catch {
    return null;
  }
}
