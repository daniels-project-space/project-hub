import { APPS } from "@/lib/apps";
import { AppTile } from "./app-tile";
import { SectionLabel } from "./section-label";

export function AppsRow() {
  const live = APPS.filter((a) => a.status === "live");
  const wip = APPS.filter((a) => a.status === "wip");
  const idea = APPS.filter((a) => a.status === "idea");
  const ordered = [...live, ...wip, ...idea];

  return (
    <section className="mb-12">
      <SectionLabel
        title="Apps · Workspaces"
        hint={`${live.length} live · ${wip.length} wip · ${idea.length} idea`}
      />
      <div className="flex gap-4 overflow-x-auto no-scrollbar py-4 px-1 -mx-1">
        {ordered.map((app, i) => (
          <div
            key={app.slug}
            className="dock-rise"
            style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}
          >
            <AppTile app={app} />
          </div>
        ))}
      </div>
    </section>
  );
}
