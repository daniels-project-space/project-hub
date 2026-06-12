"use node";

/**
 * Wealth — EXTERNAL-API ACTIONS (Wave 1 · centerpiece).
 *
 * This module is "use node" because Coinbase Advanced Trade requires an
 * ES256-signed JWT (node `crypto`) and Binance requires HMAC-SHA256 signing.
 * Convex forbids queries/mutations in a node module, so all DB access here goes
 * through `internal.wealth.*` helpers (defined in convex/wealth.ts).
 *
 * READ-ONLY DISCIPLINE
 * --------------------
 * - API keys are read from the Convex `secrets` table ONLY here (server-side),
 *   via internal `wealth.readSecret`. They never reach the client.
 * - Every exchange call hits a READ-ONLY endpoint (balances / tickers). There
 *   are NO trade / withdraw / transfer calls anywhere, by construction.
 * - The vault's Coinbase/Binance keys are tagged `aria`; permission level is NOT
 *   verifiable from metadata. Daniel must CONFIRM (or mint) READ-ONLY keys at
 *   the exchange before trusting auto-pull.
 *
 * RESILIENCE: if an API/key fails we keep the last cached value + lastPricedAt
 * (never overwrite a good value with nothing; never crash the refresh).
 */

import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import * as crypto from "crypto";

const GBP = "GBP";
const DUST_EPSILON = 1e-8;

// (service, keyName) pairs in the Convex `secrets` table.
const SECRET = {
  coinbaseKey: { service: "coinbase", keyName: "COINBASE_API_KEY" },
  coinbaseSecret: { service: "coinbase", keyName: "COINBASE_API_SECRET" },
  binanceKey: { service: "binance", keyName: "BINANCE_API_KEY" },
  binanceSecret: { service: "binance", keyName: "BINANCE_API_SECRET" },
  // OPTIONAL — degrade gracefully (manual value) if absent. See output doc.
  finnhub: { service: "finnhub", keyName: "FINNHUB_API_KEY" }, // stock quotes
  // Phase 16 — rental-manager-v2 Convex URL. NEVER hardcoded (dev deployment;
  // URL can change). Service `convex`, keyName NEXT_PUBLIC_CONVEX_URL_RMV2.
  rmv2ConvexUrl: { service: "convex", keyName: "NEXT_PUBLIC_CONVEX_URL_RMV2" },
  // AI music income — music-house Convex URL (dev deployment IS prod there).
  musicHouseConvexUrl: { service: "convex", keyName: "NEXT_PUBLIC_CONVEX_URL_MUSIC_HOUSE" },
} as const;

// Blended per-stream payout estimate (USD) shown until DistroKid's bank reports
// real money (~2-3 month store lag). Display-only — never enters net worth.
const USD_PER_STREAM = 0.0035;

const COINGECKO_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  USDC: "usd-coin",
  USDT: "tether",
  ADA: "cardano",
  XRP: "ripple",
  DOGE: "dogecoin",
  MATIC: "matic-network",
  DOT: "polkadot",
  LINK: "chainlink",
  AVAX: "avalanche-2",
  LTC: "litecoin",
  BNB: "binancecoin",
  ATOM: "cosmos",
};

// ─── helpers ─────────────────────────────────────────────────────────────────

async function getSecret(
  ctx: any,
  pair: { service: string; keyName: string },
): Promise<string | null> {
  return await ctx.runQuery(internal.wealth.readSecret, pair);
}

