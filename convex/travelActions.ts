/**
 * Travel — EXTERNAL-API ACTIONS (Wave 2a).
 *
 * Two actions, both server-side only:
 *  - planTrip:     ONE Claude (Anthropic Messages API) call with FORCED tool-use
 *                  for structured JSON output, then persists via the Wave-1
 *                  trips.create + trips.replaceItinerary mutations.
 *  - flightStatus: AeroDataBox (RapidAPI) flight lookup. The API key is currently
 *                  ABSENT from the vault, so this degrades gracefully (returns
 *                  { available:false, reason } rather than throwing) until a key
 *                  is added.
 *
 * SECRET DISCIPLINE
 * -----------------
 * API keys live in the Convex `secrets` table and are read ONLY here, server-side,
 * via the public `api.secrets.getOne` query (returns the row or null; we read
 * `.value`). They never reach the client and are never echoed in return values.
 *
 * This module is intentionally NOT "use node": it needs no node crypto, so it
 * runs in the default Convex runtime and can call queries/mutations directly via
 * ctx.runQuery / ctx.runMutation.
 */

import { v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";

// ─── config ──────────────────────────────────────────────────────────────────

/** Swap to a stronger model (e.g. "claude-opus-4-6") by changing this constant. */
const PLANNER_MODEL = "claude-sonnet-4-6";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const PLANNER_MAX_TOKENS = 6000;
const GBP = "GBP";

/**
 * Interest-category slugs the planner may tag items with (Stage 1). Kept as a
 * self-contained constant here (convex modules don't share the `@/` alias and
 * shouldn't reach into src/) — it mirrors src/lib/travel/categories.ts and the
 * `category` enum in the emit_itinerary tool schema below. The model returns one
 * of these per item; we persist it into the item's `tags` so the timeline can
 * filter by category with no schema change.
 */
const CATEGORY_SLUGS: readonly string[] = [
  "restaurants",
  "cafes",
  "attractions",
  "nature",
  "bars",
  "markets",
  "viewpoints",
];

/** Human-ish labels for prompt injection (slug → label). */
const CATEGORY_LABELS: Record<string, string> = {
  restaurants: "restaurants",
  cafes: "cafés",
  attractions: "attractions & sights",
  nature: "nature & hiking",
  bars: "bars & nightlife",
  markets: "markets",
  viewpoints: "viewpoints & scenic spots",
};

/** (service, keyName) pairs in the Convex `secrets` table. */
const SECRET = {
  anthropic: { service: "anthropic", keyName: "ANTHROPIC_API_KEY" },
  // AeroDataBox key is ABSENT today — try the dedicated service first, then the
  // generic rapidapi slot. Either being present flips flightStatus to live.
  aerodatabox: { service: "aerodatabox", keyName: "AERODATABOX_API_KEY" },
  rapidapi: { service: "rapidapi", keyName: "RAPIDAPI_KEY" },
  // Google Places (images + place details + maps/website links) and Google
  // Directions (transport routing) share one key. Verified live in the vault.
  googlePlaces: { service: "google", keyName: "GOOGLE_PLACES_API_KEY" },
  // SerpApi — Google Hotels (Deal mode) + Google Flights. Verified live.
  serpapi: { service: "serpapi", keyName: "SERPAPI_KEY" },
} as const;

const SERPAPI_URL = "https://serpapi.com/search.json";

// Google Maps Platform endpoints (Places + Directions share the one key).
const GP_FINDPLACE =
  "https://maps.googleapis.com/maps/api/place/findplacefromtext/json";
const GP_DETAILS = "https://maps.googleapis.com/maps/api/place/details/json";
const GP_PHOTO = "https://maps.googleapis.com/maps/api/place/photo";
const GP_DIRECTIONS = "https://maps.googleapis.com/maps/api/directions/json";

/** A "view on Google Maps" search URL — always a valid link for any place. */
function mapsSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Read a secret value (or null) from the vault via the public getOne query. */
async function getSecret(
  ctx: any,
  pair: { service: string; keyName: string },
): Promise<string | null> {
  const row = await ctx.runQuery(api.secrets.getOne, pair);
  const value = row?.value;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Best-effort regex intent parser. Pulls a destination, day-count and budget
 * hint from the raw prompt. The LLM also infers these — this is only a cheap
 * pre-pass to give us sensible defaults and to seed the title when the model
 * omits something.
 */
function parseIntent(prompt: string): {
  destination?: string;
  days?: number;
  budgetGbp?: number;
} {
  const out: { destination?: string; days?: number; budgetGbp?: number } = {};

  // "5 days" / "5-day" / "for 3 nights"
  const dayMatch = prompt.match(/(\d+)\s*[-\s]?(?:days?|nights?|day\b)/i);
  if (dayMatch) {
    const n = parseInt(dayMatch[1], 10);
    if (Number.isFinite(n) && n > 0 && n <= 60) out.days = n;
  }

  // "£1500" / "1500 gbp" / "budget of 2000 pounds"
  const budgetMatch =
    prompt.match(/£\s*([\d,]+(?:\.\d+)?)/) ||
    prompt.match(/([\d,]+(?:\.\d+)?)\s*(?:gbp|pounds?|quid)\b/i) ||
    prompt.match(/budget(?:\s+of)?\s+([\d,]+(?:\.\d+)?)/i);
  if (budgetMatch) {
    const n = parseFloat(budgetMatch[1].replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0) out.budgetGbp = n;
  }

  // "to Rome" / "trip to Lisbon" / "in Tokyo" — grab the proper-noun-ish phrase.
  const destMatch =
    prompt.match(/\b(?:to|visit(?:ing)?|in)\s+([A-Z][a-zA-Z'’.-]+(?:\s+[A-Z][a-zA-Z'’.-]+){0,2})/);
  if (destMatch) out.destination = destMatch[1].trim();

  return out;
}

// ─── Anthropic structured-output tool schema ───────────────────────────────────

/**
 * The single tool the model MUST call. Its input_schema IS the itinerary JSON
 * contract; tool_choice forces the model to emit exactly this shape, so we get
 * valid structured JSON instead of free-form prose we'd have to parse.
 */
const EMIT_ITINERARY_TOOL = {
  name: "emit_itinerary",
  description:
    "Return the complete planned itinerary as structured data. Call this exactly once.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      destCity: { type: "string", description: "Primary destination city." },
      destCountryCode: {
        type: "string",
        description: "ISO 3166-1 alpha-2 country code, e.g. 'IT'.",
      },
      destLat: { type: "number", description: "Destination latitude." },
      destLng: { type: "number", description: "Destination longitude." },
      currency: {
        type: "string",
        description: "Always 'GBP' — all prices are in GBP.",
      },
      days: {
        type: "array",
        description: "One entry per day of the trip, in order.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            date: {
              type: "string",
              description: "ISO date YYYY-MM-DD if known, else omit.",
            },
            dayIndex: {
              type: "integer",
              description: "0-based day number.",
            },
            summary: {
              type: "string",
              description: "One-line theme for the day.",
            },
            items: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  kind: {
                    type: "string",
                    enum: [
                      "place",
                      "food",
                      "stay",
                      "flight",
                      "transport",
                      "activity",
                    ],
                  },
                  title: { type: "string" },
                  description: { type: "string" },
                  startTime: {
                    type: "string",
                    description: "HH:MM 24h local, if applicable.",
                  },
                  endTime: { type: "string", description: "HH:MM 24h local." },
                  priceGbp: {
                    type: "number",
                    description: "Estimated cost in GBP for this item.",
                  },
                  lat: { type: "number" },
                  lng: { type: "number" },
                  address: { type: "string" },
                  image: {
                    type: "string",
                    description:
                      "Direct https URL to a representative photo, if confidently known.",
                  },
                  link: {
                    type: "string",
                    description:
                      "Official website or authoritative info URL (https), if known.",
                  },
                  category: {
                    type: "string",
                    description:
                      "Interest-category slug this item belongs to (one of the provided slugs), if applicable.",
                    enum: [
                      "restaurants",
                      "cafes",
                      "attractions",
                      "nature",
                      "bars",
                      "markets",
                      "viewpoints",
                    ],
                  },
                },
                required: ["kind", "title", "priceGbp"],
              },
            },
          },
          required: ["dayIndex", "items"],
        },
      },
    },
    required: ["destCity", "currency", "days"],
  },
} as const;

