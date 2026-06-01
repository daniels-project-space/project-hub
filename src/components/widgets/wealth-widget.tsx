"use client";

/**
 * Wealth / Net Worth widget (Wave 1 · centerpiece).
 *
 * - Headline net-worth card (tabular GBP) + inline sparkline + range pills
 *   (1W/1M/3M/1Y) + £/% toggle + delta badge + privacy/eye toggle.
 * - Category breakdown tiles (crypto/stocks/gold/cash/property/inventory) with
 *   value + % of NW + per-tile staleness.
 * - Live-prices mini-card (key holdings + spot).
 * - History overlay (large centered Sheet): rich net-worth chart (gridlines,
 *   value axis, date axis, end-dot) + 1W/1M/3M/1Y + £/% + min/max/delta stats
 *   + category breakdown — v1's "expand into larger widget" feel.
 * - Edit mode (gear): add/edit/remove MANUAL assets + manual-refresh button.
 * - EVERY value shows an "updated Xm ago" staleness badge (fix v1's #1 sin).
 */

import { useMemo, useState } from "react";
import {
  Wallet,
  Eye,
  EyeOff,
  Settings,
  RefreshCw,
  LineChart,
  Plus,
  Trash2,
  X,
  Pencil,
  Check,
} from "lucide-react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { WidgetSlot } from "../widget-slot";
import { Card } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { MiniChart } from "@/components/ui/mini-chart";
import { Sheet } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { agoLabel, stalenessTone, gbp, pct, type Tone } from "@/lib/staleness";

const CATEGORIES = [
  "crypto",
  "stocks",
  "gold",
  "cash",
  "property",
  "inventory",
] as const;
type Category = (typeof CATEGORIES)[number];

const CATEGORY_TONE: Record<Category, Tone> = {
  crypto: "brass",
  stocks: "emerald",
  gold: "amber",
  cash: "default",
  property: "default",
  inventory: "default",
};

const CATEGORY_LABEL: Record<Category, string> = {
  crypto: "Crypto",
  stocks: "Stocks / ETF",
  gold: "Gold",
  cash: "Cash",
  property: "Property",
  inventory: "Inventory",
};

const RANGES = ["1W", "1M", "3M", "1Y"] as const;
type Range = (typeof RANGES)[number];

function StaleBadge({ pricedAt }: { pricedAt: number | null | undefined }) {
  return <Badge tone={stalenessTone(pricedAt)}>upd {agoLabel(pricedAt)}</Badge>;
}

function fmtK(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1000) return `£${(n / 1000).toFixed(1)}k`;
  return `£${Math.round(n)}`;
}

// USD companion line — mirrors v1's fmtUSD ($ prefix, rounded ≥100, else 2dp).
// usdPerGbp = USD per 1 GBP (Phase A's getWealth.usdPerGbp), so USD = gbp * rate.
function usd(
  gbpVal: number | null | undefined,
  usdPerGbp: number | null | undefined,
  hidden = false,
): string {
  if (hidden) return "≈ $••••";
  if (usdPerGbp == null || gbpVal == null) return "";
  const v = gbpVal * usdPerGbp;
  const n =
    Math.abs(v) >= 100
      ? "$" + Math.round(v).toLocaleString("en-US")
      : "$" + v.toFixed(2);
  return `≈ ${n}`;
}

// Per-category trajectory from snapshot history (byCategory = Record<cat,total>).
// Returns the series + GBP/% delta over the selected range, mirroring the
// headline spark/delta pattern so every tile reads identically.
function categorySeries(
  history: { byCategory?: Record<string, number> | null }[] | undefined,
  cat: string,
): { data: number[]; delta: number; deltaPct: number } {
  const rows = history ?? [];
  const data = rows.map((r) => (r.byCategory?.[cat] ?? 0) as number);
  if (data.length < 2) return { data, delta: 0, deltaPct: 0 };
  const first = data[0];
  const last = data[data.length - 1];
  return {
    data,
    delta: last - first,
    deltaPct: first ? ((last - first) / first) * 100 : 0,
  };
}

