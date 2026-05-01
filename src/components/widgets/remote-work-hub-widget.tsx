"use client";

import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { WidgetSlot } from "../widget-slot";

type ProjectTab = {
  slug: string;
  name: string;
  short: string;
  status: "live" | "wip" | "idle";
};

const PROJECTS: ProjectTab[] = [
  { slug: "test-project", name: "Sandbox Test", short: "ST", status: "live" },
];

const RWH_BASE = "https://remote-work-hub-sepia.vercel.app";

export function RemoteWorkHubWidget() {
  const [activeSlug, setActiveSlug] = useState<string>(PROJECTS[0]?.slug ?? "");
  const stripRef = useRef<HTMLDivElement | null>(null);

  const scrollBy = (dir: -1 | 1) => {
    const el = stripRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * 240, behavior: "smooth" });
  };

  const iframeSrc = activeSlug ? `${RWH_BASE}/projects/${activeSlug}` : RWH_BASE;

  return (
    <WidgetSlot
      size="full"
      label="Remote Work Hub"
      status={`embedded · ${activeSlug || "home"}`}
      action={
        <a
          href={iframeSrc}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-[10px] uppercase tracking-[0.2em] text-paper-faint hover:text-amber transition-colors flex items-center gap-1.5"
        >
          open in tab <ExternalLink className="w-3 h-3" />
        </a>
      }
    >
      {/* Tab carousel */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-rule-soft/60 bg-ink-2/40">
        <button
          type="button"
          onClick={() => scrollBy(-1)}
          aria-label="scroll tabs left"
          className="shrink-0 w-7 h-7 grid place-items-center rounded-sm border border-rule-soft/60 bg-ink hover:bg-ink-2 hover:border-amber/40 transition-colors text-paper-faint hover:text-amber"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>

        <div
          ref={stripRef}
          className="flex-1 flex items-center gap-2 overflow-x-auto scroll-smooth no-scrollbar"
        >
          {PROJECTS.map((p) => {
            const active = p.slug === activeSlug;
            return (
              <button
                key={p.slug}
                type="button"
                onClick={() => setActiveSlug(p.slug)}
                className={cn(
                  "shrink-0 flex items-center gap-2 pl-1.5 pr-3 py-1 rounded-sm border transition-colors",
                  active
                    ? "border-amber/50 bg-amber/[0.08]"
                    : "border-rule-soft/60 bg-ink hover:bg-ink-2 hover:border-rule",
                )}
              >
                <span
                  className={cn(
                    "w-6 h-6 rounded-sm grid place-items-center font-display italic text-[11px] border",
                    active
                      ? "border-amber/40 bg-amber/[0.12] text-amber"
                      : "border-rule-soft/60 bg-ink-2 text-paper-dim",
                  )}
                >
                  {p.short}
                </span>
                <span
                  className={cn(
                    "font-mono text-[10px] uppercase tracking-[0.22em]",
                    active ? "text-paper" : "text-paper-faint",
                  )}
                >
                  {p.name}
                </span>
                <span
                  className={cn(
                    "w-1.5 h-1.5 rounded-full",
                    p.status === "live" && "bg-emerald-soft pulse-dot",
                    p.status === "wip" && "bg-amber",
                    p.status === "idle" && "bg-paper-faint/50",
                  )}
                />
              </button>
            );
          })}

          {/* "More coming" ghost tab */}
          <div className="shrink-0 flex items-center gap-2 px-3 py-1 rounded-sm border border-dashed border-rule-soft/50 text-paper-faint">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em]">
              + more as they migrate
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => scrollBy(1)}
          aria-label="scroll tabs right"
          className="shrink-0 w-7 h-7 grid place-items-center rounded-sm border border-rule-soft/60 bg-ink hover:bg-ink-2 hover:border-amber/40 transition-colors text-paper-faint hover:text-amber"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Iframe — smaller, per-project */}
      <iframe
        key={activeSlug}
        src={iframeSrc}
        title={`Remote Work Hub — ${activeSlug}`}
        className="w-full h-[520px] bg-ink"
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
        allow="clipboard-read; clipboard-write"
      />
    </WidgetSlot>
  );
}
