"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { Lightbulb, Maximize2 } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { WidgetSlot } from "../widget-slot";
import { Badge } from "@/components/ui/badge";
import { Sheet } from "@/components/ui/sheet";

// ---------------------------------------------------------------------------
// Idea of the Day — LIVE since 2026-07-03. Backed by convex/ideas.ts: one
// cheap DeepSeek call per day (05:30 UTC cron) writes a dailyIdeas doc that
// this widget and channel-idea-widget.tsx both read. Was a static
// "generation is paused" placeholder before. Visuals preserved from the v1
// port (purple #c084fc accent, 💡, italic body, green benefit).
//
// Rigidity: a dead feed is VISIBLE — no doc → explicit empty state; doc older
// than 48h → "stale" badge instead of silently presenting old data as fresh.
// ---------------------------------------------------------------------------

const PURPLE = "rgb(192,132,252)";
const STALE_MS = 48 * 60 * 60 * 1000;

export function IdeaWidget() {
  const doc = useQuery(api.ideas.latest);
  const stale = !!doc && Date.now() - doc.generatedAt > STALE_MS;
  // Click-to-expand: full (non-clamped) idea detail sheet (header action).
  const [expandOpen, setExpandOpen] = useState(false);

  return (
    <WidgetSlot
      size="medium"
      label="Idea of the Day"
      action={
        <button
          type="button"
          aria-label="Expand"
          onClick={() => setExpandOpen(true)}
          className="p-1 rounded text-paper-faint hover:text-paper"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      }
    >
      <div className="p-2">
        <div
          className="relative overflow-hidden rounded-xl border px-4 py-4"
          style={{
            background:
              "linear-gradient(160deg, rgba(192,132,252,0.06), rgba(18,16,22,0.4))",
            borderColor: "rgba(192,132,252,0.25)",
          }}
        >
          {/* Top accent line (v1) */}
          <div
            className="absolute inset-x-0 top-0 h-px opacity-30"
            style={{
              background:
                "linear-gradient(90deg, transparent, rgb(192,132,252) 30%, rgb(192,132,252) 70%, transparent)",
            }}
          />

          <div className="flex items-center gap-2 mb-2">
            <Lightbulb className="w-4 h-4" style={{ color: PURPLE }} />
            <span
              className="font-mono text-[10px] font-bold uppercase tracking-[0.16em]"
              style={{ color: "rgba(192,132,252,0.75)" }}
            >
              Idea of the Day
            </span>
            {stale && (
              <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.16em] text-amber">
                stale
              </span>
            )}
          </div>

          {doc === undefined ? (
            <p className="font-display italic text-[15px] text-paper-faint">Loading…</p>
          ) : doc === null ? (
            <p className="font-display italic text-[15px] text-paper-faint">
              No idea yet — the daily generator runs 05:30 UTC.
            </p>
          ) : (
            <>
              <p className="font-display italic text-[15px] leading-snug text-paper-dim">
                {doc.ideaText}
              </p>
              {doc.ideaBenefit && (
                <p className="mt-1.5 font-mono text-[11px] leading-snug text-emerald-soft/85">
                  {doc.ideaBenefit}
                </p>
              )}
            </>
          )}

          <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.18em] text-paper-faint/70">
            {doc ? `generated ${doc.day} · deepseek · 1 call/day` : "daily · deepseek · 1 call/day"}
          </p>
        </div>
      </div>

      {/* Click-to-expand: full detail (Sheet, wealth-widget HistorySheet
          convention). Backend only exposes `latest` (no history query), so
          this surfaces the SAME record un-clamped + its full timestamp/model. */}
      <Sheet
        open={expandOpen}
        onClose={() => setExpandOpen(false)}
        title="Idea of the Day"
        side="center"
      >
        {doc === undefined ? (
          <p className="font-display italic text-[15px] text-paper-faint">Loading…</p>
        ) : doc === null ? (
          <p className="font-display italic text-[15px] text-paper-faint">
            No idea yet — the daily generator runs 05:30 UTC.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Lightbulb className="w-5 h-5" style={{ color: PURPLE }} />
              <span
                className="font-mono text-[11px] uppercase tracking-[0.18em]"
                style={{ color: "rgba(192,132,252,0.85)" }}
              >
                {doc.day}
              </span>
              {stale && <Badge tone="amber">stale</Badge>}
            </div>
            <p className="font-display italic text-[19px] leading-relaxed text-paper">
              {doc.ideaText}
            </p>
            {doc.ideaBenefit && (
              <p
                className="font-mono text-[13px] leading-relaxed text-emerald-soft/90 border-l-2 pl-3"
                style={{ borderColor: "rgba(34,197,94,0.35)" }}
              >
                {doc.ideaBenefit}
              </p>
            )}
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint/70 pt-3 border-t border-rule-soft/40">
              generated {new Date(doc.generatedAt).toLocaleString()} ·{" "}
              {doc.model ?? "deepseek"} · 1 call/day
            </p>
          </div>
        )}
      </Sheet>
    </WidgetSlot>
  );
}
