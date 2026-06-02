import type { LucideIcon } from "lucide-react";
import {
  StickyNote,
  Calendar,
  ListTodo,
  Wallet,
  FolderKanban,
  Receipt,
  Search,
  Lightbulb,
  Tv,
  Briefcase,
  Plane,
} from "lucide-react";

// Display metadata for the Add-widget picker (label + icon per widget type).
// Keyed by the same type strings as the REGISTRY in widget-renderer.tsx.
export const WIDGET_META: Record<string, { label: string; Icon: LucideIcon }> = {
  notes: { label: "Notes", Icon: StickyNote },
  calendar: { label: "Calendar", Icon: Calendar },
  todo: { label: "To-do", Icon: ListTodo },
  wealth: { label: "Net Worth", Icon: Wallet },
  projects: { label: "Projects", Icon: FolderKanban },
  expenses: { label: "Expenses", Icon: Receipt },
  hunts: { label: "Hunts · Alerts", Icon: Search },
  idea: { label: "Idea", Icon: Lightbulb },
  channelIdea: { label: "Channel Idea", Icon: Tv },
  remoteWorkHub: { label: "Remote Work Hub", Icon: Briefcase },
  travel: { label: "Travel", Icon: Plane },
};
