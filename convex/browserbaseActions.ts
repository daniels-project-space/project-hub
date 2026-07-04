"use node";

/**
 * Browserbase-powered LIVE provider scrapes (2026-07-04). The portals Google
 * never indexes with prices (lastminute, Stayforlong, Trivago) are JS-only
 * sites — a real remote browser renders them, we read the RENDERED text +
 * links + images over raw CDP (no playwright bundle; just `ws`), and DeepSeek
 * structures the listings. Daniel pays for Browserbase — this is what it's
 * for. One session per hunt, released immediately after.
 *
 * SECRETS: browserbase/BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID,
 * openrouter/OPENROUTER_API_KEY — all read from the vault at runtime.
 */
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import WebSocket from "ws";

const BB_API = "https://api.browserbase.com/v1";

async function readSecret(ctx: any, service: string, keyName: string): Promise<string | null> {
  return await ctx.runQuery(internal.wealth.readSecret, { service, keyName });
}

/** Minimal CDP client over the Browserbase connect websocket. */
class Cdp {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, (v: any) => void>();

  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on("message", (raw: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg.id && this.pending.has(msg.id)) {
          this.pending.get(msg.id)!(msg);
          this.pending.delete(msg.id);
        }
      } catch {
        /* ignore non-JSON frames */
      }
    });
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<any> {
    const id = this.nextId++;
    const payload: Record<string, unknown> = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 20_000);
      this.pending.set(id, (msg) => {
        clearTimeout(t);
        if (msg.error) reject(new Error(`${method}: ${msg.error.message ?? "CDP error"}`));
        else resolve(msg.result);
      });
      this.ws.send(JSON.stringify(payload));
    });
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Render a URL in a Browserbase session and return rendered text + links + images. */
async function renderPage(
  apiKey: string,
  projectId: string,
  url: string,
): Promise<{ text: string; anchors: { href: string; text: string; img?: string }[]; images: string[] }> {
  // 1. session
  const sres = await fetch(`${BB_API}/sessions`, {
    method: "POST",
    headers: { "X-BB-API-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ projectId }),
  });
  const session: any = await sres.json();
  if (!session?.id || !session?.connectUrl) {
    throw new Error(`browserbase session failed: ${JSON.stringify(session).slice(0, 200)}`);
  }
  const ws = new WebSocket(session.connectUrl, { perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 });
  try {
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", (e) => reject(e));
    });
    const cdp = new Cdp(ws);
    const targets = await cdp.send("Target.getTargets");
    const page = (targets?.targetInfos ?? []).find((t: any) => t.type === "page");
    if (!page) throw new Error("no page target");
    const attach = await cdp.send("Target.attachToTarget", { targetId: page.targetId, flatten: true });
    const sid = attach?.sessionId as string;
    await cdp.send("Page.enable", {}, sid);
    await cdp.send("Page.navigate", { url }, sid);
    // JS-heavy portals hydrate slowly; poll readyState then give hydration time.
    for (let i = 0; i < 20; i++) {
      await sleep(1000);
      const st = await cdp
        .send("Runtime.evaluate", { expression: "document.readyState", returnByValue: true }, sid)
        .catch(() => null);
      if (st?.result?.value === "complete" && i >= 5) break;
    }
    // Listing cards lazy-load on scroll — walk down the page to force them in.
    // Price/image hydration on OTA result pages lags the scroll — give it room.
    await sleep(4000);
    for (const frac of [0.35, 0.7, 1, 0.5]) {
      await cdp
        .send(
          "Runtime.evaluate",
          { expression: `window.scrollTo(0, document.body.scrollHeight * ${frac})`, returnByValue: true },
          sid,
        )
        .catch(() => null);
      await sleep(1300);
    }
    const extract = await cdp.send(
      "Runtime.evaluate",
      {
        expression: `(() => {
          const NL = String.fromCharCode(10);
          const MARKERS = [String.fromCharCode(163), "$", String.fromCharCode(8364), "IDR", "night", "Night"];
          const full = document.body ? document.body.innerText : "";
          const priceLines = full.split(NL).filter(function (l) {
            return MARKERS.some(function (m) { return l.indexOf(m) !== -1; });
          }).slice(0, 120).join(NL);
          const text = (priceLines + NL + "----" + NL + full).slice(0, 14000);
          const anchors = Array.from(document.querySelectorAll("a[href]"))
            .map(function (a) {
              var card = a.closest("article, li, section, div");
              var im = card ? card.querySelector("img[src]") : null;
              return {
                href: a.href,
                text: (a.innerText || "").trim().slice(0, 120),
                img: im && im.src && im.src.indexOf("http") === 0 ? im.src : "",
              };
            })
            .filter(function (a) { return a.text.length > 3 && a.href.indexOf("http") === 0; })
            .sort(function (x, y) { return (y.img ? 1 : 0) - (x.img ? 1 : 0); })
            .slice(0, 60);
          const images = Array.from(document.querySelectorAll("img[src]"))
            .map(function (i) { return i.src; })
            .filter(function (u) { return u.indexOf("http") === 0 && !/logo|icon|sprite|svg/i.test(u); })
            .slice(0, 30);
          return JSON.stringify({ text: text, anchors: anchors, images: images });
        })()`,
        returnByValue: true,
      },
      sid,
    );
    const parsed = JSON.parse(extract?.result?.value ?? "{}");
    return {
      text: parsed.text ?? "",
      anchors: Array.isArray(parsed.anchors) ? parsed.anchors : [],
      images: Array.isArray(parsed.images) ? parsed.images : [],
    };
  } finally {
    try {
      ws.close();
    } catch {
      /* noop */
    }
    // release the session so it never idles against the plan
    void fetch(`${BB_API}/sessions/${session.id}`, {
      method: "POST",
      headers: { "X-BB-API-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, status: "REQUEST_RELEASE" }),
    }).catch(() => undefined);
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
    const apiKey = await readSecret(ctx, "browserbase", "BROWSERBASE_API_KEY");
    const projectId = await readSecret(ctx, "browserbase", "BROWSERBASE_PROJECT_ID");
    if (!apiKey || !projectId) return { available: false, reason: "browserbase keys absent", deals: [] };

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
    let rendered: Awaited<ReturnType<typeof renderPage>>;
    try {
      rendered = await renderPage(apiKey, projectId, url);
    } catch (e) {
      return { available: false, reason: `render failed: ${e instanceof Error ? e.message : String(e)}`, deals: [] };
    }
    if (!rendered.text.trim()) return { available: true, deals: [] };

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
