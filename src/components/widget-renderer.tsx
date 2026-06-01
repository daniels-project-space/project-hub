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
