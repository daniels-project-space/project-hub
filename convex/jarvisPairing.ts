import { ConvexError, v } from "convex/values";
import { internalMutation } from "./_generated/server";

const MIN_REQUEST_GAP_MS = 30_000;
const DAILY_LIMIT = 5;

export const claimRequest = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const recent = await ctx.db
      .query("jarvisPairingRequests")
      .withIndex("by_created")
      .order("desc")
      .take(DAILY_LIMIT + 1);
    if (recent[0] && now - recent[0].createdAt < MIN_REQUEST_GAP_MS) {
      throw new ConvexError("A Jarvis trust link was just requested. Check Telegram.");
    }
    if (recent.filter((row) => now - row.createdAt < 24 * 60 * 60 * 1000).length >= DAILY_LIMIT) {
      throw new ConvexError("Daily Jarvis trust-link limit reached.");
    }
    return await ctx.db.insert("jarvisPairingRequests", { status: "requested", createdAt: now });
  },
});

export const finishRequest = internalMutation({
  args: {
    id: v.id("jarvisPairingRequests"),
    status: v.union(v.literal("delivered"), v.literal("failed")),
    errorCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: args.status,
      completedAt: Date.now(),
      errorCode: args.errorCode?.slice(0, 80),
    });
  },
});
