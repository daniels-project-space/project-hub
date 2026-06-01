import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Daily net-worth snapshot (Wave 1 · Wealth). Refreshes live prices best-effort
// then records one `netWorthSnapshots` row. Runs 06:00 UTC.
crons.daily(
  "net-worth-snapshot",
  { hourUTC: 6, minuteUTC: 0 },
  internal.wealthActions.snapshot,
);

// Frequent prices-only refresh (Phase A · no-staleness backbone). Re-prices
// crypto/gold + FX and updates the singleton `currentPrices` (live) doc every
// 30 min — NO history row written. Keeps dashboard tiles near-live between the
// once-daily full snapshots above. Stocks stay manual (no quote).
crons.interval(
  "net-worth-live-refresh",
  { minutes: 30 },
  internal.wealthActions.refreshLive,
);

// ── Phase D · Hunts·Alerts (decoupled from Aria) ────────────────────────────

// Price-alert check (Phase D). Every 15 min compares each ACTIVE `alerts` row
// against the current price the hub already holds (currentPrices live doc /
// priceCache / fxRates) and stamps `lastTriggeredAt` on a crossing. Pure DB
// work, no external key. Ported from aria/lib/portfolio-alerts.js (price_target).
crons.interval(
  "alerts-price-check",
  { minutes: 15 },
  internal.alerts.checkAlerts,
);

// Recurring LLM deal-hunt fleet tick (Phase D). Hourly tick fans out to active
// `hunts` whose lastCheckedAt is older than their per-hunt cadence (derived from
// the cron `schedule` string); each due hunt runs an LLM + web-search check in a
// "use node" action and writes lastResult/lastCheckedAt back. Ported from
// aria/lib/hunts.js (runs/maxRuns/auto-stop). NEEDS vault keys at deploy:
// serpapi:SERPAPI_KEY + anthropic:ANTHROPIC_API_KEY (both present 2026-06-01).
crons.interval(
  "hunts-fleet-check",
  { hours: 1 },
  internal.huntActions.enqueueDueHunts,
);

// ── Phase 16 · Wealth completion (Binance margin + rental revenue) ───────────

// Binance margin/futures refresh (Phase 16). Every 25 min re-pulls the READ-ONLY
// isolated/cross/USDⓂ/COINⓂ surfaces, REPLACES the marginPositions table, and
// (via the synthetic "margin" category) keeps the live net worth current. Net
// equity also rolls in through refreshLive, but this dedicated cron keeps the
// positions tracker fresh on its own cadence. Internal alias declared in
// wealthActions so cronJobs can reference it.
crons.interval(
  "margin-refresh",
  { minutes: 25 },
  internal.wealthActions.refreshMarginCron,
);

// Rental-revenue poll (Phase 16). Hourly server-side read of rental-manager-v2's
// Convex dashboard:getStatsDrawerData → confirmed NET month revenue into the
// rentalRevenue cache doc. RMv2 Convex URL read from the vault (NOT hardcoded).
crons.interval(
  "rental-revenue-poll",
  { hours: 1 },
  internal.wealthActions.pollRentalRevenueCron,
);

export default crons;
