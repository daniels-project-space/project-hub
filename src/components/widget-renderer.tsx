"use client";

import type { ComponentType } from "react";
import { NotesWidget } from "./widgets/notes-widget";
import { CalendarWidget } from "./widgets/calendar-widget";
import { TodoWidget } from "./widgets/todo-widget";
import { WealthWidget } from "./widgets/wealth-widget";
import { ProjectsWidget } from "./widgets/projects-widget";
import { ExpensesWidget } from "./widgets/expenses-widget";
import { HuntsWidget } from "./widgets/hunts-widget";
import { IdeaWidget } from "./widgets/idea-widget";
import { ChannelIdeaWidget } from "./widgets/channel-idea-widget";
import { RemoteWorkHubWidget } from "./widgets/remote-work-hub-widget";
import { TravelWidget } from "./widgets/travel-widget";
import { MusicWidget } from "./widgets/music-widget";
import { WidgetSlot } from "./widget-slot";
import { EmptyState } from "@/components/ui/empty-state";

// widget.type → component registry.
//
// SOURCE OF TRUTH for "which widgets exist". The Convex `widgets` table only
// stores per-widget ORDER + VISIBILITY (the saved layout). The dashboard
// reconciles the saved layout against this registry on load (see
// `dashboard-grid.tsx` + `convex/widgets.ts:reconcile`), so any widget added
// here is GUARANTEED to surface even if it has no row in an older saved layout.
// Insertion order here = default append order for newly-registered widgets.
const REGISTRY: Record<string, ComponentType> = {
  notes: NotesWidget,
  calendar: CalendarWidget,
  todo: TodoWidget,
  wealth: WealthWidget,
  projects: ProjectsWidget,
  expenses: ExpensesWidget,
  hunts: HuntsWidget,
  idea: IdeaWidget,
  channelIdea: ChannelIdeaWidget,
  remoteWorkHub: RemoteWorkHubWidget,
  travel: TravelWidget,
  music: MusicWidget,
};

// Canonical ordered list of every registered widget type. Consumed by the
// dashboard reconcile path and the backfill mutation. Adding an entry to
// REGISTRY above automatically extends this — no second list to keep in sync.
export const WIDGET_TYPES: string[] = Object.keys(REGISTRY);

// Exact implementation locations sent with visual-edit selections. Keeping
// this beside the renderer registry makes the page-to-code link auditable.
export const WIDGET_SOURCES: Record<string, string> = {
  notes: "src/components/widgets/notes-widget.tsx",
  calendar: "src/components/widgets/calendar-widget.tsx",
  todo: "src/components/widgets/todo-widget.tsx",
  wealth: "src/components/widgets/wealth-widget.tsx",
  projects: "src/components/widgets/projects-widget.tsx",
  expenses: "src/components/widgets/expenses-widget.tsx",
  hunts: "src/components/widgets/hunts-widget.tsx",
  idea: "src/components/widgets/idea-widget.tsx",
  channelIdea: "src/components/widgets/channel-idea-widget.tsx",
  remoteWorkHub: "src/components/widgets/remote-work-hub-widget.tsx",
  travel: "src/components/widgets/travel-widget.tsx",
  music: "src/components/widgets/music-widget.tsx",
};

// Membership test used by the reconcile path to know what's renderable.
export function isKnownWidgetType(type: string): boolean {
  return Object.prototype.hasOwnProperty.call(REGISTRY, type);
}

export function WidgetRenderer({ type }: { type: string }) {
  const Component = REGISTRY[type];
  if (!Component) {
    return (
      <WidgetSlot size="small" label={type || "unknown"}>
        <div className="p-2">
          <EmptyState
            title="Unknown widget"
            hint={`No renderer for "${type}"`}
          />
        </div>
      </WidgetSlot>
    );
  }
  return <Component />;
}