async function safeJson(url: string, init?: RequestInit): Promise<any | null> {
  try {
    const res = await fetch(url, init);
    if (!res.ok) {
      console.warn(`wealth: fetch ${url} -> ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.warn(`wealth: fetch ${url} failed`, e);
    return null;
  }
}

// FX: GBP per 1 unit of `from`. exchangerate.host (free, no key).
async function fxToGBP(from: string): Promise<number | null> {
  if (from === GBP) return 1;
  // Frankfurter/ECB (free, no key) — same source the net-worth reconstruction
  // used. Standardized away from exchangerate.host. Returns GBP per 1 `from` unit.
  const j = await safeJson(
    `https://api.frankfurter.app/latest?from=${encodeURIComponent(from)}&to=GBP`,
  );
  const rate = j?.rates?.GBP;
  return typeof rate === "number" ? rate : null;
}

/**
 * GBP→USD rate (USD per 1 GBP) from Frankfurter/ECB. Used for dual-currency
 * display; persisted into `fxRates` and written onto live/daily snapshots.
 */
async function gbpToUsd(): Promise<number | null> {
  const j = await safeJson("https://api.frankfurter.app/latest?from=GBP&to=USD");
  const rate = j?.rates?.USD;
  return typeof rate === "number" ? rate : null;
}

// CoinGecko: GBP price per unit for symbols. No key required.
async function coingeckoGBP(symbols: string[]): Promise<Record<string, number>> {
  const ids = symbols.map((s) => COINGECKO_IDS[s.toUpperCase()]).filter(Boolean);
  if (ids.length === 0) return {};
  const j = await safeJson(
    `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=gbp`,
  );
  if (!j) return {};
  const out: Record<string, number> = {};
  for (const sym of symbols) {
    const id = COINGECKO_IDS[sym.toUpperCase()];
    const gbp = id ? j[id]?.gbp : undefined;
    if (typeof gbp === "number") out[sym.toUpperCase()] = gbp;
  }
  return out;
}

// Coinbase Advanced Trade JWT (ES256) — READ-ONLY accounts call only.
function coinbaseJwt(
  apiKey: string,
  apiSecret: string,
  method: string,
  path: string,
): string | null {
  try {
    const host = "api.coinbase.com";
    const uri = `${method} ${host}${path}`;
    const now = Math.floor(Date.now() / 1000);
    const header = {
      alg: "ES256",
      kid: apiKey,
      nonce: crypto.randomBytes(16).toString("hex"),
      typ: "JWT",
    };
    const payload = { iss: "cdp", sub: apiKey, nbf: now, exp: now + 120, uri };
    const b64 = (o: any) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const signingInput = `${b64(header)}.${b64(payload)}`;
    const key = apiSecret.replace(/\\n/g, "\n"); // CDP EC private key PEM
    const sign = crypto.createSign("SHA256");
    sign.update(signingInput);
    sign.end();
    const der = sign.sign({ key, dsaEncoding: "ieee-p1363" });
    return `${signingInput}.${der.toString("base64url")}`;
  } catch (e) {
    console.warn("wealth: coinbase JWT sign failed (key may not be CDP EC PEM)", e);
    return null;
  }
}

async function coinbaseBalances(
  apiKey: string,
  apiSecret: string,
): Promise<Record<string, number> | null> {
  const path = "/api/v3/brokerage/accounts";
  const jwt = coinbaseJwt(apiKey, apiSecret, "GET", path);
  if (!jwt) return null;
  const j = await safeJson(`https://api.coinbase.com${path}?limit=250`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!j?.accounts) return null;
  const out: Record<string, number> = {};
  for (const acct of j.accounts) {
    const cur = acct?.currency;
    const amt = parseFloat(acct?.available_balance?.value ?? "0");
    if (cur && amt > DUST_EPSILON) out[cur] = (out[cur] ?? 0) + amt;
  }
  return out;
}

// ─── Phase 17 · Binance MARGIN/FUTURES auto-fetch helpers REMOVED ─────────────
// `binanceBalances` (spot /api/v3/account), `binanceSigned` (generic signed GET),
// and `binanceMarginPositions` (the 4-surface puller) were deleted: Binance
// geo-blocks Convex's egress IP (HTTP 451) on every signed endpoint, so they only
// ever failed. Binance spot + margin are MANUAL now. No Binance signed call
// remains anywhere in this module — only the public, keyless Coinbase / CoinGecko
// / Frankfurter / goldprice paths are still live.

// ─── PUBLIC ACTIONS ──────────────────────────────────────────────────────────

/**
 * refreshCrypto — READ-ONLY balances from Coinbase + Binance, priced via
 * CoinGecko (FX fallback for stablecoins), upserts source:"auto" crypto assets.
 */
export const refreshCrypto = action({
  args: {},
  handler: async (ctx): Promise<{ updated: number; errors: string[] }> => {
    const errors: string[] = [];
    // Phase 16: keep Coinbase and Binance SPOT in SEPARATE per-exchange maps so
    // each surfaces as its OWN visible asset line (externalRef "coinbase" /
    // "binance"), instead of the old silent "coinbase+binance" merge.
    const byExchange: Record<string, Record<string, number>> = {
      coinbase: {},
      binance: {},
    };

    const cbKey = await getSecret(ctx, SECRET.coinbaseKey);
    const cbSecret = await getSecret(ctx, SECRET.coinbaseSecret);
    if (cbKey && cbSecret) {
      const cb = await coinbaseBalances(cbKey, cbSecret);
      if (cb)
        for (const [k, val] of Object.entries(cb))
          byExchange.coinbase[k] = (byExchange.coinbase[k] ?? 0) + val;
      else errors.push("coinbase: balance fetch failed (key/permission?)");
    } else errors.push("coinbase: API key/secret missing in vault");

    // Phase 17: Binance SPOT auto-fetch DISABLED. Binance geo-blocks the Convex
    // egress IP (HTTP 451) on /api/v3/account, so the live pull never succeeds —
    // and re-running it would clobber the manual £364 "Binance" row with nothing.
    // Per Daniel's choice the Binance spot line is now MANUAL (like Stocks), edited
    // straight from the tile via setManualAssetValue. We deliberately do NOT call
    // binanceBalances here; the manual row persists untouched. Coinbase stays live.
    // (binanceBalances retained but unreferenced in case egress is ever unblocked.)

    // Union of symbols across both exchanges — one CoinGecko price fetch.
    const allSymbols = Array.from(
      new Set([
        ...Object.keys(byExchange.coinbase),
        ...Object.keys(byExchange.binance),
      ]),
    );
    if (allSymbols.length === 0) {
      return {
        updated: 0,
        errors: errors.length ? errors : ["no balances returned"],
      };
    }

    const prices = await coingeckoGBP(allSymbols);
    const now = Date.now();
    let updated = 0;

    // Resolve a GBP unit price per symbol (CoinGecko, FX fallback for stables).
    const gbpPerCache: Record<string, number | undefined> = {};
    for (const sym of allSymbols) {
      let gbpPer = prices[sym.toUpperCase()];
      if (gbpPer === undefined) {
        const fx = await fxToGBP(sym === "USDC" || sym === "USDT" ? "USD" : sym);
        if (fx !== null) gbpPer = fx;
      }
      gbpPerCache[sym] = gbpPer;
      if (gbpPer !== undefined) {
        await ctx.runMutation(internal.wealth._writePrice, {
          symbol: sym.toUpperCase(),
          gbp: gbpPer,
          ts: now,
        });
      }
    }

    // Upsert each holding as a SEPARATE per-exchange asset line so Coinbase AND
    // Binance both appear distinctly (label suffixed with the exchange).
    for (const exchange of ["coinbase", "binance"] as const) {
      const bal = byExchange[exchange];
      const tag = exchange === "coinbase" ? "Coinbase" : "Binance";
      for (const sym of Object.keys(bal)) {
        const amt = bal[sym];
        const gbpPer = gbpPerCache[sym];
        const valueGBP = gbpPer !== undefined ? amt * gbpPer : undefined;
        await ctx.runMutation(internal.wealth._upsertAutoAsset, {
          category: "crypto",
          label: `${sym.toUpperCase()} (${tag})`,
          currency: sym.toUpperCase(),
          quantity: amt,
          externalRef: exchange,
          newValueGBP: valueGBP,
          pricedAt: valueGBP !== undefined ? now : undefined,
        });
        if (valueGBP !== undefined) updated++;
        else errors.push(`price missing for ${sym} (${tag}) (kept previous value)`);
      }
    }
    return { updated, errors };
  },
});

/**
 * refreshPrices — revalue MANUAL assets: stocks (Finnhub quote × qty, FX→GBP),
 * gold (spot £/oz × qty), cash (balance × FX), property/inventory (direct GBP).
 * Writes priceCache for stock symbols + XAU. Resilient per-asset.
 */
export const refreshPrices = action({
  args: {},
  handler: async (ctx): Promise<{ updated: number; errors: string[] }> => {
    const errors: string[] = [];
    const now = Date.now();
    let updated = 0;

    const assets: any[] = await ctx.runQuery(internal.wealth._allAssets, {});
    const finnhubKey = await getSecret(ctx, SECRET.finnhub);

    // Gold spot £/oz: goldprice.org USD spot × USD→GBP FX.
    let goldGbpPerOz: number | null = null;
    {
      const gp = await safeJson("https://data-asg.goldprice.org/dbXRates/USD");
      const usdPerOz = gp?.items?.[0]?.xauPrice;
      const usdToGbp = await fxToGBP("USD");
      if (typeof usdPerOz === "number" && usdToGbp !== null) {
        goldGbpPerOz = usdPerOz * usdToGbp;
        await ctx.runMutation(internal.wealth._writePrice, {
          symbol: "XAU",
          gbp: goldGbpPerOz,
          ts: now,
        });
      } else {
        errors.push("gold: spot price unavailable (kept previous values)");
      }
    }

    for (const a of assets) {
      if (a.source !== "manual") continue;
      try {
        if (a.category === "stocks") {
          const qty = a.quantity ?? 0;
          const sym = (a.externalRef || a.label || "").toUpperCase();
          let quoteGBP: number | null = null;
          if (finnhubKey && sym) {
            const j = await safeJson(
              `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${finnhubKey}`,
            );
            const px = j?.c; // current price (assume USD)
            const fx = await fxToGBP(a.currency || "USD");
            if (typeof px === "number" && px > 0 && fx !== null) {
              quoteGBP = px * fx;
              await ctx.runMutation(internal.wealth._writePrice, {
                symbol: sym,
                gbp: quoteGBP,
                ts: now,
              });
            }
          }
          if (quoteGBP !== null) {
            await ctx.runMutation(internal.wealth._setAssetValue, {
              id: a._id,
              valueGBP: qty * quoteGBP,
              pricedAt: now,
            });
            updated++;
          } else {
            errors.push(
              `stocks/${a.label}: no live quote (need finnhub key + symbol in externalRef) — kept previous`,
            );
          }
        } else if (a.category === "gold") {
          const qty = a.quantity ?? 0; // troy oz
          if (goldGbpPerOz !== null) {
            await ctx.runMutation(internal.wealth._setAssetValue, {
              id: a._id,
              valueGBP: qty * goldGbpPerOz,
              pricedAt: now,
            });
            updated++;
          }
        } else if (a.category === "cash") {
          const bal = a.balanceNative ?? 0;
          const fx = await fxToGBP(a.currency || GBP);
          if (fx !== null) {
            await ctx.runMutation(internal.wealth._setAssetValue, {
              id: a._id,
              valueGBP: bal * fx,
              pricedAt: now,
            });
            updated++;
          } else {
            errors.push(`cash/${a.label}: FX for ${a.currency} unavailable`);
          }
        } else if (a.category === "property" || a.category === "inventory") {
          // Direct manual figure (GBP unless currency differs). NOT hardcoded.
          const bal = a.balanceNative ?? a.lastValueGBP ?? 0;
          const fx = a.currency && a.currency !== GBP ? await fxToGBP(a.currency) : 1;
          if (fx !== null) {
            await ctx.runMutation(internal.wealth._setAssetValue, {
              id: a._id,
              valueGBP: bal * fx,
              pricedAt: now,
            });
            updated++;
          }
        }
      } catch (e) {
        errors.push(`${a.category}/${a.label}: ${String(e)}`);
      }
    }
    return { updated, errors };
  },
});

/** refreshAll — crypto then prices. Manual-refresh button + daily snapshot. */
export const refreshAll = action({
  args: {},
  handler: async (ctx): Promise<{ crypto: any; prices: any }> => {
    const cryptoRes = await ctx.runAction(api.wealthActions.refreshCrypto, {});
    const pricesRes = await ctx.runAction(api.wealthActions.refreshPrices, {});
    return { crypto: cryptoRes, prices: pricesRes };
  },
});

// ─── Phase 17 · Binance margin AUTO-FETCH REMOVED ─────────────────────────────
//
// Phase 16's `refreshMargin` action + `refreshMarginCron` alias pulled the four
// Binance leveraged surfaces (isolated/cross/USDⓂ/COINⓂ). EVERY surface returns
// HTTP 451 (geo-restricted) from Convex's egress IP, so the action only ever
// produced failures. Per Daniel's Phase-17 decision, margin positions are now
// ENTERED MANUALLY (addMarginPosition / updateMarginPosition / removeMarginPosition
// in convex/wealth.ts) and roll into net worth straight from the marginPositions
// table. The auto-fetch action + its cron are deleted; NO code path hits a
// geo-blocked Binance endpoint anymore. (The binanceSigned / binanceMarginPositions
// helpers were also removed below.)

/**
 * pollRentalRevenue — server-side poll of rental-manager-v2's Convex
 * `dashboard:getStatsDrawerData {accountSlug:null}` → confirmed NET current-month
 * revenue (Phase 16). The RMv2 Convex URL is read from the vault (service
 * `convex`, key NEXT_PUBLIC_CONVEX_URL_RMV2) — NEVER hardcoded (dev deployment,
 * URL can change). Does NOT modify rental-manager-v2 (read-only HTTP query).
 * Resilient: a failed fetch keeps the previously cached figure (no clobber).
 */
export const pollRentalRevenue = action({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    monthRevenueGbp: number | null;
    monthLabel: string | null;
    targetGbp: number | null;
    error?: string;
  }> => {
    const url = await getSecret(ctx, SECRET.rmv2ConvexUrl);
    if (!url) {
      return {
        monthRevenueGbp: null,
        monthLabel: null,
        targetGbp: null,
        error: "rmv2 convex url missing in vault (convex/NEXT_PUBLIC_CONVEX_URL_RMV2)",
      };
    }
    const j = await safeJson(`${url.replace(/\/$/, "")}/api/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "dashboard:getStatsDrawerData",
        args: { accountSlug: null },
        format: "json",
      }),
    });
    const v = j?.status === "success" ? j.value : null;
    const monthRevenue = v?.confirmed?.month_revenue;
    const monthLabel = v?.confirmed?.month_label;
    const target = v?.monthly?.target_gbp;
    if (typeof monthRevenue !== "number") {
      return {
        monthRevenueGbp: null,
        monthLabel: null,
        targetGbp: null,
        error: "rmv2 query returned no confirmed.month_revenue (kept cache)",
      };
    }
    await ctx.runMutation(internal.wealth._setRentalRevenue, {
      source: "rmv2",
      monthRevenueGbp: monthRevenue,
      monthLabel: typeof monthLabel === "string" ? monthLabel : "",
      targetGbp: typeof target === "number" ? target : undefined,
    });
    return {
      monthRevenueGbp: monthRevenue,
      monthLabel: typeof monthLabel === "string" ? monthLabel : null,
      targetGbp: typeof target === "number" ? target : null,
    };
  },
});

/** Internal cron alias for pollRentalRevenue (cronJobs require internal refs). */
export const pollRentalRevenueCron = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    try {
      await ctx.runAction(api.wealthActions.pollRentalRevenue, {});
    } catch (e) {
      console.warn("wealth.pollRentalRevenueCron failed", e);
    }
  },
});

/**
 * pollMusicIncome — server-side poll of music-house's Convex
 * `distributorAnalytics:latest` + `:history` (DistroKid streams + REAL bank
 * balance; music-house refreshes its own data every 2 days via Trigger). First
 * AI income wired into net worth: the cache mutation also maintains the
 * "Music · DistroKid" auto asset under category `property` (= "AI Income").
 * URL from vault (`convex/NEXT_PUBLIC_CONVEX_URL_MUSIC_HOUSE`) — never
 * hardcoded. Read-only against music-house. Failed fetch keeps the cache.
 */
export const pollMusicIncome = action({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    streamsTotal: number | null;
    balanceUsd: number | null;
    balanceGbp: number | null;
    error?: string;
  }> => {
    const url = await getSecret(ctx, SECRET.musicHouseConvexUrl);
    if (!url) {
      return {
        streamsTotal: null,
        balanceUsd: null,
        balanceGbp: null,
        error:
          "music-house convex url missing in vault (convex/NEXT_PUBLIC_CONVEX_URL_MUSIC_HOUSE)",
      };
    }
    const base = url.replace(/\/$/, "");
    const q = (path: string, args: Record<string, unknown>) =>
      safeJson(`${base}/api/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, args, format: "json" }),
      });

    const latest = await q("distributorAnalytics:latest", { distributor: "distrokid" });
    const snap = latest?.status === "success" ? latest.value : null;
    if (!snap || typeof snap.streamsTotal !== "number") {
      return {
        streamsTotal: null,
        balanceUsd: null,
        balanceGbp: null,
        error: "music-house returned no analytics snapshot (kept cache)",
      };
    }

    const hist = await q("distributorAnalytics:history", { distributor: "distrokid" });
    const history: unknown[] = hist?.status === "success" && Array.isArray(hist.value) ? hist.value : [];

    const balanceUsd = typeof snap.balance === "number" ? snap.balance : 0;
    const fx = await fxToGBP(snap.currency || "USD");
    if (fx === null) {
      return {
        streamsTotal: snap.streamsTotal,
        balanceUsd,
        balanceGbp: null,
        error: `FX for ${snap.currency || "USD"} unavailable (kept cache)`,
      };
    }
    const balanceGbp = balanceUsd * fx;
    const estUsd = snap.streamsTotal * USD_PER_STREAM;

    await ctx.runMutation(internal.wealth._setAiIncome, {
      source: "music-house",
      streamsTotal: snap.streamsTotal,
      balanceUsd,
      estUsd,
      balanceGbp,
      historyJson: JSON.stringify(history.slice(-180)),
    });
    return { streamsTotal: snap.streamsTotal, balanceUsd, balanceGbp };
  },
});

