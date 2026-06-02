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

import { ConvexError, v } from "convex/values";
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

// ─── Phase 16 · MARGIN POSITIONS (Binance isolated/cross/USDⓂ/COINⓂ) ──────────
// Net equity of all margin/futures positions, rolled into the headline net worth
// as a synthetic "margin" category (v1 behaviour). Helper used by the snapshot +
// live-doc mutations and the getWealth query so live total AND history agree.
async function marginNetEquityGbp(ctx: any): Promise<number> {
  const rows = await ctx.db.query("marginPositions").collect();
  let sum = 0;
  for (const p of rows) sum += p.netEquityGbp ?? 0;
  return sum;
}

// ─── Phase 19 · BINANCE DISPLAY-CATEGORY SPLIT (server-side) ─────────────────
// Binance SPOT holdings live inside the `crypto` category (an asset row whose
// externalRef/label matches "binance"). The UI shows Binance as its OWN tile
// (spot + margin net equity) and the Crypto tile EXCLUDING binance spot.
// Historically this split was done client-side, so snapshots had no `binance`
// key → the per-tile history series + delta were bogus. We now compute the
// binance-spot total HERE and stamp a real `binance` display-category into every
// byCategory builder so snapshots persist a genuine series going forward.
//
// IMPORTANT: this is DISPLAY-ONLY. The net-worth `total` sums assets directly
// (binance spot is already part of an asset's lastValueGBP) + margin (once) +
// cashflow; it is NEVER derived from byCategory. Reshaping byCategory below does
// not change `total`. Rule replicated verbatim from the old client `cryptoSplit`
// (wealth-widget.tsx): externalRef or label contains "binance" (case-insensitive),
// scoped to rows in the `crypto` category.
function binanceSpotFromAssets(
  assets: { category?: string; externalRef?: string | null; label?: string | null; lastValueGBP?: number | null }[],
): number {
  let spot = 0;
  for (const a of assets) {
    if (a.category !== "crypto") continue;
    const ref = (a.externalRef ?? "").toLowerCase();
    const lbl = (a.label ?? "").toLowerCase();
    if (ref.includes("binance") || lbl.includes("binance")) {
      spot += a.lastValueGBP ?? 0;
    }
  }
  return spot;
}

// ─── CASHFLOW ADJUSTMENT (v1 parity) ─────────────────────────────────────────
// Net worth folds in confirmed rental revenue (a credit) minus the portion of
// monthly expenses ACCRUED so far this month (a debit), matching v1's
// hub-main.js:733-754. Expenses accrue linearly across the ACTUAL days in the
// current month: accrued = monthlyTotal × (dayOfMonth / daysInMonth), where
// daysInMonth = new Date(y, m+1, 0).getDate(). Used by the snapshot + live-doc
// mutations and the getWealth query so the live total, daily history, and the
// read path all agree. One `new Date()` per call.
async function computeCashflowAdjustment(ctx: any): Promise<{
  confirmedRentalGbp: number;
  expensesMonthlyGbp: number;
  expensesAccruedGbp: number;
  dayOfMonth: number;
  daysInMonth: number;
  netCashflowGbp: number;
}> {
  // Confirmed rental revenue: RMv2 NET confirmed.month_revenue singleton.
  const rentalRow = await ctx.db
    .query("rentalRevenue")
    .withIndex("by_source", (q: any) => q.eq("source", "rmv2"))
    .first();
  const confirmedRentalGbp = rentalRow?.monthRevenueGbp ?? 0;

  // Monthly expenses total (sum of all expense rows' amountGBP).
  const expenseRows = await ctx.db.query("expenses").collect();
  let expensesMonthlyGbp = 0;
  for (const e of expenseRows) expensesMonthlyGbp += e.amountGBP ?? 0;

  // Accrue expenses by days elapsed over ACTUAL days in the current month.
  const now = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
  ).getDate();
  const expensesAccruedGbp = expensesMonthlyGbp * (dayOfMonth / daysInMonth);

  const netCashflowGbp = confirmedRentalGbp - expensesAccruedGbp;
  return {
    confirmedRentalGbp,
    expensesMonthlyGbp,
    expensesAccruedGbp,
    dayOfMonth,
    daysInMonth,
    netCashflowGbp,
  };
}

// Wholesale replace all margin positions for an exchange (delete-then-insert) so
// closed positions never linger. Called by the READ-ONLY refreshMargin action.
export const _replaceMarginPositions = internalMutation({
  args: {
    exchange: v.string(),
    positions: v.array(
      v.object({
        market: v.string(),
        symbol: v.string(),
        base: v.optional(v.string()),
        quote: v.optional(v.string()),
        side: v.string(),
        size: v.number(),
        entryPrice: v.number(),
        markPrice: v.number(),
        leverage: v.optional(v.number()),
        uPnlUsd: v.number(),
        uPnlGbp: v.number(),
        marginLevel: v.optional(v.number()),
        liqPrice: v.optional(v.number()),
        netEquityGbp: v.number(),
      }),
    ),
  },
  handler: async (ctx, { exchange, positions }) => {
    const existing = await ctx.db
      .query("marginPositions")
      .withIndex("by_exchange", (q) => q.eq("exchange", exchange))
      .collect();
    for (const r of existing) await ctx.db.delete(r._id);
    const now = Date.now();
    for (const p of positions) {
      await ctx.db.insert("marginPositions", {
        exchange,
        source: "auto",
        updatedAt: now,
        ...p,
      });
    }
    return { count: positions.length };
  },
});

