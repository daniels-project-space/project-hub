import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import {
  requireStrictVaultWrite,
  requireVaultRead,
  requireVaultWrite,
} from "./vaultAuth";

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
    // Do not let an unauthenticated caller use the mutation as an ID-existence
    // oracle. Scoped writers can delete records in their own services; only a
    // root/all-services writer may confirm that an arbitrary ID is absent.
    if (!row) {
      await requireVaultWrite(ctx, { vaultToken }, ["*"]);
      return { deleted: null };
    }
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

const CJ_SERVICE = "cj" as const;
const CJ_REQUIRED_KEYS = [
  "CJ_OPEN_ID",
  "CJ_ACCESS_TOKEN",
  "CJ_REFRESH_TOKEN",
] as const;
const CJ_OPTIONAL_KEYS = [
  "CJ_ACCESS_TOKEN_EXPIRY_DATE",
  "CJ_REFRESH_TOKEN_EXPIRY_DATE",
] as const;
const CJ_KEYS = [...CJ_REQUIRED_KEYS, ...CJ_OPTIONAL_KEYS] as const;
type CjKey = (typeof CJ_KEYS)[number];
type CjBundle = {
  CJ_OPEN_ID: string;
  CJ_ACCESS_TOKEN: string;
  CJ_REFRESH_TOKEN: string;
  CJ_ACCESS_TOKEN_EXPIRY_DATE?: string;
  CJ_REFRESH_TOKEN_EXPIRY_DATE?: string;
};

const cjBundleValidator = v.object({
  CJ_OPEN_ID: v.string(),
  CJ_ACCESS_TOKEN: v.string(),
  CJ_REFRESH_TOKEN: v.string(),
  CJ_ACCESS_TOKEN_EXPIRY_DATE: v.optional(v.string()),
  CJ_REFRESH_TOKEN_EXPIRY_DATE: v.optional(v.string()),
});

function isBoundedNonempty(value: string, maximum: number): boolean {
  return value.length > 0 && value.length <= maximum && value.trim().length > 0;
}

function assertBoundedNonempty(value: string, maximum: number): void {
  if (!isBoundedNonempty(value, maximum)) {
    throw new Error("Invalid CJ token bundle");
  }
}

function validateExpectedRefreshToken(expectedRefreshToken: string | undefined): void {
  if (expectedRefreshToken !== undefined) {
    assertBoundedNonempty(expectedRefreshToken, 4096);
  }
}

function isValidCjBundle(bundle: CjBundle): boolean {
  return (
    /^\d{1,20}$/.test(bundle.CJ_OPEN_ID) &&
    isBoundedNonempty(bundle.CJ_ACCESS_TOKEN, 4096) &&
    isBoundedNonempty(bundle.CJ_REFRESH_TOKEN, 4096) &&
    (bundle.CJ_ACCESS_TOKEN_EXPIRY_DATE === undefined ||
      isBoundedNonempty(bundle.CJ_ACCESS_TOKEN_EXPIRY_DATE, 128)) &&
    (bundle.CJ_REFRESH_TOKEN_EXPIRY_DATE === undefined ||
      isBoundedNonempty(bundle.CJ_REFRESH_TOKEN_EXPIRY_DATE, 128))
  );
}

function validateCjBundle(bundle: CjBundle): void {
  if (!isValidCjBundle(bundle)) throw new Error("Invalid CJ token bundle");
}

function constantTimeSecretEqual(left: string, right: string): boolean {
  let mismatch = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |=
      (left.charCodeAt(index % Math.max(1, left.length)) || 0) ^
      (right.charCodeAt(index % Math.max(1, right.length)) || 0);
  }
  return mismatch === 0;
}

type CjRows = Partial<Record<CjKey, Doc<"secrets">>>;
type CjInspection =
  | { kind: "empty"; rows: CjRows; retainedKeys: CjKey[] }
  | { kind: "complete"; rows: CjRows; retainedKeys: CjKey[] }
  | { kind: "ambiguous"; retainedKeys: CjKey[] };

async function inspectCjBundle(ctx: Pick<QueryCtx, "db">): Promise<CjInspection> {
  const serviceRows = await ctx.db
    .query("secrets")
    .withIndex("by_service", (q) => q.eq("service", CJ_SERVICE))
    .collect();
  const acceptedRows = serviceRows.filter((row) =>
    (CJ_KEYS as readonly string[]).includes(row.keyName),
  );
  const rowsByKey = new Map<CjKey, Doc<"secrets">[]>();
  for (const key of CJ_KEYS) rowsByKey.set(key, []);
  for (const row of acceptedRows) {
    rowsByKey.get(row.keyName as CjKey)?.push(row);
  }

  const retainedKeys = CJ_KEYS.filter((key) => (rowsByKey.get(key)?.length ?? 0) > 0);
  if (CJ_KEYS.some((key) => (rowsByKey.get(key)?.length ?? 0) > 1)) {
    return { kind: "ambiguous", retainedKeys };
  }
  if (retainedKeys.length === 0) return { kind: "empty", rows: {}, retainedKeys };
  if (CJ_REQUIRED_KEYS.some((key) => rowsByKey.get(key)?.length !== 1)) {
    return { kind: "ambiguous", retainedKeys };
  }

  const rows: CjRows = {};
  for (const key of retainedKeys) rows[key] = rowsByKey.get(key)?.[0];
  const currentBundle: CjBundle = {
    CJ_OPEN_ID: rows.CJ_OPEN_ID!.value,
    CJ_ACCESS_TOKEN: rows.CJ_ACCESS_TOKEN!.value,
    CJ_REFRESH_TOKEN: rows.CJ_REFRESH_TOKEN!.value,
    ...(rows.CJ_ACCESS_TOKEN_EXPIRY_DATE
      ? { CJ_ACCESS_TOKEN_EXPIRY_DATE: rows.CJ_ACCESS_TOKEN_EXPIRY_DATE.value }
      : {}),
    ...(rows.CJ_REFRESH_TOKEN_EXPIRY_DATE
      ? { CJ_REFRESH_TOKEN_EXPIRY_DATE: rows.CJ_REFRESH_TOKEN_EXPIRY_DATE.value }
      : {}),
  };
  if (!isValidCjBundle(currentBundle)) return { kind: "ambiguous", retainedKeys };
  return { kind: "complete", rows, retainedKeys };
}

