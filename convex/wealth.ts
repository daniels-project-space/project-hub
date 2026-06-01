/**
 * Wealth / Net Worth — QUERIES + MUTATIONS + internal data helpers (Wave 1).
 *
 * Base currency: GBP. Every asset's `lastValueGBP` is in GBP and carries a
 * `lastPricedAt` so the UI can surface staleness (v1's #1 sin was showing stale
 * numbers as if fresh — we never do that here).
 *
 * NOTE ON FILE SPLIT: the EXTERNAL-API actions (Coinbase/Binance/CoinGecko/FX)
 * live in `convex/wealthActions.ts` ("use node" — required for crypto signing).
 * Convex forbids queries/mutations in a "use node" module, so all DB read/write
 * helpers + the client-facing queries/mutations stay HERE (default runtime).
 *
 * SECURITY: `readSecret` is an internalQuery — secret VALUES are only ever read
 * inside server-side actions (in wealthActions.ts). They never reach the client.
 */

import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";

const GBP = "GBP";

// Tiny balances below this (native units) are ignored to avoid dust rows.
const DUST_EPSILON = 1e-8;

/** Reject non-finite numeric inputs (NaN/Infinity) before they reach the DB. */
function assertFinite(name: string, value: number | undefined): void {
  if (value !== undefined && !Number.isFinite(value)) {
    throw new Error(`Invalid ${name}: must be a finite number`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Server-only secret read (NEVER exposed to client — internalQuery)
// Used by actions in wealthActions.ts via ctx.runQuery(internal.wealth.readSecret).
// ─────────────────────────────────────────────────────────────────────────────

export const readSecret = internalQuery({
  args: { service: v.string(), keyName: v.string() },
  handler: async (ctx, { service, keyName }) => {
    const row = await ctx.db
      .query("secrets")
      .withIndex("by_service_and_key", (q) =>
        q.eq("service", service).eq("keyName", keyName),
      )
      .first();
    return row?.value ?? null;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Internal data helpers (called from the node actions)
// ─────────────────────────────────────────────────────────────────────────────

export const _allAssets = internalQuery({
  args: {},
  handler: async (ctx) => ctx.db.query("assets").collect(),
});

// Upsert an auto-sourced asset keyed by (category, label, source:"auto").
// Resilient: if newValueGBP is null/undefined we KEEP the previous value +
// previous lastPricedAt (never clobber a good number with nothing).
export const _upsertAutoAsset = internalMutation({
  args: {
    category: v.string(),
    label: v.string(),
    currency: v.string(),
    quantity: v.optional(v.number()),
    balanceNative: v.optional(v.number()),
    externalRef: v.optional(v.string()),
    newValueGBP: v.optional(v.number()),
    pricedAt: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    const existing = (
      await ctx.db
        .query("assets")
        .withIndex("by_category", (q) => q.eq("category", a.category as any))
        .collect()
    ).find((r) => r.label === a.label && r.source === "auto");

    const hasFresh = a.newValueGBP !== undefined && a.newValueGBP !== null;
    const patch: Record<string, unknown> = {
      category: a.category,
      label: a.label,
      source: "auto",
      currency: a.currency,
      quantity: a.quantity,
      balanceNative: a.balanceNative,
      externalRef: a.externalRef,
    };
    if (hasFresh) {
      patch.lastValueGBP = a.newValueGBP;
      patch.lastPricedAt = a.pricedAt ?? Date.now();
    }

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("assets", {
      category: a.category as any,
      label: a.label,
      source: "auto",
      currency: a.currency,
      quantity: a.quantity,
      balanceNative: a.balanceNative,
      externalRef: a.externalRef,
      lastValueGBP: hasFresh ? a.newValueGBP : undefined,
      lastPricedAt: hasFresh ? (a.pricedAt ?? Date.now()) : undefined,
    });
  },
});

export const _setAssetValue = internalMutation({
  args: { id: v.id("assets"), valueGBP: v.number(), pricedAt: v.number() },
  handler: async (ctx, { id, valueGBP, pricedAt }) => {
    await ctx.db.patch(id, { lastValueGBP: valueGBP, lastPricedAt: pricedAt });
  },
});

export const _writePrice = internalMutation({
  args: { symbol: v.string(), gbp: v.number(), ts: v.number() },
  handler: async (ctx, { symbol, gbp: price, ts }) => {
    const existing = await ctx.db
      .query("priceCache")
      .withIndex("by_symbol", (q) => q.eq("symbol", symbol))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { gbp: price, ts });
    } else {
      await ctx.db.insert("priceCache", { symbol, gbp: price, ts });
    }
  },
});

// Record one net-worth snapshot from whatever last-known values exist.
export const _recordSnapshot = internalMutation({
  args: {},
  handler: async (ctx) => {
    const assets = await ctx.db.query("assets").collect();
    const byCategory: Record<string, number> = {};
    let total = 0;
    for (const a of assets) {
      const val = a.lastValueGBP ?? 0;
      byCategory[a.category] = (byCategory[a.category] ?? 0) + val;
      total += val;
    }
    await ctx.db.insert("netWorthSnapshots", {
      ts: Date.now(),
      totalGBP: total,
      byCategory,
    });
    return { totalGBP: total };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// QUERIES (client-facing — no secrets touched)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * getWealth — assets grouped by category + per-category + total GBP, each asset
 * carrying lastPricedAt so the UI can show staleness.
 */
export const getWealth = query({
  args: {},
  handler: async (ctx) => {
    const assets = await ctx.db.query("assets").collect();
    const byCategory: Record<string, { total: number; assets: any[] }> = {};
    let total = 0;
    let oldestPricedAt: number | null = null;
    for (const a of assets) {
      const cat = a.category;
      byCategory[cat] ??= { total: 0, assets: [] };
      const val = a.lastValueGBP ?? 0;
      byCategory[cat].total += val;
      byCategory[cat].assets.push({
        _id: a._id,
        label: a.label,
        category: a.category,
        source: a.source,
        quantity: a.quantity,
        balanceNative: a.balanceNative,
        currency: a.currency,
        externalRef: a.externalRef,
        lastValueGBP: a.lastValueGBP ?? null,
        lastPricedAt: a.lastPricedAt ?? null,
      });
      total += val;
      if (a.lastPricedAt != null) {
        oldestPricedAt =
          oldestPricedAt === null
            ? a.lastPricedAt
            : Math.min(oldestPricedAt, a.lastPricedAt);
      }
    }
    return { totalGBP: total, byCategory, oldestPricedAt, assetCount: assets.length };
  },
});

/** getLivePrices — key holdings + spot from priceCache (live-prices card). */
export const getLivePrices = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("priceCache").collect();
    return rows
      .map((r) => ({ symbol: r.symbol, gbp: r.gbp, ts: r.ts }))
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
  },
});

/**
 * getHistory — net-worth snapshots within a range for the chart.
 * range: "1W" | "1M" | "3M" | "1Y" (defaults to 1M).
 */
export const getHistory = query({
  args: { range: v.optional(v.string()) },
  handler: async (ctx, { range }) => {
    const now = Date.now();
    const day = 86_400_000;
    const windows: Record<string, number> = {
      "1W": 7 * day,
      "1M": 30 * day,
      "3M": 90 * day,
      "1Y": 365 * day,
    };
    const span = windows[range ?? "1M"] ?? windows["1M"];
    const since = now - span;
    const rows = await ctx.db
      .query("netWorthSnapshots")
      .withIndex("by_ts", (q) => q.gte("ts", since))
      .order("asc")
      .collect();
    return rows.map((r) => ({
      ts: r.ts,
      totalGBP: r.totalGBP,
      byCategory: r.byCategory,
    }));
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// MANUAL ASSET MUTATIONS (client-facing)
// ─────────────────────────────────────────────────────────────────────────────

export const upsertAsset = mutation({
  args: {
    id: v.optional(v.id("assets")),
    category: v.union(
      v.literal("crypto"),
      v.literal("stocks"),
      v.literal("gold"),
      v.literal("cash"),
      v.literal("property"),
      v.literal("inventory"),
    ),
    label: v.string(),
    quantity: v.optional(v.number()),
    balanceNative: v.optional(v.number()),
    currency: v.optional(v.string()),
    externalRef: v.optional(v.string()),
    // Direct GBP value for property/inventory/cash entered straight as GBP.
    lastValueGBP: v.optional(v.number()),
    ownerId: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    assertFinite("quantity", a.quantity);
    assertFinite("balanceNative", a.balanceNative);
    assertFinite("lastValueGBP", a.lastValueGBP);
    const base = {
      category: a.category,
      label: a.label,
      source: "manual" as const,
      quantity: a.quantity,
      balanceNative: a.balanceNative,
      currency: a.currency ?? GBP,
      externalRef: a.externalRef,
      ownerId: a.ownerId,
    };
    if (a.id) {
      const patch: Record<string, unknown> = { ...base };
      if (a.lastValueGBP !== undefined) {
        patch.lastValueGBP = a.lastValueGBP;
        patch.lastPricedAt = Date.now();
      }
      await ctx.db.patch(a.id, patch);
      return a.id;
    }
    return await ctx.db.insert("assets", {
      ...base,
      lastValueGBP: a.lastValueGBP,
      lastPricedAt: a.lastValueGBP !== undefined ? Date.now() : undefined,
    });
  },
});

export const removeAsset = mutation({
  args: { id: v.id("assets"), ownerId: v.optional(v.string()) },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
    return id;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// SNAPSHOT IMPORT (client-facing) — backfill net-worth history at explicit
// past timestamps. `_recordSnapshot` only ever stamps "now"; these let a one-off
// migration insert historical rows so getHistory has a real trajectory to draw.
// Used by the v1→v2 finance data migration (Phase 11).
// ─────────────────────────────────────────────────────────────────────────────

export const importSnapshot = mutation({
  args: {
    ts: v.number(),
    totalGBP: v.number(),
    byCategory: v.optional(v.any()),
    ownerId: v.optional(v.string()),
  },
  handler: async (ctx, { ts, totalGBP, byCategory, ownerId }) => {
    assertFinite("ts", ts);
    assertFinite("totalGBP", totalGBP);
    return await ctx.db.insert("netWorthSnapshots", {
      ts,
      totalGBP,
      byCategory: byCategory ?? {},
      ownerId,
    });
  },
});

export const importSnapshots = mutation({
  args: {
    rows: v.array(
      v.object({
        ts: v.number(),
        totalGBP: v.number(),
        byCategory: v.optional(v.any()),
      }),
    ),
    ownerId: v.optional(v.string()),
  },
  handler: async (ctx, { rows, ownerId }) => {
    const ids = [];
    for (const r of rows) {
      assertFinite("ts", r.ts);
      assertFinite("totalGBP", r.totalGBP);
      ids.push(
        await ctx.db.insert("netWorthSnapshots", {
          ts: r.ts,
          totalGBP: r.totalGBP,
          byCategory: r.byCategory ?? {},
          ownerId,
        }),
      );
    }
    return { inserted: ids.length };
  },
});

// Re-exported constants for the action module (kept in sync via import there).
export const _const = { GBP, DUST_EPSILON };
