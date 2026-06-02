"use client";
import { useState } from "react";
import { useQuery } from "convex/react";
import { Pencil, Check } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { TopBar } from "@/components/top-bar";
import { AppsRow } from "@/components/apps-row";
import { SectionLabel } from "@/components/section-label";
import { DashboardGrid } from "@/components/dashboard-grid";
import { CommandCenter } from "@/components/command-center";
import { APPS } from "@/lib/apps";

export default function HomePage() {
  const secretsSummary = useQuery(api.secrets.summary);
  const liveCount = APPS.filter((a) => a.status === "live").length;
  const wipCount = APPS.filter((a) => a.status === "wip").length;
  const [editMode, setEditMode] = useState(false);

  return (
    <main className="min-h-dvh">
      <TopBar />

      <section className="max-w-[1440px] mx-auto px-8 lg:px-14 py-8">
        {/* Carousel is the top content now (hero text removed). */}
        <AppsRow />

        {/* Compact infra strip — shrunk Handbook card + inline stats. */}
        <div className="mb-10 -mt-4 flex items-center justify-between gap-4 flex-wrap">
          <a
            href="/handbook.pdf"
            target="_blank"
            rel="noreferrer"
            className="group relative flex items-center gap-2 rounded-md border border-paper/[0.08] bg-paper/[0.025] hover:bg-paper/[0.05] hover:border-paper/[0.14] transition-colors px-2.5 py-1.5"
          >
            <span
              className="w-1 h-5 rounded-sm shrink-0"
              style={{ background: "linear-gradient(180deg, #ec4899, #8b5cf6, #06b6d4)" }}
            />
            <span className="flex flex-col leading-tight">
              <span className="font-mono text-[8px] uppercase tracking-[0.2em] text-paper-faint">
                Handbook · PDF
              </span>
              <span className="font-display text-[11px] font-medium text-paper">
                Project infrastructure
              </span>
            </span>
            <span className="font-mono text-[9px] text-paper-faint group-hover:text-paper transition-colors ml-0.5">↗</span>
          </a>

          {/* Inline stats — compact chip row */}
          <ul className="flex items-center gap-x-4 gap-y-2 flex-wrap">
            <Stat label="live" value={liveCount} tone="emerald" />
            <Stat label="wip" value={wipCount} tone="amber" />
            <Stat
              label="secrets"
              value={secretsSummary ? secretsSummary.total : "—"}
            />
            <Stat label="deploys" value="38" />
          </ul>
        </div>

        <CommandCenter />

        <section className="mb-12">
          <SectionLabel
            title="Widgets"
            hint={
              editMode
                ? "Drag · resize · remove — saved to Convex"
                : "Tap Edit to rearrange, resize or add widgets"
            }
            action={
              <button
                type="button"
                onClick={() => setEditMode((v) => !v)}
                aria-pressed={editMode}
                className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors ${
                  editMode
                    ? "border-brass/50 bg-brass-dim text-brass"
                    : "border-rule-soft/60 bg-paper/[0.025] hover:bg-paper/[0.05] text-paper-faint hover:text-brass"
                }`}
              >
                {editMode ? (
                  <Check className="w-3 h-3" />
                ) : (
                  <Pencil className="w-3 h-3" />
                )}
                {editMode ? "Done" : "Edit"}
              </button>
            }
          />
          <DashboardGrid editMode={editMode} />
        </section>
      </section>

      <footer className="max-w-[1440px] mx-auto px-8 lg:px-14 pb-10">
        <div className="rule-hairline mb-4" />
        <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.28em] text-paper-faint">
          <span>project-hub · convex · vercel · github</span>
          <span>v0.4</span>
        </div>
      </footer>
    </main>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: "emerald" | "amber";
}) {
  const color =
    tone === "emerald"
      ? "text-emerald-soft"
      : tone === "amber"
        ? "text-amber"
        : "text-paper";
  return (
    <li className="flex items-baseline gap-1.5">
      <span
        className={`font-display italic font-light text-[20px] leading-none tabular-nums ${color}`}
      >
        {value}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-paper-faint">
        {label}
      </span>
    </li>
  );
}

