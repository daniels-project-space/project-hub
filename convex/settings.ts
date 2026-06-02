import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

// Settings layer (Pass 1). Stored as one row per key in the `settings` table;
// surfaced to the client as a single flat Record<string, any>.

// Return all settings as a flat object: { [key]: value }.
export const all = query({
  args: {},
  handler: async (ctx): Promise<Record<string, unknown>> => {
    const rows = await ctx.db.query("settings").collect();
    const out: Record<string, unknown> = {};
    for (const row of rows) out[row.key] = row.value;
    return out;
  },
});

// Upsert a single setting by key: patch the existing row if present, else insert.
export const set = mutation({
  args: { key: v.string(), value: v.any() },
  handler: async (ctx, { key, value }) => {
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { value });
      return existing._id;
    }
    return await ctx.db.insert("settings", { key, value });
  },
});
