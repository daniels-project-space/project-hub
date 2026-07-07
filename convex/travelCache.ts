/**
 * Stay-search cache (2026-07-07) — the efficiency backbone. Aggregated results
 * are stored per destination+dates+guests so repeat searches return instantly
 * (stale-while-revalidate) and a cron can pre-warm active trips. Keeps scraping
 * cost and latency off the hot path.
 */
import { v } from "convex/values";
import { internalQuery, internalMutation, query } from "./_generated/server";

export const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — hotel prices are stable enough for planning

export function stayCacheKey(city: string, checkIn: string, checkOut: string, adults: number): string {
  return `${city.trim().toLowerCase()}|${checkIn}|${checkOut}|${Math.max(1, Math.floor(adults || 1))}`;
}

/** Internal read used by the ppHotels action (cache-first). */
export const _getStayCache = internalQuery({
  args: { cacheKey: v.string() },
  handler: async (ctx, { cacheKey }) => {
    const row = await ctx.db
      .query("stayCache")
      .withIndex("by_key", (q) => q.eq("cacheKey", cacheKey))
      .unique()
      .catch(() => null);
    return row ? { options: row.options, fetchedAt: row.fetchedAt, count: row.count } : null;
  },
});

/** Internal upsert after a live fetch. */
export const _putStayCache = internalMutation({
  args: { cacheKey: v.string(), options: v.string(), count: v.number(), now: v.number() },
  handler: async (ctx, { cacheKey, options, count, now }) => {
    const existing = await ctx.db
      .query("stayCache")
      .withIndex("by_key", (q) => q.eq("cacheKey", cacheKey))
      .unique()
      .catch(() => null);
    if (existing) {
      await ctx.db.patch(existing._id, { options, count, fetchedAt: now });
    } else {
      await ctx.db.insert("stayCache", { cacheKey, options, count, fetchedAt: now });
    }
  },
});

/**
 * Public reactive read — the client shows cached results the instant a trip is
 * opened (no action round-trip), then a background refresh tops it up. Returns
 * null on a cold cache so the caller knows to fetch live.
 */
export const getCachedStays = query({
  args: { city: v.string(), checkIn: v.string(), checkOut: v.string(), adults: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const key = stayCacheKey(args.city, args.checkIn, args.checkOut, args.adults ?? 1);
    const row = await ctx.db
      .query("stayCache")
      .withIndex("by_key", (q) => q.eq("cacheKey", key))
      .unique()
      .catch(() => null);
    if (!row) return null;
    let options: unknown[] = [];
    try {
      options = JSON.parse(row.options);
    } catch {
      options = [];
    }
    return { options, fetchedAt: row.fetchedAt, stale: Date.now() - row.fetchedAt > CACHE_TTL_MS };
  },
});
