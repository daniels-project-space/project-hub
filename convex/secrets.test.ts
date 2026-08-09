import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.*s");
const ROOT_TOKEN = "r".repeat(40);
const MEDIA_ENGINE_TOKEN = "m".repeat(40);
const OTHER_HIGGSFIELD_TOKEN = "o".repeat(40);

function t(enforceAuth = "true") {
  vi.stubEnv("VAULT_ENFORCE_AUTH", enforceAuth);
  vi.stubEnv("VAULT_ROOT_TOKEN", ROOT_TOKEN);
  return convexTest(schema, modules);
}

type SessionOverrides = { clientId?: string };

function session(suffix = "one", overrides: SessionOverrides = {}) {
  return JSON.stringify({
    version: 1,
    accessToken: `access-${suffix}`,
    refreshToken: `refresh-${suffix}`,
    expiresAt: Date.UTC(2030, 0, 1),
    clientId: "https://media-engine.example.com/.well-known/oauth-client.json",
    scope: "openid email offline_access",
    tokenType: "Bearer",
    issuer: "https://mcp.higgsfield.ai",
    idToken: `id-token-${suffix}`,
    ...overrides,
  });
}

async function grantMediaEngineWrite(c: ReturnType<typeof t>) {
  await c.mutation(api.vaultAuth.upsertClient, {
    rootToken: ROOT_TOKEN,
    name: "media-engine",
    token: MEDIA_ENGINE_TOKEN,
    services: ["higgsfield"],
    canWrite: true,
  });
}

