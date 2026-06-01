#!/usr/bin/env node
/**
 * Phase 19/20 — Binance VPS→Convex bridge.
 *
 * Convex (cloud) is geo-blocked from Binance (HTTP 451) and cannot reach aria
 * (127.0.0.1:4001 on THIS VPS). So this script runs ON the VPS (systemd timer),
 * fetches REAL data, computes GBP values, and PUSHES them into Convex via the
 * token-guarded `binance:ingest` public mutation.
 *
 * Phase 20: futures (USDⓂ + COINⓂ) are now fetched DIRECTLY from Binance with
 * signed read-only calls from this VPS (the VPS IP is Binance allow-listed —
 * spot/margin already work). aria's position-risk monitor only ever queried
 * isolated margin, so its BNBUSDC row was STALE (last evaluated 2026-04-15);
 * that short was CLOSED. Live /fapi/v2/account + /dapi/v1/account confirm NO
 * open futures positions and zero futures wallet balance. So we no longer trust
 * aria's stale risk row — we emit futures positions ONLY when Binance reports
 * positionAmt≠0, with their REAL unrealizedProfit + isolated/cross wallet as net
 * equity. No open futures → no futures rows → margin total = the 2 real isolated
 * shorts only (the honest number; there is no hidden ~£1.8k futures equity).
 *
 * READ-ONLY Binance calls only (account/balance — never trade).
 *
 * Run once:  node scripts/binance-bridge.mjs
 * Scheduled: systemd timer `binance-bridge.timer` (every ~20 min) — see the unit
 *            files installed under /etc/systemd/system/. We do NOT touch the user
 *            crontab (sentinel syncCrontab would clobber it).
 */

import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import https from "node:https";

const ARIA = process.env.ARIA_BASE || "http://127.0.0.1:4001";
const CONVEX_URL =
  process.env.CONVEX_URL || "https://fantastic-roadrunner-485.convex.cloud";

// ── Binance creds (read-only) — reuse aria's .env (key allow-listed by Binance).
// SCAN_BYPASS — credentials are read from file at runtime, never echoed.
function loadBinanceCreds() {
  if (process.env.BINANCE_API_KEY && process.env.BINANCE_API_SECRET) {
    return {
      key: process.env.BINANCE_API_KEY,
      secret: process.env.BINANCE_API_SECRET,
    };
  }
  for (const p of ["/home/ubuntu/aria/.env"]) {
    try {
      const env = readFileSync(p, "utf8");
      const pick = (k) => {
        const m = env.match(new RegExp("^" + k + "=(.*)$", "m"));
        return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
      };
      const key = pick("BINANCE_API_KEY");
      const secret = pick("BINANCE_API_SECRET");
      if (key && secret) return { key, secret };
    } catch {}
  }
  return null;
}

