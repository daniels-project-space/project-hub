import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

type VaultCredentials = { vaultToken?: string };

const HIGGSFIELD_SERVICE = "higgsfield";
const MEDIA_ENGINE_CREDENTIAL_CLIENT = "media-engine";

/**
 * Jarvis has two intentionally separate Hub capabilities: the existing
 * `jarvis-context` snapshot reader and this narrow action facade. Keeping the
 * name and service singleton prevents an action bearer from quietly inheriting
 * a broad vault policy (or the context-only scope) during later provisioning.
 */
export const JARVIS_ACTIONS_VAULT_CLIENT = "jarvis-actions";
export const JARVIS_ACTIONS_VAULT_SERVICE = "jarvis-actions";

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

export function requireVaultRoot(rootToken: string | undefined): void {
  const expected = process.env.VAULT_ROOT_TOKEN;
  if (!expected || !constantTimeEqual(rootToken, expected)) {
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

async function findClient(ctx: any, vaultToken: string | undefined) {
  if (!vaultToken || vaultToken.length < 32 || vaultToken.length > 256) return null;
  return await ctx.db
    .query("vaultClients")
    .withIndex("by_token", (q: any) => q.eq("token", vaultToken))
    .first();
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
  },
});

export const revokeClient = mutation({
  args: { rootToken: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    requireVaultRoot(args.rootToken);
    const existing = await ctx.db
      .query("vaultClients")
      .withIndex("by_name", (q: any) => q.eq("name", args.name.trim().toLowerCase()))
      .first();
    if (!existing) return false;
    await ctx.db.patch(existing._id, { active: false, updatedAt: Date.now() });
    return true;
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
