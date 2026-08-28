import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import {
  PRIVATE_CREATION_ASSET_V2_VAULT_CLIENT,
  PRIVATE_CREATION_ASSET_V2_VAULT_SERVICE,
  requirePrivateCreationAssetV2CredentialRead,
  requireVaultRoot,
} from "./vaultAuth";

const R2_ENDPOINT_KEY = "R2_ENDPOINT";
const R2_ACCESS_KEY_ID_KEY = "R2_ACCESS_KEY_ID";
const R2_SECRET_ACCESS_KEY_KEY = "R2_SECRET_ACCESS_KEY";
const R2_SESSION_TOKEN_KEY = "R2_SESSION_TOKEN";
const REQUIRED_R2_KEYS = [
  R2_ENDPOINT_KEY,
  R2_ACCESS_KEY_ID_KEY,
  R2_SECRET_ACCESS_KEY_KEY,
] as const;
const ALLOWED_R2_KEYS = [...REQUIRED_R2_KEYS, R2_SESSION_TOKEN_KEY] as const;
const R2_ENDPOINT_HOST = /^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/;
const MAX_R2_CREDENTIAL_CHARS = 1024;

type R2CredentialKey = (typeof ALLOWED_R2_KEYS)[number];
type R2CredentialInput = {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
};

function assertR2CredentialValue(value: string, keyName: R2CredentialKey): string {
  if (value.length === 0 || value.length > MAX_R2_CREDENTIAL_CHARS) {
    throw new Error(`Invalid ${keyName} credential`);
  }
  return value;
}

function canonicalR2Endpoint(value: string): string {
  assertR2CredentialValue(value, R2_ENDPOINT_KEY);
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error("R2_ENDPOINT must be an approved Cloudflare R2 HTTPS endpoint");
  }

  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.port ||
    endpoint.pathname !== "/" ||
    endpoint.search ||
    endpoint.hash ||
    !R2_ENDPOINT_HOST.test(endpoint.hostname)
  ) {
    throw new Error("R2_ENDPOINT must be an approved Cloudflare R2 HTTPS endpoint");
  }

  return endpoint.origin;
}

function exactR2CredentialRows(rows: Array<{ keyName: string; value: string }>) {
  if (rows.length < REQUIRED_R2_KEYS.length || rows.length > ALLOWED_R2_KEYS.length) {
    throw new Error("Private creation asset V2 credentials require only the fixed R2 keys");
  }

  const values = new Map(rows.map((row) => [row.keyName, row.value]));
  if (
    values.size !== rows.length ||
    rows.some((row) => !ALLOWED_R2_KEYS.includes(row.keyName as R2CredentialKey)) ||
    REQUIRED_R2_KEYS.some((keyName) => !values.has(keyName))
  ) {
    throw new Error("Private creation asset V2 credentials require only the fixed R2 keys");
  }

  const secrets: {
    R2_ENDPOINT: string;
    R2_ACCESS_KEY_ID: string;
    R2_SECRET_ACCESS_KEY: string;
    R2_SESSION_TOKEN?: string;
  } = {
    R2_ENDPOINT: canonicalR2Endpoint(values.get(R2_ENDPOINT_KEY)!),
    R2_ACCESS_KEY_ID: assertR2CredentialValue(values.get(R2_ACCESS_KEY_ID_KEY)!, R2_ACCESS_KEY_ID_KEY),
    R2_SECRET_ACCESS_KEY: assertR2CredentialValue(values.get(R2_SECRET_ACCESS_KEY_KEY)!, R2_SECRET_ACCESS_KEY_KEY),
  };
  const sessionToken = values.get(R2_SESSION_TOKEN_KEY);
  if (sessionToken !== undefined) {
    secrets.R2_SESSION_TOKEN = assertR2CredentialValue(sessionToken, R2_SESSION_TOKEN_KEY);
  }

  return {
    service: PRIVATE_CREATION_ASSET_V2_VAULT_SERVICE,
    secrets,
  };
}

function assertExpectedRevision(revision: number): void {
  if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) {
    throw new Error("Invalid expected credential revision");
  }
}

function fixedR2CredentialEntries(input: R2CredentialInput) {
  const entries: Array<{ keyName: R2CredentialKey; value: string }> = [
    { keyName: R2_ENDPOINT_KEY, value: canonicalR2Endpoint(input.endpoint) },
    { keyName: R2_ACCESS_KEY_ID_KEY, value: assertR2CredentialValue(input.accessKeyId, R2_ACCESS_KEY_ID_KEY) },
    { keyName: R2_SECRET_ACCESS_KEY_KEY, value: assertR2CredentialValue(input.secretAccessKey, R2_SECRET_ACCESS_KEY_KEY) },
  ];
  if (input.sessionToken !== undefined) {
    entries.push({ keyName: R2_SESSION_TOKEN_KEY, value: assertR2CredentialValue(input.sessionToken, R2_SESSION_TOKEN_KEY) });
  }
  return entries;
}

function currentBundleRevision(rows: Array<{ revision?: number }>): number {
  const revisions = [...new Set(rows.map((row) => row.revision ?? 0))];
  if (revisions.length !== 1) {
    throw new Error("Private creation asset V2 credential revisions require root repair before rotation");
  }
  const revision = revisions[0]!;
  assertExpectedRevision(revision);
  return revision;
}

function fixedR2CredentialRecord(keyName: R2CredentialKey, value: string, revision: number) {
  return {
    service: PRIVATE_CREATION_ASSET_V2_VAULT_SERVICE,
    keyName,
    value,
    revision,
    description: "Jarvis private creation asset V2 R2 credential (root-only rotation)",
    scopes: ["jarvis", "private-creation-assets-v2", "r2"],
    aliases: [],
    sourceFiles: ["jarvis/private-creation-assets-v2"],
  };
}

