"use node";

/**
 * LIVE provider scrapes (self-hosted renderer, 2026-08-16).
 *
 * Replaces the Browserbase CDP path. The portals Google never indexes with
 * prices (lastminute, Stayforlong, Trivago) are JS-only sites, so a real
 * browser still has to render them — it now runs on Daniel's own VPS
 * (`render-service`, headless Chrome behind a token-gated HTTPS endpoint)
 * instead of a metered third party. The rendered text/anchors/images come back
 * in exactly the shape the old CDP extraction produced, so the DeepSeek
 * structuring prompt below is unchanged.
 *
 * SECRETS: renderservice/RENDER_URL + RENDER_TOKEN, openrouter/OPENROUTER_API_KEY,
 * serpapi/SERPAPI_KEY — all read from the vault at runtime.
 */
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";

async function readSecret(ctx: any, service: string, keyName: string): Promise<string | null> {
  return await ctx.runQuery(internal.wealth.readSecret, { service, keyName });
}

type Rendered = { text: string; anchors: { href: string; text: string; img?: string }[]; images: string[] };

/** Render a URL on the self-hosted render-service and return text + links + images. */
async function renderPage(renderUrl: string, renderToken: string, url: string): Promise<Rendered> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 115_000);
  try {
    const res = await fetch(renderUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${renderToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ url }),
      signal: controller.signal,
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`render-service ${res.status}: ${String(body?.error ?? "").slice(0, 160)}`);
    }
    return {
      text: typeof body?.text === "string" ? body.text : "",
      anchors: Array.isArray(body?.anchors) ? body.anchors : [],
      images: Array.isArray(body?.images) ? body.images : [],
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Provider search URLs that render results for a destination + dates. */
function providerUrl(key: string, city: string, checkIn?: string, checkOut?: string, adults?: number): string {
  const c = encodeURIComponent(city);
  const slug = encodeURIComponent(city.toLowerCase().replace(/\s+/g, "-"));
  switch (key) {
    case "trivago":
      return `https://www.trivago.co.uk/en-GB/srl?search=${c}`;
    case "lastminute":
      return `https://www.lastminute.com/hotels/${slug}.html`;
    case "stayforlong":
      return `https://www.stayforlong.co.uk/uk-en/`;
    case "expedia":
      return `https://www.expedia.co.uk/Hotel-Search?destination=${c}${checkIn ? `&startDate=${checkIn}` : ""}${checkOut ? `&endDate=${checkOut}` : ""}&adults=${adults ?? 1}`;
    case "hotels":
      return `https://www.hotels.com/Hotel-Search?destination=${c}${checkIn ? `&startDate=${checkIn}` : ""}${checkOut ? `&endDate=${checkOut}` : ""}&adults=${adults ?? 1}`;
    case "trip":
      return `https://uk.trip.com/hotels/list?cityName=${c}${checkIn ? `&checkin=${checkIn}` : ""}${checkOut ? `&checkout=${checkOut}` : ""}&adult=${adults ?? 1}&crn=1`;
    default:
      return `https://www.booking.com/searchresults.html?ss=${c}${checkIn ? `&checkin=${checkIn}` : ""}${checkOut ? `&checkout=${checkOut}` : ""}&group_adults=${adults ?? 1}`;
  }
}

/** Portals that answer a bot challenge instead of listings when rendered from a
 *  datacentre IP. We do not attempt to defeat those challenges — the hunt just
 *  reports itself unavailable and the caller falls back to the SerpAPI path. */
const BOT_WALL = /show us your human side|security verification|are you a robot|unusual traffic|pardon our interruption|access denied|captcha/i;

export const providerDealsLive = action({
  args: {
    providerKey: v.string(), // "trivago" | "lastminute" | "stayforlong" | ...
    provider: v.string(), // display name
    domain: v.optional(v.string()), // e.g. "lastminute.com" — entry-URL resolution
    city: v.string(),
    checkIn: v.optional(v.string()),
    checkOut: v.optional(v.string()),
    adults: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    available: boolean;
    reason?: string;
    deals: { name: string; priceNight?: string; priceTotal?: string; priceGbpNight?: number; priceGbpTotal?: number; link?: string; image?: string; images?: string[]; note?: string }[];
  }> => {
    // Vault first (consistent with every other secret here); Convex env vars are
    // accepted as a fallback so the endpoint can be configured from the Convex
    // dashboard without a vault mutation.
    const renderUrl = (await readSecret(ctx, "renderservice", "RENDER_URL")) ?? process.env.RENDER_URL ?? null;
    const renderToken = (await readSecret(ctx, "renderservice", "RENDER_TOKEN")) ?? process.env.RENDER_TOKEN ?? null;
    if (!renderUrl || !renderToken) return { available: false, reason: "render-service not configured", deals: [] };

    // Guessed slugs 404 for regions ("Bali" isn't a lastminute city page). The
    // universal entry: ask Google (indexed) for the portal's OWN page for this
    // destination and render THAT. Falls back to the pattern URL.
    let url = providerUrl(args.providerKey, args.city, args.checkIn, args.checkOut, args.adults);
    if (args.domain) {
      const serpKey = await readSecret(ctx, "serpapi", "SERPAPI_KEY");
      if (serpKey) {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const sp = new URLSearchParams({
              engine: "google",
              q: `site:${args.domain} ${args.city} hotels`,
              gl: "uk",
              hl: "en",
              num: "5",
              api_key: serpKey,
            });
            const r = await fetch(`https://serpapi.com/search.json?${sp.toString()}`);
            const j: any = await r.json();
            if (j?.error) {
              if (attempt === 0 && /try again/i.test(String(j.error))) continue;
              break;
            }
            const first = (j?.organic_results ?? []).find(
              (o: any) => typeof o?.link === "string" && o.link.includes(args.domain!),
            );
            if (first?.link) url = first.link;
            break;
          } catch {
            break;
          }
        }
      }
    }

    let rendered: Rendered;
    try {
      rendered = await renderPage(renderUrl, renderToken, url);
    } catch (e) {
      return { available: false, reason: `render failed: ${e instanceof Error ? e.message : String(e)}`, deals: [] };
    }
    if (!rendered.text.trim()) return { available: true, deals: [] };
    if (BOT_WALL.test(rendered.text.slice(0, 1200))) {
      return { available: false, reason: `${args.provider} served a bot challenge`, deals: [] };
    }

    const llmKey = await readSecret(ctx, "openrouter", "OPENROUTER_API_KEY");
    if (!llmKey) return { available: true, deals: [] };
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${llmKey}` },
        body: JSON.stringify({
          model: "deepseek/deepseek-v4-flash",
          provider: { only: ["deepseek", "alibaba"] },
          max_tokens: 5500, // v4-flash reasoning + long OTA urls — smaller budgets truncate the JSON
          messages: [
            {
              role: "user",
              content:
                `This is the RENDERED ${args.provider} page for ${args.city} stays` +
                (args.checkIn ? ` (${args.checkIn} to ${args.checkOut})` : "") +
                `. Extract up to 12 HOTEL/PROPERTY listings - NEVER destination/area tiles (skip names that are just places like Seminyak, Kuta, Ubud). PRICE SEMANTICS ARE CRITICAL: portals show per-night AND stay-total prices; NEVER put a nightly rate in the total field. Decide from context text (per night / a night = nightly; total / for N nights = total); leave the other null. STRICT JSON only:\n` +
                `{"deals":[{"name":"<property>","priceNight":"<nightly price as displayed or null>","priceTotal":"<stay-total as displayed or null>","priceGbpNight":<approx GBP number or null>,"priceGbpTotal":<approx GBP number or null>,` +
                `"link":"<best matching anchor href or null>","image":"<best matching image url or null>","note":"<rating/area/perk>"}]}\n` +
                `Use ANCHORS to pick links AND images (each row is name :: link :: image-url of the SAME card). Loose IMAGES are a fallback gallery. ` +
                `Only listings genuinely on the page. ASCII only.\n` +
                `PAGE TEXT:\n${rendered.text.slice(0, 9000)}\n\nANCHORS:\n` +
                rendered.anchors.map((a) => `${a.text} :: ${a.href} :: ${(a as { img?: string }).img ?? ""}`).join("\n").slice(0, 3800) +
                `\n\nIMAGES:\n${rendered.images.join("\n").slice(0, 1500)}`,
            },
          ],
        }),
      });
      const j: any = await res.json();
      const text: string = j?.choices?.[0]?.message?.content ?? "";
      const m = text.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(m ? m[0] : text);
      const deals = (Array.isArray(parsed?.deals) ? parsed.deals : [])
        .filter((d: any) => typeof d?.name === "string")
        .slice(0, 12)
        .map((d: any) => {
          const image = typeof d.image === "string" && d.image.startsWith("http") ? d.image : undefined;
          // Card image first, then page gallery shots for the overlay rail.
          const images = [image, ...rendered.images]
            .filter((u, i, arr): u is string => typeof u === "string" && arr.indexOf(u) === i)
            .slice(0, 6);
          return {
            name: d.name,
            priceNight: typeof d.priceNight === "string" ? d.priceNight : undefined,
            priceTotal: typeof d.priceTotal === "string" ? d.priceTotal : undefined,
            priceGbpNight:
              typeof d.priceGbpNight === "number" && Number.isFinite(d.priceGbpNight) ? d.priceGbpNight : undefined,
            priceGbpTotal:
              typeof d.priceGbpTotal === "number" && Number.isFinite(d.priceGbpTotal) ? d.priceGbpTotal : undefined,
            link: typeof d.link === "string" && d.link.startsWith("http") ? d.link : undefined,
            image,
            images,
            note: typeof d.note === "string" ? d.note.slice(0, 90) : undefined,
          };
        });
      return { available: true, deals };
    } catch (e) {
      return { available: false, reason: `extraction failed: ${e instanceof Error ? e.message : String(e)}`, deals: [] };
    }
  },
});
