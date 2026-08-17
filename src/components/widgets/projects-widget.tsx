"use client";

// Projects widget — polished app list from APPS registry (apps.ts) with
// live/wip/idea status dots. Sourced entirely from static APPS registry
// (no VPS). RemoteWorkHubWidget is preserved — widget-renderer still
// routes the "projects" type through here; see NOTE below.
import { useState } from "react";
import { ExternalLink, GitFork, Maximize2 } from "lucide-react";
import { APPS, type AppEntry, type AppStatus } from "@/lib/apps";
import { WidgetSlot } from "../widget-slot";
import { Sheet } from "@/components/ui/sheet";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// NOTE: RemoteWorkHubWidget previously wrapped here. It fetches
// remote-work-hub-sepia.vercel.app/api/projects (native Vercel source — no
// VPS). It renders its own full-height UI, making it incompatible with being
// nested inside WidgetSlot. The projects widget now renders the APPS registry
// directly (richer, click-through, status-driven). The remote-work-hub widget
// remains importable from ./remote-work-hub-widget for direct use if needed.

const STATUS_DOT: Record<AppStatus, string> = {
  live: "bg-emerald-soft pulse-dot",
  wip: "bg-amber",
  idea: "bg-paper-faint/50",
};

const STATUS_LABEL: Record<AppStatus, string> = {
  live: "live",
  wip: "wip",
  idea: "idea",
};

