import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { createVaultSession } from "../src/lib/vault-control";

const modules = import.meta.glob("./**/*.*s");
const ROOT_TOKEN = "r".repeat(40);
const LEGACY_JARVIS_TOKEN = "l".repeat(40);
const V2_TOKEN = "v".repeat(40);
const WILDCARD_V2_TOKEN = "w".repeat(40);
const CASE_VARIANT_V2_TOKEN = "c".repeat(40);
const V2_POLICY_VARIANT_TOKEN = "p".repeat(40);
const V2_SERVICE = "cloudflare-private-r2-v2";
const V2_CLIENT = "jarvis-private-creation-assets-v2";
const SESSION_SECRET = "s".repeat(48);
const R2_ENDPOINT = "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com";

function t() {
  vi.stubEnv("VAULT_ENFORCE_AUTH", "true");
  vi.stubEnv("VAULT_ROOT_TOKEN", ROOT_TOKEN);
  vi.stubEnv("PROJECT_HUB_VAULT_SESSION_SECRET", SESSION_SECRET);
  return convexTest(schema, modules);
}

async function grantV2Read(c: ReturnType<typeof t>, token = V2_TOKEN) {
  await c.mutation(api.vaultAuth.rotatePrivateCreationAssetV2Client, {
    rootToken: ROOT_TOKEN,
    token,
  });
}

