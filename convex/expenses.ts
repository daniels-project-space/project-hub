import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/** Reject non-finite numeric inputs (NaN/Infinity) before they reach the DB.
 *  Mirrors the guard in convex/todos.ts so callers get a clear error, not a 500. */
function assertFinite(name: string, value: number | undefined): void {
  if (value !== undefined && !Number.isFinite(value)) {
    throw new Error(`Invalid ${name}: must be a finite number`);
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------
export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("expenses")
      .withIndex("by_createdAt")
      .order("asc")
      .collect();
  },
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------
export const add = mutation({
  args: {
    name: v.string(),
    amountGBP: v.number(),
    category: v.optional(v.string()),
    recurring: v.optional(v.boolean()),
    dueDay: v.optional(v.number()),
    ownerId: v.optional(v.string()),
  },
  handler: async (ctx, { name, amountGBP, category, recurring, dueDay, ownerId }) => {
    assertFinite("amountGBP", amountGBP);
    assertFinite("dueDay", dueDay);
    return await ctx.db.insert("expenses", {
      name,
      amountGBP,
      category,
      recurring,
      dueDay,
      createdAt: Date.now(),
      ownerId,
    });
  },
});

// Alias for engine-consistency (create == add).
export const create = add;

export const update = mutation({
  args: {
    id: v.id("expenses"),
    name: v.optional(v.string()),
    amountGBP: v.optional(v.number()),
    category: v.optional(v.string()),
    recurring: v.optional(v.boolean()),
    dueDay: v.optional(v.number()),
    ownerId: v.optional(v.string()),
  },
  handler: async (ctx, { id, amountGBP, dueDay, ...rest }) => {
    assertFinite("amountGBP", amountGBP);
    assertFinite("dueDay", dueDay);
    const patch: Record<string, unknown> = {};
    for (const [k, val] of Object.entries({ amountGBP, dueDay, ...rest })) {
      if (val !== undefined) patch[k] = val;
    }
    await ctx.db.patch(id, patch);
    return id;
  },
});

export const remove = mutation({
  args: { id: v.id("expenses") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

// ---------------------------------------------------------------------------
// One-time migration from v1 hub-kv.json:home_expenses_v1
// ---------------------------------------------------------------------------
// v1 shape: { id, name, amount, createdAt }  (amount in GBP)
// v2 shape: { name, amountGBP: amount, createdAt }
// Idempotent: skips any row whose (name + createdAt) already exists, so re-running
// in Phase E is a no-op. Run via the Convex dashboard or:
//   npx convex run expenses:seedFromV1 '{"items":[{"name":"Rent","amount":1690,"createdAt":1775398410314}, ...]}'
// (Pass the real home_expenses_v1 array from /home/ubuntu/project-hub/data/hub-kv.json.)
export const seedFromV1 = mutation({
  args: {
    items: v.array(
      v.object({
        name: v.string(),
        amount: v.number(),
        createdAt: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, { items }) => {
    const existing = await ctx.db.query("expenses").collect();
    const seen = new Set(existing.map((e) => `${e.name}::${e.createdAt}`));
    let inserted = 0;
    let skipped = 0;
    for (const it of items) {
      if (!Number.isFinite(it.amount)) {
        skipped++;
        continue;
      }
      const createdAt = it.createdAt ?? Date.now();
      const key = `${it.name}::${createdAt}`;
      if (seen.has(key)) {
        skipped++;
        continue;
      }
      await ctx.db.insert("expenses", {
        name: it.name,
        amountGBP: it.amount,
        createdAt,
      });
      seen.add(key);
      inserted++;
    }
    return { inserted, skipped, total: items.length };
  },
});
