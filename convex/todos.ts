import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/** Reject non-finite numeric inputs (NaN/Infinity) before they reach the DB.
 *  The real Convex deployment rejects non-finite f64 at serialization time;
 *  this guards the app layer so callers get a clear error instead of a 500. */
function assertFinite(name: string, value: number | undefined): void {
  if (value !== undefined && !Number.isFinite(value)) {
    throw new Error(`Invalid ${name}: must be a finite number`);
  }
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("todos")
      .withIndex("by_position")
      .order("asc")
      .collect();
  },
});

export const add = mutation({
  args: {
    text: v.string(),
    priority: v.optional(v.number()),
    dueDate: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
    projectSlug: v.optional(v.string()),
    ownerId: v.optional(v.string()),
  },
  handler: async (ctx, { text, priority, dueDate, tags, projectSlug, ownerId }) => {
    assertFinite("priority", priority);
    assertFinite("dueDate", dueDate);
    const existing = await ctx.db.query("todos").collect();
    const maxPos = existing.reduce((m, t) => Math.max(m, t.position), -1);
    return await ctx.db.insert("todos", {
      text,
      done: false,
      priority: priority ?? 0,
      dueDate,
      tags: tags ?? [],
      projectSlug,
      position: maxPos + 1,
      createdAt: Date.now(),
      ownerId,
    });
  },
});

// Alias for engine-consistency (create == add).
export const create = add;

export const update = mutation({
  args: {
    id: v.id("todos"),
    text: v.optional(v.string()),
    done: v.optional(v.boolean()),
    priority: v.optional(v.number()),
    dueDate: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
    projectSlug: v.optional(v.string()),
    ownerId: v.optional(v.string()),
  },
  handler: async (ctx, { id, priority, dueDate, ...rest }) => {
    assertFinite("priority", priority);
    assertFinite("dueDate", dueDate);
    const patch: Record<string, unknown> = {};
    for (const [k, val] of Object.entries({ priority, dueDate, ...rest })) {
      if (val !== undefined) patch[k] = val;
    }
    await ctx.db.patch(id, patch);
    return id;
  },
});

export const remove = mutation({
  args: { id: v.id("todos") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

export const reorder = mutation({
  args: { ids: v.array(v.id("todos")) },
  handler: async (ctx, { ids }) => {
    for (let i = 0; i < ids.length; i++) {
      await ctx.db.patch(ids[i], { position: i });
    }
  },
});
