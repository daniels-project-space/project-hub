"use client";

import { useEffect, useMemo, useState } from "react";
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
import { Plus, X, Minus } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { WidgetRenderer, WIDGET_TYPES } from "./widget-renderer";
import { DragHandle } from "@/components/ui/drag-handle";
import { EmptyState } from "@/components/ui/empty-state";
import { Sheet } from "@/components/ui/sheet";
import { WIDGET_META } from "./widget-meta";

type WidgetRow = {
  _id: Id<"widgets">;
  type: string;
  position: number;
  enabled: boolean;
  config: unknown;
  w?: number;
  h?: number;
};

// Default grid sizing per widget type — mirror of convex/widgets.ts DEFAULT_SIZE.
// Used as the fallback when a row has no persisted w/h (no migration needed).
// `w` = column span (1–4); `h` = height step (1–2).
const DEFAULT_SIZE: Record<string, { w: number; h: number }> = {
  wealth: { w: 3, h: 2 },
  projects: { w: 4, h: 1 },
  notes: { w: 2, h: 1 },
  calendar: { w: 2, h: 1 },
  todo: { w: 2, h: 1 },
  expenses: { w: 2, h: 1 },
  hunts: { w: 2, h: 1 },
  idea: { w: 2, h: 1 },
  channelIdea: { w: 2, h: 1 },
  remoteWorkHub: { w: 2, h: 1 },
  travel: { w: 4, h: 2 },
};
const FALLBACK_SIZE = { w: 2, h: 1 };

// STATIC Tailwind class lookups — literal strings so Tailwind's JIT never
// purges them (dynamically-built class strings like `md:col-span-${w}` WOULD be
// purged). `clampW`/`clampH` keep the index in range.
const COL: Record<number, string> = {
  1: "md:col-span-1",
  2: "md:col-span-2",
  3: "md:col-span-3",
  4: "md:col-span-4",
};
const MINH: Record<number, string> = {
  1: "min-h-0",
  2: "md:min-h-[420px]",
};

const clampW = (n: number) => Math.max(1, Math.min(4, Math.round(n)));
const clampH = (n: number) => Math.max(1, Math.min(2, Math.round(n)));

function sizeOf(row: { type: string; w?: number; h?: number }) {
  const def = DEFAULT_SIZE[row.type] ?? FALLBACK_SIZE;
  return { w: clampW(row.w ?? def.w), h: clampH(row.h ?? def.h) };
}

