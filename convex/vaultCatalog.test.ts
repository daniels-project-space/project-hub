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

  it("supports create-only project enrollment writes and idempotent same-value recovery", async () => {
    const c = t();
    const fields = { keyName: "RENDER_ENGINE_PROJECT_TOKEN", value: "a".repeat(64), scopes: ["music-house", "render-engine"], aliases: [], sourceFiles: [] };
    await expect(c.mutation(api.secrets.upsertOne, {
      vaultToken: ROOT_TOKEN, service: "music-house", ...fields, createOnly: true,
    })).resolves.toMatchObject({ created: true, entry: { service: "music-house", keyName: fields.keyName, revision: 1 } });

    // Retrying after an uncertain HTTP response confirms the exact value and
    // leaves the secret revision and metadata unchanged.
    await expect(c.mutation(api.secrets.upsertOne, {
      vaultToken: ROOT_TOKEN, service: "music-house", ...fields, createOnly: true,
    })).resolves.toMatchObject({ created: false, entry: { revision: 1 } });
    await expect(c.mutation(api.secrets.upsertOne, {
      vaultToken: ROOT_TOKEN, service: "music-house", ...fields, value: "b".repeat(64), createOnly: true,
    })).rejects.toThrow("already exists with a different value");
    await expect(c.query(api.secrets.getOne, {
      vaultToken: ROOT_TOKEN, service: "music-house", keyName: fields.keyName,
    })).resolves.toMatchObject({ value: fields.value, revision: 1 });

    // The common key name is still a distinct record in a different project
    // namespace; create-only never claims a global key name.
    await expect(c.mutation(api.secrets.upsertOne, {
      vaultToken: ROOT_TOKEN, service: "vera-stay", ...fields, createOnly: true,
    })).resolves.toMatchObject({ created: true, entry: { service: "vera-stay", revision: 1 } });
  });
});
