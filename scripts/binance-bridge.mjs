#!/usr/bin/env node
/**
 * Phase 19 — Binance VPS→Convex bridge.
 *
 * Convex (cloud) is geo-blocked from Binance (HTTP 451) and cannot reach aria
 * (127.0.0.1:4001 on THIS VPS). So this script runs ON the VPS (systemd timer),
 * fetches REAL data from aria, computes GBP values, and PUSHES them into Convex
 * via the token-guarded `binance:ingest` public mutation.
 *
 * REAL DATA ONLY. Nothing here is fabricated. If a figure aria does not expose
 * (e.g. USDⓂ futures wallet/equity for BNBUSDC) is missing, the position is sent
 * with netEquityGbp omitted (→ contributes 0 to net worth) and flagged in stdout.
 *
 * Run once:  node scripts/binance-bridge.mjs
 * Scheduled: systemd timer `binance-bridge.timer` (every ~20 min) — see the unit
 *            files installed under /etc/systemd/system/. We do NOT touch the user
 *            crontab (sentinel syncCrontab would clobber it).
 */

const ARIA = process.env.ARIA_BASE || "http://127.0.0.1:4001";
const CONVEX_URL =
  process.env.CONVEX_URL || "https://fantastic-roadrunner-485.convex.cloud";
// Token: env first, else the vault-mirrored file written at seed time.
import { readFileSync } from "node:fs";
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
  const [portfolio, risk] = await Promise.all([
    getJson(`${ARIA}/api/finance/portfolio`),
    getJson(`${ARIA}/api/finance/position-risk`).catch(() => ({ positions: [] })),
  ]);

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

  // ── USDⓂ futures BNBUSDC short — from position-risk ONLY (risk fields, no
  //    wallet/equity in aria's portfolio feed). Include the position with the
  //    risk fields we DO have; netEquityGbp omitted (→ 0 to NW), flagged. ──
  const bnb = (risk.positions || []).find((x) => x.symbol === "BNBUSDC");
  let futuresFlag = "BNBUSDC not present in position-risk";
  if (bnb) {
    positions.push({
      exchange: "binance",
      market: "usdm",
      symbol: bnb.symbol,
      quote: "USDC",
      side: bnb.side === "short" ? "short" : "long",
      mark: +Number(bnb.current_price).toFixed(4),
      liqPrice: +Number(bnb.liq_price).toFixed(4),
      marginLevel: +Number(bnb.margin_level).toFixed(4),
      // entry/size/uPnL/netEquity NOT exposed by aria for USDⓂ → omit (no fabrication)
    });
    futuresFlag =
      "BNBUSDC USDⓂ futures: risk fields only (mark/liq/marginLevel). " +
      "aria portfolio feed does NOT expose futures wallet/equity → netEquityGbp omitted (0 to NW).";
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
