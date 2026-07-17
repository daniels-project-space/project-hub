import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireVaultRead, requireVaultWrite } from "./vaultAuth";

// CRITICAL: secrets values are written here. None of these queries should ever
// be exposed to anonymous clients in production. Server-only callers should
// use the action layer with auth on top once the hub has user accounts.

export const listByService = query({
  args: { service: v.string(), vaultToken: v.optional(v.string()) },
  handler: async (ctx, { service, vaultToken }) => {
    await requireVaultRead(ctx, { vaultToken }, service);
    return await ctx.db
      .query("secrets")
      .withIndex("by_service", (q) => q.eq("service", service))
      .collect();
  },
});

export const getOne = query({
  args: { service: v.string(), keyName: v.string(), vaultToken: v.optional(v.string()) },
  handler: async (ctx, { service, keyName, vaultToken }) => {
    await requireVaultRead(ctx, { vaultToken }, service);
    return await ctx.db
      .query("secrets")
      .withIndex("by_service_and_key", (q) =>
        q.eq("service", service).eq("keyName", keyName),
      )
      .first();
  },
});

export const summary = query({
  args: { vaultToken: v.optional(v.string()) },
  handler: async (ctx, { vaultToken }) => {
    await requireVaultRead(ctx, { vaultToken }, "*");
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
    vaultToken: v.optional(v.string()),
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
  handler: async (ctx, { items, vaultToken }) => {
    await requireVaultWrite(ctx, { vaultToken }, [...new Set(items.map((item) => item.service))]);
    let inserted = 0;
    for (const item of items) {
      await ctx.db.insert("secrets", item);
      inserted += 1;
    }
    return { inserted };
  },
});

export const deleteOne = mutation({
  args: { id: v.id("secrets"), vaultToken: v.optional(v.string()) },
  handler: async (ctx, { id, vaultToken }) => {
    const row = await ctx.db.get(id);
    if (!row) return { deleted: null };
    await requireVaultWrite(ctx, { vaultToken }, [row.service]);
    await ctx.db.delete(id);
    return { deleted: id };
  },
});

export const truncate = mutation({
  args: { vaultToken: v.optional(v.string()) },
  handler: async (ctx, { vaultToken }) => {
    await requireVaultWrite(ctx, { vaultToken }, ["*"]);
    const all = await ctx.db.query("secrets").collect();
    for (const row of all) await ctx.db.delete(row._id);
    return { deleted: all.length };
  },
});
