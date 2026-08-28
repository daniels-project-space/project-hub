import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import {
  requireProjectHubVaultSession,
  requireVaultRead,
  requireVaultWrite,
} from "./vaultAuth";

const PROJECT_HUB_SERVICE = "project-hub";

type TodoCredentials = {
  vaultToken?: string;
  vaultSession?: string;
};

/**
 * Todos are private Project Hub data. The browser never receives a durable
 * capability: the owner-only Next route forwards its HttpOnly vault session.
 * Trusted workers may instead use a scoped vault client. Do not add an
 * unauthenticated compatibility path here; Convex functions are publicly
 * callable even when their only current UI caller is the Hub.
 */
async function requireTodoAccess(
  ctx: Parameters<typeof requireVaultRead>[0],
  { vaultToken, vaultSession }: TodoCredentials,
  write: boolean,
): Promise<void> {
  if (vaultToken !== undefined && vaultSession !== undefined) {
    throw new Error("Provide exactly one todo credential");
  }
  if (vaultSession !== undefined) {
    await requireProjectHubVaultSession(vaultSession);
    return;
  }
  if (write) {
    await requireVaultWrite(ctx, { vaultToken }, [PROJECT_HUB_SERVICE]);
    return;
  }
  await requireVaultRead(ctx, { vaultToken }, PROJECT_HUB_SERVICE);
}

/** Reject non-finite numeric inputs (NaN/Infinity) before they reach the DB.
 *  The real Convex deployment rejects non-finite f64 at serialization time;
 *  this guards the app layer so callers get a clear error instead of a 500. */
function assertFinite(name: string, value: number | undefined): void {
  if (value !== undefined && !Number.isFinite(value)) {
    throw new Error(`Invalid ${name}: must be a finite number`);
  }
}

export const list = query({
  args: {
    vaultToken: v.optional(v.string()),
    vaultSession: v.optional(v.string()),
  },
  handler: async (ctx, credentials) => {
    await requireTodoAccess(ctx, credentials, false);
    return await ctx.db
      .query("todos")
      .withIndex("by_position")
      .order("asc")
      .collect();
  },
});

export const add = mutation({
  args: {
    vaultToken: v.optional(v.string()),
    vaultSession: v.optional(v.string()),
    text: v.string(),
    priority: v.optional(v.number()),
    dueDate: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
    projectSlug: v.optional(v.string()),
    ownerId: v.optional(v.string()),
  },
  handler: async (ctx, { vaultToken, vaultSession, text, priority, dueDate, tags, projectSlug, ownerId }) => {
    await requireTodoAccess(ctx, { vaultToken, vaultSession }, true);
    assertFinite("priority", priority);
    assertFinite("dueDate", dueDate);
    const existing = await ctx.db.query("todos").collect();
    const maxPos = existing.reduce((m, t) => Math.max(m, t.position), -1);
    return await ctx.db.insert("todos", {
      text,
      done: false,
      priority: priority ?? 0,
      dueDate,
      tags: tags ?? [],
      projectSlug,
      position: maxPos + 1,
      createdAt: Date.now(),
      ownerId,
    });
  },
});

// Alias for engine-consistency (create == add).
export const create = add;

export const update = mutation({
  args: {
    vaultToken: v.optional(v.string()),
    vaultSession: v.optional(v.string()),
    id: v.id("todos"),
    text: v.optional(v.string()),
    done: v.optional(v.boolean()),
    priority: v.optional(v.number()),
    dueDate: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
    projectSlug: v.optional(v.string()),
    ownerId: v.optional(v.string()),
  },
  handler: async (ctx, { vaultToken, vaultSession, id, priority, dueDate, ...rest }) => {
    await requireTodoAccess(ctx, { vaultToken, vaultSession }, true);
    assertFinite("priority", priority);
    assertFinite("dueDate", dueDate);
    const patch: Record<string, unknown> = {};
    for (const [k, val] of Object.entries({ priority, dueDate, ...rest })) {
      if (val !== undefined) patch[k] = val;
    }
    await ctx.db.patch(id, patch);
    return id;
  },
});

export const remove = mutation({
  args: {
    vaultToken: v.optional(v.string()),
    vaultSession: v.optional(v.string()),
    id: v.id("todos"),
  },
  handler: async (ctx, { vaultToken, vaultSession, id }) => {
    await requireTodoAccess(ctx, { vaultToken, vaultSession }, true);
    await ctx.db.delete(id);
  },
});

export const reorder = mutation({
  args: {
    vaultToken: v.optional(v.string()),
    vaultSession: v.optional(v.string()),
    ids: v.array(v.id("todos")),
  },
  handler: async (ctx, { vaultToken, vaultSession, ids }) => {
    await requireTodoAccess(ctx, { vaultToken, vaultSession }, true);
    for (let i = 0; i < ids.length; i++) {
      await ctx.db.patch(ids[i], { position: i });
    }
  },
});

// ---------------------------------------------------------------------------
// One-time migration from v1 hub-kv.json:home_todos_v1
// ---------------------------------------------------------------------------
// v1 shape: { id, text, done, category, createdAt, ideaId?, dedupKey?, isNewApp? }
// v2 shape: { text, done, priority, tags, position, createdAt }
// Mapping: text→text, done→done (preserved), category→tags:[category].
// Inserts directly (not via `add`) so `done:true` items survive the import.
// Idempotent: skips any row whose (text + createdAt) already exists, so re-running
// in Phase E is a no-op. Run only from a trusted owner/server context with a
// scoped Project Hub vault capability. It is intentionally not a public
// dashboard mutation.
export const seedFromV1 = mutation({
  args: {
    vaultToken: v.optional(v.string()),
    vaultSession: v.optional(v.string()),
    items: v.array(
      v.object({
        text: v.string(),
        done: v.optional(v.boolean()),
        category: v.optional(v.string()),
        createdAt: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, { vaultToken, vaultSession, items }) => {
    await requireTodoAccess(ctx, { vaultToken, vaultSession }, true);
    const existing = await ctx.db.query("todos").collect();
    const seen = new Set(existing.map((t) => `${t.text}::${t.createdAt}`));
    let maxPos = existing.reduce((m, t) => Math.max(m, t.position), -1);
    let inserted = 0;
    let skipped = 0;
    for (const it of items) {
      const createdAt = it.createdAt ?? Date.now();
      const key = `${it.text}::${createdAt}`;
      if (seen.has(key)) {
        skipped++;
        continue;
      }
      maxPos += 1;
      await ctx.db.insert("todos", {
        text: it.text,
        done: it.done ?? false,
        priority: 0,
        tags: it.category ? [it.category] : [],
        position: maxPos,
        createdAt,
      });
      seen.add(key);
      inserted++;
    }
    return { inserted, skipped, total: items.length };
  },
});
