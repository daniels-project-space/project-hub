import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Widgets the dashboard renders. Each row = one widget instance.
  widgets: defineTable({
    type: v.string(), // "iframe" | "project-tile" | etc.
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
});
