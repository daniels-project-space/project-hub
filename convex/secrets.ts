import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import {
  requireHiggsfieldCredentialBundleRead,
  requireHiggsfieldCredentialBundleWrite,
  requireVaultRead,
  requireVaultRoot,
  requireVaultWrite,
} from "./vaultAuth";

// CRITICAL: secrets values are written here. None of these queries should ever
// be exposed to anonymous clients in production. Server-only callers should
// use the action layer with auth on top once the hub has user accounts.

const HIGGSFIELD_SERVICE = "higgsfield";
const HIGGSFIELD_SESSION_KEY = "HIGGSFIELD_SESSION";
const HIGGSFIELD_SESSION_VERSION = 1;
const MAX_HIGGSFIELD_SESSION_BYTES = 32 * 1024;
const MAX_OAUTH_TOKEN_CHARS = 16 * 1024;
const MAX_CLIENT_ID_CHARS = 1024;
const MAX_SCOPE_CHARS = 4096;
const MAX_TOKEN_TYPE_CHARS = 128;
const MAX_ISSUER_CHARS = 2048;

type HiggsfieldSession = {
  version: 1;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  clientId: string;
  scope?: string;
  tokenType?: string;
  issuer?: string;
  idToken?: string;
};

function assertBoundedString(value: unknown, field: string, maximum: number): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw new Error(`Invalid Higgsfield session ${field}`);
  }
}

function assertHttpsClientMetadataUrl(value: unknown): asserts value is string {
  assertBoundedString(value, "clientId", MAX_CLIENT_ID_CHARS);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Higgsfield session clientId must be an HTTPS URL");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("Higgsfield session clientId must be an HTTPS metadata URL");
  }
}

function parseHiggsfieldSession(value: string): HiggsfieldSession {
  if (new TextEncoder().encode(value).byteLength > MAX_HIGGSFIELD_SESSION_BYTES) {
    throw new Error("Higgsfield session exceeds the maximum size");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Higgsfield session must be valid JSON");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Higgsfield session must be an object");
  }

  const session = parsed as Record<string, unknown>;
  const allowedFields = new Set([
    "version",
    "accessToken",
    "refreshToken",
    "expiresAt",
    "clientId",
    "scope",
    "tokenType",
    "issuer",
    "idToken",
  ]);
  if (Object.keys(session).some((field) => !allowedFields.has(field))) {
    throw new Error("Higgsfield session contains unsupported fields");
  }
  if (session.version !== HIGGSFIELD_SESSION_VERSION) {
    throw new Error("Unsupported Higgsfield session version");
  }

  assertBoundedString(session.accessToken, "accessToken", MAX_OAUTH_TOKEN_CHARS);
  assertBoundedString(session.refreshToken, "refreshToken", MAX_OAUTH_TOKEN_CHARS);
  assertHttpsClientMetadataUrl(session.clientId);
  if (
    !Number.isSafeInteger(session.expiresAt) ||
    (session.expiresAt as number) <= 0
  ) {
    throw new Error("Invalid Higgsfield session expiresAt");
  }
  if (session.scope !== undefined) {
    assertBoundedString(session.scope, "scope", MAX_SCOPE_CHARS);
  }
  if (session.tokenType !== undefined) {
    assertBoundedString(session.tokenType, "tokenType", MAX_TOKEN_TYPE_CHARS);
  }
  if (session.issuer !== undefined) {
    assertBoundedString(session.issuer, "issuer", MAX_ISSUER_CHARS);
  }
  if (session.idToken !== undefined) {
    assertBoundedString(session.idToken, "idToken", MAX_OAUTH_TOKEN_CHARS);
  }

  return session as HiggsfieldSession;
}

function assertRevision(revision: number): void {
  if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) {
    throw new Error("Invalid expected credential revision");
  }
}

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

/**
 * Reads only the fixed Media Engine OAuth bundle and its CAS revision. This is
 * intentionally narrower than listByService so a renderer capability cannot
 * enumerate unrelated Higgsfield credentials.
 */
