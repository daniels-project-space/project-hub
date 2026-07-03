"use client";

import { useQuery } from "convex/react";
import { Clapperboard } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { WidgetSlot } from "../widget-slot";
import { Badge } from "@/components/ui/badge";

// ---------------------------------------------------------------------------
// Channel Idea of the Day — LIVE since 2026-07-03. Backed by convex/ideas.ts:
// the SAME single daily DeepSeek call that powers idea-widget.tsx also returns
// this card (one call, two widgets). Was a static "wire the AutoStudio
// pipeline" placeholder before. Visuals preserved from the v1 port
// (amber/red gradient, 🎬, italic logline, purple hook, green monetization).
//
// Rigidity: no doc → explicit empty state; doc older than 48h → "stale" badge.
// ---------------------------------------------------------------------------

const STALE_MS = 48 * 60 * 60 * 1000;

export function ChannelIdeaWidget() {
  const doc = useQuery(api.ideas.latest);
  const stale = !!doc && Date.now() - doc.generatedAt > STALE_MS;

  return (
    <WidgetSlot size="medium" label="Channel Idea">
      <div className="p-2">
        <div
          className="relative overflow-hidden rounded-xl border px-4 py-4"
          style={{
            background:
              "linear-gradient(160deg, rgba(251,191,36,0.06), rgba(239,68,68,0.04))",
            borderColor: "rgba(251,191,36,0.25)",
          }}
        >
          {/* Top accent line */}
          <div
            className="absolute inset-x-0 top-0 h-px opacity-30"
            style={{
              background:
                "linear-gradient(90deg, transparent, rgb(251,191,36) 30%, rgb(251,191,36) 70%, transparent)",
            }}
          />

          <div className="flex items-center gap-2 mb-2">
            <Clapperboard className="w-4 h-4" style={{ color: "rgb(251,191,36)" }} />
            <span
              className="font-mono text-[10px] font-bold uppercase tracking-[0.16em]"
              style={{ color: "rgba(251,191,36,0.8)" }}
            >
              Channel Idea of the Day
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
              No channel idea yet — the daily generator runs 05:30 UTC.
            </p>
          ) : (
            <>
              <p className="font-display italic text-[15px] leading-snug text-paper-dim">
                {doc.channelLogline}
              </p>
              {doc.channelHook && (
                <p
                  className="mt-2 font-mono text-[11px] leading-snug"
                  style={{ color: "rgba(192,132,252,0.85)" }}
                >
                  {doc.channelHook}
                </p>
              )}
              {doc.channelMonetization && (
                <p
                  className="mt-1.5 font-mono text-[11px] leading-snug text-emerald-soft/85 rounded-r px-2 py-1"
                  style={{
                    background: "rgba(34,197,94,0.04)",
                    borderLeft: "2px solid rgba(34,197,94,0.3)",
                  }}
                >
                  {doc.channelMonetization}
                </p>
              )}
              {(doc.channelNiche || doc.channelFormat) && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {doc.channelNiche && <Badge tone="amber">{doc.channelNiche}</Badge>}
                  {doc.channelFormat && <Badge tone="default">{doc.channelFormat}</Badge>}
                </div>
              )}
            </>
          )}

          <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.18em] text-paper-faint/70">
            {doc ? `generated ${doc.day} · deepseek · shared daily call` : "daily · deepseek · shared daily call"}
          </p>
        </div>
      </div>
    </WidgetSlot>
  );
}