function durableBundleEquals(rows: CjRows, bundle: CjBundle): boolean {
  return CJ_KEYS.every((key) => {
    const desired = bundle[key];
    const current = rows[key];
    return desired === undefined
      ? current === undefined
      : current !== undefined && constantTimeSecretEqual(current.value, desired);
  });
}

function replacementKeys(bundle: CjBundle): CjKey[] {
  return CJ_KEYS.filter((key) => bundle[key] !== undefined);
}

/**
 * Strict, non-secret readiness check for a CJ coordinator. This must run before
 * consuming CJ's one-time refresh operation.
 */
export const preflightCjTokenBundle = query({
  args: {
    service: v.literal(CJ_SERVICE),
    vaultToken: v.optional(v.string()),
    expectedRefreshToken: v.optional(v.string()),
  },
  handler: async (ctx, { vaultToken, expectedRefreshToken }) => {
    await requireStrictVaultWrite(ctx, { vaultToken }, CJ_SERVICE);
    validateExpectedRefreshToken(expectedRefreshToken);
    const inspection = await inspectCjBundle(ctx);
    if (inspection.kind === "ambiguous") {
      return { status: "ambiguous" as const, retainedKeys: inspection.retainedKeys };
    }
    if (inspection.kind === "empty") {
      return {
        status: expectedRefreshToken === undefined ? ("ready" as const) : ("conflict" as const),
        retainedKeys: inspection.retainedKeys,
      };
    }
    return {
      status:
        expectedRefreshToken !== undefined &&
        inspection.rows.CJ_REFRESH_TOKEN !== undefined &&
        constantTimeSecretEqual(
          inspection.rows.CJ_REFRESH_TOKEN.value,
          expectedRefreshToken,
        )
          ? ("ready" as const)
          : ("conflict" as const),
      retainedKeys: inspection.retainedKeys,
    };
  },
});

/**
 * Atomically replaces the complete CJ credential bundle. Convex transaction
 * OCC is the sole serialization and commit boundary.
 */
export const compareAndSwapCjTokenBundle = mutation({
  args: {
    service: v.literal(CJ_SERVICE),
    vaultToken: v.optional(v.string()),
    expectedRefreshToken: v.optional(v.string()),
    bundle: cjBundleValidator,
  },
  handler: async (ctx, { vaultToken, expectedRefreshToken, bundle }) => {
    await requireStrictVaultWrite(ctx, { vaultToken }, CJ_SERVICE);
    validateExpectedRefreshToken(expectedRefreshToken);
    validateCjBundle(bundle);

    const inspection = await inspectCjBundle(ctx);
    if (inspection.kind === "ambiguous") return { status: "ambiguous" as const };

    if (inspection.kind === "empty") {
      if (expectedRefreshToken !== undefined) return { status: "conflict" as const };
    } else {
      if (expectedRefreshToken === undefined) return { status: "conflict" as const };
      if (durableBundleEquals(inspection.rows, bundle)) {
        return { status: "written" as const, retainedKeys: replacementKeys(bundle) };
      }

      const currentRefreshToken = inspection.rows.CJ_REFRESH_TOKEN?.value;
      if (
        currentRefreshToken === undefined ||
        !constantTimeSecretEqual(currentRefreshToken, expectedRefreshToken)
      ) {
        return { status: "conflict" as const };
      }

      // A successful replacement must advance the CAS token. This makes a
      // response-loss replay idempotent without allowing a changed payload to
      // reuse the already-current refresh token.
      if (constantTimeSecretEqual(bundle.CJ_REFRESH_TOKEN, expectedRefreshToken)) {
        return { status: "conflict" as const };
      }
    }

    const currentRows = inspection.rows;
    for (const key of CJ_KEYS) {
      const value = bundle[key];
      const current = currentRows[key];
      if (value === undefined) {
        if (current) await ctx.db.delete(current._id);
      } else if (current) {
        // Patch only the value so all existing non-secret metadata survives.
        await ctx.db.patch(current._id, { value });
      } else {
        await ctx.db.insert("secrets", {
          service: CJ_SERVICE,
          keyName: key,
          value,
          scopes: [CJ_SERVICE],
          aliases: [],
          sourceFiles: [],
        });
      }
    }

    return { status: "written" as const, retainedKeys: replacementKeys(bundle) };
  },
});
