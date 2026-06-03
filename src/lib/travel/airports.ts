/**
 * Airport lookup over the bundled OpenFlights dataset (src/lib/travel/data/airports.json).
 *
 * The ~835 KB dataset is DYNAMICALLY imported the first time a lookup runs, so it
 * never lands in the initial client bundle — only when travel features actually
 * call findAirport(). An IATA index + a lowercased city index are built once and
 * memoized. SSR-safe: no browser globals.
 */

export interface Airport {
  iata: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
  tz: string; // IANA timezone, may be "" if unknown
}

interface AirportIndex {
  byIata: Map<string, Airport>;
  byCity: Map<string, Airport[]>;
  all: Airport[];
}

let indexPromise: Promise<AirportIndex> | null = null;

async function loadIndex(): Promise<AirportIndex> {
  if (indexPromise) return indexPromise;
  indexPromise = (async () => {
    const mod = await import("./data/airports.json");
    const all = (mod.default ?? mod) as unknown as Airport[];
    const byIata = new Map<string, Airport>();
    const byCity = new Map<string, Airport[]>();
    for (const a of all) {
      byIata.set(a.iata.toUpperCase(), a);
      const cityKey = a.city.trim().toLowerCase();
      if (cityKey) {
        const bucket = byCity.get(cityKey);
        if (bucket) bucket.push(a);
        else byCity.set(cityKey, [a]);
      }
    }
    return { byIata, byCity, all };
  })();
  return indexPromise;
}

/**
 * Look up an airport by 3-letter IATA code or by city name.
 * - IATA match is exact (case-insensitive).
 * - City match returns the first airport in that city (use findAirports for all).
 * Null if nothing matches or the dataset fails to load.
 */
export async function findAirport(iataOrCity: string): Promise<Airport | null> {
  const q = iataOrCity.trim();
  if (!q) return null;
  let idx: AirportIndex;
  try {
    idx = await loadIndex();
  } catch {
    return null;
  }
  if (q.length === 3) {
    const hit = idx.byIata.get(q.toUpperCase());
    if (hit) return hit;
  }
  const city = idx.byCity.get(q.toLowerCase());
  return city?.[0] ?? null;
}

/**
 * Type-ahead search over the dataset by IATA / city / country / airport name.
 * Ranked: exact IATA, then city/country prefix, then any substring. Only airports
 * with a real 3-letter IATA code are returned (flight search needs codes).
 */
export async function searchAirports(
  query: string,
  limit = 8,
): Promise<Airport[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  let idx: AirportIndex;
  try {
    idx = await loadIndex();
  } catch {
    return [];
  }
  const scored: Array<{ a: Airport; score: number }> = [];
  for (const a of idx.all) {
    if (!a.iata || a.iata.length !== 3) continue;
    const iata = a.iata.toLowerCase();
    const city = a.city.toLowerCase();
    const country = a.country.toLowerCase();
    const name = a.name.toLowerCase();
    let score = -1;
    if (iata === q) score = 0;
    else if (city === q) score = 1;
    else if (city.startsWith(q)) score = 2;
    else if (country.startsWith(q)) score = 3;
    else if (
      city.includes(q) ||
      country.includes(q) ||
      name.includes(q) ||
      iata.includes(q)
    )
      score = 4;
    if (score >= 0) scored.push({ a, score });
  }
  scored.sort(
    (x, y) => x.score - y.score || x.a.city.localeCompare(y.a.city),
  );
  return scored.slice(0, limit).map((s) => s.a);
}

/** All airports in a city (or the single IATA match). Empty array on miss. */
export async function findAirports(iataOrCity: string): Promise<Airport[]> {
  const q = iataOrCity.trim();
  if (!q) return [];
  let idx: AirportIndex;
  try {
    idx = await loadIndex();
  } catch {
    return [];
  }
  if (q.length === 3) {
    const hit = idx.byIata.get(q.toUpperCase());
    if (hit) return [hit];
  }
  return idx.byCity.get(q.toLowerCase()) ?? [];
}
