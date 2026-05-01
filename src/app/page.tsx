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

      <section className="max-w-[1440px] mx-auto px-8 lg:px-14 py-10">
        {/* Hero */}
        <header className="mb-12">
          <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-amber/80">
            Daniel&apos;s Project Space / 2026
          </p>
          <h1 className="mt-2 font-display text-[64px] leading-[1.02] tracking-tight text-paper">
            Project <span className="italic text-paper-dim">Hub</span>
          </h1>
          <p className="mt-3 max-w-xl text-paper-dim text-[15px] leading-relaxed">
            Umbrella dashboard. Each tile is an app. Widgets are embedded
            tools. Backend on Convex, deployed via Vercel.
          </p>
        </header>

        {/* Stats bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-rule-soft/40 mb-12">
          <Stat label="Apps · live" value={liveCount} tone="emerald" />
          <Stat label="Apps · wip" value={wipCount} tone="amber" />
          <Stat
            label="Secrets vaulted"
            value={secretsSummary ? secretsSummary.total : "—"}
          />
          <Stat label="Free deploys left" value="38" />
        </div>

        {/* Apps row */}
        <AppsRow />

        {/* Widgets */}
        <section className="mb-12">
          <SectionLabel
            title="Widgets"
            hint="Embedded tools — one per row by default"
          />
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <RemoteWorkHubWidget />
          </div>
        </section>

        {/* Inline status row */}
        <section className="mb-12">
          <SectionLabel title="Infra · Live" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-rule-soft/40">
            <InfraTile name="Convex" detail="reactive backend · 2 deployments" tone="emerald" />
            <InfraTile name="Vercel" detail="2 projects · auto-deploy" tone="emerald" />
            <InfraTile name="GitHub" detail="daniels-project-space · 3 repos" tone="emerald" />
          </div>
        </section>

        {/* Roadmap line */}
        <section className="mb-12">
          <SectionLabel title="Next" hint="In flight / on deck" />
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-px bg-rule-soft/40">
            <NextItem n="01" title="Migrate apps from VPS → Vercel" detail="rental-manager, app-factory, aria, lofi-generator first" />
            <NextItem n="02" title="Iframe embed each app as widget" detail="As they go live on Vercel, drop them into the Widgets row" />
            <NextItem n="03" title="Auth gate the hub" detail="Single-user Clerk/Convex Auth so the URL isn't open" />
            <NextItem n="04" title="Edit-mode drag&drop" detail="Reorder widgets and apps; persist to Convex" />
          </ul>
        </section>
      </section>

      {/* Footer */}
      <footer className="max-w-[1440px] mx-auto px-8 lg:px-14 pb-10">
        <div className="rule-hairline mb-4" />
        <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.28em] text-paper-faint">
          <span>project-hub · convex · vercel · github</span>
          <span>v0.2</span>
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
    <div className="bg-ink p-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-paper-faint">
        {label}
      </p>
      <p className={`mt-2 font-display text-3xl tabular-nums ${color}`}>
        {value}
      </p>
    </div>
  );
}

function InfraTile({
  name,
  detail,
  tone,
}: {
  name: string;
  detail: string;
  tone: "emerald";
}) {
  return (
    <div className="bg-ink p-5 flex items-start justify-between gap-3">
      <div>
        <p className="font-display text-2xl text-paper">{name}</p>
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-paper-faint mt-2">
          {detail}
        </p>
      </div>
      <span
        className={`w-2 h-2 rounded-full mt-2 ${
          tone === "emerald" ? "bg-emerald-soft pulse-dot" : "bg-amber"
        }`}
      />
    </div>
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
    <li className="bg-ink p-5">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-[11px] text-paper-faint tabular-nums">
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
