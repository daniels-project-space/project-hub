import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("widgets")
      .withIndex("by_position")
      .order("asc")
      .collect();
  },
});

export const upsert = mutation({
  args: {
    id: v.optional(v.id("widgets")),
    type: v.string(),
    position: v.number(),
    enabled: v.boolean(),
    config: v.any(),
  },
  handler: async (ctx, { id, ...rest }) => {
    if (id) {
      await ctx.db.patch(id, rest);
      return id;
    }
    return await ctx.db.insert("widgets", rest);
  },
});

export const remove = mutation({
  args: { id: v.id("widgets") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

// Drag-reorder: ids in their new visual order → positions 0..n-1.
export const reorder = mutation({
  args: { ids: v.array(v.id("widgets")) },
  handler: async (ctx, { ids }) => {
    for (let i = 0; i < ids.length; i++) {
      await ctx.db.patch(ids[i], { position: i });
    }
  },
});

// Eye-toggle: show/hide a single widget.
export const setEnabled = mutation({
  args: { id: v.id("widgets"), enabled: v.boolean() },
  handler: async (ctx, { id, enabled }) => {
    await ctx.db.patch(id, { enabled });
    return id;
  },
});

// ---------------------------------------------------------------------------
// SIZE — per-widget grid sizing (Phase 1). `w` = column span (1–4), `h` =
// height step (1–2). Derived from the previous hardcoded SPAN map in
// dashboard-grid.tsx. Exported so the grid can fall back to these when a row
// has no persisted w/h (no migration needed — optional schema fields).
// ---------------------------------------------------------------------------
export const DEFAULT_SIZE: Record<string, { w: number; h: number }> = {
  wealth: { w: 3, h: 2 },
  projects: { w: 4, h: 1 },
  notes: { w: 2, h: 1 },
  calendar: { w: 2, h: 1 },
  todo: { w: 2, h: 1 },
  expenses: { w: 2, h: 1 },
  hunts: { w: 2, h: 1 },
  idea: { w: 2, h: 1 },
  channelIdea: { w: 2, h: 1 },
  remoteWorkHub: { w: 2, h: 1 },
  travel: { w: 4, h: 2 },
};

// Fallback size for an unmapped type (matches the grid's md:col-span-2 default).
export const FALLBACK_SIZE = { w: 2, h: 1 } as const;

// Resize a single widget. Clamps w∈[1,4], h∈[1,2] and patches the row.
export const setSize = mutation({
  args: { id: v.id("widgets"), w: v.number(), h: v.number() },
  handler: async (ctx, { id, w, h }) => {
    const cw = Math.max(1, Math.min(4, Math.round(w)));
    const ch = Math.max(1, Math.min(2, Math.round(h)));
    await ctx.db.patch(id, { w: cw, h: ch });
    return id;
  },
});

// Idempotent seed of the five Pass-1 widgets. No-op if the table is non-empty.
const DEFAULT_WIDGETS: { type: string; position: number }[] = [
  { type: "notes", position: 0 },
  { type: "calendar", position: 1 },
  { type: "todo", position: 2 },
  { type: "wealth", position: 3 },
  { type: "projects", position: 4 },
];

export const seed = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("widgets").collect();
    if (existing.length > 0) {
      return { seeded: 0, reason: "table not empty", existing: existing.length };
    }
    let seeded = 0;
    for (const w of DEFAULT_WIDGETS) {
      const size = DEFAULT_SIZE[w.type] ?? FALLBACK_SIZE;
      await ctx.db.insert("widgets", {
        type: w.type,
        position: w.position,
        enabled: true,
        config: {},
        w: size.w,
        h: size.h,
      });
      seeded += 1;
    }
    return { seeded };
  },
});

// Canonical full widget set, kept in sync with the client REGISTRY
// (`src/components/widget-renderer.tsx` WIDGET_TYPES). Convex functions cannot
// import client/React modules, so this list is the server-side mirror. If you
// add a widget to the REGISTRY, add its type string here too — the reconcile
// path then backfills it into every saved layout automatically.
export const ALL_WIDGET_TYPES: string[] = [
  "notes",
  "calendar",
  "todo",
  "wealth",
  "projects",
  "expenses",
  "hunts",
  "idea",
  "channelIdea",
  "remoteWorkHub",
  "travel",
];

// ---------------------------------------------------------------------------
// RECONCILE — the structural fix for "newly-registered widget silently missing".
//
// The dashboard renders ONLY rows in the `widgets` table (the saved layout).
// A widget registered in the client REGISTRY but absent from the saved layout
// would never render. `reconcile` appends any registry type missing from the
// saved layout as a VISIBLE row (enabled:true), at the end. Fully idempotent:
// re-running inserts nothing once every type is present.
//
// Called automatically by the dashboard on load (client passes the live
// REGISTRY types) AND runnable from the CLI as a backfill:
//   npx convex run widgets:reconcile
// ---------------------------------------------------------------------------
export const reconcile = mutation({
  // Optional `types` so the client can pass its live REGISTRY. When omitted
  // (e.g. a CLI backfill), falls back to the server-side ALL_WIDGET_TYPES.
  args: { types: v.optional(v.array(v.string())) },
  handler: async (ctx, { types }) => {
    const wanted = types && types.length > 0 ? types : ALL_WIDGET_TYPES;
    const existing = await ctx.db.query("widgets").collect();
    const present = new Set(existing.map((w) => w.type));
    let nextPos = existing.reduce((m, w) => Math.max(m, w.position), -1) + 1;
    const appended: string[] = [];
    for (const type of wanted) {
      if (present.has(type)) continue;
      const size = DEFAULT_SIZE[type] ?? FALLBACK_SIZE;
      await ctx.db.insert("widgets", {
        type,
        position: nextPos,
        enabled: true, // newly-surfaced widgets are VISIBLE, never hidden
        config: {},
        w: size.w,
        h: size.h,
      });
      present.add(type);
      nextPos += 1;
      appended.push(type);
    }
    return {
      appended,
      alreadyPresent: wanted.filter((t) => !appended.includes(t)),
      total: existing.length + appended.length,
    };
  },
});

// Back-compat alias. Phase 13 used `seedMissing`; reconcile supersedes it with
// a registry-driven, idempotent backfill. Kept so existing tooling/runbooks
// keep working.
export const seedMissing = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("widgets").collect();
    const present = new Set(existing.map((w) => w.type));
    let nextPos = existing.reduce((m, w) => Math.max(m, w.position), -1) + 1;
    const inserted: string[] = [];
    const skipped: string[] = [];
    for (const type of ALL_WIDGET_TYPES) {
      if (present.has(type)) {
        skipped.push(type);
        continue;
      }
      await ctx.db.insert("widgets", {
        type,
        position: nextPos,
        enabled: true,
        config: {},
      });
      present.add(type);
      nextPos += 1;
      inserted.push(type);
    }
    return { inserted, skipped, total: existing.length + inserted.length };
  },
});
