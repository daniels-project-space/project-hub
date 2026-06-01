"use client";

import { Lightbulb } from "lucide-react";
import { WidgetSlot } from "../widget-slot";

// ---------------------------------------------------------------------------
// Idea of the Day — display-parity port of v1 #hub-idea card.
//
// v1 backed this with an LLM/cron pipeline (server.js idea generation + the
// home_todos_v1 "adopt" flow). That generation pipeline is DEFERRED — see
// build-logs/phase13-phaseC.md. This is a static-for-now display component that
// matches the v1 look (purple #c084fc accent, 💡, italic body, green benefit).
// When the pipeline lands, swap `IDEA` for a Convex query result of the same shape.
// ---------------------------------------------------------------------------

interface Idea {
  text: string;
  benefit?: string;
}

// Placeholder content (no staleness concern — generation pipeline deferred).
const IDEA: Idea | null = {
  text: "Idea generation is paused — wire the daily idea pipeline to light this up.",
  benefit: "Ships ranked product/feature ideas each morning, one tap to add to tasks.",
};

const PURPLE = "rgb(192,132,252)";

export function IdeaWidget() {
  return (
    <WidgetSlot size="medium" label="Idea of the Day">
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
          </div>

          {IDEA ? (
            <>
              <p className="font-display italic text-[15px] leading-snug text-paper-dim">
                {IDEA.text}
              </p>
              {IDEA.benefit && (
                <p className="mt-1.5 font-mono text-[11px] leading-snug text-emerald-soft/85">
                  {IDEA.benefit}
                </p>
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
