import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import {
  assertAllowedClientServicePolicy,
  assertAllowedVaultService,
  isOpenAiNamespace,
} from "./vaultPolicy";

type VaultCredentials = { vaultToken?: string };

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

function requireRoot(rootToken: string | undefined): void {
  const expected = process.env.VAULT_ROOT_TOKEN;
  if (!expected || !constantTimeEqual(rootToken, expected)) {
    throw new Error("Vault authentication required");
  }
}

function serviceAllowed(services: string[], service: string): boolean {
  // Existing wildcard rows are deliberately inert as well as impossible to
  // create going forward. Only a concrete exact service is a capability.
  return services.includes(service) && !service.includes("*");
}

async function findClient(ctx: any, vaultToken: string | undefined) {
  if (!vaultToken || vaultToken.length < 32 || vaultToken.length > 256) return null;
  return await ctx.db
    .query("vaultClients")
    .withIndex("by_token", (q: any) => q.eq("token", vaultToken))
    .first();
}

export async function requireVaultRead(
  ctx: any,
  credentials: VaultCredentials,
  service: string,
): Promise<void> {
  if (service !== "*") assertAllowedVaultService(service);
  if (constantTimeEqual(credentials.vaultToken, process.env.VAULT_ROOT_TOKEN)) return;
  const client = await findClient(ctx, credentials.vaultToken);
  if (client?.active && serviceAllowed(client.services, service)) return;
  // Deployment bridge only: callers are migrated and verified before this is
  // flipped. Production is not considered secure until enforcement is true.
  if (process.env.VAULT_ENFORCE_AUTH !== "true") return;
  throw new Error("Vault authentication required");
}

export async function requireVaultWrite(
  ctx: any,
  credentials: VaultCredentials,
  services: string[],
): Promise<void> {
  for (const service of services) assertAllowedVaultService(service);
  if (constantTimeEqual(credentials.vaultToken, process.env.VAULT_ROOT_TOKEN)) return;
  const client = await findClient(ctx, credentials.vaultToken);
  if (client?.active && client.canWrite && services.every((service) => serviceAllowed(client.services, service))) {
    return;
  }
  if (process.env.VAULT_ENFORCE_AUTH !== "true") return;
  throw new Error("Vault authentication required");
}

/**
 * A root-only, value-blind cleanup path for pre-policy forbidden rows. Scoped
 * clients never receive an OpenAI capability, including one that can delete.
 */
export async function requireVaultDelete(
  ctx: MutationCtx,
  credentials: VaultCredentials,
  service: string,
): Promise<void> {
  if (isOpenAiNamespace(service)) {
    requireRoot(credentials.vaultToken);
    return;
  }
  await requireVaultWrite(ctx, credentials, [service]);
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
    requireRoot(args.rootToken);
    const name = args.name.trim().toLowerCase();
    const services = [...new Set(args.services.map((service) => service.trim()).filter(Boolean))];
    if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(name)) throw new Error("Invalid vault client name");
    if (args.token.length < 32 || args.token.length > 256) throw new Error("Invalid vault client token");
    if (services.length === 0 || services.length > 100) throw new Error("Invalid vault service policy");
    for (const service of services) assertAllowedClientServicePolicy(service);
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
    requireRoot(args.rootToken);
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
    requireRoot(args.rootToken);
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
