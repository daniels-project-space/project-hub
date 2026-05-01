"use client";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { TopBar } from "@/components/top-bar";
import { RemoteWorkHubWidget } from "@/components/widgets/remote-work-hub-widget";

export default function HomePage() {
  const projects = useQuery(api.projects.list);
  const secretsSummary = useQuery(api.secrets.summary);

  return (
    <main className="min-h-dvh">
      <TopBar />

      <section className="max-w-[1440px] mx-auto px-8 lg:px-14 py-10">
        {/* Header band */}
        <header className="mb-12">
          <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-amber/80">
            Daniel&apos;s Project Space / 2026
          </p>
          <h1 className="mt-2 font-display text-[64px] leading-[1.02] tracking-tight text-paper">
            Project <span className="italic text-paper-dim">Hub</span>
          </h1>
          <p className="mt-3 max-w-xl text-paper-dim text-[15px] leading-relaxed">
            Umbrella dashboard. Each tile = an app. Widgets = embedded tools.
            Backend on Convex, deployed via Vercel.
          </p>
        </header>

        {/* Status row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-rule-soft/40 mb-12">
          <Stat label="Projects" value={projects ? projects.length : "—"} />
          <Stat
            label="Secrets vaulted"
            value={secretsSummary ? secretsSummary.total : "—"}
          />
          <Stat label="Convex" value="live" tone="emerald" />
          <Stat label="Free deploys left" value="38" />
        </div>

        {/* Widgets section — Remote Work Hub iframe */}
        <div className="mb-10">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.32em] text-paper-faint mb-4">
            Widgets
          </h2>
          <RemoteWorkHubWidget />
        </div>

        {/* Project tiles section */}
        <div>
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.32em] text-paper-faint">
              Projects
            </h2>
            <p className="font-mono text-[11px] text-paper-faint">
              Click any tile to jump in (placeholder for now)
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-rule-soft/40">
            {projects && projects.length > 0
              ? projects.map((p, idx) => (
                  <ProjectTile key={p._id} project={p} index={idx} />
                ))
              : Array.from({ length: 3 }).map((_, i) => (
                  <EmptyTile key={i} index={i} />
                ))}
          </div>
        </div>
      </section>

      <footer className="max-w-[1440px] mx-auto px-8 lg:px-14 pb-10">
        <div className="rule-hairline mb-4" />
        <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.28em] text-paper-faint">
          <span>project-hub · convex · vercel · github</span>
          <span>v0.1</span>
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
  tone?: "emerald";
}) {
  return (
    <div className="bg-ink p-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-paper-faint">
        {label}
      </p>
      <p
        className={`mt-2 font-display text-3xl tabular-nums ${
          tone === "emerald" ? "text-emerald-soft" : "text-paper"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

type Project = {
  _id: string;
  slug: string;
  name: string;
  description?: string;
  vercelUrl?: string;
  githubUrl?: string;
  status: string;
};

function ProjectTile({ project, index }: { project: Project; index: number }) {
  return (
    <a
      href={project.vercelUrl || "#"}
      target={project.vercelUrl ? "_blank" : undefined}
      rel="noreferrer"
      className="bg-ink hover:bg-ink-2 transition-colors p-7 min-h-[200px] flex flex-col justify-between"
    >
      <div className="flex items-start justify-between">
        <span className="font-mono text-[11px] text-paper-faint tabular-nums">
          /{String(index + 1).padStart(2, "0")}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] px-2 py-0.5 text-amber bg-amber-glow">
          {project.status}
        </span>
      </div>
      <div>
        <h3 className="font-display text-2xl text-paper">{project.name}</h3>
        {project.description && (
          <p className="mt-2 text-sm text-paper-dim leading-relaxed">
            {project.description}
          </p>
        )}
      </div>
    </a>
  );
}

function EmptyTile({ index }: { index: number }) {
  return (
    <div className="bg-ink p-7 min-h-[200px] flex flex-col justify-between border border-dashed border-rule-soft/30 m-px">
      <span className="font-mono text-[11px] text-paper-faint tabular-nums">
        /{String(index + 1).padStart(2, "0")}
      </span>
      <div>
        <h3 className="font-display text-2xl italic text-paper-faint">
          Add a project
        </h3>
        <p className="mt-2 text-sm text-paper-faint leading-relaxed">
          Wire it via <code className="font-mono">projects.upsert</code>
        </p>
      </div>
    </div>
  );
}