async function seedV2Credentials(c: ReturnType<typeof t>, endpoint?: string, sessionToken?: string) {
  await c.mutation(api.privateCreationAssetV2.rotateCredentials, {
    rootToken: ROOT_TOKEN,
    expectedRevision: null,
    endpoint: endpoint ?? R2_ENDPOINT,
    accessKeyId: "v2-access-key",
    secretAccessKey: "v2-secret-key",
    ...(sessionToken === undefined ? {} : { sessionToken }),
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("private creation asset V2 credential capability", () => {
  it("returns the exact fixed Convex value shape to the dedicated read-only V2 bearer", async () => {
    const c = t();
    await grantV2Read(c);
    await seedV2Credentials(c);

    const credentials = await c.query(api.privateCreationAssetV2.credentials, { v2VaultToken: V2_TOKEN });

    expect(Object.keys(credentials).sort()).toEqual([
      "secrets",
      "service",
    ]);
    expect(credentials).toEqual({
      service: V2_SERVICE,
      secrets: {
        R2_ENDPOINT,
        R2_ACCESS_KEY_ID: "v2-access-key",
        R2_SECRET_ACCESS_KEY: "v2-secret-key",
      },
    });
    expect(Object.keys(credentials.secrets).sort()).toEqual([
      "R2_ACCESS_KEY_ID",
      "R2_ENDPOINT",
      "R2_SECRET_ACCESS_KEY",
    ]);
  });

  it("rejects a legacy generic Jarvis bearer from the V2 service and fixed endpoint", async () => {
    const c = t();
    await c.mutation(api.vaultAuth.upsertClient, {
      rootToken: ROOT_TOKEN,
      name: "jarvis",
      token: LEGACY_JARVIS_TOKEN,
      services: ["*"],
      canWrite: true,
    });
    await seedV2Credentials(c);

    await expect(
      c.query(api.secrets.listByService, { service: V2_SERVICE, vaultToken: LEGACY_JARVIS_TOKEN }),
    ).rejects.toThrow("root-only fixed rotation endpoint");
    await expect(
      c.query(api.privateCreationAssetV2.credentials, { v2VaultToken: LEGACY_JARVIS_TOKEN }),
    ).rejects.toThrow("Vault authentication required");
  });

  it("reserves V2 client lifecycle for the root-only fixed control path", async () => {
    const c = t();
    await c.mutation(api.vaultAuth.upsertClient, {
      rootToken: ROOT_TOKEN,
      name: "jarvis",
      token: LEGACY_JARVIS_TOKEN,
      services: ["*"],
      canWrite: true,
    });

    await expect(
      c.mutation(api.vaultAuth.provisionClient, {
        vaultToken: LEGACY_JARVIS_TOKEN,
        name: V2_CLIENT,
        token: "c".repeat(40),
        services: [V2_SERVICE],
        canWrite: false,
      }),
    ).rejects.toThrow("root-only fixed rotation endpoint");

    await expect(
      c.mutation(api.vaultAuth.upsertClient, {
        rootToken: ROOT_TOKEN,
        name: V2_CLIENT,
        token: "u".repeat(40),
        services: [V2_SERVICE],
        canWrite: false,
      }),
    ).rejects.toThrow("root-only fixed rotation endpoint");
    await expect(
      c.mutation(api.vaultAuth.upsertClient, {
        rootToken: ROOT_TOKEN,
        name: "reserved-service-escape",
        token: "p".repeat(40),
        services: [V2_SERVICE],
        canWrite: true,
      }),
    ).rejects.toThrow("root-only fixed rotation endpoint");
    await expect(
      c.mutation(api.vaultAuth.revokeClient, {
        rootToken: ROOT_TOKEN,
        name: V2_CLIENT,
      }),
    ).rejects.toThrow("root-only fixed rotation endpoint");

    await grantV2Read(c);
    await expect(
      c.mutation(api.vaultAuth.provisionClient, {
        vaultToken: V2_TOKEN,
        name: V2_CLIENT,
        token: "o".repeat(40),
        services: [V2_SERVICE],
        canWrite: false,
      }),
    ).rejects.toThrow("root-only fixed rotation endpoint");
    await expect(
      c.mutation(api.vaultAuth.revokeClientByAdmin, {
        vaultToken: V2_TOKEN,
        name: V2_CLIENT,
      }),
    ).rejects.toThrow("root-only fixed rotation endpoint");
    await expect(c.query(api.vaultAuth.listClients, { rootToken: ROOT_TOKEN })).resolves.toEqual([
      expect.objectContaining({ name: "jarvis" }),
    ]);
    await expect(c.query(api.vaultAuth.whoami, { vaultToken: V2_TOKEN })).rejects.toThrow(
      "Private creation asset V2 credentials require the fixed endpoint",
    );
  });

  it("keeps V2 secrets off owner generic controls and permits only root fixed CAS rotation", async () => {
    const c = t();
    await grantV2Read(c);
    const ownerSession = createVaultSession();

    await expect(
      c.mutation(api.secrets.upsertOne, {
        vaultSession: ownerSession,
        service: V2_SERVICE,
        keyName: "R2_ACCESS_KEY_ID",
        value: "owner-must-not-write-v2",
        scopes: [],
        aliases: [],
        sourceFiles: [],
      }),
    ).rejects.toThrow("root-only fixed rotation endpoint");
    await expect(
      c.mutation(api.vaultAuth.provisionClient, {
        vaultToken: ownerSession,
        name: V2_CLIENT,
        token: "o".repeat(40),
        services: [V2_SERVICE],
        canWrite: false,
      }),
    ).rejects.toThrow("root-only fixed rotation endpoint");

    await expect(
      c.mutation(api.privateCreationAssetV2.rotateCredentials, {
        rootToken: V2_TOKEN,
        expectedRevision: null,
        endpoint: R2_ENDPOINT,
        accessKeyId: "v2-access-key",
        secretAccessKey: "v2-secret-key",
      }),
    ).rejects.toThrow("Vault authentication required");

    await expect(
      c.mutation(api.privateCreationAssetV2.rotateCredentials, {
        rootToken: ROOT_TOKEN,
        expectedRevision: null,
        endpoint: R2_ENDPOINT,
        accessKeyId: "v2-access-key",
        secretAccessKey: "v2-secret-key",
      }),
    ).resolves.toEqual({ created: true, revision: 1 });
    await expect(c.query(api.secrets.catalog, { vaultSession: ownerSession })).resolves.toEqual([]);
    await expect(
      c.query(api.privateCreationAssetV2.preflightAudit, { rootToken: ownerSession }),
    ).rejects.toThrow("Vault authentication required");
    await expect(
      c.query(api.privateCreationAssetV2.preflightAudit, { rootToken: ROOT_TOKEN }),
    ).resolves.toEqual({
      v2SecretRowCount: 3,
      v2ClientRowCount: 1,
      activeV2ClientRowCount: 1,
      duplicateActiveBearerTokenGroupCount: 0,
      activeV2ClientBearerCollisionCount: 0,
    });

    await expect(
      c.query(api.secrets.listByService, { vaultToken: ROOT_TOKEN, service: V2_SERVICE }),
    ).rejects.toThrow("root-only fixed rotation endpoint");
    await expect(
      c.query(api.secrets.getOne, {
        vaultToken: ROOT_TOKEN,
        service: V2_SERVICE,
        keyName: "R2_ACCESS_KEY_ID",
      }),
    ).rejects.toThrow("root-only fixed rotation endpoint");
    await expect(c.query(api.secrets.summary, { vaultToken: ROOT_TOKEN })).resolves.toEqual({
      total: 0,
      byService: {},
    });
    await expect(c.query(api.secrets.catalog, { vaultToken: ROOT_TOKEN })).resolves.toEqual([]);
    await expect(
      c.mutation(api.secrets.upsertOne, {
        vaultToken: ROOT_TOKEN,
        service: V2_SERVICE,
        keyName: "R2_ACCESS_KEY_ID",
        value: "generic-root-must-not-rotate-v2",
        scopes: [],
        aliases: [],
        sourceFiles: [],
      }),
    ).rejects.toThrow("root-only fixed rotation endpoint");
    await expect(
      c.mutation(api.secrets.bulkInsert, {
        vaultToken: ROOT_TOKEN,
        items: [{
          service: V2_SERVICE,
          keyName: "R2_BUCKET",
          value: "generic-root-must-not-add-v2",
          scopes: [],
          aliases: [],
          sourceFiles: [],
        }],
      }),
    ).rejects.toThrow("root-only fixed rotation endpoint");
    const [row] = await c.run(async (ctx) => await ctx.db
      .query("secrets")
      .withIndex("by_service", (q) => q.eq("service", V2_SERVICE))
      .collect());
    await expect(
      c.mutation(api.secrets.deleteOne, { vaultToken: ROOT_TOKEN, id: row!._id }),
    ).rejects.toThrow("root-only fixed rotation endpoint");
    await expect(c.mutation(api.secrets.truncate, { vaultToken: ROOT_TOKEN })).resolves.toEqual({ deleted: 0 });
    await expect(
      c.query(api.privateCreationAssetV2.preflightAudit, { rootToken: ROOT_TOKEN }),
    ).resolves.toMatchObject({ v2SecretRowCount: 3, v2ClientRowCount: 1 });

    await expect(
      c.mutation(api.privateCreationAssetV2.rotateCredentials, {
        rootToken: ROOT_TOKEN,
        expectedRevision: 1,
        endpoint: R2_ENDPOINT,
        accessKeyId: "rotated-v2-access-key",
        secretAccessKey: "rotated-v2-secret-key",
        sessionToken: "rotated-v2-session-token",
      }),
    ).resolves.toEqual({ created: false, revision: 2 });
    await expect(
      c.query(api.privateCreationAssetV2.credentials, { v2VaultToken: V2_TOKEN }),
    ).resolves.toEqual({
      service: V2_SERVICE,
      secrets: {
        R2_ENDPOINT,
        R2_ACCESS_KEY_ID: "rotated-v2-access-key",
        R2_SECRET_ACCESS_KEY: "rotated-v2-secret-key",
        R2_SESSION_TOKEN: "rotated-v2-session-token",
      },
    });
  });

  it("reports only aggregate V2 preflight state and detects active bearer collisions", async () => {
    const c = t();
    await expect(
      c.query(api.privateCreationAssetV2.preflightAudit, { rootToken: V2_TOKEN }),
    ).rejects.toThrow("Vault authentication required");
    await expect(
      c.query(api.privateCreationAssetV2.preflightAudit, { rootToken: ROOT_TOKEN }),
    ).resolves.toEqual({
      v2SecretRowCount: 0,
      v2ClientRowCount: 0,
      activeV2ClientRowCount: 0,
      duplicateActiveBearerTokenGroupCount: 0,
      activeV2ClientBearerCollisionCount: 0,
    });

    await grantV2Read(c);
    await c.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("vaultClients", {
        name: "audit-collision-only",
        token: V2_TOKEN,
        services: [V2_SERVICE],
        canWrite: true,
        active: true,
        createdAt: now,
        updatedAt: now,
      });
    });

    await expect(
      c.query(api.privateCreationAssetV2.preflightAudit, { rootToken: ROOT_TOKEN }),
    ).resolves.toEqual({
      v2SecretRowCount: 0,
      v2ClientRowCount: 2,
      activeV2ClientRowCount: 2,
      duplicateActiveBearerTokenGroupCount: 1,
      activeV2ClientBearerCollisionCount: 2,
    });
  });

  it("fails closed for historical case and service-policy V2 aliases on every generic capability path", async () => {
    const c = t();
    await c.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("vaultClients", {
        name: V2_CLIENT.toUpperCase(),
        token: CASE_VARIANT_V2_TOKEN,
        services: ["*"],
        canWrite: true,
        active: true,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("vaultClients", {
        name: "legacy-v2-policy-variant",
        token: V2_POLICY_VARIANT_TOKEN,
        services: [` ${V2_SERVICE} `, "*"],
        canWrite: true,
        active: true,
        createdAt: now,
        updatedAt: now,
      });
    });

    for (const vaultToken of [CASE_VARIANT_V2_TOKEN, V2_POLICY_VARIANT_TOKEN]) {
      await expect(c.query(api.secrets.summary, { vaultToken })).rejects.toThrow(
        "Private creation asset V2 credentials require the fixed endpoint",
      );
      await expect(
        c.mutation(api.secrets.upsertOne, {
          vaultToken,
          service: "novita",
          keyName: "ESCAPE_TEST",
          value: "must-not-write",
          scopes: [],
          aliases: [],
          sourceFiles: [],
        }),
      ).rejects.toThrow("Private creation asset V2 credentials require the fixed endpoint");
      await expect(
        c.mutation(api.vaultAuth.provisionClient, {
          vaultToken,
          name: "generic-admin-escape",
          token: "e".repeat(40),
          services: ["*"],
          canWrite: true,
        }),
      ).rejects.toThrow("Private creation asset V2 credentials require the fixed endpoint");
      await expect(c.query(api.vaultAuth.whoami, { vaultToken })).rejects.toThrow(
        "Private creation asset V2 credentials require the fixed endpoint",
      );
    }

    await expect(
      c.mutation(api.vaultAuth.rotatePrivateCreationAssetV2Client, {
        rootToken: ROOT_TOKEN,
        token: V2_TOKEN,
      }),
    ).rejects.toThrow("requires root repair before rotation");
    await expect(
      c.query(api.privateCreationAssetV2.preflightAudit, { rootToken: ROOT_TOKEN }),
    ).resolves.toEqual({
      v2SecretRowCount: 0,
      v2ClientRowCount: 2,
      activeV2ClientRowCount: 2,
      duplicateActiveBearerTokenGroupCount: 0,
      activeV2ClientBearerCollisionCount: 0,
    });
  });

  it("hides V2 state from every generic catalogue route and preserves it through root truncate", async () => {
    const c = t();
    await c.mutation(api.vaultAuth.upsertClient, {
      rootToken: ROOT_TOKEN,
      name: "jarvis",
      token: LEGACY_JARVIS_TOKEN,
      services: ["*"],
      canWrite: true,
    });
    await grantV2Read(c);
    await seedV2Credentials(c);

    await expect(c.query(api.secrets.summary, { vaultToken: LEGACY_JARVIS_TOKEN })).resolves.toEqual({
      total: 0,
      byService: {},
    });
    await expect(c.query(api.secrets.catalog, { vaultToken: LEGACY_JARVIS_TOKEN })).resolves.toEqual([]);
    await expect(c.mutation(api.secrets.truncate, { vaultToken: LEGACY_JARVIS_TOKEN })).rejects.toThrow(
      "Vault authentication required",
    );
    await expect(c.query(api.secrets.summary, { vaultToken: ROOT_TOKEN })).resolves.toEqual({
      total: 0,
      byService: {},
    });
    await expect(c.query(api.secrets.catalog, { vaultToken: ROOT_TOKEN })).resolves.toEqual([]);
    await expect(c.mutation(api.secrets.truncate, { vaultToken: ROOT_TOKEN })).resolves.toEqual({ deleted: 0 });
    await expect(
      c.query(api.privateCreationAssetV2.credentials, { v2VaultToken: V2_TOKEN }),
    ).resolves.toMatchObject({ service: V2_SERVICE });
  });

  it("keeps the V2 bearer mapped to one identity by rejecting token collisions", async () => {
    const c = t();
    await grantV2Read(c);

    await expect(
      c.mutation(api.vaultAuth.upsertClient, {
        rootToken: ROOT_TOKEN,
        name: "jarvis-broad-fallback",
        token: V2_TOKEN,
        services: ["*"],
        canWrite: true,
      }),
    ).rejects.toThrow("Vault client token is already assigned");
  });

  it("rejects generic V2 misprovisioning and keeps the fixed bearer off every generic route", async () => {
    const c = t();
    await expect(
      c.mutation(api.vaultAuth.upsertClient, {
        rootToken: ROOT_TOKEN,
        name: V2_CLIENT,
        token: WILDCARD_V2_TOKEN,
        services: ["*"],
        canWrite: true,
      }),
    ).rejects.toThrow("root-only fixed rotation endpoint");
    await grantV2Read(c, WILDCARD_V2_TOKEN);
    await seedV2Credentials(c);

    await expect(c.query(api.secrets.summary, { vaultToken: WILDCARD_V2_TOKEN })).rejects.toThrow(
      "Private creation asset V2 credentials require the fixed endpoint",
    );
    await expect(
      c.query(api.secrets.listByService, { service: "novita", vaultToken: WILDCARD_V2_TOKEN }),
    ).rejects.toThrow("Private creation asset V2 credentials require the fixed endpoint");
    await expect(
      c.mutation(api.secrets.bulkInsert, {
        vaultToken: WILDCARD_V2_TOKEN,
        items: [
          {
            service: "novita",
            keyName: "unexpected",
            value: "unexpected",
            scopes: [],
            aliases: [],
            sourceFiles: [],
          },
        ],
      }),
    ).rejects.toThrow("Private creation asset V2 credentials require the fixed endpoint");
    await expect(
      c.mutation(api.vaultAuth.provisionClient, {
        vaultToken: WILDCARD_V2_TOKEN,
        name: "escape-client",
        token: "e".repeat(40),
        services: ["*"],
        canWrite: true,
      }),
    ).rejects.toThrow("Private creation asset V2 credentials require the fixed endpoint");
    await expect(
      c.query(api.privateCreationAssetV2.credentials, { v2VaultToken: WILDCARD_V2_TOKEN }),
    ).resolves.toMatchObject({ service: V2_SERVICE });
  });

  it("fails closed before writing when root fixed provisioning receives an unapproved R2 endpoint", async () => {
    const c = t();
    await grantV2Read(c);

    await expect(
      seedV2Credentials(c, "https://public.r2.dev"),
    ).rejects.toThrow("R2_ENDPOINT must be an approved Cloudflare R2 HTTPS endpoint");
    await expect(
      c.query(api.privateCreationAssetV2.preflightAudit, { rootToken: ROOT_TOKEN }),
    ).resolves.toMatchObject({ v2SecretRowCount: 0, v2ClientRowCount: 1 });
  });

  it("does not let generic root insertion introduce an unallowlisted V2 service secret", async () => {
    const c = t();
    await grantV2Read(c);
    await seedV2Credentials(c);
    await expect(
      c.mutation(api.secrets.bulkInsert, {
        vaultToken: ROOT_TOKEN,
        items: [
        {
          service: V2_SERVICE,
          keyName: "R2_BUCKET",
          value: "must-not-leak-from-the-fixed-capability",
          scopes: [],
          aliases: [],
          sourceFiles: [],
        },
        ],
      }),
    ).rejects.toThrow("root-only fixed rotation endpoint");

    await expect(
      c.query(api.privateCreationAssetV2.credentials, { v2VaultToken: V2_TOKEN }),
    ).resolves.toMatchObject({ service: V2_SERVICE });
  });

  it("allows only the documented optional R2 session token and rejects a caller service selector", async () => {
    const c = t();
    await grantV2Read(c);
    await seedV2Credentials(c, undefined, "v2-session-token");

    await expect(
      c.query(api.privateCreationAssetV2.credentials, {
        v2VaultToken: V2_TOKEN,
        service: "novita",
      } as never),
    ).rejects.toThrow();

    const credentials = await c.query(api.privateCreationAssetV2.credentials, { v2VaultToken: V2_TOKEN });
    expect(credentials).toEqual({
      service: V2_SERVICE,
      secrets: {
        R2_ENDPOINT: "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
        R2_ACCESS_KEY_ID: "v2-access-key",
        R2_SECRET_ACCESS_KEY: "v2-secret-key",
        R2_SESSION_TOKEN: "v2-session-token",
      },
    });
  });
});
