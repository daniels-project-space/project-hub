import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

type VaultCredentials = { vaultToken?: string };
type VaultClientRecord = {
  _id: unknown;
  name: string;
  services: string[];
  canWrite: boolean;
  active: boolean;
};

const HIGGSFIELD_SERVICE = "higgsfield";
const MEDIA_ENGINE_CREDENTIAL_CLIENT = "media-engine";
/**
 * The V2 private creation-asset vault is intentionally isolated from the
 * generic Jarvis vault bearer. It is read-only and may only retrieve the
 * fixed R2 credential bundle exposed by `privateCreationAssetV2:credentials`.
 */
export const PRIVATE_CREATION_ASSET_V2_VAULT_CLIENT = "jarvis-private-creation-assets-v2";
export const PRIVATE_CREATION_ASSET_V2_VAULT_SERVICE = "cloudflare-private-r2-v2";

/**
 * Jarvis has two intentionally separate Hub capabilities: the existing
 * `jarvis-context` snapshot reader and this narrow action facade. Keeping the
 * name and service singleton prevents an action bearer from quietly inheriting
 * a broad vault policy (or the context-only scope) during later provisioning.
 */
export const JARVIS_ACTIONS_VAULT_CLIENT = "jarvis-actions";
export const JARVIS_ACTIONS_VAULT_SERVICE = "jarvis-actions";
const PROJECT_HUB_VAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function constantTimeEqual(left: string | undefined, right: string | undefined): boolean {
  const a = left ?? "";
  const b = right ?? "";
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |=
      (a.charCodeAt(index % Math.max(1, a.length)) || 0) ^
      (b.charCodeAt(index % Math.max(1, b.length)) || 0);
  }
  return mismatch === 0 && a.length > 0;
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(`${normalized}${padding}`);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  let mismatch = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (left[index % Math.max(1, left.length)] ?? 0) ^ (right[index % Math.max(1, right.length)] ?? 0);
  }
  return mismatch === 0 && left.length > 0;
}

/**
 * Verifies the short-lived, HttpOnly Project Hub owner session. The HMAC key is
 * shared only between the Project Hub server and this Convex deployment, so a
 * browser never receives a durable vault bearer.
 */
export async function requireProjectHubVaultSession(session: string | undefined): Promise<void> {
  const secret = process.env.PROJECT_HUB_VAULT_SESSION_SECRET;
  if (!secret || session === undefined || session.length > 512) {
    throw new Error("Vault authentication required");
  }
  const [payload, suppliedSignature, ...extra] = session.split(".");
  if (!payload || !suppliedSignature || extra.length > 0) throw new Error("Vault authentication required");

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const expectedSignature = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)),
    );
    if (!bytesEqual(fromBase64Url(suppliedSignature), expectedSignature)) {
      throw new Error("Vault authentication required");
    }

    const decoded: unknown = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
    if (!decoded || typeof decoded !== "object" || !("expiresAt" in decoded) || typeof decoded.expiresAt !== "number") {
      throw new Error("Vault authentication required");
    }
    const now = Date.now();
    if (
      !Number.isFinite(decoded.expiresAt)
      || decoded.expiresAt <= now
      || decoded.expiresAt > now + PROJECT_HUB_VAULT_SESSION_TTL_MS + 5 * 60 * 1000
    ) {
      throw new Error("Vault authentication required");
    }
  } catch {
    throw new Error("Vault authentication required");
  }
}

export function isVaultRoot(rootToken: string | undefined): boolean {
  return constantTimeEqual(rootToken, process.env.VAULT_ROOT_TOKEN);
}

export function requireVaultRoot(rootToken: string | undefined): void {
  if (!isVaultRoot(rootToken)) {
    throw new Error("Vault authentication required");
  }
}

function serviceAllowed(services: string[], service: string): boolean {
  return services.some((policy) => {
    if (policy === "*" || policy === service) return true;
    return policy.endsWith("*") && service.startsWith(policy.slice(0, -1));
  });
}

/**
 * The durable Higgsfield refresh credential is intentionally stricter than
 * the generic vault policy language. A wildcard (including a prefix wildcard)
 * would let a future service name silently inherit the renderer capability.
 */
