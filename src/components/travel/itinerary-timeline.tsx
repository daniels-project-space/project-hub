"use client";

/**
 * ItineraryTimeline — vertical day-by-day timeline. Each day is a card with a
 * date/summary header and a list of items. Per item:
 *   - kind icon + time + title + price + status pill
 *   - status toggle cycling planned → done → skip (setItemStatus)
 *   - delete (removeItem)
 *   - dnd-kit drag-reorder WITHIN a day (reorderItems)
 * Plus an "add item" affordance per day (addItem with a minimal title).
 *
 * Mutations are passed in from the widget so this stays a pure-ish view that the
 * reactive getFull query re-renders after each write.
 */

import { useState } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  MapPin,
  Utensils,
  BedDouble,
  Plane,
  Bus,
  Sparkles,
  GripVertical,
  Trash2,
  Plus,
  Check,
  SkipForward,
  Circle,
  type LucideIcon,
} from "lucide-react";
import type { Id } from "../../../convex/_generated/dataModel";

// Trip item kinds (from the planner schema) → icon + map marker kind.
const KIND_ICON: Record<string, LucideIcon> = {
  place: MapPin,
  food: Utensils,
  stay: BedDouble,
  flight: Plane,
  transport: Bus,
  activity: Sparkles,
};

type ItemStatus = "planned" | "done" | "skip";
const STATUS_CYCLE: Record<ItemStatus, ItemStatus> = {
  planned: "done",
  done: "skip",
  skip: "planned",
};

export interface TripItem {
  _id: Id<"tripItems">;
  dayId: Id<"tripDays">;
  kind: string;
  title: string;
  startTime?: string;
  endTime?: string;
  priceGbp?: number;
  status?: string;
  lat?: number;
  lng?: number;
}
export interface TripDay {
  _id: Id<"tripDays">;
  date?: string;
  dayIndex: number;
  summary?: string;
}

interface TimelineProps {
  days: TripDay[];
  items: TripItem[];
  onReorder: (dayId: Id<"tripDays">, orderedItemIds: Id<"tripItems">[]) => void;
  onSetStatus: (itemId: Id<"tripItems">, status: ItemStatus) => void;
  onRemoveItem: (itemId: Id<"tripItems">) => void;
  onAddItem: (dayId: Id<"tripDays">) => void;
}

