/**
 * Daily idea generation (2026-07-03) — lights up the two widgets that shipped
 * as static "generation is paused" placeholders (idea-widget.tsx and
 * channel-idea-widget.tsx).
 *
 * Cost discipline: ONE OpenRouter DeepSeek call per day produces BOTH cards
 * (~1k tokens/day total — deliberately NOT Anthropic: that org has no credits,
 * and DeepSeek is the house standard for cheap JSON generation). On any
 * failure (missing key, bad JSON, provider down) nothing is written — the
 * widgets keep yesterday's doc and surface their own stale badge, so a broken
 * feed is VISIBLE instead of silently blank.
 */
import { internalAction, internalMutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

// deepseek-v4-flash pinned to trusted providers — SiliconFlow's fp8 quant corrupts
// JSON output (see rental-manager-v2 DeepSeek quirks).
const MODEL = "deepseek/deepseek-v4-flash";
const PROVIDERS = { only: ["deepseek", "alibaba"] };

const PROMPT =
  "You generate two short daily idea cards for a solo builder's dashboard. " +
  "His active businesses: camera-gear rental (Hygglo), an AI music label " +
  "(Suno/DistroKid), automated faceless YouTube channels, a print/dropship " +
  "experiment, and personal-finance tooling. Return STRICT JSON only:\n" +
  '{"idea": {"text": "<one buildable product/feature idea in 1-2 sentences>", ' +
  '"benefit": "<the concrete payoff in one sentence>"}, ' +
  '"channelIdea": {"logline": "<one faceless YouTube channel concept in 1-2 sentences>", ' +
  '"hook": "<a ready-to-shoot opening hook>", ' +
  '"monetization": "<the clearest monetization path>", ' +
  '"niche": "<2-3 word niche tag>", "format": "<shorts|longform|mixed>"}}\n' +
  "Be specific and novel — no generic advice, no repeats of the obvious. " +
  "Use plain ASCII punctuation only (no smart quotes, em dashes or ellipsis characters).";

// DeepSeek occasionally emits UTF-8 punctuation double-encoded as latin-1
// ("â€™" etc.). Normalize the common sequences so cards never render mojibake.
function deMojibake(s: string): string {
  return s
    .replace(/â€¦/g, "...") // most-specific first: bare "â€" prefixes every sequence
    .replace(/â€”|â€“/g, " - ")
    .replace(/â€™|â€˜/g, "'")
    .replace(/â€œ/g, '"')
    .replace(/â€[]?/g, '"') // right-dquote 3rd byte is a C1 control char
    .replace(/Â/g, "");
}

export const latest = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("dailyIdeas").order("desc").first();
  },
});

export const _save = internalMutation({
  args: {
    day: v.string(),
    ideaText: v.string(),
    ideaBenefit: v.optional(v.string()),
    channelLogline: v.string(),
    channelHook: v.optional(v.string()),
    channelMonetization: v.optional(v.string()),
    channelNiche: v.optional(v.string()),
    channelFormat: v.optional(v.string()),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("dailyIdeas")
      .withIndex("by_day", (q) => q.eq("day", args.day))
      .first();
    const doc = { ...args, generatedAt: Date.now() };
    if (existing) await ctx.db.replace(existing._id, doc);
    else await ctx.db.insert("dailyIdeas", doc);
    // Keep only the last 14 days — this is a daily card, not an archive.
    const all = await ctx.db.query("dailyIdeas").order("desc").collect();
    for (const old of all.slice(14)) await ctx.db.delete(old._id);
  },
});

export const generateDaily = internalAction({
  args: {},
  handler: async (ctx): Promise<{ ok: boolean; error?: string }> => {
    const apiKey: string | null = await ctx.runQuery(internal.wealth.readSecret, {
      service: "openrouter",
      keyName: "OPENROUTER_API_KEY",
    });
    if (!apiKey) return { ok: false, error: "OPENROUTER_API_KEY missing in vault" };

    let text = "";
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: MODEL,
          provider: PROVIDERS,
          // v4-flash is a REASONING model: its chain-of-thought spends from the
          // same budget as content, so 500 starved the JSON out (empty content,
          // finish=length). 2000 leaves room; still ~$0.0005/day at flash rates.
          max_tokens: 2000,
          temperature: 0.9, // novelty matters more than determinism here
          messages: [{ role: "user", content: PROMPT }],
        }),
      });
      if (!res.ok) return { ok: false, error: `openrouter ${res.status} (kept previous doc)` };
      const j = await res.json();
      text = j?.choices?.[0]?.message?.content ?? "";
    } catch (e) {
      return { ok: false, error: `openrouter fetch failed: ${String(e)} (kept previous doc)` };
    }

    let parsed: any;
    try {
      const m = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(m ? m[0] : text);
    } catch {
      return { ok: false, error: "LLM returned non-JSON (kept previous doc)" };
    }
    const idea = parsed?.idea;
    const ch = parsed?.channelIdea;
    if (typeof idea?.text !== "string" || typeof ch?.logline !== "string") {
      return { ok: false, error: "JSON missing idea.text / channelIdea.logline (kept previous doc)" };
    }

    const str = (x: unknown) =>
      typeof x === "string" && x.trim() ? deMojibake(x) : undefined;
    await ctx.runMutation(internal.ideas._save, {
      day: new Date().toISOString().slice(0, 10),
      ideaText: deMojibake(idea.text),
      ideaBenefit: str(idea.benefit),
      channelLogline: deMojibake(ch.logline),
      channelHook: str(ch.hook),
      channelMonetization: str(ch.monetization),
      channelNiche: str(ch.niche),
      channelFormat: str(ch.format),
      model: MODEL,
    });
    return { ok: true };
  },
});
