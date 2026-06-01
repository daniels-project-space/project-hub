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

export default crons;
