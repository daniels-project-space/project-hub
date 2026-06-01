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
};

// Canonical ordered list of every registered widget type. Consumed by the
// dashboard reconcile path and the backfill mutation. Adding an entry to
// REGISTRY above automatically extends this — no second list to keep in sync.
export const WIDGET_TYPES: string[] = Object.keys(REGISTRY);

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
