import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";

/** Reject non-finite numeric inputs (NaN/Infinity) before they reach the DB.
 *  Mirrors the guard in convex/todos.ts / events.ts so callers get a clear
 *  error instead of a serialization 500. */
function assertFinite(name: string, value: number | undefined): void {
  if (value !== undefined && !Number.isFinite(value)) {
    throw new Error(`Invalid ${name}: must be a finite number`);
  }
}

// ---------------------------------------------------------------------------
// Validators (shared shapes — keep handlers small + DRY)
// ---------------------------------------------------------------------------

/** Patchable trip fields (everything except createdAt, which is immutable). */
const tripPatchValidator = v.object({
  title: v.optional(v.string()),
  startDate: v.optional(v.string()),
  endDate: v.optional(v.string()),
  budgetGbp: v.optional(v.number()),
  currency: v.optional(v.string()),
  originCity: v.optional(v.string()),
  destCity: v.optional(v.string()),
  destLat: v.optional(v.number()),
  destLng: v.optional(v.number()),
  destCountryCode: v.optional(v.string()),
  status: v.optional(v.string()),
  active: v.optional(v.boolean()),
  travelers: v.optional(v.number()), // permanent per-trip search preference
  // v3 multi-mode (Stage 0) — so Stage 1 can persist these via trips.update.
  mode: v.optional(v.string()), // "planner" | "deal" | "trip"
  categories: v.optional(v.array(v.string())),
  notes: v.optional(v.string()),
});

/** Patchable item fields (everything except tripId/dayId, which are structural). */
const itemPatchValidator = v.object({
  kind: v.optional(v.string()),
  sortOrder: v.optional(v.number()),
  startTime: v.optional(v.string()),
  endTime: v.optional(v.string()),
  title: v.optional(v.string()),
  description: v.optional(v.string()),
  priceGbp: v.optional(v.number()),
  status: v.optional(v.string()),
  lat: v.optional(v.number()),
  lng: v.optional(v.number()),
  address: v.optional(v.string()),
  link: v.optional(v.string()),
  image: v.optional(v.string()),
  rating: v.optional(v.number()),
  tags: v.optional(v.array(v.string())),
  durationMin: v.optional(v.number()), // v3 (Stage 0) — resizable-timeline duration
});

/** Item shape accepted by the bulk replaceItinerary mutation (no ids — those
 *  are minted on insert; tripId/dayId/sortOrder are assigned by the handler). */
const bulkItemValidator = v.object({
  kind: v.string(),
  title: v.string(),
  startTime: v.optional(v.string()),
  endTime: v.optional(v.string()),
  description: v.optional(v.string()),
  priceGbp: v.optional(v.number()),
  status: v.optional(v.string()),
  lat: v.optional(v.number()),
  lng: v.optional(v.number()),
  address: v.optional(v.string()),
  link: v.optional(v.string()),
  image: v.optional(v.string()),
  rating: v.optional(v.number()),
  tags: v.optional(v.array(v.string())),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip undefined values so ctx.db.patch only touches provided fields. */
function definedOnly<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(obj)) {
    if (val !== undefined) out[k] = val;
  }
  return out;
}

/** Delete every day + item belonging to a trip (cascade). Used by remove and
 *  replaceItinerary. */
async function deleteTripChildren(
  ctx: { db: any },
  tripId: Id<"trips">,
): Promise<void> {
  const items = await ctx.db
    .query("tripItems")
    .withIndex("by_trip", (q: any) => q.eq("tripId", tripId))
    .collect();
  for (const it of items) await ctx.db.delete(it._id);
  const days = await ctx.db
    .query("tripDays")
    .withIndex("by_trip", (q: any) => q.eq("tripId", tripId))
    .collect();
  for (const d of days) await ctx.db.delete(d._id);
}

/** Combine an ISO date (YYYY-MM-DD) + optional HH:MM time into epoch ms (UTC).
 *  Returns undefined when there's no date to anchor on. */
