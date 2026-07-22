import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireVaultDelete, requireVaultRead, requireVaultWrite } from "./vaultAuth";
import { assertAllowedSecretReference } from "./vaultPolicy";

// CRITICAL: secrets values are written here. None of these queries should ever
// be exposed to anonymous clients in production. Server-only callers should
// use the action layer with auth on top once the hub has user accounts.

export const listByService = query({
  args: { service: v.string(), vaultToken: v.optional(v.string()) },
  handler: async (ctx, { service, vaultToken }) => {
    assertAllowedSecretReference({ service });
    await requireVaultRead(ctx, { vaultToken }, service);
    const rows = await ctx.db
      .query("secrets")
      .withIndex("by_service", (q) => q.eq("service", service))
      .collect();
    // Defensive handling for pre-policy rows: an otherwise harmless service
    // must not become a route to a forbidden key or alias.
    for (const row of rows) assertAllowedSecretReference(row);
    return rows;
  },
});

export const getOne = query({
  args: { service: v.string(), keyName: v.string(), vaultToken: v.optional(v.string()) },
  handler: async (ctx, { service, keyName, vaultToken }) => {
    assertAllowedSecretReference({ service, keyName });
    await requireVaultRead(ctx, { vaultToken }, service);
    const row = await ctx.db
      .query("secrets")
      .withIndex("by_service_and_key", (q) =>
        q.eq("service", service).eq("keyName", keyName),
      )
      .first();
    if (row) assertAllowedSecretReference(row);
    return row;
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
    // Validate the whole batch before authentication or the first insert: a
    // mixed request must never partially persist its otherwise-valid items.
    for (const item of items) {
      assertAllowedSecretReference(item);
    }
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
    // Do not let an unauthenticated caller use the mutation as an ID-existence
    // oracle. Scoped writers can delete records in their own services; only a
    // root/all-services writer may confirm that an arbitrary ID is absent.
    if (!row) {
      await requireVaultWrite(ctx, { vaultToken }, ["*"]);
      return { deleted: null };
    }
    await requireVaultDelete(ctx, { vaultToken }, row);
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