const PLANNER_SYSTEM = `You are an expert trip planner. You produce realistic, well-paced day-by-day itineraries and ALWAYS return them by calling the emit_itinerary tool — never as prose.

Hard rules:
- All prices are in GBP. Set currency to "GBP".
- BUDGET IS A HARD CAP: the sum of every item's priceGbp across the whole trip MUST be <= the user's budget. If no budget is given, keep costs sensible and modest.
- Allocate at most ~45% of the total budget to accommodation ("stay") items combined.
- Produce exactly the number of days requested. If the user is vague, infer a sensible length (typically 3-5 days).
- Give realistic local times (startTime/endTime, 24h HH:MM) and a logical geographic flow within each day.
- Include lat/lng and address for well-known places, restaurants and stays where you are confident.
- Use the kind field correctly: place (sights), food (meals), stay (lodging), flight, transport (local transit/transfers), activity (tours/experiences).
- When the user restricts interest categories, include ONLY activities from those categories and set each item's "category" field to the matching category slug. With no restriction, set "category" when an item clearly fits one of the known slugs (restaurants, cafes, attractions, nature, bars, markets, viewpoints).
- Populate "image" (a direct https photo URL) and "link" (official/authoritative https URL) whenever you are confident of them.
- Keep descriptions concise and useful.`;

// ─── planTrip ──────────────────────────────────────────────────────────────────

type ItineraryItem = {
  kind: string;
  title: string;
  description?: string;
  startTime?: string;
  endTime?: string;
  priceGbp?: number;
  lat?: number;
  lng?: number;
  address?: string;
  image?: string;
  link?: string;
  category?: string;
};
type ItineraryDay = {
  date?: string;
  dayIndex: number;
  summary?: string;
  items: ItineraryItem[];
};
type Itinerary = {
  destCity: string;
  destCountryCode?: string;
  destLat?: number;
  destLng?: number;
  currency: string;
  days: ItineraryDay[];
};

