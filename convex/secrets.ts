import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// CRITICAL: secrets values are written here. None of these queries should ever
// be exposed to anonymous clients in production. Server-only callers should
// use the action layer with auth on top once the hub has user accounts.

export const listByService = query({
  args: { service: v.string() },
  handler: async (ctx, { service }) => {
    return await ctx.db
      .query("secrets")
      .withIndex("by_service", (q) => q.eq("service", service))
      .collect();
  },
});

export const getOne = query({
  args: { service: v.string(), keyName: v.string() },
  handler: async (ctx, { service, keyName }) => {
    return await ctx.db
      .query("secrets")
      .withIndex("by_service_and_key", (q) =>
        q.eq("service", service).eq("keyName", keyName),
      )
      .first();
  },
});

export const summary = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("secrets").collect();
    const byService: Record<string, number> = {};
    for (const s of all) {
      byService[s.service] = (byService[s.service] ?? 0) + 1;
    }
    return { total: all.length, byService };
  },
});

export const bulkInsert = mutation({
  args: {
    items: v.array(
      v.object({
        service: v.string(),
        keyName: v.string(),
        value: v.string(),
        scopes: v.array(v.string()),
        aliases: v.array(v.string()),
        sourceFiles: v.array(v.string()),
      }),
    ),
  },
  handler: async (ctx, { items }) => {
    let inserted = 0;
    for (const item of items) {
      await ctx.db.insert("secrets", item);
      inserted += 1;
    }
    return { inserted };
  },
});

export const truncate = mutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("secrets").collect();
    for (const row of all) await ctx.db.delete(row._id);
    return { deleted: all.length };
  },
});
