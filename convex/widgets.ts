import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("widgets")
      .withIndex("by_position")
      .order("asc")
      .collect();
  },
});

export const upsert = mutation({
  args: {
    id: v.optional(v.id("widgets")),
    type: v.string(),
    position: v.number(),
    enabled: v.boolean(),
    config: v.any(),
  },
  handler: async (ctx, { id, ...rest }) => {
    if (id) {
      await ctx.db.patch(id, rest);
      return id;
    }
    return await ctx.db.insert("widgets", rest);
  },
});

export const remove = mutation({
  args: { id: v.id("widgets") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
