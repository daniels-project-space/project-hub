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
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-px bg-rule-soft/40">
        {ordered.map((app) => (
          <AppTile key={app.slug} app={app} />
        ))}
      </div>
    </section>
  );
}
