/**
 * Public holidays via Nager.Date v3 (no key, CORS-enabled).
 * SSR-safe: pure fetch. Returns null/[] on failure. Cached per country+year.
 */

export interface Holiday {
  date: string; // ISO yyyy-mm-dd
  localName: string;
  name: string; // English name
  countryCode: string;
  global: boolean;
}

const yearCache = new Map<string, Holiday[]>();

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** All public holidays for a country in a given year. Empty array on failure. */
export async function holidaysForYear(
  countryCode: string,
  year: number,
): Promise<Holiday[]> {
  const cc = countryCode.trim().toUpperCase();
  if (!cc) return [];
  const key = `${cc}:${year}`;
  const cached = yearCache.get(key);
  if (cached) return cached;

  try {
    const url = `https://date.nager.at/api/v3/PublicHolidays/${year}/${cc}`;
    const res = await fetch(url);
    if (!res.ok) {
      yearCache.set(key, []);
      return [];
    }
    const json = (await res.json()) as Array<{
      date: string;
      localName: string;
      name: string;
      countryCode: string;
      global: boolean;
    }>;
    const list: Holiday[] = json.map((h) => ({
      date: h.date,
      localName: h.localName,
      name: h.name,
      countryCode: h.countryCode,
      global: h.global,
    }));
    yearCache.set(key, list);
    return list;
  } catch {
    yearCache.set(key, []);
    return [];
  }
}

/**
 * Next public holiday in `countryCode` on/after `fromDate` (default: today).
 * Looks in the current year then rolls over to the next. Null if none/failure.
 */
export async function nextHoliday(
  countryCode: string,
  fromDate: Date = new Date(),
): Promise<Holiday | null> {
  const fromISO = toISO(fromDate);
  const year = fromDate.getFullYear();

  const thisYear = await holidaysForYear(countryCode, year);
  const upcoming = thisYear
    .filter((h) => h.date >= fromISO)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (upcoming.length > 0) return upcoming[0];

  // Nothing left this year → first holiday of next year.
  const nextYear = await holidaysForYear(countryCode, year + 1);
  const sorted = nextYear.sort((a, b) => a.date.localeCompare(b.date));
  return sorted[0] ?? null;
}
