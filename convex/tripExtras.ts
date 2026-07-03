import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";

/** Reject non-finite numeric inputs (NaN/Infinity) before they reach the DB.
 *  Mirrors the guard in convex/trips.ts / todos.ts so callers get a clear
 *  error instead of a serialization 500. */
function assertFinite(name: string, value: number | undefined): void {
  if (value !== undefined && !Number.isFinite(value)) {
    throw new Error(`Invalid ${name}: must be a finite number`);
  }
}

/** Strip undefined values so ctx.db.patch only touches provided fields. */
function definedOnly<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(obj)) {
    if (val !== undefined) out[k] = val;
  }
  return out;
}

// ===========================================================================
// Trip todos (per-trip checklist) — ordered by `position`
// ===========================================================================

/** All todos for a trip, sorted by position (ascending). Reactive. */
export const listTodos = query({
  args: { tripId: v.id("trips") },
  handler: async (ctx, { tripId }): Promise<Doc<"tripTodos">[]> => {
    return (
      await ctx.db
        .query("tripTodos")
        .withIndex("by_trip", (q) => q.eq("tripId", tripId))
        .collect()
    ).sort((a, b) => a.position - b.position);
  },
});

/** Append a todo. position auto-assigned as max+1 within the trip. */
export const addTodo = mutation({
  args: { tripId: v.id("trips"), text: v.string() },
  handler: async (ctx, { tripId, text }): Promise<Id<"tripTodos">> => {
    const existing = await ctx.db
      .query("tripTodos")
      .withIndex("by_trip", (q) => q.eq("tripId", tripId))
      .collect();
    const maxPos = existing.reduce((m, t) => Math.max(m, t.position), -1);
    return await ctx.db.insert("tripTodos", {
      tripId,
      text,
      done: false,
      position: maxPos + 1,
      createdAt: Date.now(),
    });
  },
});

/** Flip a todo's done flag. */
export const toggleTodo = mutation({
  args: { todoId: v.id("tripTodos") },
  handler: async (ctx, { todoId }): Promise<Id<"tripTodos">> => {
    const todo = await ctx.db.get(todoId);
    if (todo) await ctx.db.patch(todoId, { done: !todo.done });
    return todoId;
  },
});

/** Delete a single todo. */
export const removeTodo = mutation({
  args: { todoId: v.id("tripTodos") },
  handler: async (ctx, { todoId }): Promise<void> => {
    await ctx.db.delete(todoId);
  },
});

/** Rewrite position 0..n from an explicit ordered id list. Ids not belonging to
 *  the trip are ignored. */
export const reorderTodos = mutation({
  args: { tripId: v.id("trips"), orderedIds: v.array(v.id("tripTodos")) },
  handler: async (ctx, { tripId, orderedIds }): Promise<void> => {
    let position = 0;
    for (const id of orderedIds) {
      const todo = await ctx.db.get(id);
      if (todo && todo.tripId === tripId) {
        await ctx.db.patch(id, { position });
        position += 1;
      }
    }
  },
});

// ===========================================================================
// Trip legs (multi-destination stops) — ordered by `order`
// ===========================================================================

const legPatchValidator = v.object({
  order: v.optional(v.number()),
  city: v.optional(v.string()),
  lat: v.optional(v.number()),
  lng: v.optional(v.number()),
  countryCode: v.optional(v.string()),
  arriveDate: v.optional(v.string()),
  departDate: v.optional(v.string()),
  transportMode: v.optional(v.string()),
  routeDurationText: v.optional(v.string()),
  routeDistanceText: v.optional(v.string()),
  routePolyline: v.optional(v.string()),
});

/** All legs for a trip, sorted by order (ascending). Reactive. */
export const listLegs = query({
  args: { tripId: v.id("trips") },
  handler: async (ctx, { tripId }): Promise<Doc<"tripLegs">[]> => {
    return (
      await ctx.db
        .query("tripLegs")
        .withIndex("by_trip", (q) => q.eq("tripId", tripId))
        .collect()
    ).sort((a, b) => a.order - b.order);
  },
});