// ─── Phase 17 · MANUAL margin-position CRUD (client-facing) ───────────────────
// Binance is geo-blocked (HTTP 451) from Convex, so margin/futures positions are
// now entered BY HAND (like the manual Stocks line) instead of auto-fetched.
// These three mutations let the tracker tile add / edit / delete positions over
// the existing `marginPositions` table. Net equity rolls into net worth exactly
// as before (synthetic "margin" category in getWealth/_recordLive/_recordSnapshot)
// — no double-counting, no fetch.
//
// uPnL derivation: when size + entryPrice + markPrice are all provided, uPnL is
// DERIVED — (mark − entry) × size for a long, (entry − mark) × size for a short
// (USD-ish, since these markets quote in USDT≈USD). The caller may instead pass
// uPnlUsd explicitly (e.g. coin-margined positions). uPnlGbp = uPnlUsd × usdToGbp.
// netEquityGbp (the figure that rolls into NW) is taken as given (manual), or 0.
function deriveMarginPnl(args: {
  side: string;
  size?: number;
  entryPrice?: number;
  markPrice?: number;
  uPnlUsd?: number;
  usdToGbp: number;
}): { uPnlUsd: number; uPnlGbp: number } {
  const { side, size, entryPrice, markPrice, uPnlUsd, usdToGbp } = args;
  let pnlUsd: number;
  if (typeof uPnlUsd === "number" && Number.isFinite(uPnlUsd)) {
    pnlUsd = uPnlUsd;
  } else if (
    typeof size === "number" &&
    typeof entryPrice === "number" &&
    typeof markPrice === "number" &&
    Number.isFinite(size) &&
    Number.isFinite(entryPrice) &&
    Number.isFinite(markPrice)
  ) {
    const dir = side === "short" ? -1 : 1;
    pnlUsd = dir * (markPrice - entryPrice) * Math.abs(size);
  } else {
    pnlUsd = 0;
  }
  return { uPnlUsd: pnlUsd, uPnlGbp: pnlUsd * usdToGbp };
}

// GBP per 1 USD from the persisted fxRates row (GBP→USD rate, inverted). Falls
// back to ~0.79 only if FX was never fetched (keeps £/$ derivation sane offline).
async function usdToGbpRate(ctx: any): Promise<number> {
  const fx = await ctx.db
    .query("fxRates")
    .withIndex("by_pair", (q: any) => q.eq("base", "GBP").eq("quote", "USD"))
    .first();
  const usdPerGbp = fx?.rate;
  return typeof usdPerGbp === "number" && usdPerGbp > 0 ? 1 / usdPerGbp : 0.79;
}

export const addMarginPosition = mutation({
  args: {
    exchange: v.optional(v.string()), // default "Binance"
    market: v.string(), // isolated | cross | usdm | coinm
    symbol: v.string(),
    side: v.string(), // long | short
    size: v.optional(v.number()),
    entryPrice: v.optional(v.number()),
    markPrice: v.optional(v.number()),
    leverage: v.optional(v.number()),
    liqPrice: v.optional(v.number()),
    netEquityGbp: v.optional(v.number()),
    uPnlUsd: v.optional(v.number()),
    ownerId: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    assertFinite("size", a.size);
    assertFinite("entryPrice", a.entryPrice);
    assertFinite("markPrice", a.markPrice);
    assertFinite("leverage", a.leverage);
    assertFinite("liqPrice", a.liqPrice);
    assertFinite("netEquityGbp", a.netEquityGbp);
    assertFinite("uPnlUsd", a.uPnlUsd);
    if (!a.symbol.trim()) throw new Error("symbol is required");
    const usdToGbp = await usdToGbpRate(ctx);
    const { uPnlUsd, uPnlGbp } = deriveMarginPnl({
      side: a.side,
      size: a.size,
      entryPrice: a.entryPrice,
      markPrice: a.markPrice,
      uPnlUsd: a.uPnlUsd,
      usdToGbp,
    });
    const id = await ctx.db.insert("marginPositions", {
      exchange: (a.exchange ?? "Binance").trim() || "Binance",
      market: a.market,
      symbol: a.symbol.trim(),
      side: a.side === "short" ? "short" : "long",
      size: a.size ?? 0,
      entryPrice: a.entryPrice ?? 0,
      markPrice: a.markPrice ?? 0,
      leverage: a.leverage,
      liqPrice: a.liqPrice,
      uPnlUsd,
      uPnlGbp,
      netEquityGbp: a.netEquityGbp ?? 0,
      source: "manual",
      updatedAt: Date.now(),
    });
    // Margin net equity rolls into NW via the synthetic "margin" category — the
    // Binance tile PREFERS the live doc's margin total, so refresh it now.
    await recomputeLiveDoc(ctx);
    return id;
  },
});