export function DashboardGrid({ editMode = false }: { editMode?: boolean }) {
  const widgets = useQuery(api.widgets.list) as WidgetRow[] | undefined;
  const reorder = useMutation(api.widgets.reorder);
  const setEnabled = useMutation(api.widgets.setEnabled);
  const setSize = useMutation(api.widgets.setSize);
  const upsert = useMutation(api.widgets.upsert);
  const reconcile = useMutation(api.widgets.reconcile);

  // Local order mirror so drag feels instant; resynced when server data changes.
  const [order, setOrder] = useState<Id<"widgets">[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  useEffect(() => {
    if (widgets) setOrder(widgets.map((w) => w._id));
  }, [widgets]);

  // ── RECONCILE saved layout against the widget REGISTRY ──────────────────
  // The saved layout (Convex `widgets` table) only stores order + visibility +
  // size. If a widget is registered (WIDGET_TYPES) but has NO row in the saved
  // layout — e.g. it was added after this layout was last persisted — it would
  // otherwise never render. Here we detect those and persist them as VISIBLE
  // rows so a newly-registered widget can never silently disappear. Idempotent.
  useEffect(() => {
    if (!widgets) return;
    const present = new Set(widgets.map((w) => w.type));
    const missing = WIDGET_TYPES.filter((t) => !present.has(t));
    if (missing.length === 0) return;
    void reconcile({ types: WIDGET_TYPES });
  }, [widgets, reconcile]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const byId = useMemo(
    () => new Map((widgets ?? []).map((w) => [w._id, w])),
    [widgets],
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

  const ordered = order
    .map((id) => byId.get(id))
    .filter((w): w is WidgetRow => Boolean(w));
  const enabled = ordered.filter((w) => w.enabled);

  // Registry types not yet in the saved layout. The reconcile effect above is
  // persisting them; meanwhile we render them as VISIBLE synthetic tiles so a
  // newly-registered widget appears instantly and never depends on the write
  // landing first.
  const presentTypes = new Set(widgets.map((w) => w.type));
  const pending = WIDGET_TYPES.filter((t) => !presentTypes.has(t));

  // Re-add candidates for the picker: every registry type whose widget is NOT
  // currently enabled (removed/hidden), plus types with no row at all.
  const enabledTypes = new Set(enabled.map((w) => w.type));
  const addable = WIDGET_TYPES.filter((t) => !enabledTypes.has(t));

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

  const onResize = (row: WidgetRow, dw: number, dh: number) => {
    const cur = sizeOf(row);
    const w = clampW(cur.w + dw);
    const h = clampH(cur.h + dh);
    if (w === cur.w && h === cur.h) return;
    void setSize({ id: row._id, w, h });
  };

  // Re-add a widget from the picker: flip a disabled row back on, else create.
  const addWidget = async (type: string) => {
    const existing = widgets.find((w) => w.type === type);
    if (existing) {
      // A disabled/hidden row exists → just flip it back on (the unhide path).
      await setEnabled({ id: existing._id, enabled: true });
    } else {
      // No row at all → create one. Sizing falls back to DEFAULT_SIZE in the
      // grid until the user resizes (upsert has no w/h args), so no migration.
      const nextPos =
        widgets.reduce((m, w) => Math.max(m, w.position), -1) + 1;
      await upsert({ type, position: nextPos, enabled: true, config: {} });
    }
    setPickerOpen(false);
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
                row={w}
                editMode={editMode}
                onRemove={() => void setEnabled({ id: w._id, enabled: false })}
                onResize={(dw, dh) => onResize(w, dw, dh)}
              />
            ))}
            {/* Pending registry widgets being backfilled into the layout. Plain
                tiles (no drag/edit) until reconcile persists them as real rows. */}
            {pending.map((type) => {
              const s = sizeOf({ type });
              return (
                <div
                  key={`pending-${type}`}
                  id={`w-${type}`}
                  className={`relative col-span-1 scroll-mt-20 ${COL[s.w]} ${MINH[s.h]}`}
                >
                  <WidgetRenderer type={type} />
                </div>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>

      {/* Add / Unhide entry. Always available (subtle when not in edit mode);
          the picker lists every registry widget not currently enabled. */}
      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="flex items-center gap-1.5 rounded-md border border-rule-soft/60 bg-paper/[0.025] hover:bg-paper/[0.05] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint hover:text-brass transition-colors"
        >
          <Plus className="w-3 h-3" />
          Add widget
        </button>
        {editMode && (
          <span className="font-mono text-[10px] text-paper-faint/70">
            edit mode · drag · resize · remove
          </span>
        )}
      </div>

      <AddWidgetPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        types={addable}
        onAdd={addWidget}
      />
    </>
  );
}

function SortableWidget({
  row,
  editMode,
  onRemove,
  onResize,
}: {
  row: WidgetRow;
  editMode: boolean;
  onRemove: () => void;
  onResize: (dw: number, dh: number) => void;
}) {
  const { _id: id, type } = row;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !editMode });

  const size = sizeOf(row);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.85 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      id={`w-${type}`}
      style={style}
      className={`relative col-span-1 scroll-mt-20 ${COL[size.w]} ${MINH[size.h]} ${
        editMode ? "ring-1 ring-brass/30 rounded-lg" : ""
      }`}
    >
      {/* In edit mode, dim the widget's own interactive header icons so only the
          edit chrome below is active. Out of edit mode, NO overlay at all → the
          widget renders clean (resolves the old hover-control overlap). */}
      <div className={editMode ? "pointer-events-none select-none" : ""}>
        <WidgetRenderer type={type} />
      </div>

      {editMode && (
        <>
          {/* DRAG handle — top-left. */}
          <div className="absolute left-2 top-2 z-20 rounded bg-ink/80 backdrop-blur-sm px-1 py-0.5">
            <DragHandle {...attributes} {...listeners} />
          </div>

          {/* REMOVE — top-right. */}
          <button
            type="button"
            aria-label={`remove ${type}`}
            onClick={onRemove}
            className="absolute right-2 top-2 z-20 rounded bg-ink/80 backdrop-blur-sm p-1 text-paper-faint hover:text-rose-soft transition-colors"
          >
            <X className="w-4 h-4" />
          </button>

          {/* RESIZE steppers — bottom-right (width + height). */}
          <div className="absolute right-2 bottom-2 z-20 flex items-center gap-2 rounded-md bg-ink/85 backdrop-blur-sm px-2 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-paper-faint">
            <Stepper
              label="W"
              value={size.w}
              min={1}
              max={4}
              onDec={() => onResize(-1, 0)}
              onInc={() => onResize(1, 0)}
            />
            <span className="h-3 w-px bg-rule-soft/50" />
            <Stepper
              label="H"
              value={size.h}
              min={1}
              max={2}
              onDec={() => onResize(0, -1)}
              onInc={() => onResize(0, 1)}
            />
          </div>
        </>
      )}
    </div>
  );
}

function Stepper({
  label,
  value,
  min,
  max,
  onDec,
  onInc,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onDec: () => void;
  onInc: () => void;
}) {
  return (
    <span className="flex items-center gap-1">
      <span className="text-paper-faint/70">{label}</span>
      <button
        type="button"
        aria-label={`decrease ${label}`}
        disabled={value <= min}
        onClick={onDec}
        className="rounded p-0.5 text-paper-faint hover:text-brass disabled:opacity-30 disabled:hover:text-paper-faint transition-colors"
      >
        <Minus className="w-3 h-3" />
      </button>
      <span className="tabular-nums text-paper w-2 text-center">{value}</span>
      <button
        type="button"
        aria-label={`increase ${label}`}
        disabled={value >= max}
        onClick={onInc}
        className="rounded p-0.5 text-paper-faint hover:text-brass disabled:opacity-30 disabled:hover:text-paper-faint transition-colors"
      >
        <Plus className="w-3 h-3" />
      </button>
    </span>
  );
}

function AddWidgetPicker({
  open,
  onClose,
  types,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  types: string[];
  onAdd: (type: string) => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Add widget" side="center">
      <div className="p-4">
        {types.length === 0 ? (
          <EmptyState
            title="All widgets shown"
            hint="Every available widget is already on your dashboard."
          />
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {types.map((type) => {
              const meta = WIDGET_META[type] ?? {
                label: type,
                Icon: Plus,
              };
              const Icon = meta.Icon;
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => onAdd(type)}
                  className="flex items-center gap-2.5 rounded-md border border-rule-soft/60 bg-paper/[0.025] hover:bg-paper/[0.06] hover:border-brass/40 px-3 py-2.5 text-left transition-colors"
                >
                  <Icon className="w-4 h-4 text-brass shrink-0" />
                  <span className="font-sans text-[12px] text-paper">
                    {meta.label}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Sheet>
  );
}
