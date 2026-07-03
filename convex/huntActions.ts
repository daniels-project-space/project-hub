"use node";

/**
 * Hunt checker — the native, decoupled replacement for Aria's crontab-driven
 * `scripts/hunt-check.js` (which shelled out + called an LLM). ZERO Aria
 * dependency. Logic ported from aria/lib/hunts.js: a hunt is a recurring LLM
 * deal-hunt with a `runs` counter, `maxRuns` cap, and auto-stop when the LLM
 * decides the goal is met ("found"). Here we run the LLM check inside a Convex
 * `"use node"` action (Convex actions CAN call external APIs; queries/mutations
 * cannot — so all DB access goes through `internal.hunts.*` / `internal.wealth.readSecret`).
 *
 * Flow per hunt:
 *   1. SerpAPI Google search for the hunt query (real web signal).
 *   2. Anthropic LLM evaluates: "given these results, is there a <query>
 *      meeting <criteria>?" → returns {found, summary}.
 *   3. Write `lastResult`/`lastCheckedAt`, bump `runs`; if found → mark
 *      completed (active:false); if runs >= maxRuns → mark expired (active:false).
 *
 * SECRETS (read server-side from the vault `secrets` table via the existing
 * internal.wealth.readSecret internalQuery — same path wealthActions uses):
 *   - service "openrouter", keyName "OPENROUTER_API_KEY" (LLM — DeepSeek)
 *   - service "serpapi",    keyName "SERPAPI_KEY"        (web search; scope "aria")
 * 2026-07-03: switched off the vault's ANTHROPIC_API_KEY — that org has ZERO
 * credits (every call 400s), so hunts would have silently failed on first use.
 * DeepSeek via OpenRouter is the house standard for cheap JSON evals (same
 * setup as rental-manager-v2). If a key is absent the hunt still records a
 * graceful "no signal" result and bumps `runs` — it never crashes the cron or
 * fakes a positive.
 *
 * TRIGGER.DEV NOTE (Phase E): the plan named Trigger.dev/Mastra as the executor.
 * The project has NO trigger.config / trigger dir / @trigger.dev dep installed,
 * so the LLM check runs natively in this Convex node action (functionally
 * identical, fewer moving parts). To move it to Trigger.dev later: extract the
 * `runHunt` body into a Trigger task and have `enqueueDueHunts` call
 * `tasks.trigger(...)` instead of `runHunt`; the vault already holds 16 `trigger`
 * secrets (service "trigger"). No schema/widget change needed for that swap.
 */
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

// deepseek-v4-flash, pinned to trusted providers — SiliconFlow's fp8 quant corrupts
// JSON output (see rental-manager-v2 DeepSeek quirks).
const OPENROUTER_MODEL = "deepseek/deepseek-v4-flash";
const OPENROUTER_PROVIDERS = { only: ["deepseek", "alibaba"] };
const RESULT_MAX = 500; // aria capped last_result at 500 chars

async function getSecret(
  ctx: any,
  service: string,
  keyName: string,
): Promise<string | null> {
  return await ctx.runQuery(internal.wealth.readSecret, { service, keyName });
}