export const updateMarginPosition = mutation({
  args: {
    id: v.id("marginPositions"),
    exchange: v.optional(v.string()),
    market: v.optional(v.string()),
    symbol: v.optional(v.string()),
    side: v.optional(v.string()),
    size: v.optional(v.number()),
    entryPrice: v.optional(v.number()),
    markPrice: v.optional(v.number()),
    leverage: v.optional(v.number()),
    liqPrice: v.optional(v.number()),
    netEquityGbp: v.optional(v.number()),
    uPnlUsd: v.optional(v.number()),
    ownerId: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const existing = await ctx.db.get(a.id);
    if (!existing) throw new Error("margin position not found");
    assertFinite("size", a.size);
    assertFinite("entryPrice", a.entryPrice);
    assertFinite("markPrice", a.markPrice);
    assertFinite("leverage", a.leverage);
    assertFinite("liqPrice", a.liqPrice);
    assertFinite("netEquityGbp", a.netEquityGbp);
    assertFinite("uPnlUsd", a.uPnlUsd);
    const side =
      a.side !== undefined ? (a.side === "short" ? "short" : "long") : existing.side;
    const size = a.size ?? existing.size;
    const entryPrice = a.entryPrice ?? existing.entryPrice;
    const markPrice = a.markPrice ?? existing.markPrice;
    const usdToGbp = await usdToGbpRate(ctx);
    // Re-derive uPnL from the resolved fields unless an explicit uPnlUsd was given.
    const { uPnlUsd, uPnlGbp } = deriveMarginPnl({
      side,
      size,
      entryPrice,
      markPrice,
      uPnlUsd: a.uPnlUsd,
      usdToGbp,
    });
    const patch: Record<string, unknown> = {
      side,
      size,
      entryPrice,
      markPrice,
      uPnlUsd,
      uPnlGbp,
      updatedAt: Date.now(),
    };
    if (a.exchange !== undefined)
      patch.exchange = a.exchange.trim() || "Binance";
    if (a.market !== undefined) patch.market = a.market;
    if (a.symbol !== undefined) patch.symbol = a.symbol.trim();
    if (a.leverage !== undefined) patch.leverage = a.leverage;
    if (a.liqPrice !== undefined) patch.liqPrice = a.liqPrice;
    if (a.netEquityGbp !== undefined) patch.netEquityGbp = a.netEquityGbp;
    await ctx.db.patch(a.id, patch);
    // Refresh the live doc so the Binance tile's margin total + headline update now.
    await recomputeLiveDoc(ctx);
    return a.id;
  },
});

export const removeMarginPosition = mutation({
  args: { id: v.id("marginPositions"), ownerId: v.optional(v.string()) },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
    // Refresh the live doc so the Binance tile's margin total + headline update now.
    await recomputeLiveDoc(ctx);
    return id;
  },
});

// Latest cached rental revenue figure → singleton per source.
export const _setRentalRevenue = internalMutation({
  args: {
    source: v.string(),
    monthRevenueGbp: v.number(),
    monthLabel: v.string(),
    targetGbp: v.optional(v.number()),
  },
  handler: async (ctx, { source, monthRevenueGbp, monthLabel, targetGbp }) => {
    assertFinite("monthRevenueGbp", monthRevenueGbp);
    const existing = await ctx.db
      .query("rentalRevenue")
      .withIndex("by_source", (q) => q.eq("source", source))
      .first();
    const doc = {
      source,
      monthRevenueGbp,
      monthLabel,
      fetchedAt: Date.now(),
      ...(targetGbp !== undefined ? { targetGbp } : {}),
    };
    if (existing) {
      await ctx.db.patch(existing._id, doc);
    } else {
      await ctx.db.insert("rentalRevenue", doc);
    }
    return { monthRevenueGbp, monthLabel };
  },
});

