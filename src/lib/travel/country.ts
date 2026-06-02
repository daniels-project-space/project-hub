/**
 * Country facts via REST Countries v3.1 + plug/socket info via PlugTypes API.
 * Both no-key, CORS-enabled → client fetch. SSR-safe (pure fetch).
 * Returns null on failure. Cached in-memory by country code.
 */

export interface CountryFacts {
  countryCode: string; // alpha-2
  name: string;
  capital: string;
  region: string;
  currencyCode: string; // e.g. "EUR"
  currencyName: string;
  currencySymbol: string;
  languages: string[]; // e.g. ["French"]
  flagEmoji: string;
  flagPng: string; // URL
}

export interface PlugInfo {
  countryCode: string;
  plugTypes: string[]; // e.g. ["C", "E"]
  voltage: string; // e.g. "230V"
  frequency: string; // e.g. "50Hz"
}

const factsCache = new Map<string, CountryFacts | null>();
const plugCache = new Map<string, PlugInfo | null>();

interface RestCountry {
  name?: { common?: string };
  capital?: string[];
  region?: string;
  cca2?: string;
  flag?: string;
  flags?: { png?: string };
  currencies?: Record<string, { name?: string; symbol?: string }>;
  languages?: Record<string, string>;
}

/** Country facts (currency, languages, capital, flag) for an alpha-2 code. */
export async function countryFacts(cc: string): Promise<CountryFacts | null> {
  const code = cc.trim().toUpperCase();
  if (!code) return null;
  if (factsCache.has(code)) return factsCache.get(code) ?? null;

  try {
    const fields =
      "name,capital,region,cca2,flag,flags,currencies,languages";
    const url = `https://restcountries.com/v3.1/alpha/${code}?fields=${fields}`;
    const res = await fetch(url);
    if (!res.ok) {
      factsCache.set(code, null);
      return null;
    }
    const data = (await res.json()) as RestCountry | RestCountry[];
    const c = Array.isArray(data) ? data[0] : data;
    if (!c) {
      factsCache.set(code, null);
      return null;
    }
    const currEntry = Object.entries(c.currencies ?? {})[0];
    const facts: CountryFacts = {
      countryCode: (c.cca2 ?? code).toUpperCase(),
      name: c.name?.common ?? "",
      capital: c.capital?.[0] ?? "",
      region: c.region ?? "",
      currencyCode: currEntry?.[0] ?? "",
      currencyName: currEntry?.[1]?.name ?? "",
      currencySymbol: currEntry?.[1]?.symbol ?? "",
      languages: Object.values(c.languages ?? {}),
      flagEmoji: c.flag ?? "",
      flagPng: c.flags?.png ?? "",
    };
    factsCache.set(code, facts);
    return facts;
  } catch {
    factsCache.set(code, null);
    return null;
  }
}

interface PlugTypesResponse {
  data?: {
    country?: string;
    plugs?: Array<{ type?: string } | string>;
    voltage?: string | number;
    frequency?: string | number;
  };
  // Some deployments return a flat shape; tolerate both.
  plugs?: Array<{ type?: string } | string>;
  voltage?: string | number;
  frequency?: string | number;
}

/** Plug letters + voltage/frequency for an alpha-2 country code. */
export async function plugInfo(cc: string): Promise<PlugInfo | null> {
  const code = cc.trim().toUpperCase();
  if (!code) return null;
  if (plugCache.has(code)) return plugCache.get(code) ?? null;

  try {
    const url = `https://www.plugtypes.com/api/v1/country/${code}`;
    const res = await fetch(url);
    if (!res.ok) {
      plugCache.set(code, null);
      return null;
    }
    const json = (await res.json()) as PlugTypesResponse;
    const root = json.data ?? json;
    const rawPlugs = root.plugs ?? [];
    const plugTypes = rawPlugs
      .map((p) => (typeof p === "string" ? p : p.type))
      .filter((t): t is string => typeof t === "string" && t.length > 0);
    const info: PlugInfo = {
      countryCode: code,
      plugTypes,
      voltage: root.voltage != null ? String(root.voltage) : "",
      frequency: root.frequency != null ? String(root.frequency) : "",
    };
    plugCache.set(code, info);
    return info;
  } catch {
    plugCache.set(code, null);
    return null;
  }
}
