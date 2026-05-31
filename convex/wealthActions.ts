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
} as const;

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
  const j = await safeJson(
    `https://api.exchangerate.host/latest?base=${encodeURIComponent(from)}&symbols=GBP`,
  );
  const rate = j?.rates?.GBP;
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

async function binanceBalances(
  apiKey: string,
  apiSecret: string,
): Promise<Record<string, number> | null> {
  try {
    const ts = Date.now();
    const qs = `timestamp=${ts}&recvWindow=5000`;
    const sig = crypto.createHmac("sha256", apiSecret).update(qs).digest("hex");
    const j = await safeJson(
      `https://api.binance.com/api/v3/account?${qs}&signature=${sig}`,
      { headers: { "X-MBX-APIKEY": apiKey } },
    );
    if (!j?.balances) return null;
    const out: Record<string, number> = {};
    for (const b of j.balances) {
      const amt = parseFloat(b.free ?? "0") + parseFloat(b.locked ?? "0");
      if (b.asset && amt > DUST_EPSILON) out[b.asset] = amt;
    }
    return out;
  } catch (e) {
    console.warn("wealth: binance balances failed", e);
    return null;
  }
}

// ─── PUBLIC ACTIONS ──────────────────────────────────────────────────────────

/**
 * refreshCrypto — READ-ONLY balances from Coinbase + Binance, priced via
 * CoinGecko (FX fallback for stablecoins), upserts source:"auto" crypto assets.
 */
export const refreshCrypto = action({
  args: {},
  handler: async (ctx): Promise<{ updated: number; errors: string[] }> => {
    const errors: string[] = [];
    const balances: Record<string, number> = {};

    const cbKey = await getSecret(ctx, SECRET.coinbaseKey);
    const cbSecret = await getSecret(ctx, SECRET.coinbaseSecret);
    if (cbKey && cbSecret) {
      const cb = await coinbaseBalances(cbKey, cbSecret);
      if (cb) for (const [k, val] of Object.entries(cb)) balances[k] = (balances[k] ?? 0) + val;
      else errors.push("coinbase: balance fetch failed (key/permission?)");
    } else errors.push("coinbase: API key/secret missing in vault");

    const bnKey = await getSecret(ctx, SECRET.binanceKey);
    const bnSecret = await getSecret(ctx, SECRET.binanceSecret);
    if (bnKey && bnSecret) {
      const bn = await binanceBalances(bnKey, bnSecret);
      if (bn) for (const [k, val] of Object.entries(bn)) balances[k] = (balances[k] ?? 0) + val;
      else errors.push("binance: balance fetch failed (key/permission?)");
    } else errors.push("binance: API key/secret missing in vault");

    const symbols = Object.keys(balances);
    if (symbols.length === 0) {
      return { updated: 0, errors: errors.length ? errors : ["no balances returned"] };
    }

    const prices = await coingeckoGBP(symbols);
    const now = Date.now();
    let updated = 0;
    for (const sym of symbols) {
      const amt = balances[sym];
      let gbpPer = prices[sym.toUpperCase()];
      if (gbpPer === undefined) {
        const fx = await fxToGBP(sym === "USDC" || sym === "USDT" ? "USD" : sym);
        if (fx !== null) gbpPer = fx;
      }
      if (gbpPer !== undefined) {
        await ctx.runMutation(internal.wealth._writePrice, {
          symbol: sym.toUpperCase(),
          gbp: gbpPer,
          ts: now,
        });
      }
      const valueGBP = gbpPer !== undefined ? amt * gbpPer : undefined;
      await ctx.runMutation(internal.wealth._upsertAutoAsset, {
        category: "crypto",
        label: sym.toUpperCase(),
        currency: sym.toUpperCase(),
        quantity: amt,
        externalRef: "coinbase+binance",
        newValueGBP: valueGBP,
        pricedAt: valueGBP !== undefined ? now : undefined,
      });
      if (valueGBP !== undefined) updated++;
      else errors.push(`price missing for ${sym} (kept previous value)`);
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
    return await ctx.runMutation(internal.wealth._recordSnapshot, {});
  },
});
