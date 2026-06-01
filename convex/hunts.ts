/**
 * Hunts — recurring LLM deal-hunt CRUD + scheduling glue (Phase D). Native,
 * ZERO Aria dependency. Logic ported from aria/lib/hunts.js:
 *   - add(): default schedule "0 9 * * *", default maxRuns 30, MAX_ACTIVE 10,
 *     runs starts at 0, active=true.
 *   - markRun(): bump runs, set lastResult (capped 500) + lastCheckedAt; if the
 *     LLM says "found" → stop (active:false); else if runs >= maxRuns → stop.
 *   - remove(): hard delete (aria soft-set status:"removed"; we delete the row).
 *
 * The actual LLM check lives in convex/huntActions.ts (a "use node" action,
 * since an LLM/web call can't run inside a query/mutation). This module holds
 * the DB-side CRUD + the internal helpers that action calls back into, and a
 * public `runNow` to kick a single hunt on demand from the widget.
 */
import { v } from "convex/values";
import {
  mutation,
  query,
  action,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import { internal } from "./_generated/api";

const MAX_ACTIVE = 10; // aria parity
const DEFAULT_SCHEDULE = "0 9 * * *"; // aria default (daily 9am)
const DEFAULT_MAX_RUNS = 30; // aria default
const RESULT_MAX = 500;

// ─────────────────────────────────────────────────────────────────────────────
// Schedule helpers — map an aria-style cron string to a check cadence (ms).
// We don't run a per-hunt cron (Convex has no such primitive); instead a fleet
// cron ticks and `_dueActive` selects hunts whose lastCheckedAt is older than
// this cadence. Covers the schedules the v1 widget offers + a sane default.
// ─────────────────────────────────────────────────────────────────────────────
function scheduleToMs(schedule?: string): number {
  const HOUR = 3_600_000;
  switch ((schedule ?? DEFAULT_SCHEDULE).trim()) {
    case "0 */2 * * *":
      return 2 * HOUR;
    case "0 */6 * * *":
      return 6 * HOUR;
    case "0 9,18 * * *":
      return 12 * HOUR;
    case "0 9 * * *":
    default:
      return 24 * HOUR;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CRUD (client-facing)
// ─────────────────────────────────────────────────────────────────────────────

export const list = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("hunts").collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const add = mutation({
  args: {
    query: v.string(),
    criteria: v.optional(v.string()),
    schedule: v.optional(v.string()),
    maxRuns: v.optional(v.number()),
    ownerId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const activeCount = (
      await ctx.db
        .query("hunts")
        .withIndex("by_active", (q) => q.eq("active", true))
        .collect()
    ).length;
    if (activeCount >= MAX_ACTIVE) {
      throw new Error(`Max ${MAX_ACTIVE} active hunts. Remove one first.`);
    }
    const q = args.query.trim();
    if (!q) throw new Error("hunt query required");
    return await ctx.db.insert("hunts", {
      query: q,
      criteria: args.criteria,
      schedule: args.schedule ?? DEFAULT_SCHEDULE,
      maxRuns: args.maxRuns ?? DEFAULT_MAX_RUNS,
      runs: 0,
      active: true,
      createdAt: Date.now(),
      ownerId: args.ownerId,
    });
  },
});

/** Pause/resume or edit schedule/maxRuns. */
export const update = mutation({
  args: {
    id: v.id("hunts"),
    active: v.optional(v.boolean()),
    schedule: v.optional(v.string()),
    maxRuns: v.optional(v.number()),
    criteria: v.optional(v.string()),
  },
  handler: async (ctx, { id, active, schedule, maxRuns, criteria }) => {
    const patch: Record<string, unknown> = {};
    if (active !== undefined) patch.active = active;
    if (schedule !== undefined) patch.schedule = schedule;
    if (maxRuns !== undefined) patch.maxRuns = maxRuns;
    if (criteria !== undefined) patch.criteria = criteria;
    if (Object.keys(patch).length > 0) await ctx.db.patch(id, patch);
    return id;
  },
});

export const remove = mutation({
  args: { id: v.id("hunts") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

/** Kick a single hunt check immediately from the widget ("check now"). */
export const runNow = action({
  args: { id: v.id("hunts") },
  handler: async (
    ctx,
    { id },
  ): Promise<
    { skipped: boolean } | { found: boolean; summary: string }
  > => {
    return await ctx.runAction(internal.huntActions.runHunt, { huntId: id });
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers (called by convex/huntActions.ts + the cron)
// ─────────────────────────────────────────────────────────────────────────────

export const _get = internalQuery({
  args: { id: v.id("hunts") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

/** Active hunts whose last check is older than their cadence (or never run). */
export const _dueActive = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const active = await ctx.db
      .query("hunts")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();
    return active.filter((h) => {
      const cadence = scheduleToMs(h.schedule);
      return h.lastCheckedAt == null || now - h.lastCheckedAt >= cadence;
    });
  },
});

/**
 * _recordRun — aria markRun() parity. Bump runs, stamp lastResult/lastCheckedAt;
 * auto-stop (active:false) when the LLM found the goal or maxRuns is reached.
 */
export const _recordRun = internalMutation({
  args: {
    id: v.id("hunts"),
    result: v.string(),
    found: v.boolean(),
  },
  handler: async (ctx, { id, result, found }) => {
    const h = await ctx.db.get(id);
    if (!h) return null;
    const runs = (h.runs ?? 0) + 1;
    const maxRuns = h.maxRuns ?? DEFAULT_MAX_RUNS;
    const patch: Record<string, unknown> = {
      runs,
      lastCheckedAt: Date.now(),
      lastResult: (result || "").slice(0, RESULT_MAX),
    };
    if (found || runs >= maxRuns) patch.active = false; // completed / expired
    await ctx.db.patch(id, patch);
    return { runs, active: patch.active ?? true, found };
  },
});
