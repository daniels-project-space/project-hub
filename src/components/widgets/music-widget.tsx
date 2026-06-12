"use client";

import { useQuery } from "convex/react";
import { Music } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { WidgetSlot } from "../widget-slot";
import { EmptyState } from "@/components/ui/empty-state";
import { MiniChart } from "@/components/ui/mini-chart";

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
            hint="music-house · DistroKid · polls every 6h"
          />
        </div>
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
      status={`upd ${ago(ai.fetchedAt)}`}
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
    </WidgetSlot>
  );
}
