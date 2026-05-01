"use client";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { TopBar } from "@/components/top-bar";
import { AppsRow } from "@/components/apps-row";
import { SectionLabel } from "@/components/section-label";
import { RemoteWorkHubWidget } from "@/components/widgets/remote-work-hub-widget";
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
        </header>

        <AppsRow />

        <section className="mb-12">
          <SectionLabel
            title="Widgets"
            hint="Embedded tools — one per row by default"
          />
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <RemoteWorkHubWidget />
          </div>
        </section>

        <section className="mb-12">
          <SectionLabel title="Next" hint="In flight / on deck" />
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
            <NextItem n="01" title="Migrate apps from VPS → Vercel" detail="rental-manager, app-factory, aria, lofi-generator first" />
            <NextItem n="02" title="Iframe embed each app as widget" detail="As they go live on Vercel, drop them into the Widgets row" />
            <NextItem n="03" title="Auth gate the hub" detail="Single-user Clerk/Convex Auth so the URL isn't open" />
            <NextItem n="04" title="Edit-mode drag&drop" detail="Reorder widgets and apps; persist to Convex" />
          </ul>
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

function NextItem({
  n,
  title,
  detail,
}: {
  n: string;
  title: string;
  detail: string;
}) {
  return (
    <li className="py-4 border-b border-rule-soft/40 last:border-b-0">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-[10px] text-brass/70 tabular-nums tracking-[0.1em]">
          /{n}
        </span>
        <h3 className="font-display text-lg text-paper">{title}</h3>
      </div>
      <p className="mt-1 ml-7 text-sm text-paper-dim leading-relaxed">
        {detail}
      </p>
    </li>
  );
}
