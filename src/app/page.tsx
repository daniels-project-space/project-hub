"use client";
import { useQuery } from "convex/react";
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

  return (
    <main className="min-h-dvh">
      <TopBar />

      <section className="max-w-[1440px] mx-auto px-8 lg:px-14 py-8">
        {/* Hero — compact */}
        <header className="mb-6 flex items-end justify-between gap-6 flex-wrap">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-brass/80">
              Daniel&apos;s Project Space / 2026
            </p>
            <h1 className="mt-2 font-display text-[34px] leading-[1.05] tracking-tight text-paper">
              Project{" "}
              <span className="font-display italic font-light text-paper-dim">
                Hub
              </span>
            </h1>
            <p className="mt-1.5 max-w-xl text-paper-dim text-[13px] leading-relaxed">
              Umbrella dashboard. Each tile is an app. Widgets are embedded
              tools. Backend on Convex, deployed via Vercel.
            </p>
          </div>

          <div className="flex flex-col items-end gap-3">
            <a
              href="/handbook.pdf"
              target="_blank"
              rel="noreferrer"
              className="group relative flex items-center gap-3 rounded-md border border-paper/[0.08] bg-paper/[0.025] hover:bg-paper/[0.05] hover:border-paper/[0.14] transition-colors px-3.5 py-2.5"
            >
              <span
                className="w-1 h-8 rounded-sm shrink-0"
                style={{ background: "linear-gradient(180deg, #ec4899, #8b5cf6, #06b6d4)" }}
              />
              <span className="flex flex-col leading-tight">
                <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-paper-faint">
                  Handbook · PDF
                </span>
                <span className="font-display text-[13px] font-medium text-paper mt-0.5">
                  Project infrastructure
                </span>
              </span>
              <span className="font-mono text-[10px] text-paper-faint group-hover:text-paper transition-colors ml-1">↗</span>
            </a>

            {/* Inline stats — compact chip row */}
            <ul className="flex items-center gap-x-5 gap-y-2 flex-wrap">
              <Stat label="live" value={liveCount} tone="emerald" />
              <Stat label="wip" value={wipCount} tone="amber" />
              <Stat
                label="secrets"
                value={secretsSummary ? secretsSummary.total : "—"}
              />
              <Stat label="deploys" value="38" />
            </ul>
          </div>
        </header>

        <AppsRow />

        <CommandCenter />

        <section className="mb-12">
          <SectionLabel
            title="Widgets"
            hint="Drag to reorder · eye to hide — saved to Convex"
          />
          <DashboardGrid />
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

