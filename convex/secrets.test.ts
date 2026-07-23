import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.*s");
const ROOT_TOKEN = "r".repeat(40);
const CLIENT_TOKEN = "c".repeat(40);
const LEGACY_TOKEN = "l".repeat(40);

function t() {
  vi.stubEnv("VAULT_ENFORCE_AUTH", "true");
  vi.stubEnv("VAULT_ROOT_TOKEN", ROOT_TOKEN);
  return convexTest(schema, modules);
}

function secret(service: string, keyName = "API_KEY", aliases: string[] = []) {
  return {
    service,
    keyName,
    value: "test-only-placeholder",
    scopes: ["test"],
    aliases,
    sourceFiles: ["convex/secrets.test.ts"],
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("zero-OpenAI vault boundary", () => {
  it("rejects normalized service, key, alias, and service-prefix variants before writes", async () => {
    const c = t();
    const forbidden = ["Open AI", " chat-gpt ", "api.openai.com", "ＯＰＥＮＡＩ"];

    for (const service of forbidden) {
      await expect(
        c.mutation(api.secrets.bulkInsert, { vaultToken: ROOT_TOKEN, items: [secret(service)] }),
      ).rejects.toThrow(/OpenAI credential namespaces are not permitted/);
    }
    await expect(
      c.mutation(api.secrets.bulkInsert, {
        vaultToken: ROOT_TOKEN,
        items: [secret("stripe", "CHAT GPT API KEY")],
      }),
    ).rejects.toThrow(/OpenAI credential namespaces are not permitted/);
    await expect(
      c.mutation(api.secrets.bulkInsert, {
        vaultToken: ROOT_TOKEN,
        items: [secret("stripe", "API_KEY", ["prod_open-ai_key"])],
      }),
    ).rejects.toThrow(/OpenAI credential namespaces are not permitted/);

    expect(await c.query(api.secrets.summary, { vaultToken: ROOT_TOKEN })).toEqual({
      total: 0,
      byService: {},
    });
  });

  it("preflights mixed batches so a forbidden row leaves valid rows untouched", async () => {
    const c = t();

    await expect(
      c.mutation(api.secrets.bulkInsert, {
        vaultToken: ROOT_TOKEN,
        items: [secret("stripe"), secret("openai:production")],
      }),
    ).rejects.toThrow(/OpenAI credential namespaces are not permitted/);

    expect(await c.query(api.secrets.summary, { vaultToken: ROOT_TOKEN })).toEqual({
      total: 0,
      byService: {},
    });
  });

  it("denies public and internal reads of legacy forbidden references while retaining root counts-only audit", async () => {
    const c = t();
    const legacyOpenAiId = await c.run(async (ctx) => {
      return await ctx.db.insert("secrets", secret("openai", "API_KEY"));
    });
    await c.run(async (ctx) => {
      await ctx.db.insert("secrets", secret("stripe", "OPEN_AI_API_KEY"));
      await ctx.db.insert("secrets", secret("legacy-service", "API_KEY", ["Chat GPT"]));
    });

    await expect(
      c.query(api.secrets.listByService, { vaultToken: ROOT_TOKEN, service: "Open AI" }),
    ).rejects.toThrow(/OpenAI credential namespaces are not permitted/);
    await expect(
      c.query(api.secrets.getOne, {
        vaultToken: ROOT_TOKEN,
        service: "stripe",
        keyName: "open ai api key",
      }),
    ).rejects.toThrow(/OpenAI credential namespaces are not permitted/);
    await expect(
      c.query(internal.wealth.readSecret, { service: "openai", keyName: "API_KEY" }),
    ).rejects.toThrow(/OpenAI credential namespaces are not permitted/);
    await expect(
      c.query(api.secrets.listByService, {
        vaultToken: ROOT_TOKEN,
        service: "legacy-service",
      }),
    ).rejects.toThrow(/OpenAI credential namespaces are not permitted/);
    await expect(
      c.query(api.secrets.getOne, {
        vaultToken: ROOT_TOKEN,
        service: "legacy-service",
        keyName: "API_KEY",
      }),
    ).rejects.toThrow(/OpenAI credential namespaces are not permitted/);
    await expect(
      c.query(internal.wealth.readSecret, { service: "legacy-service", keyName: "API_KEY" }),
    ).rejects.toThrow(/OpenAI credential namespaces are not permitted/);

    // Summary intentionally remains metadata-only so root can audit and clean
    // up a pre-policy row without reading its credential value.
    expect(await c.query(api.secrets.summary, { vaultToken: ROOT_TOKEN })).toEqual({
      total: 3,
      byService: { openai: 1, stripe: 1, "legacy-service": 1 },
    });

    await c.mutation(api.secrets.deleteOne, { vaultToken: ROOT_TOKEN, id: legacyOpenAiId });
    expect(await c.query(api.secrets.summary, { vaultToken: ROOT_TOKEN })).toEqual({
      total: 2,
      byService: { stripe: 1, "legacy-service": 1 },
    });
  });

  it("keeps scoped clients out of forbidden key and alias cleanup while allowing root cleanup and normal operations", async () => {
    const c = t();
    await c.mutation(api.vaultAuth.upsertClient, {
      rootToken: ROOT_TOKEN,
      name: "stripe-writer",
      token: CLIENT_TOKEN,
      services: ["stripe"],
      canWrite: true,
    });
    const [forbiddenKeyId, forbiddenAliasId] = await c.run(async (ctx) => {
      const keyId = await ctx.db.insert("secrets", secret("stripe", "OPEN AI API KEY"));
      const aliasId = await ctx.db.insert("secrets", secret("stripe", "API_KEY", ["Chat GPT"]));
      return [keyId, aliasId];
    });

    for (const id of [forbiddenKeyId, forbiddenAliasId]) {
      await expect(
        c.mutation(api.secrets.deleteOne, { vaultToken: CLIENT_TOKEN, id }),
      ).rejects.toThrow("Vault authentication required");
    }

    // A concrete permitted capability can safely query an absent non-OpenAI
    // reference. The null result establishes absence without returning any
    // credential value.
    await expect(
      c.query(api.secrets.getOne, {
        vaultToken: CLIENT_TOKEN,
        service: "stripe",
        keyName: "MISSING_STRIPE_KEY",
      }),
    ).resolves.toBeNull();

    await c.mutation(api.secrets.bulkInsert, {
      vaultToken: CLIENT_TOKEN,
      items: [secret("stripe", "LIVE_API_KEY")],
    });
    expect(
      await c.query(api.secrets.getOne, {
        vaultToken: CLIENT_TOKEN,
        service: "stripe",
        keyName: "LIVE_API_KEY",
      }),
    ).toMatchObject({ service: "stripe", keyName: "LIVE_API_KEY" });
    const normalId = await c.run(async (ctx) =>
      ctx.db
        .query("secrets")
        .withIndex("by_service_and_key", (q) => q.eq("service", "stripe").eq("keyName", "LIVE_API_KEY"))
        .first()
        .then((row) => row!._id),
    );
    await expect(
      c.mutation(api.secrets.deleteOne, { vaultToken: CLIENT_TOKEN, id: normalId }),
    ).resolves.toEqual({ deleted: normalId });

    for (const id of [forbiddenKeyId, forbiddenAliasId]) {
      await expect(
        c.mutation(api.secrets.deleteOne, { vaultToken: ROOT_TOKEN, id }),
      ).resolves.toEqual({ deleted: id });
    }
  });

  it("rejects a forbidden fetched bridge row before token rotation or asset writes", async () => {
    const c = t();
    const oldToken = "o".repeat(40);
    await c.mutation(api.wealth.upsertAsset, {
      category: "crypto",
      label: "Binance",
      lastValueGBP: 77,
    });
    const bridgeId = await c.run(async (ctx) =>
      ctx.db.insert("secrets", {
        ...secret("convex", "BINANCE_BRIDGE_TOKEN", ["Open AI bridge"]),
        value: oldToken,
      }),
    );

    await expect(
      c.mutation(internal.wealth._seedBridgeToken, { token: "n".repeat(40) }),
    ).rejects.toThrow(/OpenAI credential namespaces are not permitted/);
    await expect(
      c.mutation(api.wealth.ingest, { token: oldToken, spotGbp: 123, positions: [] }),
    ).rejects.toThrow(/OpenAI credential namespaces are not permitted/);

    expect(await c.run((ctx) => ctx.db.get(bridgeId))).toMatchObject({ value: oldToken });
    expect(await c.query(api.wealth.getWealth, {})).toMatchObject({ assetCount: 1, totalGBP: 77 });
  });

  it("permits explicit non-OpenAI services and the fixed bridge-token seed", async () => {
    const c = t();
    await c.mutation(api.secrets.bulkInsert, {
      vaultToken: ROOT_TOKEN,
      items: [secret("openrouter"), secret("stripe")],
    });
    await c.mutation(internal.wealth._seedBridgeToken, { token: "b".repeat(40) });

    expect(await c.query(api.secrets.summary, { vaultToken: ROOT_TOKEN })).toEqual({
      total: 3,
      byService: { openrouter: 1, stripe: 1, convex: 1 },
    });
  });

  it("rejects wildcard and OpenAI client policies without changing a valid existing client", async () => {
    const c = t();
    await c.mutation(api.vaultAuth.upsertClient, {
      rootToken: ROOT_TOKEN,
      name: "explicit-client",
      token: CLIENT_TOKEN,
      services: ["stripe"],
    });

    for (const services of [["*"], ["stripe*"], [" OPEN-AI "]]) {
      await expect(
        c.mutation(api.vaultAuth.upsertClient, {
          rootToken: ROOT_TOKEN,
          name: "explicit-client",
          token: CLIENT_TOKEN,
          services,
        }),
      ).rejects.toThrow(/Wildcard vault service policies|OpenAI credential namespaces/);
    }

    expect(await c.query(api.vaultAuth.whoami, { vaultToken: CLIENT_TOKEN })).toEqual({
      name: "explicit-client",
      services: ["stripe"],
      canWrite: false,
    });
  });

  it("makes persisted wildcard client rows inert", async () => {
    const c = t();
    await c.run(async (ctx) => {
      await ctx.db.insert("vaultClients", {
        name: "legacy-wildcard",
        token: LEGACY_TOKEN,
        services: ["*"],
        canWrite: true,
        active: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await expect(
      c.query(api.secrets.listByService, { vaultToken: LEGACY_TOKEN, service: "stripe" }),
    ).rejects.toThrow("Vault authentication required");
  });
});
