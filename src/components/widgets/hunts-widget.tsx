"use client";

/**
 * Hunts · Alerts widget (Phase D) — decoupled, Aria-free replica of v1's
 * "Hunts · Alerts" card (public/index.html:307-336).
 *
 * Shows:
 *   - Price ALERTS: list of active alerts (symbol, above/below threshold), a
 *     "triggered" badge with relative time, toggle/remove, and an add-alert row
 *     (symbol search input + above/below select + threshold + add).
 *   - HUNTS: list of recurring LLM deal-hunts with their latest result, runs
 *     counter, a "check now" button, remove, and an add-hunt row (free-text task
 *     + schedule select, matching v1's options) + a "found" badge when done.
 *   - A quote sparkline (reuses ui/mini-chart.tsx) of the live-prices series so
 *     the card carries a market pulse like v1's stock view.
 *
 * Data: convex/alerts.ts (list/add/update/remove) + convex/hunts.ts
 * (list/add/update/remove/runNow) + wealth.getLivePrices for the sparkline.
 * NO Aria endpoint is called anywhere.
 */
import { useState, useMemo } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import {
  Bell,
  Target,
  Plus,
  Trash2,
  Play,
  Pause,
  CheckCircle2,
  Search,
} from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id, Doc } from "../../../convex/_generated/dataModel";
import { WidgetSlot } from "../widget-slot";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { MiniChart } from "@/components/ui/mini-chart";
import { cn } from "@/lib/utils";

// Row types are schema-derived (Doc<>), which resolves from schema.ts without
// codegen — so these annotations stay valid even before the generated `api`
// types are regenerated (Phase E deploy).
type AlertRow = Doc<"alerts">;
type HuntRow = Doc<"hunts">;
type LivePrice = { symbol: string; gbp: number; ts: number };

const SCHEDULES = [
  { value: "0 9 * * *", label: "Daily 9am" },
  { value: "0 9,18 * * *", label: "2x/day" },
  { value: "0 */6 * * *", label: "Every 6h" },
  { value: "0 */2 * * *", label: "Every 2h" },
];

