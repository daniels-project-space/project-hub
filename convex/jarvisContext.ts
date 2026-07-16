import { query } from "./_generated/server";

// A deliberately small cross-app read model for JARVIS. The previous caller
// fetched every todo/event and ran the full wealth aggregation on every chat
// turn just to learn a handful of current facts. Keep this API bounded so Hub
// remains the owner of the data without making conversational latency or reads
// grow with the lifetime of the account.
export const snapshot = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const [todos, events, liveWealth] = await Promise.all([
      ctx.db
        .query("todos")
        .withIndex("by_done_position", (q) => q.eq("done", false))
        .order("asc")
        .take(10),
      ctx.db
        .query("events")
        .withIndex("by_start", (q) => q.gte("start", now))
        .order("asc")
        .take(5),
      ctx.db
        .query("currentPrices")
        .withIndex("by_kind", (q) => q.eq("kind", "live"))
        .first(),
    ]);
    return {
      todos,
      events,
      wealth: liveWealth
        ? { currentTotalGBP: liveWealth.totalGBP, currentTotalTs: liveWealth.ts }
        : null,
      generatedAt: now,
    };
  },
});
