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

// ─── Phase 16 · Binance MARGIN/FUTURES (READ-ONLY) ─────────────────────────────
//
// Generic HMAC-SHA256 signed GET against any Binance host (spot api / sapi margin
// / fapi USDⓂ futures / dapi COINⓂ futures). Mirrors aria/lib/finance.js's
// binanceRequest. READ-ONLY: only account/position-read endpoints are ever called
// — never order/withdraw/transfer. Returns parsed JSON, or null on failure (the
// caller reports which surface failed; never fabricates).
async function binanceSigned(
  host: string,
  path: string,
  apiKey: string,
  apiSecret: string,
  extraParams = "",
  diag?: { note?: string },
): Promise<any | null> {
  try {
    const ts = Date.now();
    const qs = `${extraParams ? extraParams + "&" : ""}timestamp=${ts}&recvWindow=5000`;
    const sig = crypto.createHmac("sha256", apiSecret).update(qs).digest("hex");
    const res = await fetch(`https://${host}${path}?${qs}&signature=${sig}`, {
      headers: { "X-MBX-APIKEY": apiKey },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const snippet = `HTTP ${res.status} ${body.slice(0, 140)}`;
      console.warn(`wealth: binance ${host}${path} -> ${snippet}`);
      if (diag) diag.note = snippet;
      return null;
    }
    return await res.json();
  } catch (e) {
    const snippet = `network ${String(e).slice(0, 120)}`;
    console.warn(`wealth: binance ${host}${path} failed`, e);
    if (diag) diag.note = snippet;
    return null;
  }
}

type MarginPos = {
  market: string;
  symbol: string;
  base?: string;
  quote?: string;
  side: string;
  size: number;
  entryPrice: number;
  markPrice: number;
  leverage?: number;
  uPnlUsd: number;
  uPnlGbp: number;
  marginLevel?: number;
  liqPrice?: number;
  netEquityGbp: number;
};

// Fetch ALL Binance leveraged surfaces. `usdToGbp` converts USD-denominated PnL
// and net equity to GBP. `report` accumulates per-surface failure notes so the
// caller can say exactly which surface (if any) the API rejected.
async function binanceMarginPositions(
  apiKey: string,
  apiSecret: string,
  usdToGbp: number,
  report: { errors: string[] },
): Promise<MarginPos[]> {
  const out: MarginPos[] = [];
  const gbp = (usd: number) => usd * usdToGbp;

  // 1) ISOLATED MARGIN — /sapi/v1/margin/isolated/account. Each pair is a short:
  //    borrow base, sell → profit when price falls. Entry from myTrades (sells).
  const isoDiag: { note?: string } = {};
  const iso = await binanceSigned(
    "api.binance.com",
    "/sapi/v1/margin/isolated/account",
    apiKey,
    apiSecret,
    "",
    isoDiag,
  );
  if (iso === null)
    report.errors.push(`isolated-margin: ${isoDiag.note ?? "fetch failed"}`);
  else {
    for (const pair of iso.assets ?? []) {
      const base = pair.baseAsset ?? {};
      const quote = pair.quoteAsset ?? {};
      const baseBorrowed = parseFloat(base.borrowed ?? "0");
      const baseInterest = parseFloat(base.interest ?? "0");
      const quoteNet = parseFloat(quote.netAsset ?? "0");
      const owed = baseBorrowed + baseInterest;
      if (Math.abs(quoteNet) <= 0.01 && owed <= 0.01) continue;
      const markPrice = parseFloat(pair.indexPrice ?? "0");
      // Average entry from sell trades matched to the borrowed qty.
      let avgEntry = 0;
      const trades = await binanceSigned(
        "api.binance.com",
        "/sapi/v1/margin/myTrades",
        apiKey,
        apiSecret,
        `symbol=${pair.symbol}&isIsolated=TRUE&limit=50`,
      );
      if (Array.isArray(trades)) {
        let need = baseBorrowed;
        let val = 0;
        let matched = 0;
        const sells = trades.filter((t: any) => !t.isBuyer).reverse();
        for (const t of sells) {
          if (need <= 0) break;
          const qty = Math.min(parseFloat(t.qty), need);
          val += qty * parseFloat(t.price);
          matched += qty;
          need -= qty;
        }
        if (matched > 0) avgEntry = val / matched;
      }
      // SHORT PnL (USD-ish, quote currency): borrowed × (entry − mark) − interest×mark
      const pnlQuote =
        baseBorrowed * (avgEntry - markPrice) - baseInterest * markPrice;
      // quote is typically USDT/USDC ≈ USD. Net equity = quote net asset (USD).
      const netEquityUsd = quoteNet;
      out.push({
        market: "isolated",
        symbol: pair.symbol,
        base: base.asset,
        quote: quote.asset,
        side: "short",
        size: baseBorrowed,
        entryPrice: avgEntry,
        markPrice,
        marginLevel: parseFloat(pair.marginLevel ?? "0") || undefined,
        liqPrice: parseFloat(pair.liquidatePrice ?? "0") || undefined,
        uPnlUsd: pnlQuote,
        uPnlGbp: gbp(pnlQuote),
        netEquityGbp: gbp(netEquityUsd),
      });
    }
  }

  // 2) CROSS MARGIN — /sapi/v1/margin/account. Net equity = totalNetAssetOfBtc×BTC.
  //    Surfaced as a single aggregate "cross equity" line (no per-symbol entry).
  const crossDiag: { note?: string } = {};
  const cross = await binanceSigned(
    "api.binance.com",
    "/sapi/v1/margin/account",
    apiKey,
    apiSecret,
    "",
    crossDiag,
  );
  if (cross === null)
    report.errors.push(`cross-margin: ${crossDiag.note ?? "fetch failed"}`);
  else {
    const netBtc = parseFloat(cross.totalNetAssetOfBtc ?? "0");
    if (Math.abs(netBtc) > 1e-6) {
      // value BTC in USD via a public ticker (no key, READ-ONLY)
      const tick = await safeJson(
        "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT",
      );
      const btcUsd = tick ? parseFloat(tick.price ?? "0") : 0;
      const netUsd = netBtc * btcUsd;
      out.push({
        market: "cross",
        symbol: "CROSS (net equity)",
        side: netBtc >= 0 ? "long" : "short",
        size: netBtc,
        entryPrice: 0,
        markPrice: btcUsd,
        marginLevel: parseFloat(cross.marginLevel ?? "0") || undefined,
        uPnlUsd: 0,
        uPnlGbp: 0,
        netEquityGbp: gbp(netUsd),
      });
    }
  }

  // 3) USDⓂ FUTURES — /fapi/v2/account (+ positionRisk for entry/mark/liq).
  const usdmDiag: { note?: string } = {};
  const usdmAcct = await binanceSigned(
    "fapi.binance.com",
    "/fapi/v2/account",
    apiKey,
    apiSecret,
    "",
    usdmDiag,
  );
  if (usdmAcct === null)
    report.errors.push(`usdm-futures: ${usdmDiag.note ?? "account fetch failed"}`);
  else {
    const walletUsd = parseFloat(usdmAcct.totalWalletBalance ?? "0");
    const uPnlUsd = parseFloat(usdmAcct.totalUnrealizedProfit ?? "0");
    const positions = (usdmAcct.positions ?? []).filter(
      (p: any) => Math.abs(parseFloat(p.positionAmt ?? "0")) > 0,
    );
    // Net equity of the whole USDⓂ wallet rolls into net worth once (margin
    // balance ± uPnL). Per-position rows carry their own uPnL for the tracker.
    if (positions.length === 0 && walletUsd + uPnlUsd !== 0) {
      out.push({
        market: "usdm",
        symbol: "USDⓂ (wallet)",
        side: "long",
        size: 0,
        entryPrice: 0,
        markPrice: 0,
        uPnlUsd,
        uPnlGbp: gbp(uPnlUsd),
        netEquityGbp: gbp(walletUsd + uPnlUsd),
      });
    } else {
      const risk = await binanceSigned(
        "fapi.binance.com",
        "/fapi/v2/positionRisk",
        apiKey,
        apiSecret,
      );
      const riskBySym: Record<string, any> = {};
      if (Array.isArray(risk)) for (const r of risk) riskBySym[r.symbol] = r;
      let rolled = false;
      for (const p of positions) {
        const amt = parseFloat(p.positionAmt ?? "0");
        const pnl = parseFloat(p.unrealizedProfit ?? "0");
        const r = riskBySym[p.symbol] ?? {};
        // Roll the wallet net equity in only ONCE (on the first position).
        const netEq = !rolled ? gbp(walletUsd + uPnlUsd) : 0;
        rolled = true;
        out.push({
          market: "usdm",
          symbol: p.symbol,
          side: amt >= 0 ? "long" : "short",
          size: Math.abs(amt),
          entryPrice: parseFloat(p.entryPrice ?? r.entryPrice ?? "0"),
          markPrice: parseFloat(r.markPrice ?? "0"),
          leverage: parseFloat(p.leverage ?? r.leverage ?? "0") || undefined,
          liqPrice: parseFloat(r.liquidationPrice ?? "0") || undefined,
          uPnlUsd: pnl,
          uPnlGbp: gbp(pnl),
          netEquityGbp: netEq,
        });
      }
    }
  }

  // 4) COINⓂ FUTURES — /dapi/v1/account (+ positionRisk). Coin-margined; wallet
  //    balances are per-coin. Roll the marginBalance (in BTC etc.) → USD → GBP.
  const coinmDiag: { note?: string } = {};
  const coinmAcct = await binanceSigned(
    "dapi.binance.com",
    "/dapi/v1/account",
    apiKey,
    apiSecret,
    "",
    coinmDiag,
  );
  if (coinmAcct === null)
    report.errors.push(
      `coinm-futures: ${coinmDiag.note ?? "account fetch failed"}`,
    );
  else {
    const positions = (coinmAcct.positions ?? []).filter(
      (p: any) => Math.abs(parseFloat(p.positionAmt ?? "0")) > 0,
    );
    if (positions.length > 0) {
      const risk = await binanceSigned(
        "dapi.binance.com",
        "/dapi/v1/positionRisk",
        apiKey,
        apiSecret,
      );
      const riskBySym: Record<string, any> = {};
      if (Array.isArray(risk)) for (const r of risk) riskBySym[r.symbol] = r;
      // Value coin-margined uPnL: unrealizedProfit is in the contract's base coin.
      for (const p of positions) {
        const amt = parseFloat(p.positionAmt ?? "0");
        const pnlCoin = parseFloat(p.unrealizedProfit ?? "0");
        const r = riskBySym[p.symbol] ?? {};
        const markPrice = parseFloat(r.markPrice ?? "0");
        // pnl in coin × mark(USD/coin) ≈ USD
        const pnlUsd = pnlCoin * markPrice;
        out.push({
          market: "coinm",
          symbol: p.symbol,
          side: amt >= 0 ? "long" : "short",
          size: Math.abs(amt),
          entryPrice: parseFloat(p.entryPrice ?? r.entryPrice ?? "0"),
          markPrice,
          leverage: parseFloat(p.leverage ?? r.leverage ?? "0") || undefined,
          liqPrice: parseFloat(r.liquidationPrice ?? "0") || undefined,
          uPnlUsd: pnlUsd,
          uPnlGbp: gbp(pnlUsd),
          // Coin-margined net equity left at the position's own uPnL value in GBP
          // (wallet coin balance is the collateral; uPnL is the moving part).
          netEquityGbp: gbp(pnlUsd),
        });
      }
    }
  }

  return out;
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

    const bnKey = await getSecret(ctx, SECRET.binanceKey);
    const bnSecret = await getSecret(ctx, SECRET.binanceSecret);
    if (bnKey && bnSecret) {
      const bn = await binanceBalances(bnKey, bnSecret);
      if (bn)
        for (const [k, val] of Object.entries(bn))
          byExchange.binance[k] = (byExchange.binance[k] ?? 0) + val;
      else errors.push("binance: balance fetch failed (key/permission?)");
    } else errors.push("binance: API key/secret missing in vault");

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

/**
 * refreshMargin — READ-ONLY Binance margin/futures tracker (Phase 16).
 * Pulls ALL leveraged surfaces — isolated margin + cross margin + USDⓂ futures
 * + COINⓂ futures — signs each with HMAC-SHA256 (ported from aria/lib/finance.js),
 * converts USD-denominated PnL/equity → GBP, and REPLACES the marginPositions
 * table wholesale (so closed positions never linger). Net equity rolls into net
 * worth via the synthetic "margin" category in _recordLive/_recordSnapshot/getWealth.
 *
 * NEVER fabricates: an empty/zero account → empty table → UI empty-state. Each
 * surface that the API rejects is reported by name (no faking).
 */
export const refreshMargin = action({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    count: number;
    totalUPnlGbp: number;
    netEquityGbp: number;
    errors: string[];
  }> => {
    const errors: string[] = [];
    const bnKey = await getSecret(ctx, SECRET.binanceKey);
    const bnSecret = await getSecret(ctx, SECRET.binanceSecret);
    if (!bnKey || !bnSecret) {
      errors.push("binance: API key/secret missing in vault");
      return { count: 0, totalUPnlGbp: 0, netEquityGbp: 0, errors };
    }
    const usdToGbp = await fxToGBP("USD");
    if (usdToGbp === null) {
      errors.push("FX USD→GBP unavailable — cannot value margin (skipped)");
      return { count: 0, totalUPnlGbp: 0, netEquityGbp: 0, errors };
    }
    const report = { errors };
    const positions = await binanceMarginPositions(
      bnKey,
      bnSecret,
      usdToGbp,
      report,
    );
    await ctx.runMutation(internal.wealth._replaceMarginPositions, {
      exchange: "binance",
      positions,
    });
    let totalUPnlGbp = 0;
    let netEquityGbp = 0;
    for (const p of positions) {
      totalUPnlGbp += p.uPnlGbp;
      netEquityGbp += p.netEquityGbp;
    }
    return { count: positions.length, totalUPnlGbp, netEquityGbp, errors };
  },
});

/** Internal cron alias for refreshMargin (cronJobs require internal refs). */
export const refreshMarginCron = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    try {
      await ctx.runAction(api.wealthActions.refreshMargin, {});
    } catch (e) {
      console.warn("wealth.refreshMarginCron failed", e);
    }
  },
});

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
    // Phase 16: refresh margin so the DAILY snapshot's "margin" category matches
    // the live total (best-effort — never blocks the snapshot).
    try {
      await ctx.runAction(api.wealthActions.refreshMargin, {});
    } catch (e) {
      console.warn("wealth.snapshot: margin refresh failed, using cached", e);
    }
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
    // Phase 16: refresh Binance margin/futures so the live total + the synthetic
    // "margin" category reflect current net equity (resilient — keeps last table
    // contents on failure since _replaceMarginPositions only runs on success).
    try {
      await ctx.runAction(api.wealthActions.refreshMargin, {});
    } catch (e) {
      console.warn("wealth.refreshLive: margin refresh failed, using cached", e);
    }
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