function hasExplicitHiggsfieldScope(services: string[]): boolean {
  return services.includes(HIGGSFIELD_SERVICE) && services.every((policy) => !policy.includes("*"));
}

function hasExactPrivateCreationAssetV2Scope(client: VaultClientRecord | null): boolean {
  return (
    client !== null &&
    client.active &&
    client.name === PRIVATE_CREATION_ASSET_V2_VAULT_CLIENT &&
    client.canWrite === false &&
    client.services.length === 1 &&
    client.services[0] === PRIVATE_CREATION_ASSET_V2_VAULT_SERVICE
  );
}

function isPrivateCreationAssetV2ClientName(name: string): boolean {
  return name.trim().toLowerCase() === PRIVATE_CREATION_ASSET_V2_VAULT_CLIENT;
}

async function findClient(ctx: any, vaultToken: string | undefined) {
  if (!vaultToken || vaultToken.length < 32 || vaultToken.length > 256) return null;
  const clients: VaultClientRecord[] = await ctx.db
    .query("vaultClients")
    .withIndex("by_token", (q: any) => q.eq("token", vaultToken))
    .collect();
  // A bearer must resolve to one and only one capability identity. Historical
  // duplicate rows fail closed rather than letting database ordering decide
  // whether an isolated V2 bearer inherits a broader client policy.
  return clients.length === 1 ? clients[0] : null;
}

/**
 * Full-catalogue writers may provision other machine clients. This
 * is deliberately separate from the environment-only root bearer: the root
 * token never has to be placed in an AI runtime merely to rotate a bridge
 * client. The fixed Higgsfield endpoint keeps its own stricter authorization.
 */
async function requireVaultClientAdmin(ctx: any, credentials: VaultCredentials): Promise<void> {
  if (constantTimeEqual(credentials.vaultToken, process.env.VAULT_ROOT_TOKEN)) return;
  const client = await findClient(ctx, credentials.vaultToken);
  // Never let the V2 credential-only identity inherit catalogue administration
  // through an accidental wildcard/write provisioning change.
  if (client?.active && client.name === PRIVATE_CREATION_ASSET_V2_VAULT_CLIENT) {
    throw new Error("Private creation asset V2 credentials require the fixed endpoint");
  }
  if (client?.active && client.canWrite && serviceAllowed(client.services, "*")) return;
  throw new Error("Vault authentication required");
}

type VaultClientInput = {
  name: string;
  token: string;
  services: string[];
  canWrite?: boolean;
};

async function upsertVaultClient(ctx: any, args: VaultClientInput) {
  const name = args.name.trim().toLowerCase();
  const services = [...new Set(args.services.map((service) => service.trim()).filter(Boolean))];
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(name)) throw new Error("Invalid vault client name");
  if (args.token.length < 32 || args.token.length > 256) throw new Error("Invalid vault client token");
  if (services.length === 0 || services.length > 100) throw new Error("Invalid vault service policy");
  const now = Date.now();
  const existing = await ctx.db
    .query("vaultClients")
    .withIndex("by_name", (q: any) => q.eq("name", name))
    .first();
  const tokenMatches = await ctx.db
    .query("vaultClients")
    .withIndex("by_token", (q: any) => q.eq("token", args.token))
    .collect();
  if (tokenMatches.some((client: VaultClientRecord) => client._id !== existing?._id)) {
    throw new Error("Vault client token is already assigned");
  }
  const row = {
    name,
    token: args.token,
    services,
    canWrite: args.canWrite === true,
    active: true,
    updatedAt: now,
  };
  if (existing) {
    await ctx.db.patch(existing._id, row);
    return existing._id;
  }
  return await ctx.db.insert("vaultClients", { ...row, createdAt: now });
}

async function revokeVaultClient(ctx: any, nameInput: string) {
  const existing = await ctx.db
    .query("vaultClients")
    .withIndex("by_name", (q: any) => q.eq("name", nameInput.trim().toLowerCase()))
    .first();
  if (!existing) return false;
  await ctx.db.patch(existing._id, { active: false, updatedAt: Date.now() });
  return true;
}

/**
 * Unlike the generic vault helpers, this is deliberately *not* compatible
 * with the root bearer or wildcard service policies. The Jarvis actions
 * facade can only be reached through its one purpose-specific client record.
 */