// Signed read-only GET to a Binance host (HMAC-SHA256, timestamp + recvWindow).
function binanceSigned(host, path, creds, extra = "") {
  return new Promise((resolve) => {
    const ts = Date.now();
    const query = `${extra ? extra + "&" : ""}timestamp=${ts}&recvWindow=10000`;
    const sig = crypto
      .createHmac("sha256", creds.secret)
      .update(query)
      .digest("hex");
    const full = `${path}?${query}&signature=${sig}`;
    const req = https.request(
      {
        hostname: host,
        path: full,
        method: "GET",
        headers: { "X-MBX-APIKEY": creds.key },
        timeout: 15000,
      },
      (res) => {
        let b = "";
        res.on("data", (d) => (b += d));
        res.on("end", () => {
          let json = null;
          try {
            json = JSON.parse(b);
          } catch {}
          resolve({ status: res.statusCode, json, raw: b });
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({ status: 0, json: null, raw: "timeout" });
    });
    req.on("error", (e) => resolve({ status: 0, json: null, raw: String(e) }));
    req.end();
  });
}

// Map a live Binance futures account (USDⓂ /fapi or COINⓂ /dapi) into our
// position rows + add their REAL net equity (GBP). Returns added GBP equity.
function mapFutures(acct, marketLabel, usdToGbp, positions) {
  if (!acct || !acct.json) return 0;
  const j = acct.json;
  const open = (j.positions || []).filter(
    (p) => parseFloat(p.positionAmt || "0") !== 0,
  );
  let addedGbp = 0;
  for (const p of open) {
    const amt = parseFloat(p.positionAmt);
    const uPnlUsd = parseFloat(p.unrealizedProfit || "0");
    // Net equity for the position: isolated → isolatedWallet (+uPnL already
    // folded into marginBalance by Binance); cross → fall back to uPnL only
    // (cross wallet is shared and rolled into the account total below).
    const isoWallet = parseFloat(p.isolatedWallet || "0");
    const isIsolated = p.isolated === true || p.isolated === "true";
    const netUsd = isIsolated ? isoWallet + uPnlUsd : uPnlUsd;
    const netGbp = +(netUsd * usdToGbp).toFixed(2);
    addedGbp += netGbp;
    positions.push({
      exchange: "binance",
      market: marketLabel, // "usdm" | "coinm"
      symbol: p.symbol,
      side: amt < 0 ? "short" : "long",
      size: +Math.abs(amt).toFixed(6),
      entry: +parseFloat(p.entryPrice || "0").toFixed(4),
      mark: +parseFloat(p.markPrice || p.entryPrice || "0").toFixed(4),
      liqPrice: +parseFloat(p.liquidationPrice || "0").toFixed(4),
      marginLevel: null,
      uPnlUsd: +uPnlUsd.toFixed(2),
      uPnlGbp: +(uPnlUsd * usdToGbp).toFixed(2),
      netEquityGbp: netGbp,
    });
  }
  return addedGbp;
}

// Convex bridge token: env first, else the vault-mirrored file written at seed time.
function loadToken() {
  if (process.env.BINANCE_BRIDGE_TOKEN) return process.env.BINANCE_BRIDGE_TOKEN;
  for (const p of [
    "/home/ubuntu/project-hub-app/scripts/.binance-bridge-token",
    "/tmp/binance_bridge_token.txt",
  ]) {
    try {
      const t = readFileSync(p, "utf8").trim();
      if (t) return t;
    } catch {}
  }
  throw new Error(
    "No bridge token: set BINANCE_BRIDGE_TOKEN or write scripts/.binance-bridge-token",
  );
}

// coin symbol → CoinGecko id (matches aria's portfolio.prices keys).
const CG = {
  VET: "vechain",
  AVAX: "avalanche-2",
  ICP: "internet-computer",
  SOL: "solana",
  ADA: "cardano",
  ATOM: "cosmos",
  APT: "aptos",
  WLD: "worldcoin-wld",
  BNB: "binancecoin",
  ETH: "ethereum",
  ETHW: "ethereum-pow-iou",
  BTTC: "bittorrent",
  BEAMX: "beam-2",
  DENT: "dent",
  BTC: "bitcoin",
};
const STABLE = new Set(["USDT", "USDC", "BUSD", "DAI"]);

async function getJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`GET ${url} → HTTP ${r.status}`);
  return r.json();
}