function relTime(ts?: number): string {
  if (!ts) return "";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

const inputCls =
  "min-w-0 rounded-md border border-rule-soft/60 bg-ink/40 px-2 py-1.5 " +
  "font-mono text-[11px] text-paper placeholder:text-paper-faint/60 " +
  "focus:outline-none focus:border-brass/50";

export function HuntsWidget() {
  const alerts = useQuery(api.alerts.list);
  const hunts = useQuery(api.hunts.list);
  const livePrices = useQuery(api.wealth.getLivePrices);

  const addAlert = useMutation(api.alerts.add);
  const updateAlert = useMutation(api.alerts.update);
  const removeAlert = useMutation(api.alerts.remove);

  const addHunt = useMutation(api.hunts.add);
  const updateHunt = useMutation(api.hunts.update);
  const removeHunt = useMutation(api.hunts.remove);
  const runHuntNow = useAction(api.hunts.runNow);

  // add-alert form state
  const [aSymbol, setASymbol] = useState("");
  const [aKind, setAKind] = useState<"above" | "below">("above");
  const [aThreshold, setAThreshold] = useState("");

  // add-hunt form state
  const [hQuery, setHQuery] = useState("");
  const [hSchedule, setHSchedule] = useState(SCHEDULES[0].value);

  // sparkline series from the live-prices cache (a market "pulse" for the card)
  const sparkData = useMemo(() => {
    if (!livePrices || livePrices.length === 0) return [];
    return [...livePrices]
      .sort((a: LivePrice, b: LivePrice) => a.gbp - b.gbp)
      .map((p: LivePrice) => p.gbp)
      .filter((n: number) => Number.isFinite(n) && n > 0);
  }, [livePrices]);

  const activeAlerts = (alerts ?? []).filter((a: AlertRow) => a.active);
  const activeHunts = (hunts ?? []).filter((h: HuntRow) => h.active);
  const activeCount = activeAlerts.length + activeHunts.length;

  async function submitAlert() {
    const sym = aSymbol.trim();
    const thr = parseFloat(aThreshold);
    if (!sym || !Number.isFinite(thr)) return;
    await addAlert({ symbol: sym, kind: aKind, threshold: thr });
    setASymbol("");
    setAThreshold("");
  }

  async function submitHunt() {
    const q = hQuery.trim();
    if (!q) return;
    await addHunt({ query: q, schedule: hSchedule });
    setHQuery("");
  }

  const loading = alerts === undefined || hunts === undefined;

  return (
    <WidgetSlot
      size="medium"
      label="Hunts · Alerts"
      status={`${activeCount} active`}
    >
      <div className="p-4 space-y-4">
        {/* market pulse sparkline */}
        {sparkData.length > 1 && (
          <div className="rounded-lg border border-rule-soft/50 px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-paper-faint">
                Tracked quotes
              </span>
              <span className="font-mono text-[9px] text-paper-faint">
                {sparkData.length} symbols
              </span>
            </div>
            <MiniChart
              data={sparkData}
              width={420}
              height={40}
              className="w-full mt-1"
              endDot
            />
          </div>
        )}

        {/* ── ALERTS ──────────────────────────────────────────────── */}
        <section className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Bell className="w-3.5 h-3.5 text-brass/80" />
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-brass/85">
              Price Alerts
            </span>
          </div>

          {/* add-alert row */}
          <div className="grid grid-cols-[1fr_auto_70px_auto] gap-1.5">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-paper-faint/60" />
              <input
                className={cn(inputCls, "w-full pl-7")}
                placeholder="BTC / AAPL / GBPUSD"
                value={aSymbol}
                onChange={(e) => setASymbol(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitAlert()}
              />
            </div>
            <select
              className={cn(inputCls, "cursor-pointer")}
              value={aKind}
              onChange={(e) => setAKind(e.target.value as "above" | "below")}
            >
              <option value="above">Above</option>
              <option value="below">Below</option>
            </select>
            <input
              type="number"
              step="0.01"
              inputMode="decimal"
              className={inputCls}
              placeholder="price"
              value={aThreshold}
              onChange={(e) => setAThreshold(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitAlert()}
            />
            <button
              type="button"
              onClick={submitAlert}
              aria-label="Add alert"
              className="rounded-md border border-brass/40 bg-brass/[0.08] px-2 text-brass hover:bg-brass/[0.16]"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* alert list */}
          {activeAlerts.length === 0 ? (
            <p className="font-mono text-[10px] text-paper-faint px-1">
              No active alerts.
            </p>
          ) : (
            <ul className="space-y-1">
              {activeAlerts.map((a: AlertRow) => (
                <li
                  key={a._id}
                  className="flex items-center gap-2 rounded-md border border-rule-soft/50 px-2.5 py-1.5"
                >
                  <span className="font-mono text-[11px] text-paper">
                    {a.symbol}
                  </span>
                  <Badge tone={a.kind === "above" ? "emerald" : "rose"}>
                    {a.kind} {a.threshold}
                    {a.currency && a.currency !== "GBP" ? ` ${a.currency}` : ""}
                  </Badge>
                  {a.lastTriggeredAt && (
                    <Badge tone="amber">⚑ {relTime(a.lastTriggeredAt)}</Badge>
                  )}
                  <button
                    type="button"
                    onClick={() => removeAlert({ id: a._id as Id<"alerts"> })}
                    aria-label="Remove alert"
                    className="ml-auto text-paper-faint hover:text-rose-soft"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── HUNTS ───────────────────────────────────────────────── */}
        <section className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Target className="w-3.5 h-3.5 text-brass/80" />
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-brass/85">
              Hunts
            </span>
          </div>

          {/* add-hunt row */}
          <div className="grid grid-cols-[1fr_100px_auto] gap-1.5">
            <input
              className={inputCls}
              placeholder="Hunt: Sony A7IV under £1500…"
              value={hQuery}
              onChange={(e) => setHQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitHunt()}
            />
            <select
              className={cn(inputCls, "cursor-pointer")}
              value={hSchedule}
              onChange={(e) => setHSchedule(e.target.value)}
            >
              {SCHEDULES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={submitHunt}
              aria-label="Add hunt"
              className="rounded-md border border-brass/40 bg-brass/[0.08] px-2 text-brass hover:bg-brass/[0.16]"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* hunt list (includes recently-completed for the "latest result") */}
          {loading ? (
            <p className="font-mono text-[10px] text-paper-faint px-1">
              Loading…
            </p>
          ) : (hunts ?? []).length === 0 ? (
            <EmptyState
              icon={<Target className="w-5 h-5" />}
              title="No hunts yet"
              hint="Add a recurring deal-hunt above."
            />
          ) : (
            <ul className="space-y-1.5">
              {(hunts ?? []).map((h: HuntRow) => (
                <li
                  key={h._id}
                  className="rounded-md border border-rule-soft/50 px-2.5 py-2 space-y-1"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-paper truncate">
                      {h.query}
                    </span>
                    {!h.active && (
                      <Badge tone="emerald">
                        <CheckCircle2 className="w-3 h-3" /> done
                      </Badge>
                    )}
                    <span className="ml-auto font-mono text-[9px] text-paper-faint whitespace-nowrap">
                      {h.runs ?? 0}/{h.maxRuns ?? 30} runs
                    </span>
                    {h.active && (
                      <button
                        type="button"
                        onClick={() => runHuntNow({ id: h._id as Id<"hunts"> })}
                        aria-label="Check now"
                        className="text-paper-faint hover:text-emerald-soft"
                        title="Check now"
                      >
                        <Play className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        updateHunt({
                          id: h._id as Id<"hunts">,
                          active: !h.active,
                        })
                      }
                      aria-label={h.active ? "Pause hunt" : "Resume hunt"}
                      className="text-paper-faint hover:text-brass"
                      title={h.active ? "Pause" : "Resume"}
                    >
                      <Pause className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeHunt({ id: h._id as Id<"hunts"> })}
                      aria-label="Remove hunt"
                      className="text-paper-faint hover:text-rose-soft"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {h.lastResult && (
                    <p className="font-mono text-[10px] leading-snug text-paper-dim">
                      <span className="text-paper-faint">
                        {relTime(h.lastCheckedAt)}:{" "}
                      </span>
                      {h.lastResult}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </WidgetSlot>
  );
}

export default HuntsWidget;