function toEpochMs(date: string | undefined, time: string | undefined): number | undefined {
  if (!date) return undefined;
  const t = time && /^\d{2}:\d{2}$/.test(time) ? time : "00:00";
  const ms = new Date(`${date}T${t}:00Z`).getTime();
  return Number.isFinite(ms) ? ms : undefined;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** All trips, newest first. */
export const list = query({
  args: {},
  handler: async (ctx): Promise<Doc<"trips">[]> => {
    return await ctx.db
      .query("trips")
      .withIndex("by_createdAt")
      .order("desc")
      .collect();
  },
});

/** Full reactive view of one trip: the trip plus its days (sorted by dayIndex)
 *  and items (sorted by dayId then sortOrder). Drives the live widget UI.
 *  Returns null when the trip doesn't exist. */
export const getFull = query({
  args: { tripId: v.id("trips") },
  handler: async (
    ctx,
    { tripId },
  ): Promise<{
    trip: Doc<"trips">;
    days: Doc<"tripDays">[];
    items: Doc<"tripItems">[];
  } | null> => {
    const trip = await ctx.db.get(tripId);
    if (!trip) return null;

    const days = (
      await ctx.db
        .query("tripDays")
        .withIndex("by_trip", (q) => q.eq("tripId", tripId))
        .collect()
    ).sort((a, b) => a.dayIndex - b.dayIndex);

    const dayOrder = new Map<string, number>();
    days.forEach((d, i) => dayOrder.set(d._id, i));

    const items = (
      await ctx.db
        .query("tripItems")
        .withIndex("by_trip", (q) => q.eq("tripId", tripId))
        .collect()
    ).sort((a, b) => {
      const da = dayOrder.get(a.dayId) ?? Number.MAX_SAFE_INTEGER;
      const db = dayOrder.get(b.dayId) ?? Number.MAX_SAFE_INTEGER;
      if (da !== db) return da - db;
      return a.sortOrder - b.sortOrder;
    });

    return { trip, days, items };
  },
});

// ---------------------------------------------------------------------------
// Trip mutations
// ---------------------------------------------------------------------------

/** Create a trip. Returns the new tripId. */
export const create = mutation({
  args: {
    title: v.string(),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    budgetGbp: v.optional(v.number()),
    currency: v.optional(v.string()),
    originCity: v.optional(v.string()),
    destCity: v.optional(v.string()),
    destLat: v.optional(v.number()),
    destLng: v.optional(v.number()),
    destCountryCode: v.optional(v.string()),
    status: v.optional(v.string()),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<Id<"trips">> => {
    assertFinite("budgetGbp", args.budgetGbp);
    assertFinite("destLat", args.destLat);
    assertFinite("destLng", args.destLng);
    return await ctx.db.insert("trips", { ...args, createdAt: Date.now() });
  },
});

/** Patch a trip's fields (only provided keys are written). */
export const update = mutation({
  args: { tripId: v.id("trips"), patch: tripPatchValidator },
  handler: async (ctx, { tripId, patch }): Promise<Id<"trips">> => {
    assertFinite("budgetGbp", patch.budgetGbp);
    assertFinite("destLat", patch.destLat);
    assertFinite("destLng", patch.destLng);
    await ctx.db.patch(tripId, definedOnly(patch));
    return tripId;
  },
});

/** Delete a trip and cascade-delete ALL its per-trip rows: days + items (shared
 *  helper) plus the v3 extras (todos / legs / flights / stays). Each extra table
 *  is read via its `by_trip` index. Kept separate from deleteTripChildren so
 *  replaceItinerary (which only rewrites days/items) never wipes the extras. */
export const remove = mutation({
  args: { tripId: v.id("trips") },
  handler: async (ctx, { tripId }): Promise<void> => {
    await deleteTripChildren(ctx, tripId);
    for (const table of [
      "tripTodos",
      "tripLegs",
      "tripFlights",
      "tripStays",
    ] as const) {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_trip", (q) => q.eq("tripId", tripId))
        .collect();
      for (const row of rows) await ctx.db.delete(row._id);
    }
    await ctx.db.delete(tripId);
  },
});

/** Mark one trip active, clearing active on all others. */
export const setActive = mutation({
  args: { tripId: v.id("trips") },
  handler: async (ctx, { tripId }): Promise<Id<"trips">> => {
    const actives = await ctx.db
      .query("trips")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();
    for (const t of actives) {
      if (t._id !== tripId) await ctx.db.patch(t._id, { active: false });
    }
    await ctx.db.patch(tripId, { active: true });
    return tripId;
  },
});

// ---------------------------------------------------------------------------
// Day mutations
// ---------------------------------------------------------------------------

/** Append a day to a trip. Returns the new dayId. */
export const addDay = mutation({
  args: {
    tripId: v.id("trips"),
    date: v.optional(v.string()),
    dayIndex: v.number(),
    summary: v.optional(v.string()),
    weather: v.optional(v.any()),
  },
  handler: async (ctx, args): Promise<Id<"tripDays">> => {
    assertFinite("dayIndex", args.dayIndex);
    return await ctx.db.insert("tripDays", args);
  },
});

// ---------------------------------------------------------------------------
// Item mutations
// ---------------------------------------------------------------------------

/** Append an item to a day. sortOrder auto-assigned as max+1 within that day. */
export const addItem = mutation({
  args: {
    tripId: v.id("trips"),
    dayId: v.id("tripDays"),
    kind: v.string(),
    title: v.string(),
    startTime: v.optional(v.string()),
    endTime: v.optional(v.string()),
    description: v.optional(v.string()),
    priceGbp: v.optional(v.number()),
    status: v.optional(v.string()),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    address: v.optional(v.string()),
    link: v.optional(v.string()),
    image: v.optional(v.string()),
    rating: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<Id<"tripItems">> => {
    assertFinite("priceGbp", args.priceGbp);
    assertFinite("lat", args.lat);
    assertFinite("lng", args.lng);
    assertFinite("rating", args.rating);
    const siblings = await ctx.db
      .query("tripItems")
      .withIndex("by_day", (q) => q.eq("dayId", args.dayId))
      .collect();
    const maxSort = siblings.reduce((m, it) => Math.max(m, it.sortOrder), -1);
    return await ctx.db.insert("tripItems", { ...args, sortOrder: maxSort + 1 });
  },
});

/** Patch an item's fields (only provided keys are written). */
export const updateItem = mutation({
  args: { itemId: v.id("tripItems"), patch: itemPatchValidator },
  handler: async (ctx, { itemId, patch }): Promise<Id<"tripItems">> => {
    assertFinite("priceGbp", patch.priceGbp);
    assertFinite("lat", patch.lat);
    assertFinite("lng", patch.lng);
    assertFinite("rating", patch.rating);
    assertFinite("sortOrder", patch.sortOrder);
    assertFinite("durationMin", patch.durationMin);
    await ctx.db.patch(itemId, definedOnly(patch));
    return itemId;
  },
});

/** Delete a single item. */
export const removeItem = mutation({
  args: { itemId: v.id("tripItems") },
  handler: async (ctx, { itemId }): Promise<void> => {
    await ctx.db.delete(itemId);
  },
});

/** Rewrite sortOrder 0..n for a day from an explicit ordered id list. Ids not
 *  belonging to the day are ignored. */
export const reorderItems = mutation({
  args: { dayId: v.id("tripDays"), orderedItemIds: v.array(v.id("tripItems")) },
  handler: async (ctx, { dayId, orderedItemIds }): Promise<void> => {
    let order = 0;
    for (const id of orderedItemIds) {
      const item = await ctx.db.get(id);
      if (item && item.dayId === dayId) {
        await ctx.db.patch(id, { sortOrder: order });
        order += 1;
      }
    }
  },
});

/** Set an item's planned→done→skip status. */
export const setItemStatus = mutation({
  args: {
    itemId: v.id("tripItems"),
    status: v.union(v.literal("planned"), v.literal("done"), v.literal("skip")),
  },
  handler: async (ctx, { itemId, status }): Promise<Id<"tripItems">> => {
    await ctx.db.patch(itemId, { status });
    return itemId;
  },
});

// ---------------------------------------------------------------------------
// Save → calendar
// ---------------------------------------------------------------------------

/** Insert a calendar `events` row for every dated/timed item in the trip.
 *  Maps onto the existing events schema:
 *    title    ← item.title
 *    start    ← epoch ms from (day.date + item.startTime), required to emit
 *    end      ← epoch ms from (day.date + item.endTime) when present
 *    allDay   ← true when the item has no startTime
 *    color    ← "brass" (events default)
 *    location ← item.address
 *    notes    ← item.description
 *    source   ← "trip" (additive tag so trip-sourced events are identifiable)
 *  Items without a resolvable date are skipped. Returns the count inserted. */
export const saveToCalendar = mutation({
  args: { tripId: v.id("trips") },
  handler: async (ctx, { tripId }): Promise<{ inserted: number }> => {
    const days = await ctx.db
      .query("tripDays")
      .withIndex("by_trip", (q) => q.eq("tripId", tripId))
      .collect();
    const dateByDay = new Map<string, string | undefined>();
    for (const d of days) dateByDay.set(d._id, d.date);

    const items = await ctx.db
      .query("tripItems")
      .withIndex("by_trip", (q) => q.eq("tripId", tripId))
      .collect();

    let inserted = 0;
    for (const it of items) {
      const date = dateByDay.get(it.dayId);
      const start = toEpochMs(date, it.startTime);
      if (start === undefined) continue; // undated → not a calendar event
      const end = toEpochMs(date, it.endTime);
      await ctx.db.insert("events", {
        title: it.title,
        start,
        end,
        allDay: !it.startTime,
        color: "brass",
        location: it.address,
        notes: it.description,
        source: "trip",
      });
      inserted += 1;
    }
    return { inserted };
  },
});

// ---------------------------------------------------------------------------
// Bulk replace (planner action target)
// ---------------------------------------------------------------------------

/** Atomically replace a trip's whole itinerary: delete existing days + items,
 *  then insert the provided day/item structure. sortOrder is assigned from each
 *  item's array position. The wave-2a planner action calls this with the LLM's
 *  validated output. */
export const replaceItinerary = mutation({
  args: {
    tripId: v.id("trips"),
    days: v.array(
      v.object({
        date: v.optional(v.string()),
        dayIndex: v.number(),
        summary: v.optional(v.string()),
        weather: v.optional(v.any()),
        items: v.array(bulkItemValidator),
      }),
    ),
  },
  handler: async (ctx, { tripId, days }): Promise<{ days: number; items: number }> => {
    await deleteTripChildren(ctx, tripId);

    let itemCount = 0;
    for (const day of days) {
      assertFinite("dayIndex", day.dayIndex);
      const dayId = await ctx.db.insert("tripDays", {
        tripId,
        date: day.date,
        dayIndex: day.dayIndex,
        summary: day.summary,
        weather: day.weather,
      });
      let sortOrder = 0;
      for (const item of day.items) {
        assertFinite("priceGbp", item.priceGbp);
        assertFinite("lat", item.lat);
        assertFinite("lng", item.lng);
        assertFinite("rating", item.rating);
        await ctx.db.insert("tripItems", {
          tripId,
          dayId,
          sortOrder,
          kind: item.kind,
          title: item.title,
          startTime: item.startTime,
          endTime: item.endTime,
          description: item.description,
          priceGbp: item.priceGbp,
          status: item.status,
          lat: item.lat,
          lng: item.lng,
          address: item.address,
          link: item.link,
          image: item.image,
          rating: item.rating,
          tags: item.tags,
        });
        sortOrder += 1;
        itemCount += 1;
      }
    }
    return { days: days.length, items: itemCount };
  },
});
