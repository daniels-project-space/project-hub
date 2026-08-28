import { convexTest } from "convex-test";
import { getFunctionName } from "convex/server";
import { afterEach, describe, it, expect, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { createVaultSession } from "../src/lib/vault-control";

// convex-test needs the module map so it can load query/mutation handlers.
// Must include the _generated dir so findModulesRoot can locate the root.
const modules = import.meta.glob("./**/*.*s");

const ROOT_TOKEN = "r".repeat(40);
const PROJECT_HUB_TOKEN = "p".repeat(40);
const SESSION_SECRET = "s".repeat(48);
type AnyFunctionReference = Parameters<typeof getFunctionName>[0];

function rawT() {
  vi.stubEnv("VAULT_ENFORCE_AUTH", "true");
  vi.stubEnv("VAULT_ROOT_TOKEN", ROOT_TOKEN);
  vi.stubEnv("PROJECT_HUB_VAULT_SESSION_SECRET", SESSION_SECRET);
  return convexTest(schema, modules);
}

// Keep the historical CRUD assertions focused on CRUD behavior while making
// their caller explicit: the Hub's server route forwards this owner session.
// The raw-client regression below proves the public Convex path is closed.
function t() {
  const c = rawT();
  const vaultSession = createVaultSession();
  const isTodoFunction = (reference: AnyFunctionReference) => getFunctionName(reference).startsWith("todos:");
  return {
    query: (reference: AnyFunctionReference, args: Record<string, unknown>) => c.query(
      reference as never,
      isTodoFunction(reference) ? { ...args, vaultSession } : args,
    ),
    mutation: (reference: AnyFunctionReference, args: Record<string, unknown>) => c.mutation(
      reference as never,
      isTodoFunction(reference) ? { ...args, vaultSession } : args,
    ),
  };
}

afterEach(() => vi.unstubAllEnvs());

describe("notes CRUD + reorder", () => {
  it("add assigns incrementing positions; list returns position-asc order", async () => {
    const c = t();
    const a = await c.mutation(api.notes.add, { text: "first" });
    const b = await c.mutation(api.notes.add, { text: "second" });
    const d = await c.mutation(api.notes.add, { text: "third" });
    expect([a, b, d].every(Boolean)).toBe(true);

    const list = await c.query(api.notes.list, {});
    expect(list.map((n) => n.text)).toEqual(["first", "second", "third"]);
    expect(list.map((n) => n.position)).toEqual([0, 1, 2]);
  });

  it("add defaults color=amber, pinned=false and sets updatedAt", async () => {
    const c = t();
    await c.mutation(api.notes.add, { text: "x" });
    const [n] = await c.query(api.notes.list, {});
    expect(n.color).toBe("amber");
    expect(n.pinned).toBe(false);
    expect(typeof n.updatedAt).toBe("number");
    expect(n.updatedAt).toBeGreaterThan(0);
  });

  it("update patches ONLY provided fields, leaves others intact", async () => {
    const c = t();
    const id = await c.mutation(api.notes.add, { text: "orig", color: "rose" });
    await c.mutation(api.notes.update, { id, text: "edited" });
    const [n] = await c.query(api.notes.list, {});
    expect(n.text).toBe("edited");
    expect(n.color).toBe("rose"); // untouched — proves partial patch
  });

  it("update with pinned:true persists; color-only update keeps text", async () => {
    const c = t();
    const id = await c.mutation(api.notes.add, { text: "keepme", color: "amber" });
    await c.mutation(api.notes.update, { id, pinned: true });
    await c.mutation(api.notes.update, { id, color: "emerald" });
    const [n] = await c.query(api.notes.list, {});
    expect(n.pinned).toBe(true);
    expect(n.color).toBe("emerald");
    expect(n.text).toBe("keepme");
  });

  it("remove deletes the row", async () => {
    const c = t();
    const id = await c.mutation(api.notes.add, { text: "doomed" });
    await c.mutation(api.notes.add, { text: "survivor" });
    await c.mutation(api.notes.remove, { id });
    const list = await c.query(api.notes.list, {});
    expect(list.map((n) => n.text)).toEqual(["survivor"]);
  });

  it("reorder persists new positions and flips list order", async () => {
    const c = t();
    const a = await c.mutation(api.notes.add, { text: "A" });
    const b = await c.mutation(api.notes.add, { text: "B" });
    const d = await c.mutation(api.notes.add, { text: "C" });
    // Reverse order: C,B,A
    await c.mutation(api.notes.reorder, { ids: [d, b, a] });
    const list = await c.query(api.notes.list, {});
    expect(list.map((n) => n.text)).toEqual(["C", "B", "A"]);
    expect(list.map((n) => n.position)).toEqual([0, 1, 2]);
  });

  it("FINDING-PROBE: notes.list does NOT sort pinned-first (only by position)", async () => {
    const c = t();
    const a = await c.mutation(api.notes.add, { text: "unpinned-pos0" });
    const b = await c.mutation(api.notes.add, { text: "pinned-pos1" });
    await c.mutation(api.notes.update, { id: b, pinned: true });
    const list = await c.query(api.notes.list, {});
    // Documents ACTUAL behavior: position order, NOT pinned-first.
    expect(list.map((n) => n.text)).toEqual(["unpinned-pos0", "pinned-pos1"]);
  });
});

describe("events CRUD", () => {
  it("create defaults allDay=false, color=brass; list sorts by start asc", async () => {
    const c = t();
    await c.mutation(api.events.create, { title: "late", start: 3000 });
    await c.mutation(api.events.create, { title: "early", start: 1000 });
    await c.mutation(api.events.create, { title: "mid", start: 2000 });
    const list = await c.query(api.events.list, {});
    expect(list.map((e) => e.title)).toEqual(["early", "mid", "late"]);
    expect(list[0].allDay).toBe(false);
    expect(list[0].color).toBe("brass");
  });

  it("add is an alias of create", async () => {
    const c = t();
    const id = await c.mutation(api.events.add, { title: "via-add", start: 500 });
    expect(id).toBeTruthy();
    const list = await c.query(api.events.list, {});
    expect(list[0].title).toBe("via-add");
  });

  it("update patches only provided fields", async () => {
    const c = t();
    const id = await c.mutation(api.events.create, {
      title: "meeting",
      start: 1000,
      location: "HQ",
    });
    await c.mutation(api.events.update, { id, title: "renamed" });
    const [e] = await c.query(api.events.list, {});
    expect(e.title).toBe("renamed");
    expect(e.location).toBe("HQ"); // untouched
  });

  it("remove deletes the event", async () => {
    const c = t();
    const id = await c.mutation(api.events.create, { title: "x", start: 1 });
    await c.mutation(api.events.remove, { id });
    expect(await c.query(api.events.list, {})).toEqual([]);
  });

  it("EDGE: event with end < start is still stored verbatim (no validation)", async () => {
    const c = t();
    await c.mutation(api.events.create, { title: "bad", start: 5000, end: 1000 });
    const [e] = await c.query(api.events.list, {});
    expect(e.start).toBe(5000);
    expect(e.end).toBe(1000); // documents lack of start<end guard
  });
});

describe("todos CRUD + reorder + round-trip", () => {
  it("rejects every legacy direct Todo call and accepts an owner session or scoped server capability", async () => {
    const c = rawT();
    await expect(c.query(api.todos.list, {})).rejects.toThrow("Vault authentication required");
    await expect(c.mutation(api.todos.add, { text: "blocked" })).rejects.toThrow("Vault authentication required");
    await expect(c.mutation(api.todos.create, { text: "blocked" })).rejects.toThrow("Vault authentication required");

    const vaultSession = createVaultSession();
    const id = await c.mutation(api.todos.add, { vaultSession, text: "owner-access" });
    await expect(c.mutation(api.todos.update, { id, done: true })).rejects.toThrow("Vault authentication required");
    await expect(c.mutation(api.todos.remove, { id })).rejects.toThrow("Vault authentication required");
    await expect(c.mutation(api.todos.reorder, { ids: [id] })).rejects.toThrow("Vault authentication required");
    await expect(c.mutation(api.todos.seedFromV1, { items: [] })).rejects.toThrow("Vault authentication required");

    await c.mutation(api.todos.update, { vaultSession, id, done: true });
    expect((await c.query(api.todos.list, { vaultSession }))[0].done).toBe(true);

    await c.mutation(api.vaultAuth.upsertClient, {
      rootToken: ROOT_TOKEN,
      name: "project-hub-worker",
      token: PROJECT_HUB_TOKEN,
      services: ["project-hub"],
      canWrite: true,
    });
    const serverId = await c.mutation(api.todos.add, { vaultToken: PROJECT_HUB_TOKEN, text: "server-access" });
    expect(serverId).toBeTruthy();
    expect((await c.query(api.todos.list, { vaultToken: PROJECT_HUB_TOKEN })).map((todo) => todo._id)).toContain(serverId);
  });

  it("add defaults done=false, priority=0, tags=[]; list position-asc", async () => {
    const c = t();
    await c.mutation(api.todos.add, { text: "t1" });
    await c.mutation(api.todos.add, { text: "t2" });
    const list = await c.query(api.todos.list, {});
    expect(list.map((x) => x.text)).toEqual(["t1", "t2"]);
    expect(list[0].done).toBe(false);
    expect(list[0].priority).toBe(0);
    expect(list[0].tags).toEqual([]);
    expect(typeof list[0].createdAt).toBe("number");
  });

  it("priority/dueDate/tags/projectSlug round-trip exactly", async () => {
    const c = t();
    const due = Date.UTC(2030, 0, 1);
    await c.mutation(api.todos.add, {
      text: "rich",
      priority: 2,
      dueDate: due,
      tags: ["urgent", "home", "🔥"],
      projectSlug: "rental-manager",
    });
    const [x] = await c.query(api.todos.list, {});
    expect(x.priority).toBe(2);
    expect(x.dueDate).toBe(due);
    expect(x.tags).toEqual(["urgent", "home", "🔥"]);
    expect(x.projectSlug).toBe("rental-manager");
  });

  it("create alias works; update toggles done without touching text", async () => {
    const c = t();
    const id = await c.mutation(api.todos.create, { text: "alias" });
    await c.mutation(api.todos.update, { id, done: true });
    const [x] = await c.query(api.todos.list, {});
    expect(x.done).toBe(true);
    expect(x.text).toBe("alias");
  });

  it("update tags replaces array; empty tags array allowed", async () => {
    const c = t();
    const id = await c.mutation(api.todos.add, { text: "tagtest", tags: ["a", "b"] });
    await c.mutation(api.todos.update, { id, tags: [] });
    const [x] = await c.query(api.todos.list, {});
    expect(x.tags).toEqual([]);
  });

  it("LARGE: create 600 todos, reverse-reorder, assert full new order persists", async () => {
    const c = t();
    const N = 600;
    const ids: string[] = [];
    for (let i = 0; i < N; i++) {
      ids.push(await c.mutation(api.todos.add, { text: `todo-${i}` }));
    }
    const before = await c.query(api.todos.list, {});
    expect(before).toHaveLength(N);
    expect(before[0].text).toBe("todo-0");
    expect(before[N - 1].text).toBe(`todo-${N - 1}`);

    const reversed = [...ids].reverse();
    await c.mutation(api.todos.reorder, { ids: reversed as never });

    const after = await c.query(api.todos.list, {});
    expect(after).toHaveLength(N);
    expect(after[0].text).toBe(`todo-${N - 1}`);
    expect(after[N - 1].text).toBe("todo-0");
    // positions are a dense 0..N-1 sequence
    expect(after.map((x) => x.position)).toEqual([...Array(N).keys()]);
  }, 60_000);

  it("remove drops the row", async () => {
    const c = t();
    const id = await c.mutation(api.todos.add, { text: "del" });
    await c.mutation(api.todos.add, { text: "stay" });
    await c.mutation(api.todos.remove, { id });
    const list = await c.query(api.todos.list, {});
    expect(list.map((x) => x.text)).toEqual(["stay"]);
  });
});

describe("adversarial / edge inputs", () => {
  it("empty DB: all list queries return [] (no crash)", async () => {
    const c = t();
    expect(await c.query(api.notes.list, {})).toEqual([]);
    expect(await c.query(api.events.list, {})).toEqual([]);
    expect(await c.query(api.todos.list, {})).toEqual([]);
  });

  it("empty-string text is stored verbatim", async () => {
    const c = t();
    await c.mutation(api.notes.add, { text: "" });
    const [n] = await c.query(api.notes.list, {});
    expect(n.text).toBe("");
  });

  it("10k-char text and unicode/emoji preserved", async () => {
    const c = t();
    const big = "x".repeat(10_000);
    const uni = "日本語 — café — 🚀🔥 — Ω≈ç√";
    await c.mutation(api.notes.add, { text: big });
    await c.mutation(api.notes.add, { text: uni });
    const list = await c.query(api.notes.list, {});
    expect(list[0].text).toHaveLength(10_000);
    expect(list[1].text).toBe(uni);
  });

  it("HTML/script-injection string stored + returned VERBATIM (no escaping at data layer)", async () => {
    const c = t();
    const xss = `<script>alert('xss')</script><img src=x onerror=alert(1)>`;
    await c.mutation(api.notes.add, { text: xss });
    const [n] = await c.query(api.notes.list, {});
    expect(n.text).toBe(xss); // data layer does not sanitize — UI must escape
  });

  it("negative priority + huge 1e15 dueDate are valid finite numbers, stored as-is", async () => {
    const c = t();
    await c.mutation(api.todos.add, {
      text: "weird",
      priority: -5,
      dueDate: 1e15,
    });
    const [x] = await c.query(api.todos.list, {});
    expect(x.priority).toBe(-5);
    expect(x.dueDate).toBe(1e15);
  });

  it("NaN/Infinity numeric inputs are now REJECTED by the finite-number guard", async () => {
    // Phase 9 FIX B: todos.add (and events/wealth) now guard against non-finite
    // numbers via assertFinite(). This closes the prod-divergence gap documented
    // in phase7 FINDING-1 — the real Convex deployment rejects non-finite f64 at
    // serialization time, so we reject them at the app layer with a clear error
    // instead of letting them through (convex-test had previously stored them).
    const c = t();
    await expect(
      c.mutation(api.todos.add, { text: "nan-due", dueDate: NaN }),
    ).rejects.toThrow(/finite/i);
    await expect(
      c.mutation(api.todos.add, { text: "inf-prio", priority: Infinity }),
    ).rejects.toThrow(/finite/i);
    // Nothing was inserted — the guard threw before db.insert.
    const list = await c.query(api.todos.list, {});
    expect(list.find((x) => x.text === "nan-due")).toBeUndefined();
    expect(list.find((x) => x.text === "inf-prio")).toBeUndefined();
  });

  it("missing optional fields: bare note has no dueDate/end on its row shape", async () => {
    const c = t();
    await c.mutation(api.events.create, { title: "minimal", start: 100 });
    const [e] = await c.query(api.events.list, {});
    expect(e.end).toBeUndefined();
    expect(e.location).toBeUndefined();
  });

  it("two concurrent reorders resolve to a consistent dense ordering", async () => {
    const c = t();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await c.mutation(api.todos.add, { text: `c${i}` }));
    // Fire two reorders without awaiting between them.
    const r1 = c.mutation(api.todos.reorder, { ids: [...ids].reverse() as never });
    const r2 = c.mutation(api.todos.reorder, { ids: ids as never });
    await Promise.all([r1, r2]);
    const after = await c.query(api.todos.list, {});
    // Whatever wins, positions must remain a dense 0..4 with no dupes.
    const positions = after.map((x) => x.position).sort((a, b) => a - b);
    expect(positions).toEqual([0, 1, 2, 3, 4]);
    expect(after).toHaveLength(5);
  });
});
