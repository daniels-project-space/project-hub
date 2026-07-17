import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.*s");
const ROOT_TOKEN = "r".repeat(40);
const JARVIS_TOKEN = "j".repeat(40);
const OTHER_TOKEN = "o".repeat(40);

function t() {
  vi.stubEnv("VAULT_ENFORCE_AUTH", "true");
  vi.stubEnv("VAULT_ROOT_TOKEN", ROOT_TOKEN);
  return convexTest(schema, modules);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("JARVIS cross-app context", () => {
  it("fails closed without a scoped bearer", async () => {
    const c = t();

    await expect(c.query(api.jarvisContext.snapshot, {})).rejects.toThrow(
      "Vault authentication required",
    );
  });

  it("returns the bounded snapshot only to the jarvis-context capability", async () => {
    const c = t();
    await c.mutation(api.vaultAuth.upsertClient, {
      rootToken: ROOT_TOKEN,
      name: "jarvis",
      token: JARVIS_TOKEN,
      services: ["jarvis-context"],
    });
    await c.mutation(api.vaultAuth.upsertClient, {
      rootToken: ROOT_TOKEN,
      name: "other-app",
      token: OTHER_TOKEN,
      services: ["openai"],
    });
    await c.mutation(api.todos.add, { text: "private work item" });

    const snapshot = await c.query(api.jarvisContext.snapshot, {
      vaultToken: JARVIS_TOKEN,
    });
    expect(snapshot.todos.map((todo) => todo.text)).toEqual(["private work item"]);
    expect(snapshot.todos).toHaveLength(1);
    expect(snapshot.events).toEqual([]);

    await expect(
      c.query(api.jarvisContext.snapshot, { vaultToken: OTHER_TOKEN }),
    ).rejects.toThrow("Vault authentication required");
  });
});
