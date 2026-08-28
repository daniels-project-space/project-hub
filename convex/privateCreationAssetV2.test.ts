import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.*s");
const ROOT_TOKEN = "r".repeat(40);
const LEGACY_JARVIS_TOKEN = "l".repeat(40);
const V2_TOKEN = "v".repeat(40);
const WILDCARD_V2_TOKEN = "w".repeat(40);
const V2_SERVICE = "cloudflare-private-r2-v2";
const V2_CLIENT = "jarvis-private-creation-assets-v2";

function t() {
  vi.stubEnv("VAULT_ENFORCE_AUTH", "true");
  vi.stubEnv("VAULT_ROOT_TOKEN", ROOT_TOKEN);
  return convexTest(schema, modules);
}

function r2Rows(
  endpoint = "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
  sessionToken?: string,
) {
  const rows = [
    { service: V2_SERVICE, keyName: "R2_ENDPOINT", value: endpoint },
    { service: V2_SERVICE, keyName: "R2_ACCESS_KEY_ID", value: "v2-access-key" },
    { service: V2_SERVICE, keyName: "R2_SECRET_ACCESS_KEY", value: "v2-secret-key" },
  ];
  if (sessionToken) rows.push({ service: V2_SERVICE, keyName: "R2_SESSION_TOKEN", value: sessionToken });
  return rows.map((item) => ({ ...item, scopes: [], aliases: [], sourceFiles: [] }));
}

async function grantV2Read(c: ReturnType<typeof t>, token = V2_TOKEN, services = [V2_SERVICE], canWrite = false) {
  await c.mutation(api.vaultAuth.upsertClient, {
    rootToken: ROOT_TOKEN,
    name: V2_CLIENT,
    token,
    services,
    canWrite,
  });
}

async function seedV2Credentials(c: ReturnType<typeof t>, endpoint?: string, sessionToken?: string) {
  await c.mutation(api.secrets.bulkInsert, {
    vaultToken: ROOT_TOKEN,
    items: r2Rows(endpoint, sessionToken),
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
        R2_ENDPOINT: "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
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
    ).rejects.toThrow("Private creation asset V2 credentials require the fixed endpoint");
    await expect(
      c.query(api.privateCreationAssetV2.credentials, { v2VaultToken: LEGACY_JARVIS_TOKEN }),
    ).rejects.toThrow("Vault authentication required");
  });

  it("reserves creation, rotation, and revocation of the V2 client identity for the root control path", async () => {
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
    ).rejects.toThrow("Vault authentication required");

    await grantV2Read(c);
    await expect(
      c.mutation(api.vaultAuth.provisionClient, {
        vaultToken: LEGACY_JARVIS_TOKEN,
        name: V2_CLIENT,
        token: "o".repeat(40),
        services: [V2_SERVICE],
        canWrite: false,
      }),
    ).rejects.toThrow("Vault authentication required");
    await expect(
      c.mutation(api.vaultAuth.revokeClientByAdmin, {
        vaultToken: LEGACY_JARVIS_TOKEN,
        name: V2_CLIENT,
      }),
    ).rejects.toThrow("Vault authentication required");
  });

  it("hides V2 metadata from a generic Jarvis bearer and blocks its global truncate path", async () => {
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
      total: 3,
      byService: { [V2_SERVICE]: 3 },
    });
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

  it("does not let a V2-named bearer escape through generic vault enumeration, even if misprovisioned broadly", async () => {
    const c = t();
    await grantV2Read(c, WILDCARD_V2_TOKEN, ["*"], true);
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
    ).rejects.toThrow("Vault authentication required");
  });

  it("fails closed when the fixed R2 endpoint is not an approved HTTPS Cloudflare R2 API endpoint", async () => {
    const c = t();
    await grantV2Read(c);
    await seedV2Credentials(c, "https://public.r2.dev");

    await expect(
      c.query(api.privateCreationAssetV2.credentials, { v2VaultToken: V2_TOKEN }),
    ).rejects.toThrow("R2_ENDPOINT must be an approved Cloudflare R2 HTTPS endpoint");
  });

  it("fails closed instead of silently omitting an unallowlisted V2 service secret", async () => {
    const c = t();
    await grantV2Read(c);
    await seedV2Credentials(c);
    await c.mutation(api.secrets.bulkInsert, {
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
    });

    await expect(
      c.query(api.privateCreationAssetV2.credentials, { v2VaultToken: V2_TOKEN }),
    ).rejects.toThrow("Private creation asset V2 credentials require only the fixed R2 keys");
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