async function safeJson(url: string, init?: any): Promise<any | null> {
  try {
    const res = await fetch(url, init);
    if (!res.ok) {
      console.warn(`hunts: fetch ${url} -> ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.warn(`hunts: fetch ${url} failed`, e);
    return null;
  }
}

/** SerpAPI Google search → top organic snippets, condensed for the LLM. */
async function webSignal(query: string, apiKey: string): Promise<string> {
  const url =
    `https://serpapi.com/search.json?engine=google&num=10` +
    `&q=${encodeURIComponent(query)}&api_key=${encodeURIComponent(apiKey)}`;
  const j = await safeJson(url);
  const organic: any[] = j?.organic_results ?? [];
  const shopping: any[] = j?.shopping_results ?? [];
  const lines: string[] = [];
  for (const r of shopping.slice(0, 8)) {
    lines.push(
      `[shop] ${r.title ?? ""} — ${r.price ?? "?"} (${r.source ?? r.link ?? ""})`,
    );
  }
  for (const r of organic.slice(0, 8)) {
    lines.push(`[web] ${r.title ?? ""} — ${r.snippet ?? ""} (${r.link ?? ""})`);
  }
  return lines.join("\n").slice(0, 4000) || "(no search results)";
}

/** OpenRouter (DeepSeek) chat completion → {found, summary}. found=true ends the hunt. */
async function llmEvaluate(
  query: string,
  criteria: string | undefined,
  evidence: string,
  apiKey: string,
): Promise<{ found: boolean; summary: string }> {
  const sys =
    "You are a deal-hunting assistant. Given web search results, decide whether " +
    "the user's hunt goal is currently MET. A goal is met only if the evidence " +
    "shows a concrete matching offer/listing (e.g. the item at/under the target " +
    "price, in stock). Respond with STRICT JSON only: " +
    '{"found": boolean, "summary": "<one or two sentences, cite price/source>"}.';
  const userMsg =
    `HUNT: ${query}\n` +
    (criteria ? `CRITERIA / STOP-WHEN: ${criteria}\n` : "") +
    `\nWEB RESULTS:\n${evidence}\n\n` +
    `Is the goal met right now? Return JSON only.`;

  const j = await safeJson("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      provider: OPENROUTER_PROVIDERS,
      max_tokens: 300,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: userMsg },
      ],
    }),
  });

  const text: string = j?.choices?.[0]?.message?.content ?? "";
  if (!text) return { found: false, summary: "LLM returned no content." };
  try {
    const m = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(m ? m[0] : text);
    return {
      found: !!parsed.found,
      summary: String(parsed.summary ?? text).slice(0, RESULT_MAX),
    };
  } catch {
    // Non-JSON fallback: keep the prose, treat as "not found yet".
    return { found: false, summary: text.slice(0, RESULT_MAX) };
  }
}

/**
 * runHunt — execute ONE hunt's LLM check and write the outcome back.
 * Mirrors aria markRun(): bump runs, set last_result/last_run, auto-stop on
 * found or maxRuns.
 */
export const runHunt = internalAction({
  args: { huntId: v.id("hunts") },
  handler: async (ctx, { huntId }) => {
    const hunt = await ctx.runQuery(internal.hunts._get, { id: huntId });
    if (!hunt || !hunt.active) return { skipped: true };

    const serpKey = await getSecret(ctx, "serpapi", "SERPAPI_KEY");
    const llmKey = await getSecret(ctx, "openrouter", "OPENROUTER_API_KEY");

    let result: { found: boolean; summary: string };
    if (!serpKey || !llmKey) {
      result = {
        found: false,
        summary:
          "No check run: missing " +
          [!serpKey && "SERPAPI_KEY", !llmKey && "OPENROUTER_API_KEY"]
            .filter(Boolean)
            .join(" + ") +
          " in vault.",
      };
    } else {
      const evidence = await webSignal(hunt.query, serpKey);
      result = await llmEvaluate(hunt.query, hunt.criteria, evidence, llmKey);
    }

    await ctx.runMutation(internal.hunts._recordRun, {
      id: huntId,
      result: result.summary,
      found: result.found,
    });
    return { found: result.found, summary: result.summary };
  },
});

/**
 * enqueueDueHunts — the cron entrypoint. Finds active hunts that are "due"
 * (lastCheckedAt older than their cadence, derived from the cron `schedule`
 * string) and runs each. Because Convex has no per-row cron, we approximate
 * aria's per-hunt crontab here: one fleet cron ticks, this fans out to due
 * hunts. Sequential to stay polite to SerpAPI/Anthropic rate limits.
 */
export const enqueueDueHunts = internalAction({
  args: {},
  handler: async (ctx) => {
    const due: Array<{ _id: any }> = await ctx.runQuery(
      internal.hunts._dueActive,
      {},
    );
    let ran = 0;
    for (const h of due) {
      await ctx.runAction(internal.huntActions.runHunt, { huntId: h._id });
      ran++;
    }
    return { dueCount: due.length, ran };
  },
});
