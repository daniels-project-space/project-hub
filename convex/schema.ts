import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Widgets the dashboard renders. Each row = one widget instance.
  widgets: defineTable({
    type: v.string(), // "notes" | "calendar" | "todo" | "wealth" | "projects" | etc.
    position: v.number(),
    enabled: v.boolean(),
    config: v.any(), // arbitrary widget-specific config
  }).index("by_position", ["position"]),

  // Projects (placeholder list — eventually populated as apps migrate to Vercel).
  projects: defineTable({
    slug: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    vercelUrl: v.optional(v.string()),
    githubUrl: v.optional(v.string()),
    status: v.string(), // "active" | "wip" | "archived"
  }).index("by_slug", ["slug"]),

  // Merged from the old key-vault Supabase project. Server-only access.
  secrets: defineTable({
    service: v.string(),
    keyName: v.string(),
    value: v.string(),
    description: v.optional(v.string()),
    scopes: v.array(v.string()),
    aliases: v.array(v.string()),
    sourceFiles: v.array(v.string()),
  })
    .index("by_service", ["service"])
    .index("by_service_and_key", ["service", "keyName"]),

  // --- Pass 1 widget data tables ---

  // Sticky notes (W3). Color-coded, pinnable, drag-reorderable.
  notes: defineTable({
    text: v.string(),
    color: v.string(),
    pinned: v.boolean(),
    position: v.number(),
    updatedAt: v.number(),
    ownerId: v.optional(v.string()), // unused now; for later auth scoping
  }).index("by_position", ["position"]),

  // Calendar events (W4). Manual entry only.
  events: defineTable({
    title: v.string(),
    start: v.number(),
    end: v.optional(v.number()),
    allDay: v.boolean(),
    color: v.string(),
    location: v.optional(v.string()),
    notes: v.optional(v.string()),
    ownerId: v.optional(v.string()),
  }).index("by_start", ["start"]),

  // To-do items (W2). Priority, due dates, tags, project linkage.
  todos: defineTable({
    text: v.string(),
    done: v.boolean(),
    priority: v.number(),
    dueDate: v.optional(v.number()),
    tags: v.array(v.string()),
    projectSlug: v.optional(v.string()),
    position: v.number(),
    createdAt: v.number(),
    ownerId: v.optional(v.string()),
  }).index("by_position", ["position"]),

  // --- Wealth tables (schema only — convex/wealth.ts owned by a later agent) ---

  // Tracked assets across all categories.
  assets: defineTable({
    category: v.union(
      v.literal("crypto"),
      v.literal("stocks"),
      v.literal("gold"),
      v.literal("cash"),
      v.literal("property"),
      v.literal("inventory"),
    ),
    label: v.string(),
    source: v.union(v.literal("auto"), v.literal("manual")),
    quantity: v.optional(v.number()),
    balanceNative: v.optional(v.number()),
    currency: v.string(),
    externalRef: v.optional(v.string()),
    lastValueGBP: v.optional(v.number()),
    lastPricedAt: v.optional(v.number()),
    ownerId: v.optional(v.string()),
  }).index("by_category", ["category"]),

  // Daily net-worth snapshots — powers the history chart.
  netWorthSnapshots: defineTable({
    ts: v.number(),
    totalGBP: v.number(),
    byCategory: v.any(),
    ownerId: v.optional(v.string()),
  }).index("by_ts", ["ts"]),

  // Shared price / FX cache.
  priceCache: defineTable({
    symbol: v.string(),
    gbp: v.number(),
    ts: v.number(),
  }).index("by_symbol", ["symbol"]),
});