// Record one net-worth snapshot from whatever last-known values exist.
// Phase 16: margin net equity rolls in as a synthetic "margin" category so the
// daily history reflects it exactly like the live total.
export const _recordSnapshot = internalMutation({
  args: { usdPerGbp: v.optional(v.number()) },
  handler: async (ctx, { usdPerGbp }) => {
    const assets = await ctx.db.query("assets").collect();
    const byCategory: Record<string, number> = {};
    let total = 0;
    for (const a of assets) {
      const val = a.lastValueGBP ?? 0;
      byCategory[a.category] = (byCategory[a.category] ?? 0) + val;
      total += val;
    }
    const marginGbp = await marginNetEquityGbp(ctx);
    if (marginGbp !== 0) {
      byCategory["margin"] = (byCategory["margin"] ?? 0) + marginGbp;
      total += marginGbp;
    }
    // Phase 19: DISPLAY-only binance split (does NOT touch `total`). Carve the
    // Binance SPOT total out of `crypto` and stamp a real `binance` category =
    // spot + margin net equity, so future history snapshots carry a genuine
    // per-tile series. `crypto` is reduced by the spot so the tiles don't
    // double-count. `margin` is left intact (still summed into total once above).
    const binanceSpotGbp = binanceSpotFromAssets(assets);
    if (binanceSpotGbp !== 0 || marginGbp !== 0) {
      byCategory["binance"] = binanceSpotGbp + marginGbp;
      byCategory["crypto"] = (byCategory["crypto"] ?? 0) - binanceSpotGbp;
    }
    // Fold confirmed rental revenue − accrued expenses into the headline (v1).
    const cashflow = await computeCashflowAdjustment(ctx);
    total += cashflow.netCashflowGbp;
    await ctx.db.insert("netWorthSnapshots", {
      ts: Date.now(),
      totalGBP: total,
      byCategory,
      ...(usdPerGbp !== undefined ? { usdPerGbp } : {}),
    });
    return { totalGBP: total };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// QUERIES (client-facing — no secrets touched)
// ─────────────────────────────────────────────────────────────────────────────

export const _upsertFxRate = internalMutation({
  args: {
    base: v.string(),
    quote: v.string(),
    rate: v.number(),
    fetchedAt: v.number(),
  },
  handler: async (ctx, { base, quote, rate, fetchedAt }) => {
    assertFinite("fxRate", rate);
    const existing = await ctx.db
      .query("fxRates")
      .withIndex("by_pair", (q) => q.eq("base", base).eq("quote", quote))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { rate, fetchedAt });
    } else {
      await ctx.db.insert("fxRates", { base, quote, rate, fetchedAt });
    }
  },
})

// ─── SHARED LIVE-DOC RECOMPUTE (single source of truth) ──────────────────────
// Rebuilds the singleton live (intraday) `currentPrices` doc from whatever values
// currently live in the DB: Σ assets `lastValueGBP` + Binance margin net equity
// (synthetic "margin" category) + net cashflow (confirmed rental − accrued
// expenses). Mirrors the daily snapshot / getWealth math EXACTLY so the live
// total, the daily history, and the read path all agree.
//
// CRITICAL (the manual-edit bug): the live doc is what the widget PREFERS for the
// headline (`currentTotalGBP`) and per-tile values (`live.byCategory`). Manual
// edits only patch `assets.lastValueGBP`, which updates getWealth's FRESH
// `byCategory`/`totalGBP` — but UNLESS the live doc is recomputed too, the
// PREFERRED live values stay stale (up to 30 min, until refreshLive runs) and the
// edit appears to do nothing. So every mutation that changes an asset/margin value
// MUST call this helper.
//
// Pure DB work — no external prices/FX needed (FX is read from the persisted
// fxRates row), so it is safe to run inside a mutation context. `usdPerGbp`:
// when an explicit value is passed (cron with a fresh quote) it wins; otherwise we
// PRESERVE the existing live doc's rate (then fall back to the fxRates row) so a
// manual edit never wipes the dual-currency display.
async function recomputeLiveDoc(
  ctx: any,
  opts?: { usdPerGbp?: number; ts?: number },
): Promise<{ totalGBP: number; usdPerGbp: number | null }> {
  const assets = await ctx.db.query("assets").collect();
  const byCategory: Record<string, number> = {};
  let total = 0;
  for (const a of assets) {
    const val = a.lastValueGBP ?? 0;
    byCategory[a.category] = (byCategory[a.category] ?? 0) + val;
    total += val;
  }
  // Phase 16: roll Binance margin net equity into the live total + a synthetic
  // "margin" category (matches the daily snapshot + getWealth).
  const marginGbp = await marginNetEquityGbp(ctx);
  if (marginGbp !== 0) {
    byCategory["margin"] = (byCategory["margin"] ?? 0) + marginGbp;
    total += marginGbp;
  }
  // Phase 19: DISPLAY-only binance split (does NOT touch `total`). See
  // binanceSpotFromAssets — carve Binance SPOT out of crypto and expose a real
  // `binance` category = spot + margin net equity for live tiles + go-forward
  // history. crypto is net of spot; margin key + total are unchanged.
  const binanceSpotGbp = binanceSpotFromAssets(assets);
  if (binanceSpotGbp !== 0 || marginGbp !== 0) {
    byCategory["binance"] = binanceSpotGbp + marginGbp;
    byCategory["crypto"] = (byCategory["crypto"] ?? 0) - binanceSpotGbp;
  }
  // Fold confirmed rental revenue − accrued expenses into the live total (v1).
  const cashflow = await computeCashflowAdjustment(ctx);
  total += cashflow.netCashflowGbp;

  const ts = opts?.ts ?? Date.now();
  const existing = await ctx.db
    .query("currentPrices")
    .withIndex("by_kind", (q: any) => q.eq("kind", "live"))
    .first();
  // Resolve the dual-currency rate: explicit > existing live doc > persisted FX.
  let usdPerGbp: number | null =
    opts?.usdPerGbp !== undefined ? opts.usdPerGbp : (existing?.usdPerGbp ?? null);
  if (usdPerGbp == null) {
    const fx = await ctx.db
      .query("fxRates")
      .withIndex("by_pair", (q: any) => q.eq("base", "GBP").eq("quote", "USD"))
      .first();
    usdPerGbp = fx?.rate ?? null;
  }
  const doc = {
    kind: "live",
    totalGBP: total,
    byCategory,
    ts,
    ...(usdPerGbp != null ? { usdPerGbp } : {}),
  };
  if (existing) {
    await ctx.db.patch(existing._id, doc);
  } else {
    await ctx.db.insert("currentPrices", doc);
  }
  return { totalGBP: total, usdPerGbp };
}

// Upsert the singleton live (intraday) net-worth doc. Written by the frequent
// prices-only refresh cron (NOT a history row). Mirrors the daily snapshot's
// byCategory shape so the frontend can reuse it for fresh tiles. Thin wrapper
// over the shared `recomputeLiveDoc` so the cron and the manual mutations stay
// in lock-step.
export const _recordLive = internalMutation({
  args: { usdPerGbp: v.optional(v.number()) },
  handler: async (ctx, { usdPerGbp }) => {
    return await recomputeLiveDoc(ctx, { usdPerGbp });
  },
})

// Latest persisted GBP→USD rate (USD per 1 GBP), or null if never fetched.
export const getFxRate = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("fxRates")
      .withIndex("by_pair", (q) => q.eq("base", "GBP").eq("quote", "USD"))
      .first();
    return row ? { usdPerGbp: row.rate, fetchedAt: row.fetchedAt } : null;
  },
})

