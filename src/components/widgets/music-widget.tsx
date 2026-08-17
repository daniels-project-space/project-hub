"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { Music, Maximize2 } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { WidgetSlot } from "../widget-slot";
import { EmptyState } from "@/components/ui/empty-state";
import { MiniChart } from "@/components/ui/mini-chart";
import { Sheet } from "@/components/ui/sheet";
import { StatTile } from "@/components/ui/stat-tile";
import { Badge } from "@/components/ui/badge";

// AI Music Income — first income made through AI. Mirrors music-house's
// DistroKid analytics (polled into convex/wealth.ts aiIncome cache every 6h;
// the source pull runs every 2 days on music-house's Trigger schedule).
// Streams graph + real bank balance + blended estimate. The REAL balance also
// rolls into net worth via the "Music · DistroKid" auto asset (AI Income tile).

function ago(ts: number): string {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function fmtDay(ts: number): string {
  const d = new Date(ts);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

export function MusicWidget() {
  const ai = useQuery(api.wealth.getAiIncome);
  const [expanded, setExpanded] = useState(false);

  const expandAction = ai ? (
    <button
      type="button"
      aria-label="Expand"
      onClick={() => setExpanded(true)}
      className="p-1 rounded text-paper-faint hover:text-brass transition-colors"
    >
      <Maximize2 className="w-3.5 h-3.5" />
    </button>
  ) : undefined;

  if (ai === undefined) {
    return (
      <WidgetSlot size="small" label="AI Music Income">
        <div className="p-4">
          <EmptyState title="Loading…" hint="music-house · DistroKid" />
        </div>
      </WidgetSlot>
    );
  }
  if (ai === null) {
    return (
      <WidgetSlot size="small" label="AI Music Income">
        <div className="p-4">
          <EmptyState
            title="Awaiting first poll"
            hint="music-house · DistroKid · polls every 12h"
          />
        </div>
      </WidgetSlot>
    );
  }

  // Feed staleness: the poll runs every 12h, so anything older than ~26h means
  // the cron (or music-house's own 2-day pull) died — say so instead of quietly
  // presenting old numbers as current.
  const feedStale = Date.now() - ai.fetchedAt > 26 * 60 * 60 * 1000;

  // DistroKid genuinely reports zero until stores pay out (~2-3 months behind).
  // A flat all-zero chart reads as "widget broken" — render the honest state
  // instead. The feed itself is alive (fetchedAt is fresh).
  const allZero =
    ai.streamsTotal === 0 &&
    ai.balanceUsd === 0 &&
    ai.history.every((h) => h.streamsTotal === 0 && h.balance === 0);
  if (allZero) {
    return (
      <WidgetSlot
        size="small"
        label="AI Music Income"
        status={feedStale ? "feed stale" : `upd ${ago(ai.fetchedAt)}`}
        action={expandAction}
      >
        <div className="p-4 space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-paper-faint flex items-center gap-1.5">
            <Music className="w-3 h-3" /> DistroKid
          </p>
          <p className="font-display italic text-[15px] leading-snug text-paper-dim">
            No earnings reported yet.
          </p>
          <p className="font-mono text-[10px] text-paper-faint leading-relaxed">
            Stores report streams ~2–3 months behind release. The feed is
            connected and checks twice a day — numbers appear here the moment
            DistroKid shows any.
          </p>
        </div>
        <MusicHistorySheet ai={ai} open={expanded} onClose={() => setExpanded(false)} />
      </WidgetSlot>
    );
  }

  const series = ai.history.map((h) => h.streamsTotal);
  const labels = ai.history.map((h) => fmtDay(h.fetchedAt));
  const delta =
    series.length >= 2 ? series[series.length - 1] - series[0] : 0;

  return (
    <WidgetSlot
      size="small"
      label="AI Music Income"
      status={feedStale ? "feed stale" : `upd ${ago(ai.fetchedAt)}`}
      action={expandAction}
    >
      <div className="p-4 space-y-3">
        <div className="flex items-end justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-paper-faint flex items-center gap-1.5">
              <Music className="w-3 h-3" /> Streams
            </p>
            <p className="font-mono text-2xl font-bold tabular-nums text-paper leading-none mt-1">
              {ai.streamsTotal.toLocaleString()}
            </p>
          </div>
          {delta !== 0 && (
            <span className="font-mono text-[10px] tabular-nums text-emerald-soft">
              +{delta.toLocaleString()} over period
            </span>
          )}
        </div>

        {series.length >= 2 ? (
          <MiniChart
            data={series}
            labels={labels}
            width={260}
            height={72}
            axis
            endDot
            baseline
            className="w-full"
            valueFormat={(n) => n.toLocaleString()}
          />
        ) : (
          <p className="font-mono text-[10px] text-paper-faint">
            Graph appears after the second 2-day pull
            {series.length === 1 ? ` (first point: ${series[0].toLocaleString()})` : ""}.
          </p>
        )}

        <div className="grid grid-cols-2 gap-2 pt-1 border-t border-rule-soft/40">
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-paper-faint">
              Bank (real)
            </p>
            <p className="font-mono text-sm font-bold tabular-nums text-emerald-soft">
              ${ai.balanceUsd.toFixed(2)}
              <span className="text-paper-faint font-normal text-[10px] ml-1">
                £{ai.balanceGbp.toFixed(2)}
              </span>
            </p>
          </div>
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-paper-faint">
              Est. from streams
            </p>
            <p className="font-mono text-sm font-bold tabular-nums text-paper">
              ${ai.estUsd.toFixed(2)}
            </p>
          </div>
        </div>
        <p className="font-mono text-[9px] text-paper-faint leading-relaxed">
          Real balance counts toward net worth (AI Income). Stores pay ~2–3 months behind; estimate = streams × $0.0035.
        </p>
      </div>
      <MusicHistorySheet ai={ai} open={expanded} onClose={() => setExpanded(false)} />
    </WidgetSlot>
  );
}

// ─── Expanded detail view ────────────────────────────────────────────────────
// There is no per-track breakdown in convex (aiIncome only stores aggregate
// streamsTotal/balance snapshots) — the fullest available detail is a bigger
// chart, low/high/change stats, and the complete poll-history table instead
// of just the compact card's tail-end sparkline.
function MusicHistorySheet({
  ai,
  open,
  onClose,
}: {
  ai: {
    streamsTotal: number;
    balanceUsd: number;
    estUsd: number;
    balanceGbp: number;
    history: { fetchedAt: number; streamsTotal: number; balance: number }[];
    fetchedAt: number;
  };
  open: boolean;
  onClose: () => void;
}) {
  const series = ai.history.map((h) => h.streamsTotal);
  const labels = ai.history.map((h) => fmtDay(h.fetchedAt));
  const streamsLow = series.length ? Math.min(...series) : 0;
  const streamsHigh = series.length ? Math.max(...series) : 0;
  const delta = series.length >= 2 ? series[series.length - 1] - series[0] : 0;
  const up = delta >= 0;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="AI Music Income · History"
      side="center"
      className="max-w-2xl w-[min(94vw,680px)]"
    >
      <div className="space-y-5">
        <div className="flex items-end justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-paper-faint flex items-center gap-1.5">
              <Music className="w-3 h-3" /> music-house · DistroKid
            </p>
            <p className="mt-1 font-display italic font-light text-[40px] leading-none tabular-nums text-paper">
              {ai.streamsTotal.toLocaleString()}
            </p>
            <p className="mt-1 font-mono text-[10px] text-paper-faint">
              {ai.history.length} data point{ai.history.length === 1 ? "" : "s"} · upd {ago(ai.fetchedAt)}
            </p>
          </div>
          {delta !== 0 && (
            <Badge tone={up ? "emerald" : "rose"} className="text-[11px] px-2.5 py-1">
              {up ? "▲" : "▼"} {up ? "+" : ""}
              {delta.toLocaleString()}
            </Badge>
          )}
        </div>

        {series.length >= 2 ? (
          <div className="rounded-lg border border-rule-soft/60 p-3">
            <MiniChart
              data={series}
              labels={labels}
              width={620}
              height={260}
              axis
              endDot
              baseline
              className="w-full"
              valueFormat={(n) => n.toLocaleString()}
            />
          </div>
        ) : (
          <p className="font-mono text-[10px] text-paper-faint py-8 text-center">
            Graph appears after the second 2-day pull.
          </p>
        )}

        <div className="grid grid-cols-3 gap-2.5">
          <StatTile label="Low" value={streamsLow.toLocaleString()} tone="rose" />
          <StatTile label="High" value={streamsHigh.toLocaleString()} tone="emerald" />
          <StatTile
            label="Change"
            value={`${up ? "+" : ""}${delta.toLocaleString()}`}
            tone={up ? "emerald" : "rose"}
          />
        </div>

        <div className="grid grid-cols-2 gap-2.5 pt-1 border-t border-rule-soft/40">
          <StatTile
            label="Bank (real)"
            value={`$${ai.balanceUsd.toFixed(2)}`}
            sub={`£${ai.balanceGbp.toFixed(2)}`}
            tone="emerald"
          />
          <StatTile label="Est. from streams" value={`$${ai.estUsd.toFixed(2)}`} />
        </div>

        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-paper-faint mb-2">
            Poll history
          </p>
          <div className="max-h-64 overflow-y-auto no-scrollbar space-y-1.5">
            {[...ai.history].reverse().map((h) => (
              <div
                key={h.fetchedAt}
                className="flex items-center justify-between rounded-lg border border-rule-soft/50 px-3 py-2"
                style={{
                  background:
                    "linear-gradient(160deg, oklch(0.21 0.006 245 / 0.5), oklch(0.18 0.006 245 / 0.4))",
                }}
              >
                <span className="font-mono text-[10px] text-paper-faint">{fmtDay(h.fetchedAt)}</span>
                <span className="font-mono text-[11px] tabular-nums text-paper">
                  {h.streamsTotal.toLocaleString()} streams
                </span>
                <span className="font-mono text-[11px] tabular-nums text-emerald-soft">
                  ${h.balance.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <p className="font-mono text-[9px] text-paper-faint leading-relaxed">
          Real balance counts toward net worth (AI Income). Stores pay ~2–3 months behind; estimate = streams × $0.0035.
        </p>
      </div>
    </Sheet>
  );
}