function ProjectRow({ app }: { app: AppEntry }) {
  const dot = STATUS_DOT[app.status];
  const statusText = STATUS_LABEL[app.status];
  const href = app.vercelUrl ?? app.githubUrl ?? "#";
  const isClickable = href !== "#";
  const openInNewTab = app.openInNewTab !== false;

  const inner = (
    <div className="group flex items-center gap-3 px-5 py-2.5 hover:bg-paper/[0.03] transition-colors">
      {/* Monogram badge */}
      <span
        className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 font-mono text-[10px] font-semibold tracking-wide text-paper-dim border border-rule-soft/50"
        style={{
          background:
            "linear-gradient(135deg, oklch(0.25 0.006 245 / 0.8), oklch(0.2 0.006 245 / 0.6))",
        }}
      >
        {app.short}
      </span>

      {/* Name + description */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-display text-[13px] text-paper group-hover:text-brass transition-colors truncate">
            {app.name}
          </span>
          <span className="font-mono text-[8px] uppercase tracking-[0.18em] text-paper-faint/60 shrink-0">
            {app.category}
          </span>
        </div>
        <p className="font-mono text-[10px] text-paper-faint truncate mt-0.5 leading-tight">
          {app.description}
        </p>
      </div>

      {/* Status indicator */}
      <div className="flex items-center gap-1.5 shrink-0">
        <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-paper-faint">
          {statusText}
        </span>
      </div>

      {/* External link hint */}
      {isClickable && (
        <span className="font-mono text-[11px] text-paper-faint/40 group-hover:text-brass/70 transition-colors ml-1">
          ↗
        </span>
      )}
    </div>
  );

  if (isClickable) {
    return (
      <a
        href={href}
        target={openInNewTab ? "_blank" : undefined}
        rel={openInNewTab ? "noreferrer" : undefined}
        className="block border-b border-rule-soft/30 last:border-b-0"
      >
        {inner}
      </a>
    );
  }

  return (
    <div className="border-b border-rule-soft/30 last:border-b-0">{inner}</div>
  );
}

export function ProjectsWidget() {
  const live = APPS.filter((a) => a.status === "live");
  const wip = APPS.filter((a) => a.status === "wip");
  const idea = APPS.filter((a) => a.status === "idea");
  const ordered = [...live, ...wip, ...idea];
  const [expandOpen, setExpandOpen] = useState(false);

  return (
    <WidgetSlot
      size="full"
      label="Projects"
      status={`${live.length} live · ${wip.length} wip · ${idea.length} idea`}
      action={
        <button
          type="button"
          aria-label="Expand projects"
          onClick={() => setExpandOpen(true)}
          className="p-1 rounded text-paper-faint hover:text-paper"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      }
    >
      <div>
        {ordered.map((app) => (
          <ProjectRow key={app.slug} app={app} />
        ))}
      </div>

      <ExpandedProjectsSheet
        open={expandOpen}
        onClose={() => setExpandOpen(false)}
        live={live}
        wip={wip}
        idea={idea}
      />
    </WidgetSlot>
  );
}

// ── Expanded detail view (Sheet) ────────────────────────────────────────────
// Full project list with status-grouped sections, category breakdown, and
// live github/vercel links + untruncated descriptions per app. Mirrors
// wealth-widget's HistorySheet convention (large centered Sheet).

const STATUS_TONE: Record<AppStatus, "emerald" | "amber" | "default"> = {
  live: "emerald",
  wip: "amber",
  idea: "default",
};

const CATEGORY_LABEL: Record<AppEntry["category"], string> = {
  platform: "Platform",
  creator: "Creator",
  ops: "Ops",
  ai: "AI",
  experiment: "Experiment",
};

function ExpandedProjectRow({ app }: { app: AppEntry }) {
  return (
    <Card className="flex items-start gap-3">
      <span
        className="w-8 h-8 rounded-md flex items-center justify-center shrink-0 font-mono text-[11px] font-semibold tracking-wide text-paper-dim border border-rule-soft/50"
        style={{
          background:
            "linear-gradient(135deg, oklch(0.25 0.006 245 / 0.8), oklch(0.2 0.006 245 / 0.6))",
        }}
      >
        {app.short}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-display text-[14px] text-paper">{app.name}</span>
          <Badge tone={STATUS_TONE[app.status]}>{app.status}</Badge>
          <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-paper-faint/70">
            {CATEGORY_LABEL[app.category]}
          </span>
        </div>
        <p className="mt-1 text-[12px] leading-snug text-paper-dim">{app.description}</p>
        <div className="mt-2 flex items-center gap-3">
          {app.vercelUrl && (
            <a
              href={app.vercelUrl}
              target={app.openInNewTab !== false ? "_blank" : undefined}
              rel={app.openInNewTab !== false ? "noreferrer" : undefined}
              className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint hover:text-brass transition-colors"
            >
              <ExternalLink className="w-3 h-3" /> Live
            </a>
          )}
          {app.githubUrl && (
            <a
              href={app.githubUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint hover:text-brass transition-colors"
            >
              <GitFork className="w-3 h-3" /> Source
            </a>
          )}
          {!app.vercelUrl && !app.githubUrl && (
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint/50">
              no links yet
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

function StatusSection({
  title,
  tone,
  apps,
}: {
  title: string;
  tone: "emerald" | "amber" | "default";
  apps: AppEntry[];
}) {
  if (apps.length === 0) return null;
  return (
    <div>
      <p className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-paper-faint">
        <span
          className={cn(
            "w-1.5 h-1.5 rounded-full",
            tone === "emerald" ? "bg-emerald-soft" : tone === "amber" ? "bg-amber" : "bg-paper-faint/50",
          )}
        />
        {title}
        <span className="text-paper-faint/60">· {apps.length}</span>
      </p>
      <div className="space-y-2">
        {apps.map((app) => (
          <ExpandedProjectRow key={app.slug} app={app} />
        ))}
      </div>
    </div>
  );
}

function ExpandedProjectsSheet({
  open,
  onClose,
  live,
  wip,
  idea,
}: {
  open: boolean;
  onClose: () => void;
  live: AppEntry[];
  wip: AppEntry[];
  idea: AppEntry[];
}) {
  const all = [...live, ...wip, ...idea];
  const byCategory = (Object.keys(CATEGORY_LABEL) as AppEntry["category"][])
    .map((cat) => ({ cat, count: all.filter((a) => a.category === cat).length }))
    .filter((c) => c.count > 0);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Projects · ${all.length} total`}
      side="center"
      className="max-w-3xl w-[min(94vw,760px)]"
    >
      <div className="space-y-5">
        {/* category breakdown */}
        <div className="flex flex-wrap gap-2">
          {byCategory.map(({ cat, count }) => (
            <span
              key={cat}
              className="inline-flex items-center gap-1.5 rounded-full border border-rule-soft/50 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-paper-dim"
            >
              {CATEGORY_LABEL[cat]}
              <span className="text-paper-faint">{count}</span>
            </span>
          ))}
        </div>

        <StatusSection title="Live" tone="emerald" apps={live} />
        <StatusSection title="In progress" tone="amber" apps={wip} />
        <StatusSection title="Idea" tone="default" apps={idea} />
      </div>
    </Sheet>
  );
}