async function requireJarvisActionsCapability(
  ctx: any,
  credentials: VaultCredentials,
  write: boolean,
): Promise<void> {
  const client = await findClient(ctx, credentials.vaultToken);
  if (
    client?.active &&
    client.name === JARVIS_ACTIONS_VAULT_CLIENT &&
    client.services.length === 1 &&
    client.services[0] === JARVIS_ACTIONS_VAULT_SERVICE &&
    (!write || client.canWrite)
  ) {
    return;
  }
  throw new Error("Vault authentication required");
}

/** Read-only access for Jarvis's bounded to-do/widget façade. */
export async function requireJarvisActionsRead(
  ctx: any,
  credentials: VaultCredentials,
): Promise<void> {
  return await requireJarvisActionsCapability(ctx, credentials, false);
}

/** Mutation access for Jarvis's bounded to-do façade. */
export async function requireJarvisActionsWrite(
  ctx: any,
  credentials: VaultCredentials,
): Promise<void> {
  return await requireJarvisActionsCapability(ctx, credentials, true);
}

export async function requireVaultRead(
  ctx: any,
  credentials: VaultCredentials,
  service: string,
): Promise<void> {
  if (constantTimeEqual(credentials.vaultToken, process.env.VAULT_ROOT_TOKEN)) return;
  // A Higgsfield OAuth refresh token is intentionally never exposed through
  // the legacy generic secret API. Even a wildcard reader must use the one
  // fixed-key capability below, which is bound to the Media Engine client.
  if (service === HIGGSFIELD_SERVICE) {
    throw new Error("Higgsfield credentials require the fixed bundle endpoint");
  }
  const client = await findClient(ctx, credentials.vaultToken);
  // A V2 bearer is never a general vault reader, even if it is accidentally
  // provisioned with a broad policy. This blocks catalogue/list escape paths
  // independently of the V2 endpoint's exact-scope check.
  if (client?.active && client.name === PRIVATE_CREATION_ASSET_V2_VAULT_CLIENT) {
    throw new Error("Private creation asset V2 credentials require the fixed endpoint");
  }
  if (service === PRIVATE_CREATION_ASSET_V2_VAULT_SERVICE) {
    throw new Error("Private creation asset V2 credentials require the fixed endpoint");
  }
  if (client?.active && serviceAllowed(client.services, service)) return;
  throw new Error("Vault authentication required");
}

export async function requireVaultWrite(
  ctx: any,
  credentials: VaultCredentials,
  services: string[],
): Promise<void> {
  if (constantTimeEqual(credentials.vaultToken, process.env.VAULT_ROOT_TOKEN)) return;
  // Prevent generic insert/delete paths from bypassing the fixed-key CAS
  // contract for the durable OAuth refresh session.
  if (services.includes(HIGGSFIELD_SERVICE)) {
    throw new Error("Higgsfield credentials require the fixed bundle endpoint");
  }
  const client = await findClient(ctx, credentials.vaultToken);
  // The V2 credential bearer is deliberately read-only. Do not let a later
  // provisioning mistake turn it into a generic vault writer.
  if (client?.active && client.name === PRIVATE_CREATION_ASSET_V2_VAULT_CLIENT) {
    throw new Error("Private creation asset V2 credentials require the fixed endpoint");
  }
  if (services.includes(PRIVATE_CREATION_ASSET_V2_VAULT_SERVICE)) {
    throw new Error("Private creation asset V2 credentials require the fixed endpoint");
  }
  if (client?.active && client.canWrite && services.every((service) => serviceAllowed(client.services, service))) {
    return;
  }
  throw new Error("Vault authentication required");
}

async function requireHiggsfieldCredentialBundle(
  ctx: any,
  credentials: VaultCredentials,
  write: boolean,
): Promise<void> {
  if (constantTimeEqual(credentials.vaultToken, process.env.VAULT_ROOT_TOKEN)) return;
  const client = await findClient(ctx, credentials.vaultToken);
  if (
    client?.active &&
    client.name === MEDIA_ENGINE_CREDENTIAL_CLIENT &&
    hasExplicitHiggsfieldScope(client.services) &&
    (!write || client.canWrite)
  ) {
    return;
  }
  // This capability never inherits the migration bridge: the refresh token is
  // durable and must remain protected on every deployment.
  throw new Error("Vault authentication required");
}