/** Internal cron alias for pollMusicIncome (cronJobs require internal refs). */
export const pollMusicIncomeCron = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    try {
      await ctx.runAction(api.wealthActions.pollMusicIncome, {});
    } catch (e) {
      console.warn("wealth.pollMusicIncomeCron failed", e);
    }
  },
});

/**
 * snapshot — DAILY cron target. Refreshes live prices best-effort, then records
 * one netWorthSnapshots row. Refresh failures don't block the snapshot (we
 * snapshot whatever last-known values exist → cron never crashes).
 */
export const snapshot = internalAction({
  args: {},
  handler: async (ctx): Promise<{ totalGBP: number }> => {
    try {
      await ctx.runAction(api.wealthActions.refreshAll, {});
    } catch (e) {
      console.warn("wealth.snapshot: refresh failed, snapshotting cached values", e);
    }
    // Phase 17: no Binance margin auto-fetch (geo-blocked 451). Margin positions
    // are MANUAL now; their net equity rolls into the snapshot's "margin" category
    // straight from the marginPositions table inside _recordSnapshot. No fetch.
    // Persist GBP→USD onto the daily snapshot too (best-effort; additive).
    let usdPerGbp: number | null = null;
    try {
      usdPerGbp = await ctx.runAction(api.wealthActions.persistFx, {});
    } catch (e) {
      console.warn("wealth.snapshot: FX persist failed", e);
    }
    return await ctx.runMutation(internal.wealth._recordSnapshot, {
      usdPerGbp: usdPerGbp ?? undefined,
    });
  },
})