// Compact ±% delta badge for a tile (emerald up / rose down) — same visual
// language as the headline badge (wealth-widget headline ~190).
function DeltaBadge({
  delta,
  deltaPct,
}: {
  delta: number;
  deltaPct: number;
}) {
  if (!delta) return null;
  const up = delta >= 0;
  return (
    <Badge tone={up ? "emerald" : "rose"}>
      {up ? "▲" : "▼"} {up ? "+" : ""}
      {deltaPct.toFixed(1)}%
    </Badge>
  );
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function WealthWidget() {
  const wealth = useQuery(api.wealth.getWealth);
  const prices = useQuery(api.wealth.getLivePrices);

  const [hidden, setHidden] = useState(false);
  const [editing, setEditing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // When set, the history overlay opens focused on a single category's series.
  const [drillCat, setDrillCat] = useState<Category | null>(null);
  // Range + value/percent mode are shared between the compact card and the
  // history overlay (v1 syncs the card pills with the overlay).
  const [range, setRange] = useState<Range>("1M");
  const [mode, setMode] = useState<"gbp" | "pct">("gbp");

  const cardHistory = useQuery(api.wealth.getHistory, { range });

  const loading = wealth === undefined;
  // Drive the headline from the FRESH intraday total (Phase A `currentTotalGBP`
  // / `live`) so it never shows a once/day figure; fall back to summed assets.
  const total = wealth?.currentTotalGBP ?? wealth?.totalGBP ?? 0;
  const totalTs = wealth?.currentTotalTs ?? wealth?.oldestPricedAt;
  // Dual-currency: USD per 1 GBP (live doc's rate preferred, else persisted FX).
  const usdPerGbp = wealth?.live?.usdPerGbp ?? wealth?.usdPerGbp ?? null;
  const byCategory = wealth?.byCategory ?? {};
  // Fresh per-category totals from the live doc (Record<cat,total>) when present.
  const liveByCat = (wealth?.live?.byCategory ?? null) as
    | Record<string, number>
    | null;

  const openDrill = (cat: Category) => {
    setDrillCat(cat);
    setHistoryOpen(true);
  };

  const spark = useMemo(() => {
    const rows = cardHistory ?? [];
    if (rows.length === 0) return { data: [] as number[], delta: 0, deltaPct: 0 };
    const first = rows[0].totalGBP;
    const last = rows[rows.length - 1].totalGBP;
    return {
      data: rows.map((r: { totalGBP: number }) => r.totalGBP),
      delta: last - first,
      deltaPct: first ? ((last - first) / first) * 100 : 0,
    };
  }, [cardHistory]);

  const up = spark.delta >= 0;

  return (
    <WidgetSlot
      size="wide"
      label="Net Worth"
      status={
        wealth?.oldestPricedAt ? `oldest ${agoLabel(wealth.oldestPricedAt)}` : undefined
      }
      action={
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label={hidden ? "Show amounts" : "Hide amounts"}
            onClick={() => setHidden((h) => !h)}
            className="p-1 rounded text-paper-faint hover:text-paper"
          >
            {hidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
          <button
            type="button"
            aria-label="History"
            onClick={() => setHistoryOpen(true)}
            className="p-1 rounded text-paper-faint hover:text-paper"
          >
            <LineChart className="w-4 h-4" />
          </button>
          <button
            type="button"
            aria-label="Edit assets"
            onClick={() => setEditing(true)}
            className="p-1 rounded text-paper-faint hover:text-paper"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      }
    >
      <div className="p-4 space-y-4">
        {loading ? (
          <EmptyState
            icon={<Wallet className="w-6 h-6" />}
            title="Loading net worth…"
            hint="Pulling assets + live prices"
          />
        ) : (
          <>
            {/* Headline card — value + delta + inline sparkline behind it,
                with in-card range pills + £/% toggle (v1 parity). */}
            <Card
              className="relative overflow-hidden cursor-pointer"
              onClick={() => setHistoryOpen(true)}
            >
              {/* sparkline ghost behind the number */}
              {spark.data.length > 1 && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 opacity-50">
                  <MiniChart
                    data={spark.data}
                    width={640}
                    height={80}
                    className="w-full h-full"
                    strokeColor={up ? "var(--color-emerald-soft)" : "var(--color-rose-soft)"}
                    endDot
                  />
                </div>
              )}
              <div className="relative flex items-start justify-between">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-paper-faint">
                    Total Net Worth
                  </p>
                  <p className="mt-1 font-display italic font-light text-[40px] leading-none tabular-nums text-paper">
                    {gbp(total, hidden)}
                  </p>
                  {/* USD companion line (v1 dual-currency treatment) */}
                  {usdPerGbp != null && (
                    <p className="mt-0.5 font-mono text-[12px] tabular-nums text-paper-faint">
                      {usd(total, usdPerGbp, hidden)}
                    </p>
                  )}
                  <p className="mt-2 flex items-center gap-2">
                    <Badge tone={up ? "emerald" : "rose"}>
                      {up ? "▲" : "▼"} {up ? "+" : ""}
                      {mode === "gbp"
                        ? gbp(spark.delta, hidden)
                        : `${spark.deltaPct.toFixed(1)}%`}
                    </Badge>
                    <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-paper-faint">
                      {range}
                    </span>
                  </p>
                </div>
                <StaleBadge pricedAt={totalTs} />
              </div>

              {/* in-card range pills + £/% toggle */}
              <div
                className="relative mt-3 flex items-center justify-between"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex gap-1">
                  {RANGES.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRange(r)}
                      className={`px-2 py-0.5 rounded font-mono text-[9px] uppercase tracking-[0.18em] transition-colors ${
                        range === r
                          ? "bg-brass/25 text-brass"
                          : "text-paper-faint hover:text-paper"
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setMode((m) => (m === "gbp" ? "pct" : "gbp"))}
                  className="px-2 py-0.5 rounded font-mono text-[9px] uppercase tracking-[0.18em] bg-ink-3/60 text-paper-dim hover:text-paper"
                >
                  {mode === "gbp" ? "£" : "%"}
                </button>
              </div>
            </Card>

            {/* Category breakdown — each tile: live GBP+USD value, per-category
                sparkline, ±% delta badge, click-to-drill into the chart. */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
              {CATEGORIES.map((cat) => {
                const bucket = byCategory[cat];
                // Prefer the fresh live per-category total over summed assets.
                const val = liveByCat?.[cat] ?? bucket?.total ?? 0;
                const oldest = bucket?.assets?.reduce<number | null>(
                  (m: number | null, a: { lastPricedAt?: number | null }) =>
                    a.lastPricedAt == null
                      ? m
                      : m == null
                        ? a.lastPricedAt
                        : Math.min(m, a.lastPricedAt),
                  null,
                );
                const series = categorySeries(cardHistory, cat);
                // Editable stocks: find the manual stocks asset row (v1 "IBKR").
                const stocksAsset =
                  cat === "stocks"
                    ? bucket?.assets?.find(
                        (a: { source?: string }) => a.source === "manual",
                      )
                    : undefined;
                return (
                  <StatTile
                    key={cat}
                    label={CATEGORY_LABEL[cat]}
                    tone={CATEGORY_TONE[cat]}
                    value={gbp(val, hidden)}
                    chart={series.data}
                    onClick={() => openDrill(cat)}
                    badge={
                      <DeltaBadge delta={series.delta} deltaPct={series.deltaPct} />
                    }
                    sub={
                      <span className="flex flex-col gap-0.5">
                        {usdPerGbp != null && (
                          <span className="tabular-nums text-paper-dim">
                            {usd(val, usdPerGbp, hidden)}
                          </span>
                        )}
                        <span className="flex items-center gap-1.5">
                          <span>{pct(val, total)} of NW</span>
                          <StaleBadge pricedAt={oldest} />
                          {stocksAsset && (
                            <EditStocksButton asset={stocksAsset} />
                          )}
                        </span>
                      </span>
                    }
                  />
                );
              })}
            </div>

            {/* Live prices — tidy vertical list (v1 "Live · Markets"). */}
            {prices && prices.length > 0 && (
              <Card>
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-paper-faint mb-2">
                  Live Prices
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
                  {prices.slice(0, 10).map(
                    (p: { symbol: string; gbp: number; ts: number }) => (
                    <div
                      key={p.symbol}
                      className="flex items-center justify-between border-b border-rule-soft/30 pb-1.5"
                    >
                      <span className="font-mono text-[11px] text-paper-dim tracking-wide">
                        {p.symbol}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-[12px] tabular-nums text-paper">
                          {hidden ? "••" : gbp(p.gbp)}
                        </span>
                        <Badge tone={stalenessTone(p.ts)}>{agoLabel(p.ts)}</Badge>
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </>
        )}
      </div>

      <HistorySheet
        open={historyOpen}
        onClose={() => {
          setHistoryOpen(false);
          setDrillCat(null);
        }}
        hidden={hidden}
        range={range}
        setRange={setRange}
        mode={mode}
        setMode={setMode}
        focusCat={drillCat}
        setFocusCat={setDrillCat}
        usdPerGbp={usdPerGbp}
      />
      <EditSheet open={editing} onClose={() => setEditing(false)} />
    </WidgetSlot>
  );
}

// ─── History overlay (large detail view) ─────────────────────────────────────

function HistorySheet({
  open,
  onClose,
  hidden,
  range,
  setRange,
  mode,
  setMode,
  focusCat,
  setFocusCat,
  usdPerGbp,
}: {
  open: boolean;
  onClose: () => void;
  hidden: boolean;
  range: Range;
  setRange: (r: Range) => void;
  mode: "gbp" | "pct";
  setMode: (m: "gbp" | "pct") => void;
  /** When set, the overlay charts a single category's trajectory. */
  focusCat: Category | null;
  setFocusCat: (c: Category | null) => void;
  usdPerGbp: number | null;
}) {
  const history = useQuery(api.wealth.getHistory, open ? { range } : "skip");
  const wealth = useQuery(api.wealth.getWealth, open ? {} : "skip");

  const series = useMemo(() => {
    const rows = (history ?? []) as {
      ts: number;
      totalGBP: number;
      byCategory?: Record<string, number> | null;
    }[];
    if (rows.length === 0)
      return { data: [] as number[], labels: [] as string[], first: 0, last: 0, min: 0, max: 0, delta: 0, deltaPct: 0 };
    // Source values: a single category's series when drilled-in, else the total.
    const valOf = (r: (typeof rows)[number]) =>
      focusCat ? (r.byCategory?.[focusCat] ?? 0) : r.totalGBP;
    const totals = rows.map(valOf);
    const first = totals[0];
    const last = totals[totals.length - 1];
    const data =
      mode === "gbp" ? totals : totals.map((t) => (first ? ((t - first) / first) * 100 : 0));
    return {
      data,
      labels: rows.map((r) => fmtDate(r.ts)),
      first,
      last,
      min: Math.min(...totals),
      max: Math.max(...totals),
      delta: last - first,
      deltaPct: first ? ((last - first) / first) * 100 : 0,
    };
  }, [history, mode, focusCat]);

  const up = series.delta >= 0;
  const byCategory = wealth?.byCategory ?? {};
  const total = wealth?.totalGBP ?? 0;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={
        focusCat
          ? `${CATEGORY_LABEL[focusCat]} · Trajectory`
          : "Net Worth · Portfolio Trajectory"
      }
      side="center"
      className="max-w-3xl w-[min(94vw,760px)]"
    >
      <div className="space-y-5">
        {/* header: big value + delta */}
        <div className="flex items-end justify-between">
          <div>
            <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-paper-faint">
              {focusCat ? (
                <>
                  <button
                    type="button"
                    onClick={() => setFocusCat(null)}
                    className="rounded px-1.5 py-0.5 bg-ink-3/60 text-paper-dim hover:text-paper normal-case tracking-normal"
                  >
                    ← All
                  </button>
                  <span>{CATEGORY_LABEL[focusCat]}</span>
                </>
              ) : (
                "Net Worth · History"
              )}
            </p>
            <p className="mt-1 font-display italic font-light text-[44px] leading-none tabular-nums text-paper">
              {mode === "gbp"
                ? gbp(series.last || total, hidden)
                : `${series.data.at(-1)?.toFixed(1) ?? "0"}%`}
            </p>
            {mode === "gbp" && usdPerGbp != null && (
              <p className="mt-0.5 font-mono text-[12px] tabular-nums text-paper-faint">
                {usd(series.last || total, usdPerGbp, hidden)}
              </p>
            )}
            <p className="mt-1 font-mono text-[10px] text-paper-faint">
              {series.data.length} data points · {range}
            </p>
          </div>
          <Badge tone={up ? "emerald" : "rose"} className="text-[11px] px-2.5 py-1">
            {up ? "▲" : "▼"} {up ? "+" : ""}
            {mode === "gbp" ? gbp(series.delta, hidden) : `${series.deltaPct.toFixed(1)}%`}
          </Badge>
        </div>

        {/* controls */}
        <div className="flex items-center justify-between">
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={`px-3 py-1 rounded font-mono text-[10px] uppercase tracking-[0.18em] transition-colors ${
                  range === r ? "bg-brass/25 text-brass" : "text-paper-faint hover:text-paper"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setMode(mode === "gbp" ? "pct" : "gbp")}
            className="px-3 py-1 rounded font-mono text-[10px] uppercase tracking-[0.18em] bg-ink-3/60 text-paper-dim hover:text-paper"
          >
            {mode === "gbp" ? "£" : "%"}
          </button>
        </div>

        {/* big chart */}
        {history === undefined ? (
          <p className="font-mono text-[10px] text-paper-faint py-16 text-center">Loading…</p>
        ) : series.data.length === 0 ? (
          <EmptyState title="No snapshots yet" hint="Daily cron records one per day" />
        ) : (
          <>
            <Card className="p-3">
              <MiniChart
                data={series.data}
                labels={series.labels}
                width={680}
                height={300}
                className="w-full"
                axis
                endDot
                strokeColor="var(--color-brass)"
                valueFormat={
                  mode === "gbp" ? (v) => fmtK(v) : (v) => `${v.toFixed(0)}%`
                }
              />
            </Card>

            {/* min / max / delta stat row */}
            <div className="grid grid-cols-3 gap-2.5">
              <StatTile label="Low" value={gbp(series.min, hidden)} tone="rose" />
              <StatTile label="High" value={gbp(series.max, hidden)} tone="emerald" />
              <StatTile
                label="Change"
                value={(up ? "+" : "") + gbp(series.delta, hidden)}
                tone={up ? "emerald" : "rose"}
                sub={<span>{series.deltaPct.toFixed(1)}% over {range}</span>}
              />
            </div>

            {/* category breakdown */}
            {total > 0 && (
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-paper-faint mb-2">
                  Breakdown
                </p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
                  {CATEGORIES.map((cat) => {
                    const val = byCategory[cat]?.total ?? 0;
                    const cs = categorySeries(history, cat);
                    return (
                      <StatTile
                        key={cat}
                        label={CATEGORY_LABEL[cat]}
                        tone={CATEGORY_TONE[cat]}
                        value={gbp(val, hidden)}
                        chart={cs.data}
                        onClick={() => setFocusCat(cat)}
                        badge={<DeltaBadge delta={cs.delta} deltaPct={cs.deltaPct} />}
                        sub={
                          <span className="flex flex-col gap-0.5">
                            {usdPerGbp != null && (
                              <span className="tabular-nums text-paper-dim">
                                {usd(val, usdPerGbp, hidden)}
                              </span>
                            )}
                            <span>{pct(val, total)} of NW</span>
                          </span>
                        }
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}

// ─── Edit mode ───────────────────────────────────────────────────────────────

const BLANK = {
  category: "cash" as Category,
  label: "",
  quantity: "",
  balanceNative: "",
  currency: "GBP",
  externalRef: "",
  lastValueGBP: "",
};

function EditSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const wealth = useQuery(api.wealth.getWealth, open ? {} : "skip");
  const upsert = useMutation(api.wealth.upsertAsset);
  const remove = useMutation(api.wealth.removeAsset);
  const refreshAll = useAction(api.wealthActions.refreshAll);

  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);

  const manualAssets = useMemo(() => {
    const out: any[] = [];
    const bc = wealth?.byCategory ?? {};
    for (const cat of Object.keys(bc)) {
      for (const a of bc[cat].assets) if (a.source === "manual") out.push(a);
    }
    return out;
  }, [wealth]);

  const num = (s: string) => (s.trim() === "" ? undefined : Number(s));

  const submit = async () => {
    if (!form.label.trim()) return;
    await upsert({
      category: form.category,
      label: form.label.trim(),
      quantity: num(form.quantity),
      balanceNative: num(form.balanceNative),
      currency: form.currency || "GBP",
      externalRef: form.externalRef.trim() || undefined,
      lastValueGBP: num(form.lastValueGBP),
    });
    setForm(BLANK);
  };

  return (
    <Sheet open={open} onClose={onClose} title="Edit Assets" side="right">
      <div className="space-y-4 w-[min(92vw,440px)]">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await refreshAll({});
            } finally {
              setBusy(false);
            }
          }}
          className="flex items-center gap-2 px-3 py-1.5 rounded bg-brass/20 text-brass font-mono text-[10px] uppercase tracking-[0.18em] disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} />
          {busy ? "Refreshing…" : "Refresh prices now"}
        </button>

        {/* Add / edit form */}
        <Card className="space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-paper-faint flex items-center gap-1.5">
            <Plus className="w-3 h-3" /> Add manual asset
          </p>
          <div className="grid grid-cols-2 gap-2">
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value as Category })}
              className="bg-ink-2/80 border border-rule-soft/60 rounded px-2 py-1 text-[12px] text-paper"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
            <input
              placeholder="Label (e.g. AAPL, House)"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              className="bg-ink-2/80 border border-rule-soft/60 rounded px-2 py-1 text-[12px] text-paper"
            />
            <input
              placeholder="Quantity (stocks/gold)"
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })}
              className="bg-ink-2/80 border border-rule-soft/60 rounded px-2 py-1 text-[12px] text-paper"
            />
            <input
              placeholder="Balance (cash)"
              value={form.balanceNative}
              onChange={(e) => setForm({ ...form, balanceNative: e.target.value })}
              className="bg-ink-2/80 border border-rule-soft/60 rounded px-2 py-1 text-[12px] text-paper"
            />
            <input
              placeholder="Currency (GBP)"
              value={form.currency}
              onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
              className="bg-ink-2/80 border border-rule-soft/60 rounded px-2 py-1 text-[12px] text-paper"
            />
            <input
              placeholder="Symbol / ref (stocks)"
              value={form.externalRef}
              onChange={(e) => setForm({ ...form, externalRef: e.target.value })}
              className="bg-ink-2/80 border border-rule-soft/60 rounded px-2 py-1 text-[12px] text-paper"
            />
            <input
              placeholder="Direct GBP value (property/inventory)"
              value={form.lastValueGBP}
              onChange={(e) => setForm({ ...form, lastValueGBP: e.target.value })}
              className="col-span-2 bg-ink-2/80 border border-rule-soft/60 rounded px-2 py-1 text-[12px] text-paper"
            />
          </div>
          <button
            type="button"
            onClick={submit}
            className="px-3 py-1.5 rounded bg-emerald-soft/20 text-emerald-soft font-mono text-[10px] uppercase tracking-[0.18em]"
          >
            Save asset
          </button>
        </Card>

        {/* Existing manual assets */}
        <div className="space-y-1.5">
          {manualAssets.length === 0 ? (
            <p className="font-mono text-[10px] text-paper-faint">No manual assets yet.</p>
          ) : (
            manualAssets.map((a) => (
              <div
                key={a._id}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded border border-rule-soft/50"
              >
                <div className="min-w-0">
                  <p className="text-[13px] text-paper truncate">
                    {a.label}{" "}
                    <span className="font-mono text-[9px] uppercase text-paper-faint">
                      {a.category}
                    </span>
                  </p>
                  <p className="font-mono text-[10px] text-paper-faint flex items-center gap-1.5">
                    {gbp(a.lastValueGBP)} <StaleBadge pricedAt={a.lastPricedAt} />
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${a.label}`}
                  onClick={() => remove({ id: a._id })}
                  className="p-1 rounded text-paper-faint hover:text-rose-soft"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
        </div>

        <p className="font-mono text-[9px] text-paper-faint leading-relaxed">
          Inventory & property are manual figures you set here — not hardcoded.
          Stocks need a symbol in &quot;Symbol / ref&quot; + a Finnhub key to auto-price; without
          a key, set a Direct GBP value.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint"
        >
          <X className="w-3.5 h-3.5" /> Close
        </button>
      </div>
    </Sheet>
  );
}

// ─── Inline-editable manual stocks value ─────────────────────────────────────
// Per Daniel: stocks stays MANUAL (no live quote) but the £ figure is editable
// straight from the tile. A pencil reveals a tiny GBP input → `setManualAssetValue`.

function EditStocksButton({
  asset,
}: {
  asset: { label: string; category: string; lastValueGBP: number | null };
}) {
  const setValue = useMutation(api.wealth.setManualAssetValue);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const begin = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft(asset.lastValueGBP != null ? String(Math.round(asset.lastValueGBP)) : "");
    setOpen(true);
  };

  const save = async (e?: React.MouseEvent | React.FormEvent) => {
    e?.stopPropagation();
    const n = Number(draft);
    if (!Number.isFinite(n)) {
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      await setValue({ label: asset.label, valueGBP: n, category: "stocks" });
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        aria-label={`Edit ${asset.label} value`}
        onClick={begin}
        className="p-0.5 rounded text-paper-faint hover:text-brass"
      >
        <Pencil className="w-3 h-3" />
      </button>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1"
      onClick={(e) => e.stopPropagation()}
    >
      <span className="text-paper-faint">£</span>
      <input
        autoFocus
        type="number"
        value={draft}
        disabled={busy}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void save();
          if (e.key === "Escape") setOpen(false);
        }}
        className="w-16 bg-ink-2/80 border border-rule-soft/60 rounded px-1 py-0.5 text-[11px] tabular-nums text-paper"
      />
      <button
        type="button"
        aria-label="Save value"
        disabled={busy}
        onClick={save}
        className="p-0.5 rounded text-emerald-soft hover:text-paper disabled:opacity-50"
      >
        <Check className="w-3 h-3" />
      </button>
    </span>
  );
}
