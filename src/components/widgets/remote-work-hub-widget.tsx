"use client";

import { useRef, useState, useEffect } from "react";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { WidgetSlot } from "../widget-slot";

type ProjectTile = {
  slug: string;
  name: string;
  short: string;
  repo: string;
  status: "live" | "wip" | "idle";
  blurb: string;
};

const PROJECTS: ProjectTile[] = [
  {
    slug: "test-project",
    name: "Sandbox Test",
    short: "ST",
    repo: "remoteworkhq/sandbox-test",
    status: "live",
    blurb: "Throwaway repo for proving the Claude Code agent flow end-to-end.",
  },
];

const RWH_BASE = "https://remote-work-hub-sepia.vercel.app";

export function RemoteWorkHubWidget() {
  const railRef = useRef<HTMLDivElement | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);

  const scrollToIdx = (idx: number) => {
    const el = railRef.current;
    if (!el) return;
    const card = el.children[idx] as HTMLElement | undefined;
    if (!card) return;
    el.scrollTo({ left: card.offsetLeft, behavior: "smooth" });
  };

  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const cards = Array.from(el.children) as HTMLElement[];
        const center = el.scrollLeft + el.clientWidth / 2;
        let nearest = 0;
        let best = Infinity;
        cards.forEach((c, i) => {
          const mid = c.offsetLeft + c.offsetWidth / 2;
          const d = Math.abs(mid - center);
          if (d < best) {
            best = d;
            nearest = i;
          }
        });
        setActiveIdx(nearest);
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  const active = PROJECTS[activeIdx] ?? PROJECTS[0];
  const activeUrl = `${RWH_BASE}/projects/${active.slug}`;

  return (
    <WidgetSlot
      size="full"
      label="Remote Work Hub"
      status={`${PROJECTS.length} project${PROJECTS.length === 1 ? "" : "s"}`}
      action={
        <a
          href={activeUrl}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-[10px] uppercase tracking-[0.2em] text-paper-faint hover:text-brass transition-colors flex items-center gap-1.5"
        >
          open in tab <ExternalLink className="w-3 h-3" />
        </a>
      }
    >
      <div className="relative px-4 py-4">
        <button
          type="button"
          onClick={() => scrollToIdx(Math.max(0, activeIdx - 1))}
          aria-label="previous project"
          disabled={activeIdx === 0}
          className="absolute left-1.5 top-1/2 -translate-y-1/2 z-10 w-7 h-7 grid place-items-center rounded-md border border-rule-soft/60 bg-ink-2/80 backdrop-blur hover:border-brass/40 hover:text-brass transition-colors text-paper-faint disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>

        <div
          ref={railRef}
          className="flex gap-3 overflow-x-auto no-scrollbar scroll-smooth snap-x snap-mandatory px-8"
          style={{ scrollPaddingInline: "2rem" }}
        >
          {PROJECTS.map((p) => (
            <ProjectCard key={p.slug} p={p} />
          ))}
        </div>

        <button
          type="button"
          onClick={() =>
            scrollToIdx(Math.min(PROJECTS.length - 1, activeIdx + 1))
          }
          aria-label="next project"
          disabled={activeIdx >= PROJECTS.length - 1}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 z-10 w-7 h-7 grid place-items-center rounded-md border border-rule-soft/60 bg-ink-2/80 backdrop-blur hover:border-brass/40 hover:text-brass transition-colors text-paper-faint disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>

        {PROJECTS.length > 1 && (
          <div className="mt-3 flex items-center justify-center gap-1.5">
            {PROJECTS.map((p, i) => (
              <button
                key={p.slug}
                type="button"
                onClick={() => scrollToIdx(i)}
                aria-label={`go to ${p.name}`}
                className={cn(
                  "h-1 rounded-full transition-all",
                  i === activeIdx
                    ? "w-6 bg-brass"
                    : "w-1.5 bg-paper-faint/30 hover:bg-paper-faint/60",
                )}
              />
            ))}
          </div>
        )}
      </div>
    </WidgetSlot>
  );
}

const STATUS_DOT: Record<ProjectTile["status"], string> = {
  live: "bg-emerald-soft",
  wip: "bg-amber",
  idle: "bg-paper-faint/60",
};

function ProjectCard({ p }: { p: ProjectTile }) {
  const url = `https://remote-work-hub-sepia.vercel.app/projects/${p.slug}`;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      aria-label={`Open ${p.name} in Remote Work Hub`}
      className="group shrink-0 w-[300px] snap-center focus:outline-none focus-visible:ring-1 focus-visible:ring-brass/40 rounded-xl"
    >
      <div
        className="rounded-xl border border-rule-soft/70 p-4 transition-colors group-hover:border-brass/40"
        style={{
          background:
            "linear-gradient(160deg, oklch(0.23 0.006 245 / 0.7), oklch(0.18 0.006 245 / 0.6))",
          boxShadow: "inset 0 1px 0 oklch(1 0 0 / 0.04)",
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="w-9 h-9 rounded-md grid place-items-center border border-brass/30 bg-brass/[0.08] text-brass font-display italic text-sm">
            {p.short}
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "w-1.5 h-1.5 rounded-full",
                STATUS_DOT[p.status],
                p.status === "live" && "pulse-dot",
              )}
            />
            <span
              className={cn(
                "font-mono text-[9px] uppercase tracking-[0.22em]",
                p.status === "live" && "text-emerald-soft",
                p.status === "wip" && "text-amber",
                p.status === "idle" && "text-paper-faint",
              )}
            >
              {p.status}
            </span>
          </div>
        </div>

        <h3 className="mt-3 font-display text-[20px] italic leading-tight text-paper">
          {p.name}
        </h3>
        <p className="mt-0.5 font-mono text-[10px] text-paper-faint truncate">
          {p.repo}
        </p>
        <p className="mt-2 text-[12px] text-paper-dim leading-snug line-clamp-2">
          {p.blurb}
        </p>

        <div className="mt-3 flex items-center justify-between">
          <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-paper-faint">
            /{p.slug}
          </span>
          <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint group-hover:text-brass transition-colors">
            open <ExternalLink className="w-2.5 h-2.5" />
          </span>
        </div>
      </div>
    </a>
  );
}