export const getCredentialBundle = query({
  args: { vaultToken: v.optional(v.string()) },
  handler: async (ctx, { vaultToken }) => {
    await requireHiggsfieldCredentialBundleRead(ctx, { vaultToken });
    const rows = await ctx.db
      .query("secrets")
      .withIndex("by_service_and_key", (q) =>
        q.eq("service", HIGGSFIELD_SERVICE).eq("keyName", HIGGSFIELD_SESSION_KEY),
      )
      .collect();
    if (rows.length > 1) {
      throw new Error("Credential bundle requires root deduplication before use");
    }

    const existing = rows[0];
    return existing
      ? { value: existing.value, revision: existing.revision ?? 0 }
      : null;
  },
});

/**
 * Atomically rotates the one Media Engine Higgsfield OAuth credential bundle.
 *
 * The fixed key prevents a scoped renderer credential from being repurposed to
 * alter another service. `expectedRevision` is mandatory so two refreshes
 * cannot silently overwrite each other: read the current row, then retry only
 * with its revision. This uses strict auth even while the legacy vault bridge
 * is being phased out.
 */
export const rotateCredentialBundle = mutation({
  args: {
    vaultToken: v.optional(v.string()),
    value: v.string(),
    // `null` is an explicit create-only precondition. A number is an
    // update-only precondition and must match a previously read revision.
    expectedRevision: v.union(v.null(), v.number()),
  },
  handler: async (ctx, { vaultToken, value, expectedRevision }) => {
    if (expectedRevision !== null) assertRevision(expectedRevision);
    await requireHiggsfieldCredentialBundleWrite(ctx, { vaultToken });
    parseHiggsfieldSession(value);

    const rows = await ctx.db
      .query("secrets")
      .withIndex("by_service_and_key", (q) =>
        q.eq("service", HIGGSFIELD_SERVICE).eq("keyName", HIGGSFIELD_SESSION_KEY),
      )
      .collect();
    if (rows.length > 1) {
      throw new Error("Credential bundle requires root deduplication before rotation");
    }

    const existing = rows[0];
    const currentRevision = existing?.revision ?? 0;
    if (
      (expectedRevision === null && existing) ||
      (expectedRevision !== null && (!existing || currentRevision !== expectedRevision))
    ) {
      throw new Error("Credential bundle changed; re-read before retrying");
    }

    const revision = currentRevision + 1;
    if (existing) {
      await ctx.db.patch(existing._id, { value, revision });
      return { created: false, revision };
    }

    await ctx.db.insert("secrets", {
      service: HIGGSFIELD_SERVICE,
      keyName: HIGGSFIELD_SESSION_KEY,
      value,
      revision,
      description: "Media Engine Higgsfield OAuth session (rotated by CAS)",
      scopes: ["media-engine", "higgsfield", "oauth"],
      aliases: [],
      sourceFiles: ["media-engine/cloud-oauth"],
    });
    return { created: true, revision };
  },
});

/**
 * One-time repair path for legacy duplicate rows. It is deliberately root-only
 * and requires an explicit row to retain; normal credential writers cannot
 * choose a winner or delete another row.
 */
export const deduplicateCredentialBundle = mutation({
  args: { rootToken: v.string(), keepId: v.id("secrets") },
  handler: async (ctx, { rootToken, keepId }) => {
    requireVaultRoot(rootToken);
    const rows = await ctx.db
      .query("secrets")
      .withIndex("by_service_and_key", (q) =>
        q.eq("service", HIGGSFIELD_SERVICE).eq("keyName", HIGGSFIELD_SESSION_KEY),
      )
      .collect();
    const keep = rows.find((row) => row._id === keepId);
    if (!keep) throw new Error("Selected credential bundle row is invalid");

    let removed = 0;
    for (const row of rows) {
      if (row._id === keepId) continue;
      await ctx.db.delete(row._id);
      removed += 1;
    }
    return { removed, revision: keep.revision ?? 0 };
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
