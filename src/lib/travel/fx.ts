/**
 * Currency conversion via Frankfurter (ECB data, no key, CORS-enabled).
 * In-memory cache keyed by `${base}->${symbol}` for the lifetime of the page.
 *
 * SSR-safe: pure fetch, no browser globals. Returns null on failure.
 */

interface FrankfurterLatest {
  base: string;
  date: string;
  rates: Record<string, number>;
}

const rateCache = new Map<string, number | null>();

function norm(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * Exchange rate from `from` → `to` (1 unit of `from` in `to`). Null on failure.
 * Same-currency returns 1. Cached in-memory.
 */
export async function rate(from: string, to: string): Promise<number | null> {
  const f = norm(from);
  const t = norm(to);
  if (!f || !t) return null;
  if (f === t) return 1;

  const key = `${f}->${t}`;
  if (rateCache.has(key)) return rateCache.get(key) ?? null;

  try {
    const url = `https://api.frankfurter.dev/v1/latest?base=${f}&symbols=${t}`;
    const res = await fetch(url);
    if (!res.ok) {
      rateCache.set(key, null);
      return null;
    }
    const json = (await res.json()) as FrankfurterLatest;
    const r = json.rates?.[t];
    if (typeof r !== "number") {
      rateCache.set(key, null);
      return null;
    }
    rateCache.set(key, r);
    return r;
  } catch {
    rateCache.set(key, null);
    return null;
  }
}

/**
 * Convert `amount` from `from` → `to`. Null on failure (uses cached `rate`).
 */
export async function convert(
  amount: number,
  from: string,
  to: string,
): Promise<number | null> {
  if (!isFinite(amount)) return null;
  const r = await rate(from, to);
  if (r == null) return null;
  return amount * r;
}
