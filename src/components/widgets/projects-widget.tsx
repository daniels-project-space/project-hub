"use client";

// Projects widget — polished app list from APPS registry (apps.ts) with
// live/wip/idea status dots. Sourced entirely from static APPS registry
// (no VPS). RemoteWorkHubWidget is preserved — widget-renderer still
// routes the "projects" type through here; see NOTE below.
import { APPS, type AppEntry, type AppStatus } from "@/lib/apps";
import { WidgetSlot } from "../widget-slot";

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
        target="_blank"
        rel="noreferrer"
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

  return (
    <WidgetSlot
      size="full"
      label="Projects"
      status={`${live.length} live · ${wip.length} wip · ${idea.length} idea`}
    >
      <div>
        {ordered.map((app) => (
          <ProjectRow key={app.slug} app={app} />
        ))}
      </div>
    </WidgetSlot>
  );
}
