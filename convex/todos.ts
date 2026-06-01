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

// ---------------------------------------------------------------------------
// One-time migration from v1 hub-kv.json:home_todos_v1
// ---------------------------------------------------------------------------
// v1 shape: { id, text, done, category, createdAt, ideaId?, dedupKey?, isNewApp? }
// v2 shape: { text, done, priority, tags, position, createdAt }
// Mapping: text→text, done→done (preserved), category→tags:[category].
// Inserts directly (not via `add`) so `done:true` items survive the import.
// Idempotent: skips any row whose (text + createdAt) already exists, so re-running
// in Phase E is a no-op. Run via the Convex dashboard or:
//   npx convex run todos:seedFromV1 '{"items":[{"text":"...","done":false,"category":"general","createdAt":1775847678906}, ...]}'
// (Pass the real home_todos_v1 array from /home/ubuntu/project-hub/data/hub-kv.json.)
export const seedFromV1 = mutation({
  args: {
    items: v.array(
      v.object({
        text: v.string(),
        done: v.optional(v.boolean()),
        category: v.optional(v.string()),
        createdAt: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, { items }) => {
    const existing = await ctx.db.query("todos").collect();
    const seen = new Set(existing.map((t) => `${t.text}::${t.createdAt}`));
    let maxPos = existing.reduce((m, t) => Math.max(m, t.position), -1);
    let inserted = 0;
    let skipped = 0;
    for (const it of items) {
      const createdAt = it.createdAt ?? Date.now();
      const key = `${it.text}::${createdAt}`;
      if (seen.has(key)) {
        skipped++;
        continue;
      }
      maxPos += 1;
      await ctx.db.insert("todos", {
        text: it.text,
        done: it.done ?? false,
        priority: 0,
        tags: it.category ? [it.category] : [],
        position: maxPos,
        createdAt,
      });
      seen.add(key);
      inserted++;
    }
    return { inserted, skipped, total: items.length };
  },
});
