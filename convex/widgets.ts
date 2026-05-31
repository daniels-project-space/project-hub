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

// Drag-reorder: ids in their new visual order → positions 0..n-1.
export const reorder = mutation({
  args: { ids: v.array(v.id("widgets")) },
  handler: async (ctx, { ids }) => {
    for (let i = 0; i < ids.length; i++) {
      await ctx.db.patch(ids[i], { position: i });
    }
  },
});

// Eye-toggle: show/hide a single widget.
export const setEnabled = mutation({
  args: { id: v.id("widgets"), enabled: v.boolean() },
  handler: async (ctx, { id, enabled }) => {
    await ctx.db.patch(id, { enabled });
    return id;
  },
});

// Idempotent seed of the five Pass-1 widgets. No-op if the table is non-empty.
const DEFAULT_WIDGETS: { type: string; position: number }[] = [
  { type: "notes", position: 0 },
  { type: "calendar", position: 1 },
  { type: "todo", position: 2 },
  { type: "wealth", position: 3 },
  { type: "projects", position: 4 },
];

export const seed = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("widgets").collect();
    if (existing.length > 0) {
      return { seeded: 0, reason: "table not empty", existing: existing.length };
    }
    let seeded = 0;
    for (const w of DEFAULT_WIDGETS) {
      await ctx.db.insert("widgets", {
        type: w.type,
        position: w.position,
        enabled: true,
        config: {},
      });
      seeded += 1;
    }
    return { seeded };
  },
});