/**
 * Persist the latest GBP→USD rate (Frankfurter/ECB) into the `fxRates` table.
 * Returns the rate (USD per 1 GBP) or null if the source was unavailable
 * (resilient: never clobbers a previously-stored rate with nothing).
 */
export const persistFx = action({
  args: {},
  handler: async (ctx): Promise<number | null> => {
    const rate = await gbpToUsd();
    if (rate === null) return null;
    await ctx.runMutation(internal.wealth._upsertFxRate, {
      base: "GBP",
      quote: "USD",
      rate,
      fetchedAt: Date.now(),
    });
    return rate;
  },
})

/**
 * FREQUENT prices-only refresh (no daily snapshot row). Re-prices crypto via
 * CoinGecko, gold via spot (PAXG-equivalent XAU), refreshes FX, then writes a
 * single `currentPrices` (kind:"live") doc holding the fresh total + per-category
 * breakdown + GBP→USD. Stocks stay at their manual editable value (no quote).
 * Powers near-live dashboard tiles between the once-daily full snapshots.
 *
 * Resilient: reuses refreshCrypto + refreshPrices (both keep last-good values on
 * failure), so a flaky upstream never produces a stale-but-presented-as-fresh tile.
 */
export const refreshLive = internalAction({
  args: {},
  handler: async (ctx): Promise<{ totalGBP: number; usdPerGbp: number | null }> => {
    try {
      await ctx.runAction(api.wealthActions.refreshAll, {});
    } catch (e) {
      console.warn("wealth.refreshLive: refresh failed, using cached values", e);
    }
    // Phase 17: no Binance margin auto-fetch (geo-blocked 451). Margin net equity
    // is rolled into the live total + synthetic "margin" category by _recordLive
    // reading the (now MANUAL) marginPositions table directly. No fetch needed.
    let usdPerGbp: number | null = null;
    try {
      usdPerGbp = await ctx.runAction(api.wealthActions.persistFx, {});
    } catch (e) {
      console.warn("wealth.refreshLive: FX persist failed", e);
    }
    return await ctx.runMutation(internal.wealth._recordLive, {
      usdPerGbp: usdPerGbp ?? undefined,
    });
  },
});
