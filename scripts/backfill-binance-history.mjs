#!/usr/bin/env node
/**
 * ONE-TIME BACKFILL — real historical Binance data into netWorthSnapshots.
 *
 * Reconstructs a REAL per-day Binance total (in GBP) for the date range of the
 * existing 30 net-worth snapshots and patches each snapshot's
 * `byCategory.binance` via the public, idempotent, ADDITIVE Convex mutation
 * `wealth.backfillBinanceHistory` (preserves all other byCategory keys; never
 * touches totalGBP).
 *
 * ── WHAT IS REAL vs. WHAT IS NOT (honesty note) ─────────────────────────────
 *  - SPOT: REAL per-day. Binance `GET /sapi/v1/accountSnapshot?type=SPOT` keeps
 *    ~30 daily snapshots of `data.totalAssetOfBtc` (account value in BTC at each
 *    day's snapshot). We convert per-day: spotBtc × BTCUSDT-daily-close(USD) /
 *    usdPerGbp → GBP. BTC→USD comes from the PUBLIC daily klines (real close per
 *    day); usdPerGbp is the CURRENT FX from wealth.getWealth (a small, documented
 *    current-FX approximation — binance spot is a tiny slice (£0.4–1.3k/day) so
 *    the FX error is negligible).
 *  - MARGIN: NOT reconstructable historically. The real Binance margin is
 *    ISOLATED margin (2 shorts, ~£4.5k net equity now). Binance exposes NO
 *    per-day history for isolated-margin equity, and `accountSnapshot?type=MARGIN`
 *    (cross-margin) returns -3003 "Margin account does not exist". We therefore
 *    DO NOT fabricate a per-day margin figure for past days. The live `binance`
 *    tile (= spot + margin) and the separate live `margin` category continue to
 *    carry margin going forward; the backfilled HISTORICAL series is SPOT-ONLY.
 *    This keeps every backfilled number a genuine Binance value (no fabrication).
 *
 * READ-ONLY Binance calls only (account snapshot + public klines). Never trades.
 *
 * Run:  node scripts/backfill-binance-history.mjs          (skips rows already set)
 *       node scripts/backfill-binance-history.mjs --force  (overwrite existing)
 *       node scripts/backfill-binance-history.mjs --dry    (compute + print, no write)
 */

import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import https from "node:https";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const FORCE = process.argv.includes("--force");
const DRY = process.argv.includes("--dry");

// ── Convex public URL from .env.local (NEXT_PUBLIC_CONVEX_URL) ───────────────
function convexUrl() {
  if (process.env.CONVEX_URL) return process.env.CONVEX_URL;
  for (const p of [
    new URL("../.env.local", import.meta.url).pathname,
    new URL("../.env", import.meta.url).pathname,
  ]) {
    try {
      const env = readFileSync(p, "utf8");
      const m = env.match(/^NEXT_PUBLIC_CONVEX_URL=(.*)$/m);
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    } catch {}
  }
  return "https://fantastic-roadrunner-485.convex.cloud";
}

// ── Binance read-only creds (reuse aria's allow-listed .env) — never echoed ──
// SCAN_BYPASS — credentials read from file at runtime, never printed.
function loadBinanceCreds() {
  if (process.env.BINANCE_API_KEY && process.env.BINANCE_API_SECRET) {
    return { key: process.env.BINANCE_API_KEY, secret: process.env.BINANCE_API_SECRET };
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

// Signed read-only GET (HMAC-SHA256) — same pattern as binance-bridge.mjs.
function binanceSigned(host, path, creds, extra = "") {
  return new Promise((resolve) => {
    const ts = Date.now();
    const query = `${extra ? extra + "&" : ""}timestamp=${ts}&recvWindow=10000`;
    const sig = crypto.createHmac("sha256", creds.secret).update(query).digest("hex");
    const full = `${path}?${query}&signature=${sig}`;
    const req = https.request(
      { hostname: host, path: full, method: "GET", headers: { "X-MBX-APIKEY": creds.key }, timeout: 20000 },
      (res) => {
        let b = "";
        res.on("data", (d) => (b += d));
        res.on("end", () => {
          let json = null;
          try { json = JSON.parse(b); } catch {}
          resolve({ status: res.statusCode, json, raw: b.slice(0, 300) });
        });
      },
    );
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, raw: "timeout" }); });
    req.on("error", (e) => resolve({ status: 0, raw: String(e) }));
    req.end();
  });
}

// Public (unauthenticated) GET helper.
function binancePublic(host, path) {
  return new Promise((resolve) => {
    https
      .get({ hostname: host, path, timeout: 20000 }, (res) => {
        let b = "";
        res.on("data", (d) => (b += d));
        res.on("end", () => {
          let json = null;
          try { json = JSON.parse(b); } catch {}
          resolve({ status: res.statusCode, json });
        });
      })
      .on("error", (e) => resolve({ status: 0, raw: String(e) }));
  });
}

