import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.*s");
const ROOT_TOKEN = "r".repeat(40);
const ACTIONS_TOKEN = "a".repeat(40);
const READ_ONLY_TOKEN = "l".repeat(40);
const WILDCARD_TOKEN = "w".repeat(40);
const OTHER_TOKEN = "o".repeat(40);

function t() {
  vi.stubEnv("VAULT_ENFORCE_AUTH", "true");
  vi.stubEnv("VAULT_ROOT_TOKEN", ROOT_TOKEN);
  return convexTest(schema, modules);
}

async function provisionActionsClient(c: ReturnType<typeof t>, options?: { canWrite?: boolean; services?: string[]; name?: string; token?: string }) {
  await c.mutation(api.vaultAuth.upsertClient, {
    rootToken: ROOT_TOKEN,
    name: options?.name ?? "jarvis-actions",
    token: options?.token ?? ACTIONS_TOKEN,
    services: options?.services ?? ["jarvis-actions"],
    canWrite: options?.canWrite ?? true,
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Jarvis bounded Hub action façade", () => {
  it("fails closed without the dedicated bearer, including the vault root bearer", async () => {
    const c = t();

    await expect(c.query(api.jarvisActions.listTodos, {})).rejects.toThrow("Vault authentication required");
    await expect(
      c.query(api.jarvisActions.listTodos, { vaultToken: ROOT_TOKEN }),
    ).rejects.toThrow("Vault authentication required");
  });

  it("rejects wildcard, mixed-scope, and wrong-client bearers", async () => {
    const c = t();
    await provisionActionsClient(c, { name: "other-app", token: OTHER_TOKEN });
    await provisionActionsClient(c, { name: "jarvis-actions", token: WILDCARD_TOKEN, services: ["*"] });

    await expect(c.query(api.jarvisActions.listTodos, { vaultToken: OTHER_TOKEN })).rejects.toThrow(
      "Vault authentication required",
    );
    await expect(c.query(api.jarvisActions.listTodos, { vaultToken: WILDCARD_TOKEN })).rejects.toThrow(
      "Vault authentication required",
    );

    await provisionActionsClient(c, {
      name: "jarvis-actions",
      token: "m".repeat(40),
      services: ["jarvis-actions", "jarvis-context"],
    });
    await expect(c.query(api.jarvisActions.listTodos, { vaultToken: "m".repeat(40) })).rejects.toThrow(
      "Vault authentication required",
    );
  });

  it("lists only active to-dos and the safe widget layout inventory", async () => {
    const c = t();
    await provisionActionsClient(c);
    const activeId = await c.mutation(api.todos.add, {
      vaultToken: ROOT_TOKEN,
      text: "Plan train",
      priority: 2,
      dueDate: 1_800_000_000_000,
      tags: ["travel"],
      projectSlug: "travel",
      ownerId: "owner-private",
    });
    const completedId = await c.mutation(api.todos.add, { vaultToken: ROOT_TOKEN, text: "Old task" });
    await c.mutation(api.todos.update, { vaultToken: ROOT_TOKEN, id: completedId, done: true });
    await c.mutation(api.widgets.upsert, {
      type: "travel",
      position: 0,
      enabled: true,
      config: { privateValue: "must not leave Hub" },
    });

    const todos = await c.query(api.jarvisActions.listTodos, { vaultToken: ACTIONS_TOKEN });
    const widgets = await c.query(api.jarvisActions.listWidgets, { vaultToken: ACTIONS_TOKEN });

    expect(todos).toEqual([
      expect.objectContaining({ id: activeId, text: "Plan train", tags: ["travel"], projectSlug: "travel" }),
    ]);
    expect(todos[0]).not.toHaveProperty("ownerId");
    expect(widgets).toEqual([expect.objectContaining({ type: "travel", position: 0, enabled: true })]);
    expect(widgets[0]).not.toHaveProperty("config");
  });

  it("permits only bounded to-do creation and updates for a write-enabled actions client", async () => {
    const c = t();
    await provisionActionsClient(c);

    const created = await c.mutation(api.jarvisActions.createTodo, {
      vaultToken: ACTIONS_TOKEN,
      text: "  Download Barcelona map  ",
      priority: 3,
      dueDate: 1_800_000_000_000,
      tags: ["Travel", "travel"],
    });
    await c.mutation(api.jarvisActions.updateTodo, {
      vaultToken: ACTIONS_TOKEN,
      id: created.id,
      text: "Download Barcelona offline map",
      done: true,
    });

    const [todo] = await c.query(api.todos.list, { vaultToken: ROOT_TOKEN });
    expect(todo).toMatchObject({
      _id: created.id,
      text: "Download Barcelona offline map",
      done: true,
      priority: 3,
      tags: ["travel"],
    });
    expect(todo.projectSlug).toBeUndefined();
    expect(todo.ownerId).toBeUndefined();
    await expect(
      c.mutation(api.jarvisActions.createTodo, {
        vaultToken: ACTIONS_TOKEN,
        text: "x".repeat(501),
      }),
    ).rejects.toThrow("Todo text must be between");
    await expect(
      c.mutation(api.jarvisActions.updateTodo, { vaultToken: ACTIONS_TOKEN, id: created.id }),
    ).rejects.toThrow("At least one todo field");
  });

  it("keeps mutations unavailable to a read-only actions bearer", async () => {
    const c = t();
    await provisionActionsClient(c, { token: READ_ONLY_TOKEN, canWrite: false });

    await expect(c.query(api.jarvisActions.listTodos, { vaultToken: READ_ONLY_TOKEN })).resolves.toEqual([]);
    await expect(
      c.mutation(api.jarvisActions.createTodo, {
        vaultToken: READ_ONLY_TOKEN,
        text: "This must not be created",
      }),
    ).rejects.toThrow("Vault authentication required");
  });
});
