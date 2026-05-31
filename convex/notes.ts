import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("notes")
      .withIndex("by_position")
      .order("asc")
      .collect();
  },
});

export const add = mutation({
  args: {
    text: v.string(),
    color: v.optional(v.string()),
    pinned: v.optional(v.boolean()),
    ownerId: v.optional(v.string()),
  },
  handler: async (ctx, { text, color, pinned, ownerId }) => {
    const existing = await ctx.db.query("notes").collect();
    const maxPos = existing.reduce((m, n) => Math.max(m, n.position), -1);
    return await ctx.db.insert("notes", {
      text,
      color: color ?? "amber",
      pinned: pinned ?? false,
      position: maxPos + 1,
      updatedAt: Date.now(),
      ownerId,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("notes"),
    text: v.optional(v.string()),
    color: v.optional(v.string()),
    pinned: v.optional(v.boolean()),
    ownerId: v.optional(v.string()),
  },
  handler: async (ctx, { id, ownerId, ...rest }) => {
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [k, val] of Object.entries(rest)) {
      if (val !== undefined) patch[k] = val;
    }
    if (ownerId !== undefined) patch.ownerId = ownerId;
    await ctx.db.patch(id, patch);
    return id;
  },
});

export const remove = mutation({
  args: { id: v.id("notes") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

export const reorder = mutation({
  args: { ids: v.array(v.id("notes")) },
  handler: async (ctx, { ids }) => {
    for (let i = 0; i < ids.length; i++) {
      await ctx.db.patch(ids[i], { position: i });
    }
  },
});
