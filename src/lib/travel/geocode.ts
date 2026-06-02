/**
 * Geocoding via Open-Meteo Geocoding API (no key, CORS-enabled → client fetch).
 * Returns coords + country + IANA timezone, which the rest of the travel widget
 * (local time, weather, holidays) builds on.
 *
 * SSR-safe: pure fetch, no browser globals. Returns null on any failure.
 */

export interface GeoPlace {
  name: string;
  country: string;
  countryCode: string; // ISO-3166 alpha-2 (e.g. "FR")
  lat: number;
  lng: number;
  timezone: string; // IANA tz, e.g. "Europe/Paris"
  admin1?: string; // region/state, when available
}

interface OpenMeteoGeoResult {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  country_code?: string;
  timezone?: string;
  admin1?: string;
}

const cache = new Map<string, GeoPlace | null>();

/**
 * Geocode a free-text place query → the best match, or null.
 * Results are cached in-memory by normalized query.
 */
export async function geocodePlace(q: string): Promise<GeoPlace | null> {
  const key = q.trim().toLowerCase();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key) ?? null;

  try {
    const url =
      "https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=" +
      encodeURIComponent(q.trim());
    const res = await fetch(url);
    if (!res.ok) {
      cache.set(key, null);
      return null;
    }
    const json = (await res.json()) as { results?: OpenMeteoGeoResult[] };
    const r = json.results?.[0];
    if (!r) {
      cache.set(key, null);
      return null;
    }
    const place: GeoPlace = {
      name: r.name,
      country: r.country ?? "",
      countryCode: (r.country_code ?? "").toUpperCase(),
      lat: r.latitude,
      lng: r.longitude,
      timezone: r.timezone ?? "UTC",
      admin1: r.admin1,
    };
    cache.set(key, place);
    return place;
  } catch {
    cache.set(key, null);
    return null;
  }
}

/** Search up to `limit` matching places (for autocomplete). Empty array on failure. */
export async function searchPlaces(q: string, limit = 5): Promise<GeoPlace[]> {
  const query = q.trim();
  if (!query) return [];
  try {
    const url =
      `https://geocoding-api.open-meteo.com/v1/search?count=${Math.max(1, Math.min(20, limit))}&language=en&format=json&name=` +
      encodeURIComponent(query);
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = (await res.json()) as { results?: OpenMeteoGeoResult[] };
    return (json.results ?? []).map((r) => ({
      name: r.name,
      country: r.country ?? "",
      countryCode: (r.country_code ?? "").toUpperCase(),
      lat: r.latitude,
      lng: r.longitude,
      timezone: r.timezone ?? "UTC",
      admin1: r.admin1,
    }));
  } catch {
    return [];
  }
}
