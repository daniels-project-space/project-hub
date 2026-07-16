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

  // Key/value app settings (Pass 1 settings layer). One row per key; `value` is
  // arbitrary JSON. Read as a flat Record via settings.all; written via
  // settings.set (upsert by key). Keys/defaults are owned by settings-provider.
  settings: defineTable({
    key: v.string(),
    value: v.any(),
  }).index("by_key", ["key"]),

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

  // Calendar events (W4). Manual entry + Travel widget save→calendar.
  // `source` (optional, additive/backward-compatible) tags the origin of a row,
  // e.g. "trip" for events created by trips.saveToCalendar. Absent = manual.
  events: defineTable({
    title: v.string(),
    start: v.number(),
    end: v.optional(v.number()),
    allDay: v.boolean(),
    color: v.string(),
    location: v.optional(v.string()),
    notes: v.optional(v.string()),
    source: v.optional(v.string()),
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
  })
    .index("by_position", ["position"])
    .index("by_done_position", ["done", "position"]),

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

  // AI music income cache — server-side poll of music-house's Convex
  // `distributorAnalytics:latest` + `:history` (DistroKid streams + real bank
  // balance, pulled there every 2 days). Singleton per `source`. The music-house
  // Convex URL comes from the vault (`convex/NEXT_PUBLIC_CONVEX_URL_MUSIC_HOUSE`),
  // never hardcoded. `historyJson` = [{fetchedAt, streamsTotal, balance}] for the
  // widget graph. The poll also upserts the "Music · DistroKid" auto asset
  // (category `property` = AI Income) so the REAL balance rolls into net worth.
  aiIncome: defineTable({
    source: v.string(), // "music-house"
    streamsTotal: v.number(),
    balanceUsd: v.number(), // real DistroKid bank balance
    estUsd: v.number(), // streamsTotal × blended $/stream estimate
    balanceGbp: v.number(), // balanceUsd converted at poll time
    historyJson: v.string(),
    fetchedAt: v.number(),
  }).index("by_source", ["source"]),

  // Daily generated ideas (2026-07-03). ONE row per UTC day, written by the
  // daily-ideas cron (single cheap OpenRouter/DeepSeek call generating BOTH
  // cards). Powers the previously-static "Idea of the Day" and "Channel Idea"
  // widgets. Flat fields (no nested objects) keep the validator simple.
  dailyIdeas: defineTable({
    day: v.string(), // UTC YYYY-MM-DD
    ideaText: v.string(),
    ideaBenefit: v.optional(v.string()),
    channelLogline: v.string(),
    channelHook: v.optional(v.string()),
    channelMonetization: v.optional(v.string()),
    channelNiche: v.optional(v.string()),
    channelFormat: v.optional(v.string()),
    generatedAt: v.number(),
    model: v.optional(v.string()),
  }).index("by_day", ["day"]),

  // --- Travel widget (Wave 1A — backend data layer only) ---
  // Relational itinerary model ported from v1's SQLite schema (trips →
  // trip_days → trip_items). New tables, no migration. All planning/enrichment
  // fields optional so a trip can exist with just a title (manual or AI-built).

  // One trip = one planned journey. `active` marks the trip the widget shows by
  // default (exactly one active at a time, enforced by trips.setActive).
  trips: defineTable({
    title: v.string(),
    startDate: v.optional(v.string()), // ISO YYYY-MM-DD
    endDate: v.optional(v.string()),
    budgetGbp: v.optional(v.number()),
    currency: v.optional(v.string()),
    originCity: v.optional(v.string()),
    destCity: v.optional(v.string()),
    destLat: v.optional(v.number()),
    destLng: v.optional(v.number()),
    destCountryCode: v.optional(v.string()), // ISO-3166 alpha-2 for info-rail lookups
    status: v.optional(v.string()), // "planning" | "booked" | "done" ...
    active: v.optional(v.boolean()),
    // Permanent search preferences (2026-07-03): traveler count every stay /
    // flight search for this trip uses. Dates already live on the trip.
    travelers: v.optional(v.number()),
    // Stay style per destination (Daniel: villas for Bali-likes, hotels for
    // Turkey-likes): "villas" | "hotels" | "any". Villas searches Google's
    // vacation-rentals inventory instead of hotels.
    stayStyle: v.optional(v.string()),
    // --- v3 multi-mode (Stage 0, additive/backward-compatible) ---
    mode: v.optional(v.string()), // "planner" | "deal" | "trip" — drives widget mode (Stage 1)
    categories: v.optional(v.array(v.string())), // enabled activity kinds (constrains planTrip)
    notes: v.optional(v.string()), // free-text trip notes
    createdAt: v.number(),
  })
    .index("by_active", ["active"])
    .index("by_createdAt", ["createdAt"]),

  // One day within a trip. `dayIndex` is the 0-based ordinal (sort key);
  // `date` is optional so undated/template days are valid. `weather` is the raw
  // Open-Meteo blob (json) cached at plan time.
  tripDays: defineTable({
    tripId: v.id("trips"),
    date: v.optional(v.string()), // ISO YYYY-MM-DD
    dayIndex: v.number(),
    summary: v.optional(v.string()),
    weather: v.optional(v.any()),
  }).index("by_trip", ["tripId"]),

  // One itinerary item within a day (a place, meal, stay, flight, etc.).
  // `sortOrder` orders items within their day (0..n, maintained by reorderItems
  // / addItem). `status` tracks planned→done→skip.
  tripItems: defineTable({
    tripId: v.id("trips"),
    dayId: v.id("tripDays"),
    kind: v.string(), // "place"|"food"|"stay"|"flight"|"transport"|"activity"
    sortOrder: v.number(),
    startTime: v.optional(v.string()), // "HH:MM"
    endTime: v.optional(v.string()),
    title: v.string(),
    description: v.optional(v.string()),
    priceGbp: v.optional(v.number()),
    status: v.optional(v.string()), // "planned"|"done"|"skip"
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    address: v.optional(v.string()),
    link: v.optional(v.string()),
    image: v.optional(v.string()),
    rating: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
    // --- v3 (Stage 0, additive). An empty slot = item with kind:"slot" (no
    // schema change for kind). durationMin powers the resizable timeline. ---
    durationMin: v.optional(v.number()), // duration in minutes (drag-resize)
  })
    .index("by_trip", ["tripId"])
    .index("by_day", ["dayId"]),

  // --- Travel widget v3 multi-mode (Stage 0 — per-trip extras) ---
  // All four tables are additive, indexed by_trip, and cascade-deleted with the
  // parent trip (see trips.remove). No migration.

  // Per-trip checklist (Mode A/C). `position` orders items; `done` toggles.
  tripTodos: defineTable({
    tripId: v.id("trips"),
    text: v.string(),
    done: v.boolean(),
    position: v.number(),
    createdAt: v.number(),
  }).index("by_trip", ["tripId"]),

  // Multi-destination legs (ordered stops within one trip). `order` is the sort
  // key. Coordinates/country/dates optional so a leg can exist with just a city.
  tripLegs: defineTable({
    tripId: v.id("trips"),
    order: v.number(),
    city: v.string(),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    countryCode: v.optional(v.string()),
    arriveDate: v.optional(v.string()), // ISO YYYY-MM-DD
    departDate: v.optional(v.string()),
    // --- Transport INTO this leg (from the previous leg), via Google Directions.
    // Additive. transportMode drives the lookup; the rest cache the result so we
    // don't re-hit Directions on every render. routePolyline is Google's encoded
    // overview polyline, decoded to draw the real road/rail route on the globe.
    transportMode: v.optional(v.string()), // "car" | "train" | "bus"
    routeDurationText: v.optional(v.string()), // e.g. "3 hr 15 min"
    routeDistanceText: v.optional(v.string()), // e.g. "314 km"
    routePolyline: v.optional(v.string()),
  }).index("by_trip", ["tripId"]),

  // Connecting flights (one row = one journey, possibly multi-segment). `order`
  // sorts journeys; `segments` is the leg-by-leg breakdown.
  tripFlights: defineTable({
    tripId: v.id("trips"),
    order: v.number(),
    segments: v.array(
      v.object({
        from: v.string(),
        to: v.string(),
        depart: v.optional(v.string()),
        arrive: v.optional(v.string()),
        carrier: v.optional(v.string()),
        flightNo: v.optional(v.string()),
      }),
    ),
    // Saved from a flight search (additive): price + a booking deep-link.
    priceGbp: v.optional(v.number()),
    bookLink: v.optional(v.string()),
  }).index("by_trip", ["tripId"]),

  // Saved stay options (Mode-B deal results). Cards carry image + book link and
  // badge flags. `saved` distinguishes shortlisted vs transient search results.
  tripStays: defineTable({
    tripId: v.id("trips"),
    name: v.string(),
    provider: v.optional(v.string()),
    priceGbp: v.optional(v.number()),
    image: v.optional(v.string()),
    link: v.optional(v.string()),
    freeCancellation: v.optional(v.boolean()),
    payLater: v.optional(v.boolean()),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    checkIn: v.optional(v.string()), // ISO YYYY-MM-DD
    checkOut: v.optional(v.string()),
    saved: v.optional(v.boolean()),
    // LOCKED IN (2026-07-03): this stay is THE booking for its checkIn..checkOut
    // period — the trips-overview timeline renders it as a committed block and
    // only transport remains to be filled around it.
    locked: v.optional(v.boolean()),
    createdAt: v.number(),
  }).index("by_trip", ["tripId"]),

  // Aggregated stay-search cache (2026-07-07). Keyed by destination+dates+guests;
  // `options` is the JSON-serialised deduped StayOption[]. Searches read this
  // instantly (stale-while-revalidate); a cron refreshes active trips so the
  // common case never waits on a live scrape.
  stayCache: defineTable({
    cacheKey: v.string(), // `${cityLower}|${checkIn}|${checkOut}|${adults}`
    options: v.string(), // JSON StayOption[]
    count: v.number(),
    fetchedAt: v.number(),
  }).index("by_key", ["cacheKey"]),
});
