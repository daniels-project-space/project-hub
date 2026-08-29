import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireJarvisActionsRead, requireJarvisActionsWrite } from "./vaultAuth";
import { readWealth } from "./wealth";

const MAX_TODOS = 50;
const MAX_WIDGETS = 32;
const MAX_TODO_TEXT_LENGTH = 500;
const MAX_TAGS = 8;
const MAX_TAG_LENGTH = 40;

function normalizeTodoText(value: string): string {
  const text = value.trim();
  if (!text || text.length > MAX_TODO_TEXT_LENGTH) {
    throw new Error(`Todo text must be between 1 and ${MAX_TODO_TEXT_LENGTH} characters`);
  }
  return text;
}

function assertTodoPriority(value: number | undefined): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < 0 || value > 3) {
    throw new Error("Todo priority must be an integer between 0 and 3");
  }
}

function assertTodoDueDate(value: number | undefined): void {
  if (value === undefined) return;
  if (!Number.isFinite(value) || value < 0 || value > 4_102_444_800_000) {
    throw new Error("Todo due date must be a valid timestamp before 2100");
  }
}

function normalizeTodoTags(tags: string[] | undefined): string[] {
  if (!tags) return [];
  if (tags.length > MAX_TAGS) throw new Error(`A todo may have at most ${MAX_TAGS} tags`);

  const normalized = tags.map((tag) => tag.trim().toLowerCase());
  if (normalized.some((tag) => !tag || tag.length > MAX_TAG_LENGTH || !/^[a-z0-9][a-z0-9 -]*$/i.test(tag))) {
    throw new Error("Todo tags must be short letters, numbers, spaces, or hyphens");
  }
  return [...new Set(normalized)];
}

/**
 * Small, active-only to-do inventory for Jarvis. This intentionally does not
 * expose owner identifiers, arbitrary widget config, completed history, or a
 * general table query.
 */
export const listTodos = query({
  args: { vaultToken: v.optional(v.string()) },
  handler: async (ctx, { vaultToken }) => {
    await requireJarvisActionsRead(ctx, { vaultToken });
    const todos = await ctx.db
      .query("todos")
      .withIndex("by_done_position", (q) => q.eq("done", false))
      .order("asc")
      .take(MAX_TODOS);
    return todos.map(({ _id, text, done, priority, dueDate, tags, projectSlug, position, createdAt }) => ({
      id: _id,
      text,
      done,
      priority,
      dueDate,
      tags,
      projectSlug,
      position,
      createdAt,
    }));
  },
});

/**
 * Read only the safe widget layout inventory. `config` stays in Project Hub so
 * an arbitrary widget payload can never become cross-app context by accident.
 */
export const listWidgets = query({
  args: { vaultToken: v.optional(v.string()) },
  handler: async (ctx, { vaultToken }) => {
    await requireJarvisActionsRead(ctx, { vaultToken });
    const widgets = await ctx.db
      .query("widgets")
      .withIndex("by_position")
      .order("asc")
      .take(MAX_WIDGETS);
    return widgets.map(({ _id, type, position, enabled, w, h }) => ({
      id: _id,
      type,
      position,
      enabled,
      w,
      h,
    }));
  },
});

/**
 * Read the same current wealth calculation used by Project Hub while exposing
 * only aggregate totals. Asset rows, exchange references, quantities, wallet
 * identifiers, and provider metadata remain inside Project Hub.
 */
export const getWealth = query({
  args: { vaultToken: v.optional(v.string()) },
  handler: async (ctx, { vaultToken }) => {
    await requireJarvisActionsRead(ctx, { vaultToken });
    const wealth = await readWealth(ctx);
    const source = wealth.live?.byCategory ?? wealth.byCategory;
    const categories = Object.entries(source)
      .slice(0, 24)
      .map(([category, bucket]) => ({
        category: String(category).slice(0, 40),
        totalGBP: Number((bucket as { total?: number }).total ?? 0),
      }))
      .filter((category) => Number.isFinite(category.totalGBP));
    return {
      totalGBP: wealth.currentTotalGBP,
      asOf: wealth.currentTotalTs,
      oldestPricedAt: wealth.oldestPricedAt,
      assetCount: wealth.assetCount,
      usdPerGbp: wealth.live?.usdPerGbp ?? wealth.usdPerGbp,
      categories,
      cashflow: {
        confirmedRentalGbp: wealth.confirmedRentalGbp,
        expensesAccruedGbp: wealth.expensesAccruedGbp,
        netCashflowGbp: wealth.netCashflowGbp,
      },
    };
  },
});

/**
 * Add one user-visible to-do. Jarvis cannot choose an owner, project, sort
 * order, source, or other broader Hub field through this façade.
 */
export const createTodo = mutation({
  args: {
    vaultToken: v.optional(v.string()),
    text: v.string(),
    priority: v.optional(v.number()),
    dueDate: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { vaultToken, text, priority, dueDate, tags }) => {
    await requireJarvisActionsWrite(ctx, { vaultToken });
    const normalizedText = normalizeTodoText(text);
    assertTodoPriority(priority);
    assertTodoDueDate(dueDate);
    const normalizedTags = normalizeTodoTags(tags);
    const existing = await ctx.db.query("todos").collect();
    const position = existing.reduce((max, todo) => Math.max(max, todo.position), -1) + 1;
    const id = await ctx.db.insert("todos", {
      text: normalizedText,
      done: false,
      priority: priority ?? 0,
      dueDate,
      tags: normalizedTags,
      position,
      createdAt: Date.now(),
    });
    return { id };
  },
});

/**
 * Deliberately narrow update: Jarvis can revise the visible wording, priority,
 * due time, or completion state of an existing to-do, but cannot delete,
 * reorder, reassign, or move it between projects.
 */
export const updateTodo = mutation({
  args: {
    vaultToken: v.optional(v.string()),
    id: v.id("todos"),
    text: v.optional(v.string()),
    priority: v.optional(v.number()),
    dueDate: v.optional(v.number()),
    done: v.optional(v.boolean()),
  },
  handler: async (ctx, { vaultToken, id, text, priority, dueDate, done }) => {
    await requireJarvisActionsWrite(ctx, { vaultToken });
    if (text === undefined && priority === undefined && dueDate === undefined && done === undefined) {
      throw new Error("At least one todo field must be provided");
    }
    if (!(await ctx.db.get(id))) throw new Error("Todo not found");
    const patch: Record<string, unknown> = {};
    if (text !== undefined) patch.text = normalizeTodoText(text);
    if (priority !== undefined) {
      assertTodoPriority(priority);
      patch.priority = priority;
    }
    if (dueDate !== undefined) {
      assertTodoDueDate(dueDate);
      patch.dueDate = dueDate;
    }
    if (done !== undefined) patch.done = done;
    await ctx.db.patch(id, patch);
    return { id };
  },
});
