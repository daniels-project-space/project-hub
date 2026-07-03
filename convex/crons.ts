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

// Prices-only refresh (Phase A backbone). Re-prices crypto/gold + FX and
// updates the singleton `currentPrices` (live) doc — NO history row written.
// Poll-diet 2026-07-03: 30 min → 60 min (personal dashboard; hourly is plenty),
// and the price-alert check now runs INSIDE refreshLive right after prices
// land. The old separate 15-min `alerts-price-check` cron was deleted — it
// compared alerts against prices that only changed on this refresh anyway, so
// the extra ticks could never catch anything new.
crons.interval(
  "net-worth-live-refresh",
  { hours: 1 },
  internal.wealthActions.refreshLive,
);

// Recurring LLM deal-hunt fleet tick (Phase D). Hourly tick fans out to active
// `hunts` whose lastCheckedAt is older than their per-hunt cadence (derived from
// the cron `schedule` string). Early-exits on an empty/idle hunts table, so an
// idle tick is one cheap DB read. LLM = OpenRouter DeepSeek (2026-07-03; the
// Anthropic API org has no credits — see huntActions.ts). NEEDS vault keys:
// serpapi:SERPAPI_KEY + openrouter:OPENROUTER_API_KEY.
crons.interval(
  "hunts-fleet-check",
  { hours: 1 },
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
// Poll-diet 2026-07-03: 1h → 2h (revenue moves a few times a day at most; the
// widget shows its own "upd Xh ago" badge so staleness is always visible).
crons.interval(
  "rental-revenue-poll",
  { hours: 2 },
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