/**
 * getWealth — assets grouped by category + per-category + total GBP, each asset
 * carrying lastPricedAt so the UI can show staleness. Phase A additive fields:
 * `usdPerGbp` (persisted FX), `live` (intraday total), `currentTotalGBP`.
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
    // Phase 16: roll Binance margin NET EQUITY into the headline as a synthetic
    // "margin" category (v1 behaviour) so the breakdown total == live/snapshot.
    const marginRows = await ctx.db.query("marginPositions").collect();
    const marginTiles: any[] = [];
    let marginEquity = 0;
    if (marginRows.length > 0) {
      let marginOldest: number | null = null;
      for (const p of marginRows) {
        marginEquity += p.netEquityGbp ?? 0;
        marginOldest =
          marginOldest === null
            ? p.updatedAt
            : Math.min(marginOldest, p.updatedAt);
        marginTiles.push({
          _id: p._id,
          label: p.symbol,
          category: "margin",
          source: p.source,
          currency: "GBP",
          externalRef: `${p.exchange}:${p.market}`,
          lastValueGBP: p.netEquityGbp ?? 0,
          lastPricedAt: p.updatedAt,
        });
      }
      byCategory["margin"] = { total: marginEquity, assets: marginTiles };
      total += marginEquity;
      if (marginOldest != null) {
        oldestPricedAt =
          oldestPricedAt === null
            ? marginOldest
            : Math.min(oldestPricedAt, marginOldest);
      }
    }
    // Phase 19: DISPLAY-only binance split (does NOT touch `total`, which already
    // summed binance spot via its crypto asset row + margin once above). Carve
    // the Binance SPOT total out of `crypto` and expose a real `binance` display
    // category = spot + margin net equity. The `binance` bucket carries the
    // matching crypto SPOT asset rows (so the inline edit pencil for the manual
    // Binance row still resolves) plus the margin tiles; `crypto` keeps its rows
    // but its total is reduced by spot so the tiles don't double-count.
    const binanceSpotGbp = binanceSpotFromAssets(assets);
    // Only emit the display split when binance content actually exists (a spot
    // row or margin equity); otherwise leave byCategory untouched so an empty DB
    // stays `{}` and a binance-free portfolio keeps its full crypto total.
    if (binanceSpotGbp !== 0 || marginEquity !== 0) {
      const cryptoBucket = byCategory["crypto"];
      const binanceSpotRows =
        cryptoBucket?.assets.filter((a: any) => {
          const ref = (a.externalRef ?? "").toLowerCase();
          const lbl = (a.label ?? "").toLowerCase();
          return ref.includes("binance") || lbl.includes("binance");
        }) ?? [];
      byCategory["binance"] = {
        total: binanceSpotGbp + marginEquity,
        assets: [...binanceSpotRows, ...marginTiles],
      };
      if (cryptoBucket) cryptoBucket.total -= binanceSpotGbp;
    }
    // Fold confirmed rental revenue − accrued expenses into the headline (v1),
    // matching _recordSnapshot / _recordLive / the ingest live-doc recompute.
    const cashflow = await computeCashflowAdjustment(ctx);
    total += cashflow.netCashflowGbp;
    // Additive: persisted GBP→USD for dual-currency display.
    const fx = await ctx.db
      .query("fxRates")
      .withIndex("by_pair", (q) => q.eq("base", "GBP").eq("quote", "USD"))
      .first();
    const usdPerGbp = fx?.rate ?? null;
    // Additive: fresh intraday total from the frequent prices-only refresh.
    const live = await ctx.db
      .query("currentPrices")
      .withIndex("by_kind", (q) => q.eq("kind", "live"))
      .first();
    return {
      totalGBP: total,
      byCategory,
      oldestPricedAt,
      assetCount: assets.length,
      // --- Phase A additive fields (existing fields above are unchanged) ---
      usdPerGbp,
      fxFetchedAt: fx?.fetchedAt ?? null,
      live: live
        ? {
            totalGBP: live.totalGBP,
            byCategory: live.byCategory,
            usdPerGbp: live.usdPerGbp ?? usdPerGbp,
            ts: live.ts,
          }
        : null,
      // Convenience: the freshest current total (live if present, else summed).
      currentTotalGBP: live?.totalGBP ?? total,
      currentTotalTs: live?.ts ?? oldestPricedAt,
      // Cashflow components (v1 parity) — exposed so the Expenses/Rental tiles
      // use the SAME server numbers folded into the total (no client drift).
      confirmedRentalGbp: cashflow.confirmedRentalGbp,
      expensesMonthlyGbp: cashflow.expensesMonthlyGbp,
      expensesAccruedGbp: cashflow.expensesAccruedGbp,
      dayOfMonth: cashflow.dayOfMonth,
      daysInMonth: cashflow.daysInMonth,
      netCashflowGbp: cashflow.netCashflowGbp,
    };
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
 * getMarginPositions — Binance margin/futures positions tracker (Phase 16).
 * Returns the position list + aggregate total unrealized PnL (£/$) and total net
 * equity (GBP, the figure rolled into net worth). Empty array → UI empty-state.
 */
