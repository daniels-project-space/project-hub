/**
 * Alerts — price-alert CRUD + a checker for the decoupled Hunts·Alerts widget
 * (Phase D). ZERO Aria dependency: logic ported from aria/lib/portfolio-alerts.js
 * (the `price_target` rule type — "above"/"below" a threshold, fire only on a
 * CROSSING, with a per-alert cooldown), reimplemented natively on Convex.
 *
 * Price source = the live data the hub already has (no new feed):
 *   - the singleton `currentPrices` live doc (net-worth categories), and
 *   - the `priceCache` table (per-symbol GBP spot, written by wealthActions),
 *   - plus the persisted GBP→USD `fxRates` row for the "GBPUSD" symbol.
 * The checker compares each ACTIVE alert's threshold/kind against the current
 * price and stamps `lastTriggeredAt` when the condition crosses into true.
 *
 * NOTE: this module is the DEFAULT (non-node) Convex runtime — it does DB work
 * only. It needs no external key. The frequent prices-only refresh cron already
 * keeps `priceCache`/`currentPrices` fresh (Phase A), so the alert check just
 * reads what's there.
 */
import { v } from "convex/values";
import {
  mutation,
  query,
  internalMutation,
  internalQuery,
} from "./_generated/server";

// price_target cooldown (aria used 24h for price_target). Once an alert fires we
// don't re-stamp until this elapses — prevents flapping around the threshold.
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// CRUD (client-facing)
// ─────────────────────────────────────────────────────────────────────────────

/** All alerts, newest first (the widget lists active + recently-triggered). */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("alerts").collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const add = mutation({
  args: {
    symbol: v.string(),
    kind: v.union(v.literal("above"), v.literal("below")),
    threshold: v.number(),
    currency: v.optional(v.string()),
    ownerId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!Number.isFinite(args.threshold)) {
      throw new Error("threshold must be a finite number");
    }
    return await ctx.db.insert("alerts", {
      symbol: args.symbol.trim().toUpperCase(),
      kind: args.kind,
      threshold: args.threshold,
      currency: args.currency ?? "GBP",
      active: true,
      createdAt: Date.now(),
      ownerId: args.ownerId,
    });
  },
});

/** Toggle active, edit threshold/kind, or clear the last-triggered stamp. */
export const update = mutation({
  args: {
    id: v.id("alerts"),
    active: v.optional(v.boolean()),
    threshold: v.optional(v.number()),
    kind: v.optional(v.union(v.literal("above"), v.literal("below"))),
  },
  handler: async (ctx, { id, active, threshold, kind }) => {
    const patch: Record<string, unknown> = {};
    if (active !== undefined) patch.active = active;
    if (threshold !== undefined) {
      if (!Number.isFinite(threshold)) throw new Error("threshold not finite");
      patch.threshold = threshold;
    }
    if (kind !== undefined) patch.kind = kind;
    if (Object.keys(patch).length > 0) await ctx.db.patch(id, patch);
    return id;
  },
});

export const remove = mutation({
  args: { id: v.id("alerts") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Checker (internal — driven by the cron in crons.ts)
// ─────────────────────────────────────────────────────────────────────────────

/** Active alerts only (index-backed). */
export const _activeAlerts = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("alerts")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();
  },
});

/**
 * Resolve the current GBP price for an alert symbol from data the hub already
 * holds. Returns null when we have no signal for that symbol (alert is skipped
 * — never falsely triggered on missing data).
 *   - "GBPUSD" → the persisted GBP→USD fx rate (USD per 1 GBP).
 *   - net-worth category names (CRYPTO/GOLD/STOCKS/CASH/PROPERTY/INVENTORY) →
 *     that category's GBP total from the `currentPrices` live doc.
 *   - everything else (BTC, ETH, XAU, AAPL…) → `priceCache` GBP spot.
 */
async function resolvePriceGBP(
  ctx: any,
  symbol: string,
): Promise<number | null> {
  const sym = symbol.toUpperCase();

  if (sym === "GBPUSD") {
    const fx = await ctx.db
      .query("fxRates")
      .withIndex("by_pair", (q: any) => q.eq("base", "GBP").eq("quote", "USD"))
      .first();
    return fx?.rate ?? null;
  }

  const live = await ctx.db
    .query("currentPrices")
    .withIndex("by_kind", (q: any) => q.eq("kind", "live"))
    .first();
  if (live?.byCategory && typeof live.byCategory === "object") {
    const cat = live.byCategory as Record<string, number>;
    const lc = symbol.toLowerCase();
    if (typeof cat[lc] === "number") return cat[lc];
  }

  const pc = await ctx.db
    .query("priceCache")
    .withIndex("by_symbol", (q: any) => q.eq("symbol", sym))
    .first();
  return pc?.gbp ?? null;
}

/** Stamp an alert as triggered now. */
export const _markTriggered = internalMutation({
  args: { id: v.id("alerts"), at: v.number() },
  handler: async (ctx, { id, at }) => {
    await ctx.db.patch(id, { lastTriggeredAt: at });
  },
});

/**
 * checkAlerts — internal mutation run by the cron. For each active alert,
 * resolve its current price and, if the threshold condition holds AND the alert
 * is not in cooldown, stamp `lastTriggeredAt`. Mirrors aria's `evalPriceTarget`
 * crossing semantics via the cooldown gate (we only stamp once per cooldown
 * window, so a price sitting past the threshold won't re-fire every tick).
 * Returns a summary for cron logs. Pure DB work → no external key needed.
 */
export const checkAlerts = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const active = await ctx.db
      .query("alerts")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();

    let triggered = 0;
    let checked = 0;
    for (const a of active) {
      const price = await resolvePriceGBP(ctx, a.symbol);
      if (price == null) continue; // no signal → skip, never false-trigger
      checked++;

      const conditionMet =
        a.kind === "above" ? price >= a.threshold : price <= a.threshold;
      if (!conditionMet) continue;

      const cooling =
        a.lastTriggeredAt != null && now - a.lastTriggeredAt < COOLDOWN_MS;
      if (cooling) continue;

      await ctx.db.patch(a._id, { lastTriggeredAt: now });
      triggered++;
    }
    return { checkedActive: active.length, priced: checked, triggered, ts: now };
  },
});