/** Append a leg. order auto-assigned as max+1 within the trip. */
export const addLeg = mutation({
  args: {
    tripId: v.id("trips"),
    city: v.string(),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    countryCode: v.optional(v.string()),
    arriveDate: v.optional(v.string()),
    departDate: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"tripLegs">> => {
    assertFinite("lat", args.lat);
    assertFinite("lng", args.lng);
    const existing = await ctx.db
      .query("tripLegs")
      .withIndex("by_trip", (q) => q.eq("tripId", args.tripId))
      .collect();
    const maxOrder = existing.reduce((m, l) => Math.max(m, l.order), -1);
    return await ctx.db.insert("tripLegs", { ...args, order: maxOrder + 1 });
  },
});

/** Patch a leg's fields (only provided keys are written). */
export const updateLeg = mutation({
  args: { legId: v.id("tripLegs"), patch: legPatchValidator },
  handler: async (ctx, { legId, patch }): Promise<Id<"tripLegs">> => {
    assertFinite("order", patch.order);
    assertFinite("lat", patch.lat);
    assertFinite("lng", patch.lng);
    await ctx.db.patch(legId, definedOnly(patch));
    return legId;
  },
});

/** Delete a single leg. */
export const removeLeg = mutation({
  args: { legId: v.id("tripLegs") },
  handler: async (ctx, { legId }): Promise<void> => {
    await ctx.db.delete(legId);
  },
});

/** Rewrite order 0..n from an explicit ordered id list. Ids not belonging to
 *  the trip are ignored. */
export const reorderLegs = mutation({
  args: { tripId: v.id("trips"), orderedIds: v.array(v.id("tripLegs")) },
  handler: async (ctx, { tripId, orderedIds }): Promise<void> => {
    let order = 0;
    for (const id of orderedIds) {
      const leg = await ctx.db.get(id);
      if (leg && leg.tripId === tripId) {
        await ctx.db.patch(id, { order });
        order += 1;
      }
    }
  },
});

// ===========================================================================
// Trip flights (connecting journeys) — ordered by `order`
// ===========================================================================

const flightSegmentValidator = v.object({
  from: v.string(),
  to: v.string(),
  depart: v.optional(v.string()),
  arrive: v.optional(v.string()),
  carrier: v.optional(v.string()),
  flightNo: v.optional(v.string()),
});

/** All flights for a trip, sorted by order (ascending). Reactive. */
export const listFlights = query({
  args: { tripId: v.id("trips") },
  handler: async (ctx, { tripId }): Promise<Doc<"tripFlights">[]> => {
    return (
      await ctx.db
        .query("tripFlights")
        .withIndex("by_trip", (q) => q.eq("tripId", tripId))
        .collect()
    ).sort((a, b) => a.order - b.order);
  },
});

/** Append a flight (one journey, possibly multi-segment). order auto-assigned
 *  as max+1 within the trip. */
export const addFlight = mutation({
  args: {
    tripId: v.id("trips"),
    segments: v.array(flightSegmentValidator),
    priceGbp: v.optional(v.number()),
    bookLink: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { tripId, segments, priceGbp, bookLink },
  ): Promise<Id<"tripFlights">> => {
    assertFinite("priceGbp", priceGbp);
    const existing = await ctx.db
      .query("tripFlights")
      .withIndex("by_trip", (q) => q.eq("tripId", tripId))
      .collect();
    const maxOrder = existing.reduce((m, f) => Math.max(m, f.order), -1);
    return await ctx.db.insert("tripFlights", {
      tripId,
      order: maxOrder + 1,
      segments,
      ...(priceGbp !== undefined ? { priceGbp } : {}),
      ...(bookLink !== undefined ? { bookLink } : {}),
    });
  },
});

/** Patch a flight: optional new order and/or a full segments replacement. */
export const updateFlight = mutation({
  args: {
    flightId: v.id("tripFlights"),
    order: v.optional(v.number()),
    segments: v.optional(v.array(flightSegmentValidator)),
  },
  handler: async (ctx, { flightId, order, segments }): Promise<Id<"tripFlights">> => {
    assertFinite("order", order);
    await ctx.db.patch(flightId, definedOnly({ order, segments }));
    return flightId;
  },
});

/** Delete a single flight. */
export const removeFlight = mutation({
  args: { flightId: v.id("tripFlights") },
  handler: async (ctx, { flightId }): Promise<void> => {
    await ctx.db.delete(flightId);
  },
});

// ===========================================================================
// Trip stays (saved deal options) — newest first
// ===========================================================================

/** All stays for a trip, newest first (by createdAt). Reactive. */
/** Lock/unlock a stay as THE booking for its period (2026-07-03). The
 *  trips-overview timeline treats locked stays as committed blocks. */
export const setStayLocked = mutation({
  args: {
    stayId: v.id("tripStays"),
    locked: v.boolean(),
    checkIn: v.optional(v.string()),
    checkOut: v.optional(v.string()),
  },
  handler: async (ctx, { stayId, locked, checkIn, checkOut }) => {
    const patch: Record<string, unknown> = { locked, saved: true };
    if (checkIn !== undefined) patch.checkIn = checkIn;
    if (checkOut !== undefined) patch.checkOut = checkOut;
    await ctx.db.patch(stayId, patch);
    return stayId;
  },
});

export const listStays = query({
  args: { tripId: v.id("trips") },
  handler: async (ctx, { tripId }): Promise<Doc<"tripStays">[]> => {
    return (
      await ctx.db
        .query("tripStays")
        .withIndex("by_trip", (q) => q.eq("tripId", tripId))
        .collect()
    ).sort((a, b) => b.createdAt - a.createdAt);
  },
});

/** Insert a stay option (a search result or a manually-saved card). */
export const saveStay = mutation({
  args: {
    tripId: v.id("trips"),
    name: v.string(),
    provider: v.optional(v.string()),
    priceGbp: v.optional(v.number()),
    image: v.optional(v.string()),
    link: v.optional(v.string()),
    freeCancellation: v.optional(v.boolean()),
    payLater: v.optional(v.boolean()),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    checkIn: v.optional(v.string()),
    checkOut: v.optional(v.string()),
    saved: v.optional(v.boolean()),
    locked: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<Id<"tripStays">> => {
    assertFinite("priceGbp", args.priceGbp);
    assertFinite("lat", args.lat);
    assertFinite("lng", args.lng);
    return await ctx.db.insert("tripStays", { ...args, createdAt: Date.now() });
  },
});

/** Delete a single stay. */
export const removeStay = mutation({
  args: { stayId: v.id("tripStays") },
  handler: async (ctx, { stayId }): Promise<void> => {
    await ctx.db.delete(stayId);
  },
});

/** Toggle/set a stay's `saved` (shortlist) flag. */
export const setStaySaved = mutation({
  args: { stayId: v.id("tripStays"), saved: v.boolean() },
  handler: async (ctx, { stayId, saved }): Promise<Id<"tripStays">> => {
    await ctx.db.patch(stayId, { saved });
    return stayId;
  },
});
