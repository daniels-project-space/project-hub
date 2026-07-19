"use client";
import { useState } from "react";
import { Pencil, Check, MousePointer2 } from "lucide-react";
import { TopBar } from "@/components/top-bar";
import { AppsRow } from "@/components/apps-row";
import { SectionLabel } from "@/components/section-label";
import { DashboardGrid } from "@/components/dashboard-grid";
import { CommandCenter } from "@/components/command-center";

export default function HomePage() {
  const [editMode, setEditMode] = useState(false);

  const startJarvisEdit = () => {
    const jarvis = (window as unknown as {
      JARVIS?: { edit(instruction?: string): boolean };
    }).JARVIS;
    jarvis?.edit("Help me edit the selected element on Project Hub.");
  };

  return (
    <main
      className="min-h-dvh"
      data-jarvis-app="project-hub"
      data-jarvis-page="dashboard"
      data-jarvis-id="page:dashboard"
      data-jarvis-label="Project Hub dashboard"
      data-jarvis-source="src/app/page.tsx"
      data-jarvis-editable
    >
      <TopBar />

      <section className="max-w-[1440px] mx-auto px-8 lg:px-14 py-8">
        {/* Carousel is the top content now (hero text removed). */}
        <AppsRow editMode={editMode} />

        <CommandCenter />

        <section className="mb-12">
          <SectionLabel
            title="Widgets"
            hint={
              editMode
                ? "Drag · resize · remove — saved to Convex"
                : "Tap Edit to rearrange, resize or add widgets"
            }
            action={
              <span className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={startJarvisEdit}
                  data-jarvis-id="control:jarvis-edit"
                  data-jarvis-label="Select a page element for Jarvis"
                  data-jarvis-source="src/app/page.tsx"
                  className="flex items-center gap-1.5 rounded-md border border-cyan-300/25 bg-cyan-300/[0.04] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-200/70 transition-colors hover:border-cyan-300/50 hover:bg-cyan-300/[0.09] hover:text-cyan-100"
                >
                  <MousePointer2 className="h-3 w-3" />
                  Jarvis edit
                </button>
                <button
                  type="button"
                  onClick={() => setEditMode((v) => !v)}
                  aria-pressed={editMode}
                  data-jarvis-id="control:layout-edit"
                  data-jarvis-label="Edit dashboard layout"
                  data-jarvis-source="src/app/page.tsx"
                  className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors ${
                    editMode
                      ? "border-brass/50 bg-brass-dim text-brass"
                      : "border-rule-soft/60 bg-paper/[0.025] hover:bg-paper/[0.05] text-paper-faint hover:text-brass"
                  }`}
                >
                  {editMode ? (
                    <Check className="w-3 h-3" />
                  ) : (
                    <Pencil className="w-3 h-3" />
                  )}
                  {editMode ? "Done" : "Edit"}
                </button>
              </span>
            }
          />
          <DashboardGrid editMode={editMode} />
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
