"use client";

import { Plus, X } from "lucide-react";
import { APPS } from "@/lib/apps";
import { AppTile } from "./app-tile";
import { SectionLabel } from "./section-label";
import { useSettings } from "./settings-provider";

// Hidden carousel apps live under one settings key (Convex-persisted with the
// usual optimistic localStorage seed) so the curated dock survives reloads
// and follows across devices without a schema change.
const HIDDEN_APPS_KEY = "hiddenApps";

export function AppsRow({ editMode = false }: { editMode?: boolean }) {
  const { get, set } = useSettings();
  const hiddenSlugs = get<string[]>(HIDDEN_APPS_KEY, []);
  const hiddenSet = new Set(hiddenSlugs);

  const live = APPS.filter((a) => a.status === "live");
  const wip = APPS.filter((a) => a.status === "wip");
  const idea = APPS.filter((a) => a.status === "idea");
  const ordered = [...live, ...wip, ...idea];

  const visible = ordered.filter((a) => !hiddenSet.has(a.slug));
  const hidden = ordered.filter((a) => hiddenSet.has(a.slug));

  const hide = (slug: string) =>
    set(HIDDEN_APPS_KEY, [...hiddenSlugs.filter((s) => s !== slug), slug]);
  const show = (slug: string) =>
    set(
      HIDDEN_APPS_KEY,
      hiddenSlugs.filter((s) => s !== slug),
    );

  return (
    <section id="apps-carousel" className="mb-12 scroll-mt-20">
      <SectionLabel
        title="Apps · Workspaces"
        hint={
          editMode
            ? `tap × to hide · + restores${hidden.length > 0 ? ` · ${hidden.length} hidden` : ""}`
            : `${live.length} live · ${wip.length} wip · ${idea.length} idea`
        }
      />
      <div className="flex gap-4 overflow-x-auto no-scrollbar py-4 px-1 -mx-1">
        {visible.map((app, i) => (
          <div
            key={app.slug}
            className="relative dock-rise"
            style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}
          >
            {/* Same edit-chrome convention as the widget grid: the tile itself
                goes inert so only the × is interactive. */}
            <div className={editMode ? "pointer-events-none select-none" : ""}>
              <AppTile app={app} />
            </div>
            {editMode && (
              <button
                type="button"
                aria-label={`Hide ${app.name} from carousel`}
                onClick={() => hide(app.slug)}
                className="absolute right-0.5 -top-1 z-20 rounded-full border border-rule-soft/60 bg-ink/90 backdrop-blur-sm p-1 text-paper-faint hover:text-rose-soft hover:border-rose-soft/50 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}
        {/* Hidden apps stay reachable while editing — ghosted, + restores. */}
        {editMode &&
          hidden.map((app) => (
            <div key={app.slug} className="relative">
              <div className="pointer-events-none select-none opacity-35">
                <AppTile app={app} />
              </div>
              <button
                type="button"
                aria-label={`Restore ${app.name} to carousel`}
                onClick={() => show(app.slug)}
                className="absolute right-0.5 -top-1 z-20 rounded-full border border-rule-soft/60 bg-ink/90 backdrop-blur-sm p-1 text-paper-faint hover:text-emerald-soft hover:border-emerald-soft/50 transition-colors"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
          ))}
      </div>
    </section>
  );
}
