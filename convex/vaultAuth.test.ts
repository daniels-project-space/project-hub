import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.*s");
const ROOT_TOKEN = "r".repeat(40);
const ADMIN_TOKEN = "a".repeat(40);
const LIMITED_TOKEN = "l".repeat(40);
const BRIDGE_TOKEN = "b".repeat(40);

function t() {
  vi.stubEnv("VAULT_ROOT_TOKEN", ROOT_TOKEN);
  return convexTest(schema, modules);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("vault client administration", () => {
  it("lets a full-catalogue writer provision a revocable bridge client without the root token", async () => {
    const c = t();
    await c.mutation(api.vaultAuth.upsertClient, {
      rootToken: ROOT_TOKEN,
      name: "claude-admin",
      token: ADMIN_TOKEN,
      services: ["*"],
      canWrite: true,
    });
    await c.mutation(api.vaultAuth.upsertClient, {
      rootToken: ROOT_TOKEN,
      name: "limited-writer",
      token: LIMITED_TOKEN,
      services: ["novita"],
      canWrite: true,
    });

    await expect(
      c.mutation(api.vaultAuth.provisionClient, {
        vaultToken: ADMIN_TOKEN,
        name: "codex-bridge",
        token: BRIDGE_TOKEN,
        services: ["*"],
        canWrite: true,
      }),
    ).resolves.toBeDefined();
    await expect(c.query(api.vaultAuth.whoami, { vaultToken: BRIDGE_TOKEN })).resolves.toEqual({
      name: "codex-bridge",
      services: ["*"],
      canWrite: true,
    });
    await expect(
      c.mutation(api.vaultAuth.revokeClientByAdmin, {
        vaultToken: ADMIN_TOKEN,
        name: "codex-bridge",
      }),
    ).resolves.toBe(true);
    await expect(c.query(api.vaultAuth.whoami, { vaultToken: BRIDGE_TOKEN })).rejects.toThrow(
      "Vault authentication required",
    );
    await expect(
      c.mutation(api.vaultAuth.provisionClient, {
        vaultToken: LIMITED_TOKEN,
        name: "should-fail",
        token: "x".repeat(40),
        services: ["*"],
        canWrite: true,
      }),
    ).rejects.toThrow("Vault authentication required");
  });
});
