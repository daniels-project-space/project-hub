"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Eye, EyeOff } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { WidgetRenderer } from "./widget-renderer";
import { DragHandle } from "@/components/ui/drag-handle";
import { EmptyState } from "@/components/ui/empty-state";

type WidgetRow = {
  _id: Id<"widgets">;
  type: string;
  position: number;
  enabled: boolean;
  config: unknown;
};

const SPAN: Record<string, string> = {
  wealth: "md:col-span-3",
  projects: "md:col-span-4",
  notes: "md:col-span-2",
  calendar: "md:col-span-2",
  todo: "md:col-span-2",
};

export function DashboardGrid() {
  const widgets = useQuery(api.widgets.list) as WidgetRow[] | undefined;
  const reorder = useMutation(api.widgets.reorder);
  const setEnabled = useMutation(api.widgets.setEnabled);

  // Local order mirror so drag feels instant; resynced when server data changes.
  const [order, setOrder] = useState<Id<"widgets">[]>([]);
  useEffect(() => {
    if (widgets) setOrder(widgets.map((w) => w._id));
  }, [widgets]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  if (widgets === undefined) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="md:col-span-4 text-paper-faint text-xs font-mono py-8 text-center">
          loading widgets...
        </div>
      </div>
    );
  }

  if (widgets.length === 0) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="md:col-span-4">
          <EmptyState
            title="No widgets yet"
            hint="Run convex run widgets:seed to populate defaults"
          />
        </div>
      </div>
    );
  }

  const byId = new Map(widgets.map((w) => [w._id, w]));
  const ordered = order
    .map((id) => byId.get(id))
    .filter((w): w is WidgetRow => Boolean(w));
  const enabled = ordered.filter((w) => w.enabled);
  const hidden = ordered.filter((w) => !w.enabled);

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = order.indexOf(active.id as Id<"widgets">);
    const newIndex = order.indexOf(over.id as Id<"widgets">);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(order, oldIndex, newIndex);
    setOrder(next);
    void reorder({ ids: next });
  };

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={order} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {enabled.map((w) => (
              <SortableWidget
                key={w._id}
                id={w._id}
                type={w.type}
                onHide={() => void setEnabled({ id: w._id, enabled: false })}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {hidden.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-paper-faint">
            hidden
          </span>
          {hidden.map((w) => (
            <button
              key={w._id}
              type="button"
              onClick={() => void setEnabled({ id: w._id, enabled: true })}
              className="flex items-center gap-1.5 rounded-md border border-rule-soft/60 bg-paper/[0.025] hover:bg-paper/[0.05] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint hover:text-brass transition-colors"
            >
              <Eye className="w-3 h-3" />
              {w.type}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function SortableWidget({
  id,
  type,
  onHide,
}: {
  id: Id<"widgets">;
  type: string;
  onHide: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.85 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative col-span-1 ${SPAN[type] ?? "md:col-span-2"}`}
    >
      {/* Hover controls: drag handle + hide eye, layered over the widget frame.
          pointer-events-none while hidden so the overlay never intercepts clicks
          on widget buttons underneath (e.g. "Open calendar"). */}
      <div className="absolute right-3 top-3 z-20 flex items-center gap-1.5 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto transition-opacity">
        <button
          type="button"
          aria-label={`hide ${type}`}
          onClick={onHide}
          className="text-paper-faint hover:text-rose-soft transition-colors"
        >
          <EyeOff className="w-4 h-4" />
        </button>
        <DragHandle {...attributes} {...listeners} />
      </div>
      <WidgetRenderer type={type} />
    </div>
  );
}