const gbp = (n: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(n);

function StatusPill({
  status,
  onClick,
}: {
  status: ItemStatus;
  onClick: () => void;
}) {
  const cfg: Record<ItemStatus, { Icon: LucideIcon; cls: string; label: string }> = {
    planned: {
      Icon: Circle,
      cls: "text-paper-faint border-rule-soft/60",
      label: "Planned",
    },
    done: {
      Icon: Check,
      cls: "text-emerald-soft border-emerald-soft/50 bg-emerald-soft/10",
      label: "Done",
    },
    skip: {
      Icon: SkipForward,
      cls: "text-rose-soft border-rose-soft/50 bg-rose-soft/10 line-through",
      label: "Skip",
    },
  };
  const { Icon, cls, label } = cfg[status];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`status: ${label} (click to cycle)`}
      className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-[0.1em] transition-colors ${cls}`}
    >
      <Icon className="h-2.5 w-2.5" />
      {label}
    </button>
  );
}

function SortableItem({
  item,
  onSetStatus,
  onRemoveItem,
}: {
  item: TripItem;
  onSetStatus: TimelineProps["onSetStatus"];
  onRemoveItem: TimelineProps["onRemoveItem"];
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item._id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const Icon = KIND_ICON[item.kind] ?? Sparkles;
  const status = (item.status as ItemStatus) ?? "planned";
  const time = item.startTime
    ? `${item.startTime}${item.endTime ? `–${item.endTime}` : ""}`
    : null;

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="group flex items-center gap-2 rounded-lg border border-rule-soft/40 bg-ink-2/30 px-2 py-1.5"
    >
      <button
        type="button"
        aria-label="drag to reorder"
        className="shrink-0 cursor-grab touch-none text-paper-faint/60 hover:text-paper-faint active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <Icon className="h-3.5 w-3.5 shrink-0 text-brass/80" />
      <div className="flex-1 min-w-0">
        <p
          className={`text-[12px] leading-tight text-paper truncate ${
            status === "skip" ? "line-through text-paper-faint" : ""
          }`}
        >
          {item.title}
        </p>
        {(time || item.priceGbp != null) && (
          <p className="text-[10px] text-paper-faint tabular-nums truncate">
            {time}
            {time && item.priceGbp != null ? " · " : ""}
            {item.priceGbp != null ? gbp(item.priceGbp) : ""}
          </p>
        )}
      </div>
      <StatusPill
        status={status}
        onClick={() => onSetStatus(item._id, STATUS_CYCLE[status])}
      />
      <button
        type="button"
        onClick={() => onRemoveItem(item._id)}
        aria-label="delete item"
        className="shrink-0 text-paper-faint opacity-0 transition-opacity hover:text-rose-soft group-hover:opacity-100"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

function DayCard({
  day,
  items,
  onReorder,
  onSetStatus,
  onRemoveItem,
  onAddItem,
}: {
  day: TripDay;
  items: TripItem[];
} & Omit<TimelineProps, "days" | "items">) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = items.map((it) => it._id);
    const oldIdx = ids.indexOf(active.id as Id<"tripItems">);
    const newIdx = ids.indexOf(over.id as Id<"tripItems">);
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(ids, oldIdx, newIdx);
    onReorder(day._id, next);
  };

  const dayTotal = items.reduce((s, it) => s + (it.priceGbp ?? 0), 0);
  const dateLabel = day.date
    ? new Date(`${day.date}T00:00:00`).toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
      })
    : `Day ${day.dayIndex + 1}`;

  return (
    <div className="relative pl-5">
      {/* timeline rail + node */}
      <span className="absolute left-0 top-1.5 h-2.5 w-2.5 -translate-x-1/2 rounded-full border-2 border-brass/70 bg-ink" />
      <span className="absolute left-0 top-4 bottom-0 w-px -translate-x-1/2 bg-rule-soft/40" />

      <div className="mb-1 flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[12px] font-display text-paper">{dateLabel}</p>
          {day.summary && (
            <p className="text-[10px] text-paper-faint truncate">{day.summary}</p>
          )}
        </div>
        {dayTotal > 0 && (
          <span className="shrink-0 font-mono text-[10px] text-paper-faint tabular-nums">
            {gbp(dayTotal)}
          </span>
        )}
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={items.map((it) => it._id)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="space-y-1">
            {items.map((it) => (
              <SortableItem
                key={it._id}
                item={it}
                onSetStatus={onSetStatus}
                onRemoveItem={onRemoveItem}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      <button
        type="button"
        onClick={() => onAddItem(day._id)}
        className="mt-1 flex items-center gap-1 text-[11px] text-paper-faint hover:text-brass transition-colors"
      >
        <Plus className="h-3 w-3" /> Add item
      </button>
    </div>
  );
}

export function ItineraryTimeline({
  days,
  items,
  onReorder,
  onSetStatus,
  onRemoveItem,
  onAddItem,
}: TimelineProps) {
  const byDay = new Map<string, TripItem[]>();
  for (const it of items) {
    const arr = byDay.get(it.dayId) ?? [];
    arr.push(it);
    byDay.set(it.dayId, arr);
  }

  if (days.length === 0) {
    return (
      <p className="text-[12px] text-paper-faint py-4 text-center">
        No itinerary yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {days.map((day) => (
        <DayCard
          key={day._id}
          day={day}
          items={byDay.get(day._id) ?? []}
          onReorder={onReorder}
          onSetStatus={onSetStatus}
          onRemoveItem={onRemoveItem}
          onAddItem={onAddItem}
        />
      ))}
    </div>
  );
}

// Helper exported for the widget's map: trip item kind → TripMap MarkerKind.
export function kindToMarker(kind: string):
  | "lodging"
  | "food"
  | "sight"
  | "transport"
  | "activity"
  | "default" {
  switch (kind) {
    case "stay":
      return "lodging";
    case "food":
      return "food";
    case "place":
      return "sight";
    case "transport":
    case "flight":
      return "transport";
    case "activity":
      return "activity";
    default:
      return "default";
  }
}

export default ItineraryTimeline;