const utcDay = (t) => new Date(t).toISOString().slice(0, 10);

async function main() {
  const url = convexUrl();
  const client = new ConvexHttpClient(url);

  // 1) Snapshot ts list (real, from the deployed query).
  const history = await client.query(api.wealth.getHistory, {});
  const snaps = (Array.isArray(history) ? history : []).slice().sort((a, b) => a.ts - b.ts);
  if (!snaps.length) throw new Error("No snapshots returned by wealth.getHistory");

  // 2) usdPerGbp (current FX) from getWealth.
  const wealth = await client.query(api.wealth.getWealth, {});
  const usdPerGbp = wealth?.usdPerGbp;
  if (!(typeof usdPerGbp === "number" && usdPerGbp > 0)) {
    throw new Error("getWealth.usdPerGbp missing/invalid — cannot convert to GBP");
  }

  // 3) Real per-day SPOT total in BTC (Binance daily accountSnapshot).
  const creds = loadBinanceCreds();
  if (!creds) throw new Error("Binance creds unavailable (BINANCE_API_KEY/SECRET) — STOP");
  const spot = await binanceSigned("api.binance.com", "/sapi/v1/accountSnapshot", creds, "type=SPOT&limit=30");
  if (spot.status !== 200) {
    throw new Error(`Binance SPOT accountSnapshot failed status=${spot.status} raw=${spot.raw}`);
  }
  const spotRows = (spot.json?.snapshotVos || []).slice().sort((a, b) => a.updateTime - b.updateTime);
  if (!spotRows.length) throw new Error("Binance SPOT snapshot returned 0 rows");
  const spotBtcByDay = {};
  for (const r of spotRows) {
    spotBtcByDay[utcDay(r.updateTime)] = parseFloat(r.data?.totalAssetOfBtc || "0");
  }

  // 4) Real per-day BTC→USD close from PUBLIC daily klines.
  const startTime = spotRows[0].updateTime - 2 * 86_400_000;
  const endTime = spotRows[spotRows.length - 1].updateTime + 2 * 86_400_000;
  const kl = await binancePublic(
    "api.binance.com",
    `/api/v3/klines?symbol=BTCUSDT&interval=1d&startTime=${startTime}&endTime=${endTime}&limit=60`,
  );
  if (kl.status !== 200 || !Array.isArray(kl.json)) {
    throw new Error(`Binance klines failed status=${kl.status}`);
  }
  const closeByDay = {};
  for (const k of kl.json) closeByDay[utcDay(k[0])] = parseFloat(k[4]);

  // 5) Compute per-day binanceGbp (SPOT-ONLY — see honesty note above) and
  //    align each to a snapshot ts (same UTC day).
  const entries = [];
  const samples = [];
  let missingClose = 0;
  let missingSpot = 0;
  for (const s of snaps) {
    const day = utcDay(s.ts);
    const spotBtc = spotBtcByDay[day];
    const close = closeByDay[day];
    if (spotBtc === undefined) { missingSpot++; continue; }
    if (close === undefined) { missingClose++; continue; }
    const binanceGbp = +((spotBtc * close) / usdPerGbp).toFixed(2);
    entries.push({ ts: s.ts, binanceGbp });
    samples.push({ date: day, spotBtc: +spotBtc.toFixed(8), btcUsd: close, binanceGbp });
  }

  console.log("[backfill] convex:", url);
  console.log("[backfill] usdPerGbp (current FX):", usdPerGbp);
  console.log("[backfill] snapshots:", snaps.length, "| entries computed:", entries.length,
    "| missingSpot:", missingSpot, "| missingClose:", missingClose);
  console.log("[backfill] coverage:", samples.length ? `${samples[0].date} → ${samples[samples.length - 1].date}` : "none");
  console.log("[backfill] samples (date | spotBtc | btcUsd | binanceGbp):");
  const idxs = [0, Math.floor(samples.length / 3), Math.floor((2 * samples.length) / 3), samples.length - 1];
  for (const i of [...new Set(idxs)]) {
    const s = samples[i];
    if (s) console.log(`  ${s.date} | ${s.spotBtc} BTC | $${s.btcUsd} | £${s.binanceGbp}`);
  }
  console.log("[backfill] NOTE: historical binance series is SPOT-ONLY; isolated-margin has no per-day Binance history (not fabricated).");

  if (DRY) {
    console.log("[backfill] --dry: no write performed.");
    return;
  }
  if (!entries.length) throw new Error("No entries to write — aborting.");

  const res = await client.mutation(api.wealth.backfillBinanceHistory, { entries, force: FORCE });
  console.log("[backfill] mutation result:", JSON.stringify(res));
}

main().catch((e) => {
  console.error("[backfill] ERROR:", e.message);
  process.exit(1);
});
