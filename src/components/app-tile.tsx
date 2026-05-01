import Link from "next/link";
import { cn } from "@/lib/utils";
import { getAppIcon } from "@/lib/app-icons";
import type { AppEntry } from "@/lib/apps";

const STATUS_DOT: Record<AppEntry["status"], string> = {
  live: "bg-emerald-soft",
  wip: "bg-amber",
  idea: "bg-paper-faint/60",
};

export function AppTile({ app }: { app: AppEntry }) {
  const isExternal = !!app.vercelUrl;
  const href = app.vercelUrl ?? "#";

  const inner = (
    <div className="flex flex-col items-center gap-2 shrink-0 w-[80px]">
      <div
        className={cn(
          "dock-icon dock-icon-shine",
          isExternal &&
            "group-hover:-translate-y-1 group-hover:border-brass/40 group-focus-visible:border-brass/60",
          !isExternal && "opacity-80",
        )}
      >
        <span className="relative z-10 [&>svg]:w-7 [&>svg]:h-7">
          {getAppIcon(app.slug)}
        </span>
        <span
          className={cn(
            "absolute bottom-1.5 right-1.5 w-1.5 h-1.5 rounded-full ring-2 ring-ink",
            STATUS_DOT[app.status],
            app.status === "live" && "pulse-dot",
          )}
        />
      </div>
      <span className="font-sans text-[10.5px] font-medium text-paper-dim text-center max-w-[80px] truncate leading-tight tracking-[0.01em]">
        {app.name}
      </span>
    </div>
  );

  if (isExternal) {
    return (
      <Link
        href={href}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open ${app.name}`}
        className="group focus:outline-none focus-visible:ring-1 focus-visible:ring-brass/40 rounded-xl"
      >
        {inner}
      </Link>
    );
  }
  return (
    <div className="group" aria-label={`${app.name} (not yet deployed)`}>
      {inner}
    </div>
  );
}