/**
 * The only scoped read capability for the Media Engine's Higgsfield OAuth
 * bundle. Generic Higgsfield reads are root-only.
 */
export async function requireHiggsfieldCredentialBundleRead(
  ctx: any,
  credentials: VaultCredentials,
): Promise<void> {
  return await requireHiggsfieldCredentialBundle(ctx, credentials, false);
}

/**
 * The only scoped write capability for the Media Engine's Higgsfield OAuth
 * bundle. Its caller still has to satisfy the fixed-key CAS precondition.
 */
export async function requireHiggsfieldCredentialBundleWrite(
  ctx: any,
  credentials: VaultCredentials,
): Promise<void> {
  return await requireHiggsfieldCredentialBundle(ctx, credentials, true);
}

/**
 * Dedicated read-only capability for the isolated V2 R2 bucket. Unlike the
 * generic read path, this intentionally does not inherit the root bearer or a
 * wildcard service policy: callers must be the exact V2 machine identity.
 */
export async function requirePrivateCreationAssetV2CredentialRead(
  ctx: any,
  credentials: VaultCredentials,
): Promise<void> {
  const client = await findClient(ctx, credentials.vaultToken);
  if (hasExactPrivateCreationAssetV2Scope(client)) return;
  throw new Error("Vault authentication required");
}

export const upsertClient = mutation({
  args: {
    rootToken: v.string(),
    name: v.string(),
    token: v.string(),
    services: v.array(v.string()),
    canWrite: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    requireVaultRoot(args.rootToken);
    return await upsertVaultClient(ctx, args);
  },
});

/**
 * An explicit machine-administration route for a wildcard writer. It lets the
 * Codex/Claude bridge rotate its own high-entropy client bearers without ever
 * transferring the environment-only vault root token to either AI runtime.
 */
export const provisionClient = mutation({
  args: {
    vaultToken: v.string(),
    name: v.string(),
    token: v.string(),
    services: v.array(v.string()),
    canWrite: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // A broad catalogue administrator may provision ordinary bridge clients,
    // but must never create or rotate the identity trusted by the fixed V2
    // credential endpoint. That lifecycle remains root-only.
    if (isPrivateCreationAssetV2ClientName(args.name)) {
      requireVaultRoot(args.vaultToken);
    } else {
      await requireVaultClientAdmin(ctx, { vaultToken: args.vaultToken });
    }
    return await upsertVaultClient(ctx, args);
  },
});

export const revokeClient = mutation({
  args: { rootToken: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    requireVaultRoot(args.rootToken);
    return await revokeVaultClient(ctx, args.name);
  },
});

/** A full-catalogue writer can revoke a bridge client without the root bearer. */
export const revokeClientByAdmin = mutation({
  args: { vaultToken: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    // Keep the same root-only lifecycle boundary for revocation; otherwise a
    // generic catalogue writer could deny the isolated V2 storage path.
    if (isPrivateCreationAssetV2ClientName(args.name)) {
      requireVaultRoot(args.vaultToken);
    } else {
      await requireVaultClientAdmin(ctx, { vaultToken: args.vaultToken });
    }
    return await revokeVaultClient(ctx, args.name);
  },
});

export const listClients = query({
  args: { rootToken: v.string() },
  handler: async (ctx, args) => {
    requireVaultRoot(args.rootToken);
    const clients = await ctx.db.query("vaultClients").collect();
    return clients.map(({ token: _token, ...client }: any) => client);
  },
});

// Always validates, even while the temporary compatibility bridge is open.
export const whoami = query({
  args: { vaultToken: v.string() },
  handler: async (ctx, args) => {
    if (constantTimeEqual(args.vaultToken, process.env.VAULT_ROOT_TOKEN)) {
      return { name: "root", services: ["*"], canWrite: true };
    }
    const client = await findClient(ctx, args.vaultToken);
    if (!client?.active) throw new Error("Vault authentication required");
    return { name: client.name, services: client.services, canWrite: client.canWrite };
  },
});
