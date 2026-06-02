import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Widgets the dashboard renders. Each row = one widget instance.
  widgets: defineTable({
    type: v.string(), // "notes" | "calendar" | "todo" | "wealth" | "projects" | etc.
    position: v.number(),
    enabled: v.boolean(),
    config: v.any(), // arbitrary widget-specific config
    // Per-widget grid sizing (Phase 1, additive/optional → backward-compatible).
    // `w` = column span 1–4; `h` = height step 1–2. Rows without these fall back
    // to DEFAULT_SIZE in convex/widgets.ts so existing layouts render unmigrated.
    w: v.optional(v.number()),
    h: v.optional(v.number()),
  }).index("by_position", ["position"]),

  // Projects (placeholder list — eventually populated as apps migrate to Vercel).
  projects: defineTable({
    slug: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    vercelUrl: v.optional(v.string()),
    githubUrl: v.optional(v.string()),
    status: v.string(), // "active" | "wip" | "archived"
  }).index("by_slug", ["slug"]),

  // Merged from the old key-vault Supabase project. Server-only access.
  secrets: defineTable({
    service: v.string(),
    keyName: v.string(),
    value: v.string(),
    description: v.optional(v.string()),
    scopes: v.array(v.string()),
    aliases: v.array(v.string()),
    sourceFiles: v.array(v.string()),
  })
    .index("by_service", ["service"])
    .index("by_service_and_key", ["service", "keyName"]),

  // --- Pass 1 widget data tables ---

  // Sticky notes (W3). Color-coded, pinnable, drag-reorderable.
  notes: defineTable({
    text: v.string(),
    color: v.string(),
    pinned: v.boolean(),
    position: v.number(),
    updatedAt: v.number(),
    ownerId: v.optional(v.string()), // unused now; for later auth scoping
  }).index("by_position", ["position"]),

  // Calendar events (W4). Manual entry only.
  events: defineTable({
    title: v.string(),
    start: v.number(),
    end: v.optional(v.number()),
    allDay: v.boolean(),
    color: v.string(),
    location: v.optional(v.string()),
    notes: v.optional(v.string()),
    ownerId: v.optional(v.string()),
  }).index("by_start", ["start"]),

  // To-do items (W2). Priority, due dates, tags, project linkage.
  todos: defineTable({
    text: v.string(),
    done: v.boolean(),
    priority: v.number(),
    dueDate: v.optional(v.number()),
    tags: v.array(v.string()),
    projectSlug: v.optional(v.string()),
    position: v.number(),
    createdAt: v.number(),
    ownerId: v.optional(v.string()),
  }).index("by_position", ["position"]),

  // --- Wealth tables (schema only — convex/wealth.ts owned by a later agent) ---

  // Tracked assets across all categories.
  assets: defineTable({
    category: v.union(
      v.literal("crypto"),
      v.literal("stocks"),
      v.literal("gold"),
      v.literal("cash"),
      v.literal("property"),
      v.literal("inventory"),
    ),
    label: v.string(),
    source: v.union(v.literal("auto"), v.literal("manual")),
    quantity: v.optional(v.number()),
    balanceNative: v.optional(v.number()),
    currency: v.string(),
    externalRef: v.optional(v.string()),
    lastValueGBP: v.optional(v.number()),
    lastPricedAt: v.optional(v.number()),
    ownerId: v.optional(v.string()),
  }).index("by_category", ["category"]),

  // Daily net-worth snapshots — powers the history chart.
  netWorthSnapshots: defineTable({
    ts: v.number(),
    totalGBP: v.number(),
    byCategory: v.any(),
    usdPerGbp: v.optional(v.number()), // GBP→USD at snapshot time (additive, Phase A)
    ownerId: v.optional(v.string()),
  }).index("by_ts", ["ts"]),

  // Shared price / FX cache.
  priceCache: defineTable({
    symbol: v.string(),
    gbp: v.number(),
    ts: v.number(),
  }).index("by_symbol", ["symbol"]),

  // --- Phase A (parity v2) additive tables — data backbone ---

  // Persisted FX rate (latest GBP→USD). Singleton-ish: one row per (base,quote).
  // Sourced from Frankfurter/ECB (https://api.frankfurter.app/latest?from=GBP&to=USD).
  // `rate` = how many `quote` units per 1 `base` (e.g. base GBP, quote USD → USD per GBP).
  fxRates: defineTable({
    base: v.string(), // "GBP"
    quote: v.string(), // "USD"
    rate: v.number(), // quote units per 1 base unit
    fetchedAt: v.number(),
  }).index("by_pair", ["base", "quote"]),

  // Live (intraday) net-worth snapshot — updated by the frequent prices-only cron
  // (~30 min) so dashboard tiles reflect near-live values without a full daily
  // snapshot. Singleton: keyed by `kind` ("live"). `byCategory` mirrors the daily
  // snapshot shape: Record<category, totalGBP>. `usdPerGbp` is the GBP→USD rate
  // at refresh time so the frontend can render dual currency from one read.
  currentPrices: defineTable({
    kind: v.string(), // "live"
    totalGBP: v.number(),
    byCategory: v.any(), // Record<category, totalGBP>
    usdPerGbp: v.optional(v.number()),
    ts: v.number(), // when this live total was computed
  }).index("by_kind", ["kind"]),

  // Home expenses / subscriptions (W: Expenses, Phase C). Manual entry only —
  // mirrors v1 hub-kv.json:home_expenses_v1 ({id,name,amount,createdAt}).
  // `amountGBP` holds v1's `amount` (GBP). category/recurring/dueDay are additive
  // (v1 had none) — optional so the migration maps cleanly.
  expenses: defineTable({
    name: v.string(),
    amountGBP: v.number(),
    category: v.optional(v.string()),
    recurring: v.optional(v.boolean()),
    dueDay: v.optional(v.number()), // day-of-month 1–31 for recurring
    createdAt: v.number(),
    ownerId: v.optional(v.string()),
  }).index("by_createdAt", ["createdAt"]),

  // Price alerts for the decoupled Hunts·Alerts widget (Phase D).
  alerts: defineTable({
    symbol: v.string(), // "BTC" | "AAPL" | "XAU" | "GBPUSD" ...
    kind: v.union(v.literal("above"), v.literal("below")),
    threshold: v.number(),
    currency: v.optional(v.string()), // defaults GBP when absent
    active: v.boolean(),
    lastTriggeredAt: v.optional(v.number()),
    createdAt: v.number(),
    ownerId: v.optional(v.string()),
  }).index("by_active", ["active"]),

  // Recurring LLM deal-hunts for the decoupled Hunts·Alerts widget (Phase D wires
  // the checker; table defined now). Field names match the Phase plan contract;
  // optional fields preserve aria/lib/hunts.js semantics (schedule/maxRuns/runs).
  hunts: defineTable({
    query: v.string(), // the hunt task, e.g. "Sony A7IV under £1500"
    criteria: v.optional(v.string()), // optional structured criteria / stop_when
    schedule: v.optional(v.string()), // cron expression (aria parity)
    maxRuns: v.optional(v.number()),
    runs: v.optional(v.number()),
    lastCheckedAt: v.optional(v.number()),
    lastResult: v.optional(v.string()),
    active: v.boolean(),
    createdAt: v.number(),
    ownerId: v.optional(v.string()),
  }).index("by_active", ["active"]),

  // --- Phase 16 (Wealth completion) additive tables ---

  // Binance leveraged positions — isolated/cross margin + USDⓂ/COINⓂ futures.
  // The `assets` table can't model leverage/entry/mark/side/uPnL/liq, and a
  // leveraged position's *value* is its NET EQUITY (wallet ± unrealized PnL),
  // not quantity×price — so it lives in its own table. Repopulated wholesale by
  // the READ-ONLY `refreshMargin` action (delete-all-by-exchange then insert).
  // Net equity rolls into the headline net worth (v1 behaviour) via a synthetic
  // "margin" category in currentPrices/snapshots/getWealth.
  marginPositions: defineTable({
    exchange: v.string(), // "binance"
    market: v.string(), // "isolated" | "cross" | "usdm" | "coinm"
    symbol: v.string(), // "SOLUSDT"
    base: v.optional(v.string()),
    quote: v.optional(v.string()),
    side: v.string(), // "long" | "short"
    size: v.number(), // position size (base units / contracts)
    entryPrice: v.number(),
    markPrice: v.number(),
    leverage: v.optional(v.number()),
    uPnlUsd: v.number(), // unrealized PnL (USD)
    uPnlGbp: v.number(), // unrealized PnL (GBP)
    marginLevel: v.optional(v.number()),
    liqPrice: v.optional(v.number()),
    netEquityGbp: v.number(), // wallet balance ± uPnL (GBP) — net-worth roll-in
    source: v.string(), // "auto"
    updatedAt: v.number(),
  }).index("by_exchange", ["exchange"]),

  // Rental revenue cache (Phase 16). Server-side poll of rental-manager-v2's
  // Convex `dashboard:getStatsDrawerData {accountSlug:null}` → confirmed NET
  // current-month revenue. Singleton (one row per `source`). NEVER hardcodes the
  // RMv2 Convex URL — read from the vault (`convex/NEXT_PUBLIC_CONVEX_URL_RMV2`).
  rentalRevenue: defineTable({
    source: v.string(), // "rmv2"
    monthRevenueGbp: v.number(), // confirmed.month_revenue (NET, all accounts)
    monthLabel: v.string(), // confirmed.month_label (e.g. "2026-06-01")
    targetGbp: v.optional(v.number()), // monthly.target_gbp if present
    fetchedAt: v.number(),
  }).index("by_source", ["source"]),
});
