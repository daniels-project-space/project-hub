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
