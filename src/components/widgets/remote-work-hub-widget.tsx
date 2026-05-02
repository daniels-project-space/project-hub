"use client";

import { useRef, useState, useEffect } from "react";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { WidgetSlot } from "../widget-slot";

type ProjectTile = { slug: string; name: string; description: string; repo: string };

const RWH_BASE = "https://remote-work-hub-sepia.vercel.app";
const POLL_MS = 60_000;

function shortFromName(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function RemoteWorkHubWidget() {
  const railRef = useRef<HTMLDivElement | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [projects, setProjects] = useState<ProjectTile[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch(`${RWH_BASE}/api/projects`, { cache: "no-store" });
        if (!r.ok) throw new Error(`hub /api/projects ${r.status}`);
        const j = await r.json();
        if (!cancelled) {
          setProjects(j.projects ?? []);
          setLoadErr(null);
        }
      } catch (e: unknown) {
        if (!cancelled) setLoadErr(e instanceof Error ? e.message : String(e));
      }
    }
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

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

  const active = projects[activeIdx] ?? projects[0];
  const activeUrl = active ? `${RWH_BASE}/projects/${active.slug}` : RWH_BASE;
  const count = projects.length;

  return (
    <WidgetSlot
      size="full"
      label="Remote Work Hub"
      status={loadErr ? "hub unreachable" : `${count} project${count === 1 ? "" : "s"}`}
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
        {count === 0 && !loadErr && (
          <div className="text-paper-faint text-xs font-mono py-8 text-center">loading projects from hub...</div>
        )}
        {loadErr && (
          <div className="text-paper-faint text-xs font-mono py-8 text-center">hub unreachable</div>
        )}
        {count > 0 && (
          <>
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
              {projects.map((p) => (
                <ProjectCard key={p.slug} p={p} />
              ))}
            </div>

            <button
              type="button"
              onClick={() => scrollToIdx(Math.min(count - 1, activeIdx + 1))}
              aria-label="next project"
              disabled={activeIdx >= count - 1}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 z-10 w-7 h-7 grid place-items-center rounded-md border border-rule-soft/60 bg-ink-2/80 backdrop-blur hover:border-brass/40 hover:text-brass transition-colors text-paper-faint disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>

            {count > 1 && (
              <div className="mt-3 flex items-center justify-center gap-1.5">
                {projects.map((p, i) => (
                  <button
                    key={p.slug}
                    type="button"
                    onClick={() => scrollToIdx(i)}
                    aria-label={`go to ${p.name}`}
                    className={cn(
                      "h-1 rounded-full transition-all",
                      i === activeIdx ? "w-6 bg-brass" : "w-1.5 bg-paper-faint/30 hover:bg-paper-faint/60",
                    )}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </WidgetSlot>
  );
}

function ProjectCard({ p }: { p: ProjectTile }) {
  const url = `${RWH_BASE}/projects/${p.slug}`;
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
          background: "linear-gradient(160deg, oklch(0.23 0.006 245 / 0.7), oklch(0.18 0.006 245 / 0.6))",
          boxShadow: "inset 0 1px 0 oklch(1 0 0 / 0.04)",
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="w-9 h-9 rounded-md grid place-items-center border border-brass/30 bg-brass/[0.08] text-brass font-display italic text-sm">
            {shortFromName(p.name)}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-soft pulse-dot" />
            <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-emerald-soft">live</span>
          </div>
        </div>
        <h3 className="mt-3 font-display text-[20px] italic leading-tight text-paper">{p.name}</h3>
        <p className="mt-0.5 font-mono text-[10px] text-paper-faint truncate">{p.repo}</p>
        <p className="mt-2 text-[12px] text-paper-dim leading-snug line-clamp-2">{p.description}</p>
        <div className="mt-3 flex items-center justify-between">
          <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-paper-faint">/{p.slug}</span>
          <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint group-hover:text-brass transition-colors">
            open <ExternalLink className="w-2.5 h-2.5" />
          </span>
        </div>
      </div>
    </a>
  );
}