function isV2ClientRow(client: { name: string; services: string[] }): boolean {
  return (
    client.name.trim().toLowerCase() === PRIVATE_CREATION_ASSET_V2_VAULT_CLIENT
    || client.services.some((service) => service.trim() === PRIVATE_CREATION_ASSET_V2_VAULT_SERVICE)
  );
}

/**
 * Root-only, fixed-shape create/rotate path for the isolated V2 R2 bundle.
 * There is deliberately no caller-selected service or key. A single CAS
 * revision covers the full bundle, so a partially written or malformed legacy
 * V2 set halts rather than being silently repaired by a generic caller.
 */
export const rotateCredentials = mutation({
  args: {
    rootToken: v.string(),
    expectedRevision: v.union(v.null(), v.number()),
    endpoint: v.string(),
    accessKeyId: v.string(),
    secretAccessKey: v.string(),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireVaultRoot(args.rootToken);
    if (args.expectedRevision !== null) assertExpectedRevision(args.expectedRevision);
    const nextEntries = fixedR2CredentialEntries(args);
    const existing = await ctx.db
      .query("secrets")
      .withIndex("by_service", (q) => q.eq("service", PRIVATE_CREATION_ASSET_V2_VAULT_SERVICE))
      .collect();

    if (args.expectedRevision === null) {
      if (existing.length > 0) {
        throw new Error("Private creation asset V2 credentials changed; re-read before retrying");
      }
      for (const entry of nextEntries) {
        await ctx.db.insert("secrets", fixedR2CredentialRecord(entry.keyName, entry.value, 1));
      }
      return { created: true, revision: 1 };
    }

    if (existing.length === 0) {
      throw new Error("Private creation asset V2 credentials changed; re-read before retrying");
    }
    // Validate both the fixed-key shape and existing values before any
    // mutation. This makes malformed or duplicate historical rows a hard
    // operator repair stop rather than a best-effort rotation.
    exactR2CredentialRows(existing);
    const currentRevision = currentBundleRevision(existing);
    if (currentRevision !== args.expectedRevision) {
      throw new Error("Private creation asset V2 credentials changed; re-read before retrying");
    }

    const nextRevision = currentRevision + 1;
    const existingByKey = new Map(existing.map((row) => [row.keyName as R2CredentialKey, row]));
    const nextByKey = new Map(nextEntries.map((entry) => [entry.keyName, entry]));
    for (const row of existing) {
      const next = nextByKey.get(row.keyName as R2CredentialKey);
      if (!next) {
        // The optional session token is removed only as part of a successful
        // full-bundle rotation; generic delete remains forbidden.
        await ctx.db.delete(row._id);
        continue;
      }
      await ctx.db.patch(row._id, fixedR2CredentialRecord(next.keyName, next.value, nextRevision));
    }
    for (const entry of nextEntries) {
      if (!existingByKey.has(entry.keyName)) {
        await ctx.db.insert("secrets", fixedR2CredentialRecord(entry.keyName, entry.value, nextRevision));
      }
    }
    return { created: false, revision: nextRevision };
  },
});

/**
 * Root-only rollout preflight. It deliberately returns counts and collision
 * indicators only: no secret values, IDs, client names, or bearer material can
 * escape through the audit endpoint. Before first provisioning, both V2 row
 * counts must be zero and all collision counters must be zero.
 */
export const preflightAudit = query({
  args: { rootToken: v.string() },
  handler: async (ctx, { rootToken }) => {
    requireVaultRoot(rootToken);
    const [secrets, clients] = await Promise.all([
      ctx.db
        .query("secrets")
        .withIndex("by_service", (q) => q.eq("service", PRIVATE_CREATION_ASSET_V2_VAULT_SERVICE))
        .collect(),
      ctx.db.query("vaultClients").collect(),
    ]);
    const v2Clients = clients.filter(isV2ClientRow);
    const activeClients = clients.filter((client) => client.active);
    const activeTokenCounts = new Map<string, number>();
    for (const client of activeClients) {
      activeTokenCounts.set(client.token, (activeTokenCounts.get(client.token) ?? 0) + 1);
    }
    const duplicateActiveBearerTokenGroupCount = [...activeTokenCounts.values()].filter((count) => count > 1).length;
    const activeV2ClientBearerCollisionCount = v2Clients.filter(
      (client) => client.active && (activeTokenCounts.get(client.token) ?? 0) > 1,
    ).length;
    return {
      v2SecretRowCount: secrets.length,
      v2ClientRowCount: v2Clients.length,
      activeV2ClientRowCount: v2Clients.filter((client) => client.active).length,
      duplicateActiveBearerTokenGroupCount,
      activeV2ClientBearerCollisionCount,
    };
  },
});

/**
 * Fixed, read-only V2 vault capability. Convex wraps the return value in its
 * standard `{ status: "success", value }` HTTP envelope. The inner value has
 * no caller-selected service/key and exposes only the fixed service marker and
 * allowlisted R2 credentials; the V2 bucket is pinned locally by Jarvis.
 */
export const credentials = query({
  args: { v2VaultToken: v.string() },
  handler: async (ctx, { v2VaultToken }) => {
    await requirePrivateCreationAssetV2CredentialRead(ctx, { vaultToken: v2VaultToken });
    const rows = await ctx.db
      .query("secrets")
      .withIndex("by_service", (q) => q.eq("service", PRIVATE_CREATION_ASSET_V2_VAULT_SERVICE))
      .collect();
    return exactR2CredentialRows(rows);
  },
});