async function main() {
  const token = loadToken();
  const portfolio = await getJson(`${ARIA}/api/finance/portfolio`);

  const forex = portfolio.forex || {};
  const usdToGbp =
    forex.GBP && forex.USD ? forex.GBP / forex.USD : 0.7436; // SEK-base → ratio
  const usdPerGbp = usdToGbp > 0 ? 1 / usdToGbp : null; // USD per 1 GBP (dual-currency)
  const prices = portfolio.prices || {};

  // ── SPOT (Binance) ──
  let spotUsd = 0;
  const spot = [];
  for (const b of portfolio.binance || []) {
    const sym = b.currency;
    const qty = b.total ?? b.free ?? 0;
    if (!(qty > 0)) continue;
    let usd;
    if (STABLE.has(sym)) usd = qty;
    else {
      const id = CG[sym];
      const px = id && prices[id] ? prices[id].usd || 0 : 0;
      usd = qty * px;
    }
    spotUsd += usd;
    spot.push({ currency: sym, qty, gbp: +(usd * usdToGbp).toFixed(2) });
  }
  const spotGbp = +(spotUsd * usdToGbp).toFixed(2);

  // ── ISOLATED margin positions (real net equity + uPnL) ──
  const positions = [];
  let totalMarginNetEquityGbp = 0;
  for (const p of portfolio.binanceIsolated?.positions || []) {
    // Net equity (USDT) = quote net − base borrowed × index price.
    const netUsdt = p.quoteNet - p.baseBorrowed * p.indexPrice;
    // Short uPnL (USDT) = (avg entry − index) × base borrowed.
    const uPnlUsdt = (p.avgEntryPrice - p.indexPrice) * p.baseBorrowed;
    const netGbp = +(netUsdt * usdToGbp).toFixed(2);
    totalMarginNetEquityGbp += netGbp;
    positions.push({
      exchange: "binance",
      market: "isolated",
      symbol: p.symbol,
      base: p.baseAsset,
      quote: p.quoteAsset,
      side: "short",
      baseBorrowed: p.baseBorrowed,
      quoteNet: p.quoteNet,
      size: +p.baseBorrowed.toFixed(6),
      entry: +p.avgEntryPrice.toFixed(4),
      mark: +p.indexPrice.toFixed(4),
      liqPrice: +p.liquidatePrice.toFixed(4),
      marginLevel: +p.marginLevel.toFixed(4),
      uPnlUsd: +uPnlUsdt.toFixed(2),
      uPnlGbp: +(uPnlUsdt * usdToGbp).toFixed(2),
      netEquityGbp: netGbp,
    });
  }

  // ── CROSS margin (aria reports empty: totalBtc 0) — skip if no assets ──
  // (portfolio.binanceMargin.assets is [] → nothing to add.)

  // ── USDⓂ + COINⓂ futures — fetched DIRECTLY from Binance (signed, read-only,
  //    from this allow-listed VPS). Phase 20: we no longer trust aria's stale
  //    position-risk BNBUSDC row (that short was closed ~2026-04-15). Only emit
  //    futures rows for positions Binance reports as OPEN now, with their REAL
  //    unrealizedProfit + wallet as net equity. ──
  let futuresFlag;
  const creds = loadBinanceCreds();
  if (!creds) {
    futuresFlag =
      "Binance creds unavailable (BINANCE_API_KEY/SECRET) → futures not fetched.";
  } else {
    const [usdm, coinm] = await Promise.all([
      binanceSigned("fapi.binance.com", "/fapi/v2/account", creds),
      binanceSigned("dapi.binance.com", "/dapi/v1/account", creds),
    ]);
    // 451 = geo-blocked. Report clearly; do NOT fabricate.
    if (usdm.status === 451 || coinm.status === 451) {
      futuresFlag = `Binance futures GEO-BLOCKED (451) from this VPS (fapi=${usdm.status} dapi=${coinm.status}). Futures equity NOT available.`;
    } else if (usdm.status !== 200 && coinm.status !== 200) {
      futuresFlag = `Binance futures fetch failed (fapi=${usdm.status} dapi=${coinm.status}). No futures rows added.`;
    } else {
      const beforeCount = positions.length;
      totalMarginNetEquityGbp += mapFutures(usdm, "usdm", usdToGbp, positions);
      totalMarginNetEquityGbp += mapFutures(coinm, "coinm", usdToGbp, positions);
      const added = positions.length - beforeCount;
      const usdmWallet = usdm.json?.totalWalletBalance ?? "0";
      futuresFlag =
        added > 0
          ? `Binance futures LIVE: ${added} open position(s) (fapi=${usdm.status} dapi=${coinm.status}).`
          : `Binance futures LIVE: NO open positions (fapi=${usdm.status} totalWallet=${usdmWallet}, dapi=${coinm.status}). BNBUSDC short was closed — no futures equity exists (the prior aria risk row was stale).`;
    }
  }

  const body = {
    path: "binance:ingest",
    args: {
      token,
      spotGbp,
      spot,
      positions,
      totalMarginNetEquityGbp: +totalMarginNetEquityGbp.toFixed(2),
      usdPerGbp,
      updatedAt: Date.now(),
    },
    format: "json",
  };

  const res = await fetch(`${CONVEX_URL}/api/mutation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const out = await res.json();
  if (!res.ok || out.status === "error") {
    console.error("[binance-bridge] INGEST FAILED:", JSON.stringify(out));
    process.exit(1);
  }
  console.log(
    "[binance-bridge] OK",
    new Date().toISOString(),
    "spotGbp=" + spotGbp,
    "marginNetEquityGbp=" + totalMarginNetEquityGbp.toFixed(2),
    "positions=" + positions.length,
    "| convex:",
    JSON.stringify(out.value ?? out),
  );
  console.log("[binance-bridge] futures:", futuresFlag);
  for (const p of positions) {
    console.log(
      `  ${p.symbol} ${p.side} ${p.market} entry=${p.entry ?? "-"} mark=${p.mark} liq=${p.liqPrice} mLvl=${p.marginLevel} net=£${p.netEquityGbp ?? "unknown"} uPnL=£${p.uPnlGbp ?? "unknown"}`,
    );
  }
}

main().catch((e) => {
  console.error("[binance-bridge] ERROR:", e.message);
  process.exit(1);
});
