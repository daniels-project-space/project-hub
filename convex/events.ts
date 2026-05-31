import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/** Reject non-finite numeric inputs (NaN/Infinity) before they reach the DB. */
function assertFinite(name: string, value: number | undefined): void {
  if (value !== undefined && !Number.isFinite(value)) {
    throw new Error(`Invalid ${name}: must be a finite number`);
  }
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("events")
      .withIndex("by_start")
      .order("asc")
      .collect();
  },
});

export const create = mutation({
  args: {
    title: v.string(),
    start: v.number(),
    end: v.optional(v.number()),
    allDay: v.optional(v.boolean()),
    color: v.optional(v.string()),
    location: v.optional(v.string()),
    notes: v.optional(v.string()),
    ownerId: v.optional(v.string()),
  },
  handler: async (ctx, { title, start, end, allDay, color, location, notes, ownerId }) => {
    assertFinite("start", start);
    assertFinite("end", end);
    return await ctx.db.insert("events", {
      title,
      start,
      end,
      allDay: allDay ?? false,
      color: color ?? "brass",
      location,
      notes,
      ownerId,
    });
  },
});

// Alias for engine-consistency (add == create).
export const add = create;

export const update = mutation({
  args: {
    id: v.id("events"),
    title: v.optional(v.string()),
    start: v.optional(v.number()),
    end: v.optional(v.number()),
    allDay: v.optional(v.boolean()),
    color: v.optional(v.string()),
    location: v.optional(v.string()),
    notes: v.optional(v.string()),
    ownerId: v.optional(v.string()),
  },
  handler: async (ctx, { id, start, end, ...rest }) => {
    assertFinite("start", start);
    assertFinite("end", end);
    const patch: Record<string, unknown> = {};
    for (const [k, val] of Object.entries({ start, end, ...rest })) {
      if (val !== undefined) patch[k] = val;
    }
    await ctx.db.patch(id, patch);
    return id;
  },
});

export const remove = mutation({
  args: { id: v.id("events") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
