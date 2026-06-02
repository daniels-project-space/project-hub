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

/** (service, keyName) pairs in the Convex `secrets` table. */
const SECRET = {
  anthropic: { service: "anthropic", keyName: "ANTHROPIC_API_KEY" },
  // AeroDataBox key is ABSENT today — try the dedicated service first, then the
  // generic rapidapi slot. Either being present flips flightStatus to live.
  aerodatabox: { service: "aerodatabox", keyName: "AERODATABOX_API_KEY" },
  rapidapi: { service: "rapidapi", keyName: "RAPIDAPI_KEY" },
} as const;

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
      items: (Array.isArray(day.items) ? day.items : []).map((item) => ({
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
      })),
    }));
}

export const planTrip = action({
  args: {
    prompt: v.string(),
    budgetGbp: v.optional(v.number()),
    originCity: v.optional(v.string()),
    tripId: v.optional(v.id("trips")),
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

    const userPrompt = [
      args.prompt,
      args.originCity ? `Origin city: ${args.originCity}.` : "",
      budgetGbp ? `Total budget (HARD cap): £${budgetGbp} GBP.` : "",
      intent.days ? `Plan ${intent.days} day(s).` : "",
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
    const startDate = days.find((d) => d.date)?.date;
    const endDate = [...days].reverse().find((d) => d.date)?.date;
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

    return { tripId };
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
