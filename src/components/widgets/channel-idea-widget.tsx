"use client";

import { Clapperboard } from "lucide-react";
import { WidgetSlot } from "../widget-slot";
import { Badge } from "@/components/ui/badge";

// ---------------------------------------------------------------------------
// Channel Idea of the Day (AutoStudio) — display-parity port of v1
// #hub-channel-idea card.
//
// v1 backed this with the AutoStudio LLM idea pipeline (logline + hook +
// monetization + niche/format/toolcount + projected revenue). That generation
// pipeline is DEFERRED — see build-logs/phase13-phaseC.md. This is a
// static-for-now display component matching the v1 look (amber/red gradient,
// 🎬, italic logline, purple hook, green monetization). When the pipeline lands,
// swap `IDEA` for a Convex/AutoStudio query result of the same shape.
// ---------------------------------------------------------------------------

interface ChannelIdea {
  logline: string;
  hook?: string;
  monetization?: string;
  niche?: string;
  format?: string;
  toolCount?: number;
  projectedRevenue?: string;
}

// Placeholder content (no staleness concern — generation pipeline deferred).
const IDEA: ChannelIdea | null = {
  logline:
    "Channel idea generation is paused — wire the AutoStudio pipeline to light this up.",
  hook: "Daily faceless-channel concept with a ready-to-shoot hook.",
  monetization: "Projected monetization path appears here once the pipeline is live.",
  niche: "lo-fi",
  format: "shorts",
};

export function ChannelIdeaWidget() {
  return (
    <WidgetSlot size="medium" label="Channel Idea · AutoStudio">
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
            {IDEA?.projectedRevenue && (
              <span className="ml-auto font-mono text-[11px] font-semibold text-emerald-soft/90">
                {IDEA.projectedRevenue}
              </span>
            )}
          </div>

          {IDEA ? (
            <>
              <p className="font-display italic text-[15px] leading-snug text-paper-dim">
                {IDEA.logline}
              </p>
              {IDEA.hook && (
                <p
                  className="mt-2 font-mono text-[11px] leading-snug"
                  style={{ color: "rgba(192,132,252,0.85)" }}
                >
                  {IDEA.hook}
                </p>
              )}
              {IDEA.monetization && (
                <p
                  className="mt-1.5 font-mono text-[11px] leading-snug text-emerald-soft/85 rounded-r px-2 py-1"
                  style={{
                    background: "rgba(34,197,94,0.04)",
                    borderLeft: "2px solid rgba(34,197,94,0.3)",
                  }}
                >
                  {IDEA.monetization}
                </p>
              )}
              {(IDEA.niche || IDEA.format) && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {IDEA.niche && <Badge tone="amber">{IDEA.niche}</Badge>}
                  {IDEA.format && <Badge tone="default">{IDEA.format}</Badge>}
                  {IDEA.toolCount !== undefined && (
                    <Badge tone="default">{IDEA.toolCount} tools</Badge>
                  )}
                </div>
              )}
            </>
          ) : (
            <p className="font-display italic text-[15px] text-paper-faint">Generating…</p>
          )}

          <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.18em] text-paper-faint/70">
            generation pipeline deferred
          </p>
        </div>
      </div>
    </WidgetSlot>
  );
}
