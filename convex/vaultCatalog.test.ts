import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { createVaultSession } from "../src/lib/vault-control";

const modules = import.meta.glob("./**/*.*s");
const ROOT_TOKEN = "r".repeat(40);
const SESSION_SECRET = "s".repeat(48);

function t() {
  vi.stubEnv("VAULT_ENFORCE_AUTH", "true");
  vi.stubEnv("VAULT_ROOT_TOKEN", ROOT_TOKEN);
  vi.stubEnv("PROJECT_HUB_VAULT_SESSION_SECRET", SESSION_SECRET);
  return convexTest(schema, modules);
}

afterEach(() => vi.unstubAllEnvs());

describe("vault metadata catalogue", () => {
  it("writes opaque values but only returns metadata to the catalogue control", async () => {
    const c = t();
    const first = await c.mutation(api.secrets.upsertOne, {
      vaultToken: ROOT_TOKEN,
      service: "example-service",
      keyName: "API_KEY",
      value: " value with significant whitespace ",
      description: "Used by the example worker",
      scopes: ["worker"],
      aliases: ["EXAMPLE_API_KEY"],
      sourceFiles: ["worker/.env"],
    });

    expect(first).toEqual({
      created: true,
      entry: {
        service: "example-service",
        keyName: "API_KEY",
        revision: 1,
        description: "Used by the example worker",
        scopes: ["worker"],
        aliases: ["EXAMPLE_API_KEY"],
        sourceFiles: ["worker/.env"],
      },
    });
    expect(first.entry).not.toHaveProperty("value");

    const catalogue = await c.query(api.secrets.catalog, { vaultToken: ROOT_TOKEN });
    expect(catalogue).toEqual([first.entry]);
    expect(catalogue[0]).not.toHaveProperty("value");

    const stored = await c.query(api.secrets.getOne, {
      vaultToken: ROOT_TOKEN,
      service: "example-service",
      keyName: "API_KEY",
    });
    expect(stored?.value).toBe(" value with significant whitespace ");

    const rotated = await c.mutation(api.secrets.upsertOne, {
      vaultToken: ROOT_TOKEN,
      service: "example-service",
      keyName: "API_KEY",
      value: "replacement",
      scopes: [],
      aliases: [],
      sourceFiles: [],
    });
    expect(rotated).toMatchObject({ created: false, entry: { revision: 2 } });

    const ownerSession = createVaultSession();
    const ownerWrite = await c.mutation(api.secrets.upsertOne, {
      vaultSession: ownerSession,
      service: "owner-web-control",
      keyName: "WRITE_ONLY_KEY",
      value: "owner-entered-value",
      scopes: [],
      aliases: [],
      sourceFiles: [],
    });
    expect(ownerWrite).toMatchObject({ created: true, entry: { service: "owner-web-control" } });
    const ownerCatalogue = await c.query(api.secrets.catalog, { vaultSession: ownerSession });
    expect(ownerCatalogue.find((entry) => entry.keyName === "WRITE_ONLY_KEY")).not.toHaveProperty("value");
  });

  it("does not use the general control path for the fixed Higgsfield bundle", async () => {
    const c = t();
    await expect(c.mutation(api.secrets.upsertOne, {
      vaultToken: ROOT_TOKEN,
      service: "higgsfield",
      keyName: "HIGGSFIELD_SESSION",
      value: "not-a-session",
      scopes: [],
      aliases: [],
      sourceFiles: [],
    })).rejects.toThrow("fixed bundle endpoint");
  });
});
