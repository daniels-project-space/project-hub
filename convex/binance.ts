/**
 * Phase 19 — Binance bridge entry module.
 *
 * The VPS bridge POSTs to the Convex HTTP API path `binance:ingest`, which
 * Convex resolves as module `binance.ts` → export `ingest`. The implementation
 * lives in `wealth.ts` (alongside the wealth tables / live-doc helpers it must
 * touch); this module simply re-exports it under the `binance:` namespace so the
 * documented `binance:ingest` path resolves.
 */
export { ingest } from "./wealth";
