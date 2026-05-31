"use client";

/**
 * Wealth / Net Worth widget (Wave 1 · centerpiece).
 *
 * - Headline net-worth card (tabular GBP) + privacy/eye toggle (hide £ → ••••).
 * - Category breakdown tiles (crypto/stocks/gold/cash/property/inventory) with
 *   value + % of NW + tone.
 * - Live-prices mini-card (key holdings + spot).
 * - History overlay (Sheet): MiniChart sparkline + 1W/1M/3M/1Y + £/% toggle.
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
} from "lucide-react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { WidgetSlot } from "../widget-slot";
import { Card } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { MiniChart } from "@/components/ui/mini-chart";
import { Sheet } from "@/components/ui/sheet";
import { Toggle } from "@/components/ui/toggle";
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

function StaleBadge({ pricedAt }: { pricedAt: number | null | undefined }) {
  return <Badge tone={stalenessTone(pricedAt)}>upd {agoLabel(pricedAt)}</Badge>;
}

export function WealthWidget() {
  const wealth = useQuery(api.wealth.getWealth);
  const prices = useQuery(api.wealth.getLivePrices);

  const [hidden, setHidden] = useState(false);
  const [editing, setEditing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const loading = wealth === undefined;
  const total = wealth?.totalGBP ?? 0;
  const byCategory = wealth?.byCategory ?? {};

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
            {/* Headline */}
            <Card className="flex items-end justify-between">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-paper-faint">
                  Total Net Worth
                </p>
                <p className="mt-1 font-display italic font-light text-[40px] leading-none tabular-nums text-paper">
                  {gbp(total, hidden)}
                </p>
              </div>
              <StaleBadge pricedAt={wealth?.oldestPricedAt} />
            </Card>

            {/* Category breakdown */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
              {CATEGORIES.map((cat) => {
                const bucket = byCategory[cat];
                const val = bucket?.total ?? 0;
                const oldest = bucket?.assets?.reduce<number | null>(
                  (m, a) =>
                    a.lastPricedAt == null
                      ? m
                      : m == null
                        ? a.lastPricedAt
                        : Math.min(m, a.lastPricedAt),
                  null,
                );
                return (
                  <StatTile
                    key={cat}
                    label={CATEGORY_LABEL[cat]}
                    tone={CATEGORY_TONE[cat]}
                    value={gbp(val, hidden)}
                    sub={
                      <span className="flex items-center gap-1.5">
                        <span>{pct(val, total)} of NW</span>
                        <StaleBadge pricedAt={oldest} />
                      </span>
                    }
                  />
                );
              })}
            </div>

            {/* Live prices */}
            {prices && prices.length > 0 && (
              <Card>
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-paper-faint mb-2">
                  Live Prices
                </p>
                <div className="flex flex-wrap gap-x-5 gap-y-1.5">
                  {prices.slice(0, 10).map((p) => (
                    <span
                      key={p.symbol}
                      className="flex items-baseline gap-1.5 font-mono text-[11px]"
                    >
                      <span className="text-paper-dim">{p.symbol}</span>
                      <span className="tabular-nums text-paper">
                        {hidden ? "••" : gbp(p.gbp)}
                      </span>
                      <Badge tone={stalenessTone(p.ts)}>{agoLabel(p.ts)}</Badge>
                    </span>
                  ))}
                </div>
              </Card>
            )}
          </>
        )}
      </div>

      <HistorySheet open={historyOpen} onClose={() => setHistoryOpen(false)} hidden={hidden} />
      <EditSheet open={editing} onClose={() => setEditing(false)} />
    </WidgetSlot>
  );
}

// ─── History overlay ─────────────────────────────────────────────────────────

function HistorySheet({
  open,
  onClose,
  hidden,
}: {
  open: boolean;
  onClose: () => void;
  hidden: boolean;
}) {
  const [range, setRange] = useState<(typeof RANGES)[number]>("1M");
  const [mode, setMode] = useState<"gbp" | "pct">("gbp");
  const history = useQuery(api.wealth.getHistory, open ? { range } : "skip");

  const series = useMemo(() => {
    const rows = history ?? [];
    if (rows.length === 0) return { data: [] as number[], first: 0, last: 0, delta: 0 };
    const first = rows[0].totalGBP;
    const last = rows[rows.length - 1].totalGBP;
    const data =
      mode === "gbp"
        ? rows.map((r) => r.totalGBP)
        : rows.map((r) => (first ? ((r.totalGBP - first) / first) * 100 : 0));
    return { data, first, last, delta: last - first };
  }, [history, mode]);

  return (
    <Sheet open={open} onClose={onClose} title="Net Worth History" side="right">
      <div className="p-5 space-y-4 w-[min(90vw,460px)]">
        <div className="flex items-center justify-between">
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={`px-2 py-1 rounded font-mono text-[10px] uppercase tracking-[0.18em] ${
                  range === r ? "bg-brass/25 text-brass" : "text-paper-faint hover:text-paper"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setMode((m) => (m === "gbp" ? "pct" : "gbp"))}
            className="px-2 py-1 rounded font-mono text-[10px] uppercase tracking-[0.18em] bg-ink-3/60 text-paper-dim"
          >
            {mode === "gbp" ? "£" : "%"}
          </button>
        </div>

        {history === undefined ? (
          <p className="font-mono text-[10px] text-paper-faint">Loading…</p>
        ) : series.data.length === 0 ? (
          <EmptyState title="No snapshots yet" hint="Daily cron records one per day" />
        ) : (
          <Card>
            <div className="flex items-baseline justify-between mb-3">
              <p className="font-display italic text-[28px] tabular-nums text-paper">
                {mode === "gbp" ? gbp(series.last, hidden) : `${series.data.at(-1)?.toFixed(1)}%`}
              </p>
              <Badge tone={series.delta >= 0 ? "emerald" : "rose"}>
                {series.delta >= 0 ? "+" : ""}
                {mode === "gbp" ? gbp(series.delta, hidden) : `${series.data.at(-1)?.toFixed(1)}%`}
              </Badge>
            </div>
            <MiniChart
              data={series.data}
              width={420}
              height={120}
              className="w-full"
              strokeColor={series.delta >= 0 ? "var(--color-emerald-soft)" : "var(--color-rose-soft)"}
            />
          </Card>
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
      <div className="p-5 space-y-4 w-[min(92vw,480px)]">
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