export const getMarginPositions = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("marginPositions").collect();
    let totalUPnlGbp = 0;
    let totalUPnlUsd = 0;
    let totalNetEquityGbp = 0;
    let updatedAt: number | null = null;
    const positions = rows
      .map((p) => {
        totalUPnlGbp += p.uPnlGbp ?? 0;
        totalUPnlUsd += p.uPnlUsd ?? 0;
        totalNetEquityGbp += p.netEquityGbp ?? 0;
        updatedAt =
          updatedAt === null ? p.updatedAt : Math.max(updatedAt, p.updatedAt);
        return {
          _id: p._id,
          exchange: p.exchange,
          market: p.market,
          symbol: p.symbol,
          side: p.side,
          size: p.size,
          entryPrice: p.entryPrice,
          markPrice: p.markPrice,
          leverage: p.leverage ?? null,
          uPnlUsd: p.uPnlUsd,
          uPnlGbp: p.uPnlGbp,
          marginLevel: p.marginLevel ?? null,
          liqPrice: p.liqPrice ?? null,
          netEquityGbp: p.netEquityGbp,
        };
      })
      .sort((a, b) => Math.abs(b.netEquityGbp) - Math.abs(a.netEquityGbp));
    return {
      positions,
      count: positions.length,
      totalUPnlGbp,
      totalUPnlUsd,
      totalNetEquityGbp,
      updatedAt,
    };
  },
});

/**
 * getRentalRevenue — cached rental-manager-v2 monthly NET confirmed revenue
 * (Phase 16). Returns null until the first poll populates the cache doc.
 */
export const getRentalRevenue = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("rentalRevenue")
      .withIndex("by_source", (q) => q.eq("source", "rmv2"))
      .first();
    return row
      ? {
          monthRevenueGbp: row.monthRevenueGbp,
          monthLabel: row.monthLabel,
          targetGbp: row.targetGbp ?? null,
          fetchedAt: row.fetchedAt,
        }
      : null;
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
      // Refresh the live doc so the PREFERRED headline + tiles update now.
      await recomputeLiveDoc(ctx);
      return a.id;
    }
    const newId = await ctx.db.insert("assets", {
      ...base,
      lastValueGBP: a.lastValueGBP,
      lastPricedAt: a.lastValueGBP !== undefined ? Date.now() : undefined,
    });
    // Refresh the live doc so the PREFERRED headline + tiles update now.
    await recomputeLiveDoc(ctx);
    return newId;
  },
});