/** Drop NaN/Infinity (the trips mutations reject non-finite numbers). */
function finiteOrUndef(n: unknown): number | undefined {
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

/**
 * Inclusive day count for a start/end ISO date range (Stage 1). Mirrors the
 * project's inclusive-date convention. Returns undefined for missing/invalid
 * dates or an inverted range, capped at 60 to match parseIntent's guard.
 */
function dayCountFromRange(
  start: string | undefined,
  end: string | undefined,
): number | undefined {
  if (!start || !end) return undefined;
  const s = new Date(`${start}T00:00:00Z`).getTime();
  const e = new Date(`${end}T00:00:00Z`).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return undefined;
  const days = Math.round((e - s) / 86400000) + 1;
  return days > 0 && days <= 60 ? days : undefined;
}

/** One Anthropic Messages call with forced tool-use; returns the parsed input. */
async function callPlanner(
  apiKey: string,
  userPrompt: string,
): Promise<Itinerary> {
  const body = {
    model: PLANNER_MODEL,
    max_tokens: PLANNER_MAX_TOKENS,
    // Prompt caching: the system prompt + tool schema are stable across calls,
    // so we mark the system block ephemeral to cut input cost on repeat plans.
    system: [
      {
        type: "text",
        text: PLANNER_SYSTEM,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [EMIT_ITINERARY_TOOL],
    // Force the model to call emit_itinerary -> guaranteed structured JSON.
    tool_choice: { type: "tool", name: "emit_itinerary" },
    messages: [{ role: "user", content: userPrompt }],
  };

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Anthropic planner request failed: ${res.status} ${res.statusText} ${detail.slice(0, 300)}`,
    );
  }

  const json: any = await res.json();
  const toolUse = Array.isArray(json?.content)
    ? json.content.find(
        (b: any) => b?.type === "tool_use" && b?.name === "emit_itinerary",
      )
    : undefined;
  const input = toolUse?.input;
  if (!input || typeof input !== "object" || !Array.isArray(input.days)) {
    throw new Error("Anthropic planner returned no valid emit_itinerary payload");
  }
  return input as Itinerary;
}

/**
 * Map the model's itinerary into the exact shape trips.replaceItinerary expects,
 * sanitising numbers and stamping currency=GBP on every item.
 */
function toReplaceDays(it: Itinerary) {
  return it.days
    .slice()
    .sort((a, b) => a.dayIndex - b.dayIndex)
    .map((day, i) => ({
      date: typeof day.date === "string" ? day.date : undefined,
      dayIndex: finiteOrUndef(day.dayIndex) ?? i,
      summary: typeof day.summary === "string" ? day.summary : undefined,
      items: (Array.isArray(day.items) ? day.items : []).map((item) => {
        // Persist the model's category slug into `tags` (prepended), so the
        // timeline can filter by category with no schema change. Only accept a
        // known slug; unknown/absent → no category tag (item always shows).
        const category =
          typeof item.category === "string" && CATEGORY_SLUGS.includes(item.category)
            ? item.category
            : undefined;
        const tags = category ? [category] : undefined;
        return {
          kind: typeof item.kind === "string" ? item.kind : "activity",
          title: typeof item.title === "string" ? item.title : "Untitled",
          description:
            typeof item.description === "string" ? item.description : undefined,
          startTime: typeof item.startTime === "string" ? item.startTime : undefined,
          endTime: typeof item.endTime === "string" ? item.endTime : undefined,
          priceGbp: finiteOrUndef(item.priceGbp),
          lat: finiteOrUndef(item.lat),
          lng: finiteOrUndef(item.lng),
          address: typeof item.address === "string" ? item.address : undefined,
          image: typeof item.image === "string" ? item.image : undefined,
          link: typeof item.link === "string" ? item.link : undefined,
          tags,
        };
      }),
    }));
}

export const planTrip = action({
  args: {
    prompt: v.string(),
    budgetGbp: v.optional(v.number()),
    originCity: v.optional(v.string()),
    tripId: v.optional(v.id("trips")),
    // Stage 1 — interest categories constrain generation (empty/absent → all).
    categories: v.optional(v.array(v.string())),
    // Stage 1 — explicit timeframe drives itinerary length + actual dates.
    startDate: v.optional(v.string()), // ISO YYYY-MM-DD
    endDate: v.optional(v.string()), // ISO YYYY-MM-DD
  },
  handler: async (ctx, args): Promise<{ tripId: Id<"trips"> }> => {
    const apiKey = await getSecret(ctx, SECRET.anthropic);
    if (!apiKey) {
      throw new Error(
        "Cannot plan trip: ANTHROPIC_API_KEY is not configured in the secrets vault.",
      );
    }

    // Cheap regex pre-pass; the LLM also infers these from the prompt.
    const intent = parseIntent(args.prompt);
    const budgetGbp = args.budgetGbp ?? intent.budgetGbp;

    // Timeframe (Stage 1): an explicit start/end range overrides the regex
    // day-count and pins the actual calendar dates the planner must use.
    const rangeDays = dayCountFromRange(args.startDate, args.endDate);
    const dayCount = rangeDays ?? intent.days;

    // Interest categories (Stage 1): only keep known slugs; empty → no
    // constraint (backward compatible).
    const enabledCategories = (args.categories ?? []).filter((c) =>
      CATEGORY_SLUGS.includes(c),
    );
    const categoryLine =
      enabledCategories.length > 0
        ? `Only include activities from these interest categories: ${enabledCategories
            .map((c) => CATEGORY_LABELS[c] ?? c)
            .join(", ")}. Tag EACH item with its category by setting the item's "category" field to one of: ${enabledCategories.join(", ")}.`
        : "";

    const userPrompt = [
      args.prompt,
      args.originCity ? `Origin city: ${args.originCity}.` : "",
      budgetGbp ? `Total budget (HARD cap): £${budgetGbp} GBP.` : "",
      args.startDate && args.endDate
        ? `Travel dates: ${args.startDate} to ${args.endDate} (inclusive). Produce exactly ${dayCount} day(s) and set each day's date accordingly.`
        : dayCount
          ? `Plan ${dayCount} day(s).`
          : "",
      categoryLine,
      "Return the itinerary via the emit_itinerary tool. All prices in GBP.",
    ]
      .filter(Boolean)
      .join("\n");

    // One Claude call (forced tool-use). Retry ONCE on transient/malformed failure.
    let itinerary: Itinerary;
    try {
      itinerary = await callPlanner(apiKey, userPrompt);
    } catch (firstErr) {
      try {
        itinerary = await callPlanner(apiKey, userPrompt);
      } catch (secondErr) {
        throw new Error(
          `Trip planning failed after retry: ${
            secondErr instanceof Error ? secondErr.message : String(secondErr)
          }`,
        );
      }
    }

    const days = toReplaceDays(itinerary);
    const destCity =
      itinerary.destCity || intent.destination || "Trip";
    // Prefer the model's per-day dates; fall back to the caller's timeframe so
    // an explicit range still pins the trip's start/end (Stage 1).
    const startDate = days.find((d) => d.date)?.date ?? args.startDate;
    const endDate =
      [...days].reverse().find((d) => d.date)?.date ?? args.endDate;
    const titleDates =
      startDate && endDate && startDate !== endDate
        ? ` (${startDate}–${endDate})`
        : startDate
          ? ` (${startDate})`
          : "";

    // Persist: create the trip if the caller didn't supply one.
    let tripId: Id<"trips">;
    if (args.tripId) {
      tripId = args.tripId;
    } else {
      tripId = await ctx.runMutation(api.trips.create, {
        title: `${destCity}${titleDates}`,
        startDate,
        endDate,
        budgetGbp: finiteOrUndef(budgetGbp),
        currency: GBP,
        originCity: args.originCity,
        destCity,
        destLat: finiteOrUndef(itinerary.destLat),
        destLng: finiteOrUndef(itinerary.destLng),
        destCountryCode:
          typeof itinerary.destCountryCode === "string"
            ? itinerary.destCountryCode
            : undefined,
        active: true,
      });
    }

    await ctx.runMutation(api.trips.replaceItinerary, { tripId, days });

    // Fire-and-forget: backfill real Google Places photos + website/maps links
    // onto the freshly-planned items. Scheduled (not awaited) so the plan returns
    // immediately and images/links land reactively as the enrichment completes.
    await ctx.scheduler.runAfter(0, api.travelActions.enrichTripPlaces, {
      tripId,
    });

    return { tripId };
  },
});

// ─── enrichTripPlaces ────────────────────────────────────────────────────────
//
// Backfills REAL imagery + links onto a trip's items using Google Places:
//   image → first place photo, fetched and stored in Convex file storage so the
//           served URL carries no API key and survives quota windows.
//   link  → the place's official website, else its Google Maps page, else a
//           Maps search URL — so EVERY enrichable item ends up with a real link.
// Only items missing image/link are touched; existing good media is never
// overwritten. Non-place kinds (flight/transport) are skipped. Failures per item
// are swallowed so one bad lookup never aborts the batch.

/** Item kinds that map to a physical place worth a photo + link. */
const PLACE_KINDS = new Set(["place", "food", "stay", "activity"]);

export const enrichTripPlaces = action({
  args: { tripId: v.id("trips"), limit: v.optional(v.number()) },
  handler: async (
    ctx,
    { tripId, limit },
  ): Promise<{ enriched: number; reason?: string }> => {
    const apiKey = await getSecret(ctx, SECRET.googlePlaces);
    if (!apiKey) return { enriched: 0, reason: "GOOGLE_PLACES_API_KEY absent" };

    const full: any = await ctx.runQuery(api.trips.getFull, { tripId });
    if (!full) return { enriched: 0, reason: "trip not found" };

    const destCity: string =
      typeof full.trip?.destCity === "string" ? full.trip.destCity : "";
    const cap = Math.min(typeof limit === "number" ? limit : 40, 60);

    let enriched = 0;
    for (const it of full.items as any[]) {
      if (enriched >= cap) break;
      if (!PLACE_KINDS.has(it.kind)) continue;
      const hasImage = typeof it.image === "string" && it.image.length > 0;
      const hasLink = typeof it.link === "string" && it.link.length > 0;
      if (hasImage && hasLink) continue;
      const title = typeof it.title === "string" ? it.title.trim() : "";
      if (!title) continue;

      const query = [title, it.address || destCity].filter(Boolean).join(", ");
      const patch: { image?: string; link?: string } = {};

      try {
        // 1) Resolve the place id.
        const fpRes = await fetch(
          `${GP_FINDPLACE}?input=${encodeURIComponent(query)}&inputtype=textquery&fields=place_id&key=${apiKey}`,
        );
        const fpJson: any = await fpRes.json();
        const placeId: string | undefined = fpJson?.candidates?.[0]?.place_id;

        if (placeId) {
          // 2) Place details → website, maps url, photos.
          const dtRes = await fetch(
            `${GP_DETAILS}?place_id=${encodeURIComponent(placeId)}&fields=website,url,photos&key=${apiKey}`,
          );
          const dtJson: any = await dtRes.json();
          const result = dtJson?.result ?? {};

          if (!hasLink) {
            patch.link =
              (typeof result.website === "string" && result.website) ||
              (typeof result.url === "string" && result.url) ||
              mapsSearchUrl(query);
          }

          if (!hasImage) {
            const ref: string | undefined = result?.photos?.[0]?.photo_reference;
            if (ref) {
              const photoRes = await fetch(
                `${GP_PHOTO}?maxwidth=800&photo_reference=${encodeURIComponent(ref)}&key=${apiKey}`,
              );
              if (photoRes.ok) {
                const blob = await photoRes.blob();
                const storageId = await ctx.storage.store(blob);
                const url = await ctx.storage.getUrl(storageId);
                if (url) patch.image = url;
              }
            }
          }
        } else if (!hasLink) {
          // No match → still give the item a real, useful link.
          patch.link = mapsSearchUrl(query);
        }

        if (patch.image !== undefined || patch.link !== undefined) {
          await ctx.runMutation(api.trips.updateItem, {
            itemId: it._id,
            patch,
          });
          enriched += 1;
        }
      } catch {
        /* one bad lookup shouldn't abort the batch */
      }
    }

    return { enriched };
  },
});

// ─── routeLeg (transport routing) ────────────────────────────────────────────
//
// Google Directions lookup between two coordinates for a chosen mode. Returns
// the real travel time, distance and the encoded overview polyline (so the
// client can draw the actual road/rail route on the globe). Per the product
// decision, NO price is returned — transport surfaces a "book/view" deep-link
// instead (built client-side). Transit (train/bus) returns times + geometry;
// driving returns road geometry. Degrades gracefully (available:false) so the
// UI can show "no route found" rather than erroring.

type RouteResult =
  | { available: false; reason: string }
  | {
      available: true;
      mode: string;
      durationText: string;
      distanceText: string;
      polyline: string;
    };

/** Map our UI mode → Google Directions (mode, optional transit_mode). */
function directionsParams(mode: string): { mode: string; transitMode?: string } {
  if (mode === "train") return { mode: "transit", transitMode: "train|tram|subway|rail" };
  if (mode === "bus") return { mode: "transit", transitMode: "bus" };
  return { mode: "driving" }; // "car" / default
}

export const routeLeg = action({
  args: {
    fromLat: v.number(),
    fromLng: v.number(),
    toLat: v.number(),
    toLng: v.number(),
    mode: v.string(), // "car" | "train" | "bus"
  },
  handler: async (ctx, args): Promise<RouteResult> => {
    const apiKey = await getSecret(ctx, SECRET.googlePlaces);
    if (!apiKey) return { available: false, reason: "GOOGLE_PLACES_API_KEY absent" };

    const { mode, transitMode } = directionsParams(args.mode);
    const params = new URLSearchParams({
      origin: `${args.fromLat},${args.fromLng}`,
      destination: `${args.toLat},${args.toLng}`,
      mode,
      key: apiKey,
    });
    if (transitMode) params.set("transit_mode", transitMode);

    try {
      const res = await fetch(`${GP_DIRECTIONS}?${params.toString()}`);
      const json: any = await res.json();
      if (json?.status !== "OK" || !Array.isArray(json.routes) || !json.routes[0]) {
        return {
          available: false,
          reason: `No ${args.mode} route (${json?.status ?? res.status})`,
        };
      }
      const route = json.routes[0];
      const leg = route.legs?.[0] ?? {};
      return {
        available: true,
        mode: args.mode,
        durationText: leg.duration?.text ?? "",
        distanceText: leg.distance?.text ?? "",
        polyline: route.overview_polyline?.points ?? "",
      };
    } catch (e) {
      return {
        available: false,
        reason: `Directions error: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
});

// ─── Deal mode: searchStays (Google Hotels via SerpApi) ──────────────────────
//
// Returns real, priced hotel options (image, £/night, rating, source) for a
// query + timeframe. Per the product decision, each option's `link` is a
// BOOKING.COM deep-link for the hotel + dates with the free-cancellation filter
// (nflt=fc=2) pre-applied, so booking happens on Booking.com with free-cancel.
// `googleLink` is the Google hotel page as a secondary "details" link.

type StayOption = {
  name: string;
  provider?: string;
  priceGbp?: number;
  totalGbp?: number;
  image?: string;
  /** Small thumbnail for result cards (original stays for the detail gallery). */
  thumb?: string;
  /** "hotel" | "vacation rental" | "hostel"… straight from Google Hotels. */
  propertyType?: string;
  /** Star class (extracted_hotel_class) when Google knows it. */
  hotelClass?: number;
  rating?: number;
  freeCancellation?: boolean;
  lat?: number;
  lng?: number;
  link: string;
  googleLink?: string;
  /** SerpApi token to resolve the exact per-OTA booking link on demand. */
  propertyToken?: string;
  /** Top amenities ("Free Wi-Fi", "Breakfast", …) for the card perks row. */
  amenities?: string[];
  /** Per-OTA offers from Google Hotels — powers the per-provider carousels. */
  offers?: { source: string; priceGbp?: number }[];
};

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** Clean Booking.com link to a SPECIFIC property (dest_type=hotel + dest_id),
 *  with dates + free-cancellation filter — stable, unlike the gclid ad-redirect. */
function bookingPropertyUrl(
  destId: string,
  checkIn?: string,
  checkOut?: string,
  adults?: number,
): string {
  const p = new URLSearchParams({ dest_id: destId, dest_type: "hotel" });
  if (checkIn) p.set("checkin", checkIn);
  if (checkOut) p.set("checkout", checkOut);
  if (adults) p.set("group_adults", String(adults));
  return `https://www.booking.com/searchresults.html?${p.toString()}&nflt=fc%3D2`;
}

/** Booking.com search deep-link with free-cancellation filter pre-applied. */
function bookingDeepLink(
  name: string,
  checkIn?: string,
  checkOut?: string,
  adults?: number,
): string {
  const p = new URLSearchParams({ ss: name });
  if (checkIn) p.set("checkin", checkIn);
  if (checkOut) p.set("checkout", checkOut);
  if (adults) p.set("group_adults", String(adults));
  // nflt=fc%3D2 → Booking.com "Free cancellation" facet.
  return `https://www.booking.com/searchresults.html?${p.toString()}&nflt=fc%3D2`;
}

export const searchStays = action({
  args: {
    query: v.string(),
    checkIn: v.string(),
    checkOut: v.string(),
    adults: v.optional(v.number()),
    // Budget ceiling (per night). When set, Google Hotels returns only options
    // at or below it, so the Find-mode budget toggle shapes the recommendations.
    maxPricePerNight: v.optional(v.number()),
    // Vacation rentals (apartments/homes from Vrbo/Expedia/etc.) instead of hotels.
    vacationRentals: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ available: boolean; reason?: string; options: StayOption[] }> => {
    const key = await getSecret(ctx, SECRET.serpapi);
    if (!key) return { available: false, reason: "SERPAPI_KEY absent", options: [] };
    const adults = args.adults && args.adults > 0 ? Math.floor(args.adults) : 1;

    const baseParams: Record<string, string> = {
      engine: "google_hotels",
      q: args.query,
      check_in_date: args.checkIn,
      check_out_date: args.checkOut,
      adults: String(adults),
      currency: GBP,
      gl: "uk",
      hl: "en",
      api_key: key,
    };
    if (args.maxPricePerNight && args.maxPricePerNight > 0) {
      baseParams.max_price = String(Math.floor(args.maxPricePerNight));
    }
    if (args.vacationRentals) baseParams.vacation_rentals = "true";

    try {
      // Paginate (up to 3 pages) to collect ~50 properties per search.
      const collected: any[] = [];
      let nextToken: string | undefined;
      let firstError: string | undefined;
      for (let page = 0; page < 5 && collected.length < 100; page++) {
        const params = new URLSearchParams(baseParams);
        if (nextToken) params.set("next_page_token", nextToken);
        const res = await fetch(`${SERPAPI_URL}?${params.toString()}`);
        const json: any = await res.json();
        if (json?.error) {
          firstError = json.error;
          break;
        }
        const props: any[] = Array.isArray(json?.properties) ? json.properties : [];
        collected.push(...props);
        nextToken = json?.serpapi_pagination?.next_page_token;
        if (!nextToken) break;
      }
      if (collected.length === 0) {
        return { available: false, reason: firstError ?? "No results", options: [] };
      }
      const options: StayOption[] = collected.slice(0, 100).map((p) => {
        const img =
          p?.images?.[0]?.original_image ?? p?.images?.[0]?.thumbnail ?? undefined;
        const thumb =
          p?.images?.[0]?.thumbnail ?? p?.images?.[0]?.original_image ?? undefined;
        const coords = p?.gps_coordinates ?? {};
        return {
          name: typeof p?.name === "string" ? p.name : "Hotel",
          thumb: typeof thumb === "string" ? thumb : undefined,
          propertyType: typeof p?.type === "string" ? p.type : undefined,
          hotelClass: finiteOrUndef(p?.extracted_hotel_class),
          provider: p?.prices?.[0]?.source ?? undefined,
          priceGbp: finiteOrUndef(p?.rate_per_night?.extracted_lowest),
          totalGbp: finiteOrUndef(p?.total_rate?.extracted_lowest),
          image: typeof img === "string" ? img : undefined,
          rating: finiteOrUndef(p?.overall_rating),
          freeCancellation:
            typeof p?.free_cancellation === "boolean" ? p.free_cancellation : undefined,
          lat: finiteOrUndef(coords?.latitude),
          lng: finiteOrUndef(coords?.longitude),
          link: bookingDeepLink(p?.name ?? args.query, args.checkIn, args.checkOut, adults),
          googleLink: typeof p?.link === "string" ? p.link : undefined,
          propertyToken:
            typeof p?.property_token === "string" ? p.property_token : undefined,
          amenities: Array.isArray(p?.amenities)
            ? p.amenities.filter((a: unknown) => typeof a === "string").slice(0, 4)
            : undefined,
          offers: Array.isArray(p?.prices)
            ? p.prices
                .map((o: any) => ({
                  source: typeof o?.source === "string" ? o.source : "",
                  priceGbp: finiteOrUndef(o?.rate_per_night?.extracted_lowest),
                }))
                .filter((o: any) => o.source)
                .slice(0, 8)
            : undefined,
        };
      });
      return { available: true, options };
    } catch (e) {
      return {
        available: false,
        reason: `Hotel search error: ${e instanceof Error ? e.message : String(e)}`,
        options: [],
      };
    }
  },
});

/**
 * resolveStayOffers (2026-07-03) — the "auto-fill my search on the provider's
 * site" feature, WITHOUT Browserbase: SerpAPI's property-detail call returns,
 * per OTA, a DIRECT link to that exact property with the dates/guests already
 * applied, plus the rate's own perks (free breakfast / Wi-Fi / …) and its
 * free-cancellation flag. One credit per click, called on demand only.
 */
export const resolveStayOffers = action({
  args: {
    propertyToken: v.string(),
    query: v.string(),
    checkIn: v.string(),
    checkOut: v.string(),
    adults: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    available: boolean;
    reason?: string;
    amenities: string[];
    images: string[];
    address?: string;
    lat?: number;
    lng?: number;
    offers: {
      source: string;
      link?: string;
      priceGbp?: number;
      totalGbp?: number;
      freeCancellation?: boolean;
      cancellationNote?: string;
      perks: string[];
    }[];
  }> => {
    const key = await getSecret(ctx, SECRET.serpapi);
    if (!key)
      return { available: false, reason: "SERPAPI_KEY absent", amenities: [], images: [], offers: [] };
    const adults = args.adults && args.adults > 0 ? Math.floor(args.adults) : 1;
    const params = new URLSearchParams({
      engine: "google_hotels",
      q: args.query,
      check_in_date: args.checkIn,
      check_out_date: args.checkOut,
      adults: String(adults),
      currency: GBP,
      gl: "uk",
      hl: "en",
      property_token: args.propertyToken,
      api_key: key,
    });
    try {
      const res = await fetch(`${SERPAPI_URL}?${params.toString()}`);
      const json: any = await res.json();
      if (json?.error)
        return { available: false, reason: String(json.error), amenities: [], images: [], offers: [] };
      const amenities: string[] = Array.isArray(json?.amenities)
        ? json.amenities.filter((a: unknown) => typeof a === "string").slice(0, 10)
        : [];
      // Room/property gallery for the detail sheet's scrollable image rail.
      const images: string[] = Array.isArray(json?.images)
        ? json.images
            .map((im: any) => im?.original_image ?? im?.thumbnail)
            .filter((u: unknown) => typeof u === "string")
            .slice(0, 10)
        : [];
      const gps = json?.gps_coordinates ?? {};
      const address = typeof json?.address === "string" ? json.address : undefined;
      const raw: any[] = [
        ...(Array.isArray(json?.featured_prices) ? json.featured_prices : []),
        ...(Array.isArray(json?.prices) ? json.prices : []),
      ];
      const seen = new Set<string>();
      const offers = raw
        .map((o: any) => {
          const source = typeof o?.source === "string" ? o.source : "";
          if (!source || seen.has(source.toLowerCase())) return null;
          seen.add(source.toLowerCase());
          // Perk strings live in different fields per offer shape — collect all.
          const perks: string[] = [];
          // Perk text hides in several fields depending on the OTA: amenities,
          // per-room amenities, discount_remarks ("Breakfast included", "20%
          // off"…) and the room name itself when it embeds the board basis.
          for (const f of [o?.amenities, o?.rooms?.[0]?.amenities, o?.discount_remarks]) {
            if (Array.isArray(f)) for (const x of f) if (typeof x === "string") perks.push(x);
          }
          const roomName = o?.rooms?.[0]?.name;
          if (typeof roomName === "string" && /breakfast|half board|all inclusive/i.test(roomName)) {
            perks.push(roomName);
          }
          const linkOf = (v: unknown) => (typeof v === "string" && v.startsWith("http") ? v : undefined);
          // Refundability nuance: full free-cancel flag, or a dated/partial note.
          let cancellationNote: string | undefined;
          if (typeof o?.free_cancellation_until_date === "string") {
            cancellationNote = `free cancel until ${o.free_cancellation_until_date}`;
          } else if (typeof o?.rooms?.[0]?.free_cancellation_until_date === "string") {
            cancellationNote = `free cancel until ${o.rooms[0].free_cancellation_until_date}`;
          } else if (o?.free_cancellation === false) {
            cancellationNote = "non-refundable / partial";
          }
          return {
            source,
            link: linkOf(o?.link) ?? linkOf(o?.rooms?.[0]?.link),
            priceGbp: finiteOrUndef(o?.rate_per_night?.extracted_lowest),
            totalGbp: finiteOrUndef(o?.total_rate?.extracted_lowest),
            freeCancellation:
              typeof o?.free_cancellation === "boolean" ? o.free_cancellation : undefined,
            cancellationNote,
            perks: perks.slice(0, 5),
          };
        })
        .filter(Boolean) as any[];
      return {
        available: true,
        amenities,
        images,
        address,
        lat: finiteOrUndef(gps?.latitude),
        lng: finiteOrUndef(gps?.longitude),
        offers: offers.slice(0, 10),
      };
    } catch (e) {
      return {
        available: false,
        reason: e instanceof Error ? e.message : String(e),
        amenities: [],
        images: [],
        offers: [],
      };
    }
  },
});

// Resolve the EXACT booking link for one hotel (called on click, not per result,
// to spare quota). Returns the Booking.com property link when available, else the
// hotel's own site / first OTA link. Falls back to null so the caller can use the
// Booking.com search deep-link.
export const resolveStayLink = action({
  args: {
    propertyToken: v.string(),
    query: v.string(),
    checkIn: v.string(),
    checkOut: v.string(),
    adults: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ url: string | null; source: string | null }> => {
    const key = await getSecret(ctx, SECRET.serpapi);
    if (!key) return { url: null, source: null };
    const adults = args.adults && args.adults > 0 ? Math.floor(args.adults) : 2;
    const params = new URLSearchParams({
      engine: "google_hotels",
      q: args.query,
      check_in_date: args.checkIn,
      check_out_date: args.checkOut,
      adults: String(adults),
      currency: GBP,
      gl: "uk",
      hl: "en",
      property_token: args.propertyToken,
      api_key: key,
    });
    try {
      const res = await fetch(`${SERPAPI_URL}?${params.toString()}`);
      const json: any = await res.json();
      if (json?.error) return { url: null, source: null };
      const all: any[] = [
        ...(Array.isArray(json?.featured_prices) ? json.featured_prices : []),
        ...(Array.isArray(json?.prices) ? json.prices : []),
      ];
      const linkOf = (x: any): string | undefined =>
        (typeof x?.link === "string" && x.link) ||
        (Array.isArray(x?.rooms) && typeof x.rooms[0]?.link === "string"
          ? x.rooms[0].link
          : undefined);

      // The Booking.com "link" is a gclid ad-redirect that's flaky when opened
      // standalone. Follow it server-side to its real destination and lift the
      // dest_id, then hand back a CLEAN Booking.com property URL.
      const bookingAclk = linkOf(
        all.find((x) => /booking\.com/i.test(String(x?.source ?? "")) && linkOf(x)),
      );
      if (bookingAclk) {
        try {
          const fr = await fetch(bookingAclk, {
            headers: { "User-Agent": BROWSER_UA },
          });
          const finalUrl = fr.url ?? "";
          const m = finalUrl.match(/[?&;]dest_id=(\d+)/);
          if (m && /booking\.com/i.test(finalUrl)) {
            return {
              url: bookingPropertyUrl(
                m[1],
                args.checkIn,
                args.checkOut,
                adults,
              ),
              source: "Booking.com",
            };
          }
        } catch {
          /* fall through to other links */
        }
      }

      // Fallbacks: the hotel's own website (a real property page), else any OTA
      // link, else null so the caller uses the search deep-link.
      const ownSite =
        typeof json?.link === "string" && /^https?:\/\//.test(json.link)
          ? json.link
          : null;
      if (ownSite) return { url: ownSite, source: "Hotel website" };
      const anyPriced = all.find((x) => linkOf(x));
      return {
        url: anyPriced ? (linkOf(anyPriced) ?? null) : null,
        source: anyPriced?.source ?? null,
      };
    } catch {
      return { url: null, source: null };
    }
  },
});

// ─── Flights: searchFlights (Google Flights via SerpApi) ─────────────────────

type FlightOption = {
  priceGbp?: number;
  durationMin?: number;
  airline?: string;
  airlineLogo?: string;
  stops: number;
  from?: string;
  to?: string;
  departTime?: string;
  arriveTime?: string;
  bookLink: string;
};

/** Google Flights deep-link for a route + dates. */
function flightsDeepLink(
  origin: string,
  destination: string,
  outboundDate: string,
  returnDate?: string,
): string {
  const q =
    `Flights from ${origin} to ${destination} on ${outboundDate}` +
    (returnDate ? ` through ${returnDate}` : "");
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}`;
}

export const searchFlights = action({
  args: {
    origin: v.string(),
    destination: v.string(),
    outboundDate: v.string(),
    returnDate: v.optional(v.string()),
    adults: v.optional(v.number()),
    // Budget ceiling (total ticket price). Options above it are filtered out.
    maxPrice: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ available: boolean; reason?: string; options: FlightOption[] }> => {
    const key = await getSecret(ctx, SECRET.serpapi);
    if (!key) return { available: false, reason: "SERPAPI_KEY absent", options: [] };
    const adults = args.adults && args.adults > 0 ? Math.floor(args.adults) : 1;
    const maxPrice =
      args.maxPrice && args.maxPrice > 0 ? args.maxPrice : undefined;

    const params = new URLSearchParams({
      engine: "google_flights",
      departure_id: args.origin.trim().toUpperCase(),
      arrival_id: args.destination.trim().toUpperCase(),
      outbound_date: args.outboundDate,
      type: args.returnDate ? "1" : "2", // 1 = round trip, 2 = one way
      currency: GBP,
      gl: "uk",
      hl: "en",
      adults: String(adults),
      api_key: key,
    });
    if (args.returnDate) params.set("return_date", args.returnDate);

    try {
      const res = await fetch(`${SERPAPI_URL}?${params.toString()}`);
      const json: any = await res.json();
      if (json?.error) return { available: false, reason: json.error, options: [] };
      const raw: any[] = [
        ...(Array.isArray(json?.best_flights) ? json.best_flights : []),
        ...(Array.isArray(json?.other_flights) ? json.other_flights : []),
      ];
      const withinBudget = maxPrice
        ? raw.filter((f) => typeof f?.price === "number" && f.price <= maxPrice)
        : raw;
      const options: FlightOption[] = withinBudget.slice(0, 16).map((f) => {
        const legs: any[] = Array.isArray(f?.flights) ? f.flights : [];
        const first = legs[0] ?? {};
        const last = legs[legs.length - 1] ?? {};
        return {
          priceGbp: finiteOrUndef(f?.price),
          durationMin: finiteOrUndef(f?.total_duration),
          airline: typeof first?.airline === "string" ? first.airline : undefined,
          airlineLogo:
            typeof f?.airline_logo === "string" ? f.airline_logo : undefined,
          stops: Math.max(0, legs.length - 1),
          from: first?.departure_airport?.id ?? undefined,
          to: last?.arrival_airport?.id ?? undefined,
          departTime: first?.departure_airport?.time ?? undefined,
          arriveTime: last?.arrival_airport?.time ?? undefined,
          bookLink: flightsDeepLink(
            args.origin,
            args.destination,
            args.outboundDate,
            args.returnDate,
          ),
        };
      });
      return { available: true, options };
    } catch (e) {
      return {
        available: false,
        reason: `Flight search error: ${e instanceof Error ? e.message : String(e)}`,
        options: [],
      };
    }
  },
});

// ─── flightStatus ──────────────────────────────────────────────────────────────

const AERODATABOX_HOST = "aerodatabox.p.rapidapi.com";

type FlightEndpoint = {
  airport?: string;
  scheduled?: string;
  actual?: string;
  terminal?: string;
};
type FlightStatusResult =
  | { available: false; reason: string }
  | {
      available: true;
      flightNo: string;
      status: string;
      departure: FlightEndpoint;
      arrival: FlightEndpoint;
    };

function mapEndpoint(node: any): FlightEndpoint {
  const a = node ?? {};
  return {
    airport:
      a.airport?.name ?? a.airport?.iata ?? a.airport?.icao ?? undefined,
    scheduled:
      a.scheduledTime?.utc ?? a.scheduledTime?.local ?? a.scheduledTime ?? undefined,
    actual:
      a.actualTime?.utc ??
      a.actualTime?.local ??
      a.revisedTime?.utc ??
      a.revisedTime?.local ??
      undefined,
    terminal: a.terminal ?? undefined,
  };
}

export const flightStatus = action({
  args: {
    flightNo: v.string(),
    date: v.optional(v.string()),
  },
  handler: async (ctx, { flightNo, date }): Promise<FlightStatusResult> => {
    // Try the dedicated AeroDataBox slot, then the generic RapidAPI key.
    const apiKey =
      (await getSecret(ctx, SECRET.aerodatabox)) ??
      (await getSecret(ctx, SECRET.rapidapi));

    // Key is ABSENT today — degrade gracefully so the UI can show a disabled
    // state instead of erroring.
    if (!apiKey) {
      return { available: false, reason: "AeroDataBox API key not configured" };
    }

    const path = date
      ? `${encodeURIComponent(flightNo)}/${encodeURIComponent(date)}`
      : encodeURIComponent(flightNo);
    const url = `https://${AERODATABOX_HOST}/flights/number/${path}`;

    let json: any;
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          "X-RapidAPI-Key": apiKey,
          "X-RapidAPI-Host": AERODATABOX_HOST,
        },
      });
      if (!res.ok) {
        return {
          available: false,
          reason: `Flight lookup failed: ${res.status} ${res.statusText}`,
        };
      }
      json = await res.json();
    } catch (e) {
      return {
        available: false,
        reason: `Flight lookup error: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    // AeroDataBox returns an array of matching flight legs; take the first.
    const flight = Array.isArray(json) ? json[0] : json;
    if (!flight || typeof flight !== "object") {
      return { available: false, reason: "No flight found for that number/date" };
    }

    return {
      available: true,
      flightNo: flight.number ?? flightNo,
      status: flight.status ?? "Unknown",
      departure: mapEndpoint(flight.departure),
      arrival: mapEndpoint(flight.arrival),
    };
  },
});