async function grantOtherHiggsfieldWrite(c: ReturnType<typeof t>) {
  await c.mutation(api.vaultAuth.upsertClient, {
    rootToken: ROOT_TOKEN,
    name: "other-renderer",
    token: OTHER_HIGGSFIELD_TOKEN,
    services: ["higgsfield"],
    canWrite: true,
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Higgsfield credential bundle rotation", () => {
  it("creates once, then rotates only with the current CAS revision", async () => {
    const c = t();
    await grantMediaEngineWrite(c);

    await expect(
      c.mutation(api.secrets.rotateCredentialBundle, {
        vaultToken: MEDIA_ENGINE_TOKEN,
        value: session("first"),
        expectedRevision: null,
      }),
    ).resolves.toEqual({ created: true, revision: 1 });

    await expect(
      c.query(api.secrets.getCredentialBundle, { vaultToken: MEDIA_ENGINE_TOKEN }),
    ).resolves.toEqual({ value: session("first"), revision: 1 });

    await expect(
      c.mutation(api.secrets.rotateCredentialBundle, {
        vaultToken: MEDIA_ENGINE_TOKEN,
        value: session("second"),
        expectedRevision: 1,
      }),
    ).resolves.toEqual({ created: false, revision: 2 });

    await expect(
      c.mutation(api.secrets.rotateCredentialBundle, {
        vaultToken: MEDIA_ENGINE_TOKEN,
        value: session("stale"),
        expectedRevision: 1,
      }),
    ).rejects.toThrow("Credential bundle changed");
  });

  it("fails closed without the scoped bearer and rejects invalid session shapes", async () => {
    // The fixed-key endpoints must not inherit the vault migration bypass.
    const c = t("false");
    await grantMediaEngineWrite(c);

    await expect(
      c.mutation(api.secrets.rotateCredentialBundle, {
        value: session(),
        expectedRevision: null,
      }),
    ).rejects.toThrow("Vault authentication required");
    await expect(
      c.mutation(api.secrets.rotateCredentialBundle, {
        vaultToken: MEDIA_ENGINE_TOKEN,
        value: JSON.stringify({ version: 1, accessToken: "only-one-field" }),
        expectedRevision: null,
      }),
    ).rejects.toThrow("Invalid Higgsfield session refreshToken");
    await expect(
      c.mutation(api.secrets.rotateCredentialBundle, {
        vaultToken: MEDIA_ENGINE_TOKEN,
        value: session("insecure-client", { clientId: "http://media-engine.example.com/client.json" }),
        expectedRevision: null,
      }),
    ).rejects.toThrow("clientId must be an HTTPS metadata URL");
    await expect(
      c.query(api.secrets.getCredentialBundle, { vaultToken: MEDIA_ENGINE_TOKEN }),
    ).resolves.toBeNull();
  });

  it("restricts a Media Engine bearer to the fixed bundle endpoints", async () => {
    const c = t();
    await grantMediaEngineWrite(c);
    await c.mutation(api.secrets.rotateCredentialBundle, {
      vaultToken: MEDIA_ENGINE_TOKEN,
      value: session(),
      expectedRevision: null,
    });
    const [row] = await c.query(api.secrets.listByService, {
      service: "higgsfield",
      vaultToken: ROOT_TOKEN,
    });

    await expect(
      c.query(api.secrets.listByService, {
        service: "higgsfield",
        vaultToken: MEDIA_ENGINE_TOKEN,
      }),
    ).rejects.toThrow("fixed bundle endpoint");
    await expect(
      c.query(api.secrets.getOne, {
        service: "higgsfield",
        keyName: "HIGGSFIELD_SESSION",
        vaultToken: MEDIA_ENGINE_TOKEN,
      }),
    ).rejects.toThrow("fixed bundle endpoint");
    await expect(
      c.mutation(api.secrets.bulkInsert, {
        vaultToken: MEDIA_ENGINE_TOKEN,
        items: [{
          service: "higgsfield",
          keyName: "other",
          value: session("other"),
          scopes: [],
          aliases: [],
          sourceFiles: [],
        }],
      }),
    ).rejects.toThrow("fixed bundle endpoint");
    await expect(
      c.mutation(api.secrets.deleteOne, {
        vaultToken: MEDIA_ENGINE_TOKEN,
        id: row._id,
      }),
    ).rejects.toThrow("fixed bundle endpoint");
    await expect(
      c.query(api.secrets.getOne, {
        service: "higgsfield",
        keyName: "HIGGSFIELD_SESSION",
        vaultToken: ROOT_TOKEN,
      }),
    ).resolves.toMatchObject({ value: session() });
  });

  it("does not let another Higgsfield-scoped client use the fixed bundle capability", async () => {
    const c = t();
    await grantMediaEngineWrite(c);
    await grantOtherHiggsfieldWrite(c);
    await c.mutation(api.secrets.rotateCredentialBundle, {
      vaultToken: MEDIA_ENGINE_TOKEN,
      value: session(),
      expectedRevision: null,
    });

    await expect(
      c.query(api.secrets.getCredentialBundle, { vaultToken: OTHER_HIGGSFIELD_TOKEN }),
    ).rejects.toThrow("Vault authentication required");
    await expect(
      c.mutation(api.secrets.rotateCredentialBundle, {
        vaultToken: OTHER_HIGGSFIELD_TOKEN,
        value: session("other"),
        expectedRevision: 1,
      }),
    ).rejects.toThrow("Vault authentication required");
  });

  it("rejects wildcard policies for the durable Higgsfield capability", async () => {
    for (const services of [["*"], ["higgs*"], ["higgsfield", "*"], ["higgsfield", "higgs*"]]) {
      const c = t();
      await c.mutation(api.vaultAuth.upsertClient, {
        rootToken: ROOT_TOKEN,
        name: "media-engine",
        token: MEDIA_ENGINE_TOKEN,
        services,
        canWrite: true,
      });

      await expect(
        c.query(api.secrets.getCredentialBundle, { vaultToken: MEDIA_ENGINE_TOKEN }),
      ).rejects.toThrow("Vault authentication required");
      await expect(
        c.mutation(api.secrets.rotateCredentialBundle, {
          vaultToken: MEDIA_ENGINE_TOKEN,
          value: session(),
          expectedRevision: null,
        }),
      ).rejects.toThrow("Vault authentication required");
    }
  });

  it("halts normal writers on duplicates and permits explicit root-only repair", async () => {
    const c = t();
    await grantMediaEngineWrite(c);
    await c.mutation(api.secrets.bulkInsert, {
      vaultToken: ROOT_TOKEN,
      items: ["legacy-one", "legacy-two"].map((suffix) => ({
        service: "higgsfield",
        keyName: "HIGGSFIELD_SESSION",
        value: session(suffix),
        scopes: [],
        aliases: [],
        sourceFiles: [],
      })),
    });
    const rows = await c.query(api.secrets.listByService, {
      service: "higgsfield",
      vaultToken: ROOT_TOKEN,
    });

    await expect(
      c.mutation(api.secrets.rotateCredentialBundle, {
        vaultToken: MEDIA_ENGINE_TOKEN,
        value: session("replacement"),
        expectedRevision: 0,
      }),
    ).rejects.toThrow("requires root deduplication");
    await expect(
      c.mutation(api.secrets.deduplicateCredentialBundle, {
        rootToken: MEDIA_ENGINE_TOKEN,
        keepId: rows[0]._id,
      }),
    ).rejects.toThrow("Vault authentication required");
    await expect(
      c.mutation(api.secrets.deduplicateCredentialBundle, {
        rootToken: ROOT_TOKEN,
        keepId: rows[0]._id,
      }),
    ).resolves.toEqual({ removed: 1, revision: 0 });
  });
});