export const removeAsset = mutation({
  args: { id: v.id("assets"), ownerId: v.optional(v.string()) },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
    // Refresh the live doc so the PREFERRED headline + tiles drop the removed
    // asset's value immediately (not just getWealth's fresh total).
    await recomputeLiveDoc(ctx);
    return id;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// MANUAL ASSET INLINE-VALUE EDIT (client-facing) — Phase B.
// Lets the Wealth widget inline-edit a manual asset's GBP value by LABEL
// (e.g. the manual "Stocks (IBKR)" £7,000 row stays manual — no live quote —
// but is now editable from the UI). Matches by label; optionally scoped to a
// category (defaults to first label match). Stamps lastPricedAt = now so the
// staleness badge resets, since the user just confirmed the figure.
// ─────────────────────────────────────────────────────────────────────────────
export const setManualAssetValue = mutation({
  args: {
    label: v.string(),
    valueGBP: v.number(),
    category: v.optional(v.string()),
    ownerId: v.optional(v.string()),
  },
  handler: async (ctx, { label, valueGBP, category }) => {
    assertFinite("valueGBP", valueGBP);
    const rows = await ctx.db.query("assets").collect();
    const match = rows.find(
      (r) =>
        r.label === label &&
        r.source === "manual" &&
        (category === undefined || r.category === category),
    );
    if (!match) {
      throw new Error(`No manual asset found with label "${label}"`);
    }
    await ctx.db.patch(match._id, {
      lastValueGBP: valueGBP,
      lastPricedAt: Date.now(),
    });
    // Refresh the live doc so the PREFERRED headline + tile values update now.
    await recomputeLiveDoc(ctx);
    return match._id;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 18 · IDEMPOTENT BINANCE-SPOT SEED (client-facing, prod-safe).
// Binance spot auto-fetch is geo-blocked (HTTP 451) so the Binance crypto line is
// a PERSISTENT MANUAL asset row, sibling to Coinbase. This mutation guarantees
// that row exists so the Binance sub-line can never silently disappear again
// (the Phase 17 regression: no auto-fetch AND no stored row → line vanished).
//
// Idempotent: if a manual crypto "Binance" row already exists, it is LEFT
// UNTOUCHED (never clobbers an edited value). Only inserts when missing, with the
// last-known spot £364 as the editable starting value. Does NOT touch Coinbase,
// does NOT re-enable any auto-fetch.
// ─────────────────────────────────────────────────────────────────────────────
export const seedBinanceSpot = mutation({
  args: {
    startingValueGBP: v.optional(v.number()), // default 364 (last-known spot)
    ownerId: v.optional(v.string()),
  },
  handler: async (ctx, { startingValueGBP, ownerId }) => {
    const start = startingValueGBP ?? 364;
    assertFinite("startingValueGBP", start);
    const cryptoRows = await ctx.db
      .query("assets")
      .withIndex("by_category", (q) => q.eq("category", "crypto"))
      .collect();
    const existing = cryptoRows.find(
      (r) =>
        r.source === "manual" &&
        (r.label === "Binance" ||
          (r.label ?? "").toLowerCase().includes("binance")),
    );
    if (existing) {
      return {
        created: false,
        id: existing._id,
        value: existing.lastValueGBP ?? null,
      };
    }
    const id = await ctx.db.insert("assets", {
      category: "crypto",
      label: "Binance",
      source: "manual",
      currency: GBP,
      lastValueGBP: start,
      lastPricedAt: Date.now(),
      ownerId,
    });
    // New Binance spot row → refresh the live doc so the Binance tile + headline
    // reflect it now. (The existing-row path above is a no-op by design.)
    await recomputeLiveDoc(ctx);
    return { created: true, id, value: start };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// CASH INLINE-VALUE EDIT (client-facing) — UPSERTING.
// The Cash tile is inline-editable like Stocks, but unlike Stocks there may be
// NO manual cash row yet (cash can come purely from auto/seeded sources). So,
// unlike setManualAssetValue (which THROWS when no row exists), this mutation
// UPSERTS: it patches the existing manual cash row if present, otherwise inserts
// one (label "Cash", source "manual", category "cash"). Cash flows into
// byCategory.cash → total, so an edit moves the net-worth headline automatically.
// Idempotent in the sense that repeated edits just patch the same single row.
// ─────────────────────────────────────────────────────────────────────────────
export const setCashValue = mutation({
  args: {
    valueGBP: v.number(),
    label: v.optional(v.string()), // default "Cash"
    ownerId: v.optional(v.string()),
  },
  handler: async (ctx, { valueGBP, label, ownerId }) => {
    assertFinite("valueGBP", valueGBP);
    const desiredLabel = label ?? "Cash";
    const cashRows = await ctx.db
      .query("assets")
      .withIndex("by_category", (q) => q.eq("category", "cash"))
      .collect();
    // Prefer the exact-label manual row; else the first manual cash row.
    const existing =
      cashRows.find((r) => r.source === "manual" && r.label === desiredLabel) ??
      cashRows.find((r) => r.source === "manual");
    if (existing) {
      await ctx.db.patch(existing._id, {
        lastValueGBP: valueGBP,
        lastPricedAt: Date.now(),
      });
      // Refresh the live doc so the PREFERRED headline + Cash tile update now.
      await recomputeLiveDoc(ctx);
      return { created: false, id: existing._id, value: valueGBP };
    }
    const id = await ctx.db.insert("assets", {
      category: "cash",
      label: desiredLabel,
      source: "manual",
      currency: GBP,
      lastValueGBP: valueGBP,
      lastPricedAt: Date.now(),
      ownerId,
    });
    // Refresh the live doc so the PREFERRED headline + Cash tile update now.
    await recomputeLiveDoc(ctx);
    return { created: true, id, value: valueGBP };
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

// ─────────────────────────────────────────────────────────────────────────────
// Phase 19 — Binance BRIDGE ingest (REAL spot + margin, pushed from the VPS)
//
// Convex egress is geo-blocked from Binance (HTTP 451) AND cannot reach aria
// (127.0.0.1:4001 on the VPS). So a VPS-side systemd timer fetches from aria,
// computes GBP values, and PUSHES them here via this PUBLIC mutation, guarded by
// a shared bearer `token` checked against the vault secret
// `convex/BINANCE_BRIDGE_TOKEN`. It (a) upserts the manual "Binance" crypto spot
// asset value and (b) REPLACES every marginPositions row with source="binance"
// with the real positions, then refreshes the live `currentPrices` doc so the
// headline NW reflects spot + margin net equity immediately (margin net equity
// rolls into NW via the synthetic "margin" category — see _recordLive/getWealth).
// ─────────────────────────────────────────────────────────────────────────────

/** One-shot helper to store/rotate the bridge token in the vault. Internal. */
export const _seedBridgeToken = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const existing = await ctx.db
      .query("secrets")
      .withIndex("by_service_and_key", (q) =>
        q.eq("service", "convex").eq("keyName", "BINANCE_BRIDGE_TOKEN"),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { value: token });
      return { created: false, id: existing._id };
    }
    const id = await ctx.db.insert("secrets", {
      service: "convex",
      keyName: "BINANCE_BRIDGE_TOKEN",
      value: token,
      description:
        "Shared bearer for the VPS→Convex Binance bridge (binance:ingest). Phase 19.",
      scopes: ["wealth"],
      aliases: [],
      sourceFiles: ["convex/wealth.ts", "scripts/binance-bridge.mjs"],
    });
    return { created: true, id };
  },
});

export const ingest = mutation({
  args: {
    token: v.string(),
    // Real Binance SPOT total in GBP (sum of coin qty × USD price × USD→GBP).
    spotGbp: v.number(),
    // Optional per-coin spot breakdown (audit/debug only — not persisted as rows).
    spot: v.optional(
      v.array(
        v.object({
          currency: v.string(),
          qty: v.number(),
          gbp: v.number(),
        }),
      ),
    ),
    // Real margin/futures positions (isolated/cross/usdm/coinm).
    positions: v.array(
      v.object({
        exchange: v.optional(v.string()), // informational; row exchange is forced "binance"
        market: v.string(), // isolated | cross | usdm | coinm
        symbol: v.string(),
        base: v.optional(v.string()),
        quote: v.optional(v.string()),
        side: v.string(),
        baseBorrowed: v.optional(v.number()),
        quoteNet: v.optional(v.number()),
        size: v.optional(v.number()),
        entry: v.optional(v.number()),
        mark: v.optional(v.number()),
        liqPrice: v.optional(v.number()),
        marginLevel: v.optional(v.number()),
        uPnlUsd: v.optional(v.number()),
        uPnlGbp: v.optional(v.number()),
        netEquityGbp: v.optional(v.number()), // null/absent ⇒ equity unknown (e.g. USDⓂ futures)
      }),
    ),
    totalMarginNetEquityGbp: v.optional(v.number()),
    usdPerGbp: v.optional(v.number()), // USD per 1 GBP (for dual-currency live doc)
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    // ── Token guard (constant-effort compare against the vault secret) ──
    const secret = await ctx.db
      .query("secrets")
      .withIndex("by_service_and_key", (q) =>
        q.eq("service", "convex").eq("keyName", "BINANCE_BRIDGE_TOKEN"),
      )
      .first();
    if (!secret?.value || a.token !== secret.value) {
      throw new ConvexError("unauthorized: bad bridge token");
    }

    assertFinite("spotGbp", a.spotGbp);
    const now = a.updatedAt && Number.isFinite(a.updatedAt) ? a.updatedAt : Date.now();

    // ── 1. Upsert the manual Binance SPOT crypto asset value ──
    const cryptoRows = await ctx.db
      .query("assets")
      .withIndex("by_category", (q) => q.eq("category", "crypto"))
      .collect();
    let binanceAsset = cryptoRows.find(
      (r) =>
        r.source === "manual" &&
        (r.label === "Binance" ||
          (r.label ?? "").toLowerCase().includes("binance")),
    );
    const spot = Math.max(0, Math.round(a.spotGbp));
    if (binanceAsset) {
      await ctx.db.patch(binanceAsset._id, {
        lastValueGBP: spot,
        lastPricedAt: now,
        externalRef: "binance",
      });
    } else {
      await ctx.db.insert("assets", {
        category: "crypto",
        label: "Binance",
        source: "manual",
        currency: GBP,
        externalRef: "binance",
        lastValueGBP: spot,
        lastPricedAt: now,
      });
    }

    // ── 2. REPLACE all source="binance" margin positions with the real ones ──
    const existingMargin = await ctx.db.query("marginPositions").collect();
    for (const r of existingMargin) {
      if (r.source === "binance") await ctx.db.delete(r._id);
    }
    let insertedNetEquity = 0;
    for (const p of a.positions) {
      const uPnlUsd = Number.isFinite(p.uPnlUsd as number) ? (p.uPnlUsd as number) : 0;
      const uPnlGbp = Number.isFinite(p.uPnlGbp as number) ? (p.uPnlGbp as number) : 0;
      const netEquityGbp = Number.isFinite(p.netEquityGbp as number)
        ? (p.netEquityGbp as number)
        : 0; // unknown equity (e.g. USDⓂ futures) contributes 0 to NW — never fabricated
      insertedNetEquity += netEquityGbp;
      await ctx.db.insert("marginPositions", {
        exchange: "binance",
        market: p.market,
        symbol: p.symbol.trim(),
        base: p.base,
        quote: p.quote,
        side: p.side === "short" ? "short" : "long",
        size: Number.isFinite(p.size as number)
          ? (p.size as number)
          : Number.isFinite(p.baseBorrowed as number)
            ? (p.baseBorrowed as number)
            : 0,
        entryPrice: Number.isFinite(p.entry as number) ? (p.entry as number) : 0,
        markPrice: Number.isFinite(p.mark as number) ? (p.mark as number) : 0,
        uPnlUsd,
        uPnlGbp,
        marginLevel: Number.isFinite(p.marginLevel as number)
          ? (p.marginLevel as number)
          : undefined,
        liqPrice: Number.isFinite(p.liqPrice as number)
          ? (p.liqPrice as number)
          : undefined,
        netEquityGbp,
        source: "binance",
        updatedAt: now,
      });
    }

    // ── 3. Persist FX (USD per GBP) if provided, for dual-currency display ──
    if (a.usdPerGbp && Number.isFinite(a.usdPerGbp) && a.usdPerGbp > 0) {
      const fx = await ctx.db
        .query("fxRates")
        .withIndex("by_pair", (q) => q.eq("base", "GBP").eq("quote", "USD"))
        .first();
      if (fx) await ctx.db.patch(fx._id, { rate: a.usdPerGbp, fetchedAt: now });
      else
        await ctx.db.insert("fxRates", {
          base: "GBP",
          quote: "USD",
          rate: a.usdPerGbp,
          fetchedAt: now,
        });
    }

    // ── 4. Refresh the live `currentPrices` doc so headline NW updates now ──
    // Routed through the shared `recomputeLiveDoc` (single source of truth) so the
    // bridge, the cron, and the manual mutations build the live doc identically:
    // Σ assets + margin net equity ("margin" category) + net cashflow. Pass the
    // bridge's fresh FX + timestamp so the live doc carries them.
    const { totalGBP: liveTotal } = await recomputeLiveDoc(ctx, {
      usdPerGbp: a.usdPerGbp && a.usdPerGbp > 0 ? a.usdPerGbp : undefined,
      ts: now,
    });

    return {
      ok: true,
      spotGbp: spot,
      positionsWritten: a.positions.length,
      marginNetEquityGbp: insertedNetEquity,
      totalGBP: liveTotal,
      updatedAt: now,
    };
  },
});

// Re-exported constants for the action module (kept in sync via import there).
export const _const = { GBP, DUST_EPSILON };
