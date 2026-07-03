import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Net-worth snapshot — records a `netWorthSnapshots` history row (the graphs'
// data). Twice-daily cadence set 2026-07-03 per Daniel ("2 times per day"):
// 06:00 + 18:00 UTC gives the charts two real points a day instead of one.
crons.cron(
  "net-worth-snapshot",
  "0 6,18 * * *",
  internal.wealthActions.snapshot,
);

// Prices-only refresh (Phase A backbone). Re-prices crypto (Coinbase live) /
// gold / FX and updates the singleton `currentPrices` (live) doc — NO history
// row written. The price-alert check runs INSIDE this action right after
// prices land (the old separate 15-min alerts cron was deleted — it compared
// against prices that only changed here anyway). 2026-07-03 cadence per
// Daniel: everything polls twice a day; offset +6h from the snapshots so the
// dashboard refreshes 4× spread across the day (00/06/12/18 UTC effectively).
crons.cron(
  "net-worth-live-refresh",
  "0 0,12 * * *",
  internal.wealthActions.refreshLive,
);

// Recurring LLM deal-hunt fleet tick (Phase D). Fans out to active `hunts`
// whose lastCheckedAt is older than their per-hunt cadence. Early-exits on an
// empty/idle hunts table, so an idle tick is one cheap DB read. LLM =
// OpenRouter DeepSeek (2026-07-03; the Anthropic API org has no credits — see
// huntActions.ts). NEEDS vault keys: serpapi:SERPAPI_KEY +
// openrouter:OPENROUTER_API_KEY. Twice daily (2026-07-03 poll diet).
crons.interval(
  "hunts-fleet-check",
  { hours: 12 },
  internal.huntActions.enqueueDueHunts,
);

// ── Phase 16 · Wealth completion (rental revenue) ────────────────────────────
//
// Phase 17: the Binance `margin-refresh` cron (every 25 min) was REMOVED. Every
// Binance margin/futures surface (sapi/fapi/dapi) returns HTTP 451 (geo-blocked)
// from Convex's egress IP, so the cron only ever produced failures. Margin
// positions are now MANUAL (add/edit/delete via the tracker tile) and roll into
// net worth straight from the `marginPositions` table — no fetch needed.

// Rental-revenue poll (Phase 16). Server-side read of rental-manager-v2's
// Convex dashboard:getStatsDrawerData → confirmed NET month revenue into the
// rentalRevenue cache doc. RMv2 Convex URL read from the vault (NOT hardcoded).
// Twice daily (2026-07-03 poll diet per Daniel); the widget shows its own
// "upd Xh ago" badge so staleness is always visible.
crons.interval(
  "rental-revenue-poll",
  { hours: 12 },
  internal.wealthActions.pollRentalRevenueCron,
);

// AI music income poll. Mirrors music-house's DistroKid analytics into the
// aiIncome cache doc + the "Music · DistroKid" auto asset. Source data only
// changes every 2 DAYS (Trigger schedule on the music-house side) — poll-diet
// 2026-07-03: 6h → 12h keeps the hub at most half a day behind a 2-day feed.
crons.interval(
  "ai-music-income-poll",
  { hours: 12 },
  internal.wealthActions.pollMusicIncomeCron,
);

// Month-end profit banking (2026-07-03, per Daniel): rental profit lands in
// his pocket as payouts and must ACCUMULATE in net worth, not evaporate at
// rollover. Daily 23:50 UTC tick that only acts on the LAST day of a month —
// banks (confirmed rental − full month expenses) into the "Savings (Revolut)"
// asset. Idempotent (settings guard) + cheap early-exit on every other day.
// The 5th-of-month Revolut check-in in the wealth widget then anchors the
// accrued estimate to the real balance.
crons.cron(
  "bank-monthly-cashflow",
  "50 23 * * *",
  internal.wealth.bankMonthlyCashflow,
);

// Daily idea generation (2026-07-03). ONE cheap OpenRouter DeepSeek call per
// day produces BOTH the "Idea of the Day" and the "Channel Idea" cards — the
// widgets were static "generation is paused" placeholders before this. Runs
// before the 06:00 snapshot so the morning dashboard is fresh. On failure the
// previous day's doc is kept (widgets surface their own stale badge).
crons.daily(
  "daily-ideas",
  { hourUTC: 5, minuteUTC: 30 },
  internal.ideas.generateDaily,
);

export default crons;
