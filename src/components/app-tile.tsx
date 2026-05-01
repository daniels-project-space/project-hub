import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AppEntry, AppStatus } from "@/lib/apps";

const STATUS_TONE: Record<AppStatus, { dot: string; text: string; bg: string; border: string }> = {
  live: {
    dot: "bg-emerald-soft",
    text: "text-emerald-soft",
    bg: "bg-emerald-soft/[0.08]",
    border: "border-emerald-soft/30",
  },
  wip: {
    dot: "bg-amber",
    text: "text-amber",
    bg: "bg-amber/[0.08]",
    border: "border-amber/30",
  },
  idea: {
    dot: "bg-paper-faint/60",
    text: "text-paper-faint",
    bg: "bg-rule-soft/30",
    border: "border-rule",
  },
};

export function AppTile({ app }: { app: AppEntry }) {
  const tone = STATUS_TONE[app.status];
  const href = app.vercelUrl ?? "#";
  const isExternal = !!app.vercelUrl;

  const content = (
    <div className="bg-ink hover:bg-ink-2 transition-colors p-5 min-h-[150px] flex flex-col justify-between relative group">
      {/* Bar header — monogram + status badge */}
      <div className="flex items-start justify-between gap-3">
        <div
          className={cn(
            "shrink-0 w-10 h-10 rounded-sm grid place-items-center font-display italic text-base border",
            tone.bg,
            tone.border,
            tone.text,
          )}
        >
          {app.short}
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={cn("w-1.5 h-1.5 rounded-full", tone.dot, app.status !== "idea" && "pulse-dot")}
          />
          <span
            className={cn(
              "font-mono text-[10px] uppercase tracking-[0.2em]",
              tone.text,
            )}
          >
            {app.status}
          </span>
        </div>
      </div>

      {/* Body */}
      <div>
        <h3 className="font-display text-lg text-paper leading-tight">
          {app.name}
        </h3>
        <p className="mt-1 text-xs text-paper-dim leading-relaxed line-clamp-2">
          {app.description}
        </p>
      </div>

      {/* External link icon hover */}
      {isExternal && (
        <ExternalLink className="absolute bottom-3 right-3 w-3 h-3 text-paper-faint opacity-0 group-hover:opacity-100 transition-opacity" />
      )}
    </div>
  );

  if (isExternal) {
    return (
      <Link
        href={href}
        target="_blank"
        rel="noreferrer"
        className="block focus:outline-none focus-visible:ring-1 focus-visible:ring-amber/40"
        aria-label={`Open ${app.name}`}
      >
        {content}
      </Link>
    );
  }
  return (
    <div className="block opacity-90" aria-label={`${app.name} (not yet deployed)`}>
      {content}
    </div>
  );
}
