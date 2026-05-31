"use client";

import { useState, useCallback } from "react";
import { useQuery, useMutation } from "convex/react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { WidgetSlot } from "../widget-slot";
import { EditableValue } from "@/components/ui/editable-value";
import { EmptyState } from "@/components/ui/empty-state";
import { DragHandle } from "@/components/ui/drag-handle";
import { cn } from "@/lib/utils";
import {
  StickyNote,
  Plus,
  Trash2,
  Pin,
  Search,
  X,
} from "lucide-react";

// ── Color palette mapped to design tokens ──────────────────────────────────
const NOTE_COLORS = [
  { id: "amber",   label: "Amber",   bg: "bg-amber/[0.12]",        border: "border-amber/30",        dot: "bg-amber" },
  { id: "emerald", label: "Emerald", bg: "bg-emerald-soft/[0.12]", border: "border-emerald-soft/30", dot: "bg-emerald-soft" },
  { id: "rose",    label: "Rose",    bg: "bg-rose-soft/[0.12]",    border: "border-rose-soft/30",    dot: "bg-rose-soft" },
  { id: "brass",   label: "Brass",   bg: "bg-brass/[0.12]",        border: "border-brass/30",        dot: "bg-brass" },
  { id: "default", label: "Default", bg: "bg-ink-2/60",            border: "border-rule-soft/40",    dot: "bg-paper-faint" },
] as const;

type NoteColor = (typeof NOTE_COLORS)[number]["id"];

function colorFor(id: string): (typeof NOTE_COLORS)[number] {
  return NOTE_COLORS.find((c) => c.id === id) ?? NOTE_COLORS[NOTE_COLORS.length - 1];
}

// ── Note type inferred from query result ───────────────────────────────────
type NoteDoc = {
  _id: Id<"notes">;
  text: string;
  color: string;
  pinned: boolean;
  position: number;
  updatedAt: number;
  ownerId?: string;
};

// ── Sortable note card ─────────────────────────────────────────────────────
function NoteCard({
  note,
  onUpdate,
  onDelete,
  onTogglePin,
  onColorChange,
}: {
  note: NoteDoc;
  onUpdate: (id: Id<"notes">, text: string) => void;
  onDelete: (id: Id<"notes">) => void;
  onTogglePin: (id: Id<"notes">, pinned: boolean) => void;
  onColorChange: (id: Id<"notes">, color: string) => void;
}) {
  const [showPalette, setShowPalette] = useState(false);
  const c = colorFor(note.color);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: note._id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative rounded-lg border p-3 flex flex-col gap-2 transition-colors",
        c.bg,
        c.border,
      )}
    >
      {/* Header row: drag handle + pin + color dot + trash */}
      <div className="flex items-center gap-1.5">
        <DragHandle {...attributes} {...listeners} className="shrink-0" />

        {/* Color dot — click to open palette */}
        <button
          type="button"
          title="Change colour"
          onClick={() => setShowPalette((v) => !v)}
          className={cn(
            "w-3 h-3 rounded-full shrink-0 ring-1 ring-paper/10 hover:scale-125 transition-transform",
            c.dot,
          )}
        />

        {/* Spacer */}
        <span className="flex-1" />

        {/* Pin */}
        <button
          type="button"
          title={note.pinned ? "Unpin" : "Pin"}
          onClick={() => onTogglePin(note._id, !note.pinned)}
          className={cn(
            "transition-colors",
            note.pinned
              ? "text-brass"
              : "text-paper-faint opacity-0 group-hover:opacity-100 hover:text-brass",
          )}
        >
          <Pin className="w-3.5 h-3.5" fill={note.pinned ? "currentColor" : "none"} />
        </button>

        {/* Delete */}
        <button
          type="button"
          title="Delete note"
          onClick={() => onDelete(note._id)}
          className="text-paper-faint opacity-0 group-hover:opacity-100 hover:text-rose-soft transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Colour palette */}
      {showPalette && (
        <div className="flex gap-1.5 flex-wrap">
          {NOTE_COLORS.map((nc) => (
            <button
              key={nc.id}
              type="button"
              title={nc.label}
              onClick={() => {
                onColorChange(note._id, nc.id);
                setShowPalette(false);
              }}
              className={cn(
                "w-4 h-4 rounded-full ring-1 ring-paper/10 hover:scale-125 transition-transform",
                nc.dot,
                note.color === nc.id && "ring-2 ring-paper/60 scale-125",
              )}
            />
          ))}
        </div>
      )}

      {/* Text */}
      <EditableValue
        value={note.text}
        onCommit={(t) => onUpdate(note._id, t)}
        placeholder="Empty note…"
        multiline
        className="text-[13px] leading-relaxed text-paper/90 w-full"
        inputClassName="text-[13px] leading-relaxed min-h-[56px]"
      />
    </div>
  );
}

// ── Main widget ────────────────────────────────────────────────────────────
export function NotesWidget() {
  const notes = useQuery(api.notes.list);
  const addNote   = useMutation(api.notes.add);
  const updateNote = useMutation(api.notes.update);
  const removeNote = useMutation(api.notes.remove);
  const reorderNotes = useMutation(api.notes.reorder);

  const [newText, setNewText] = useState("");
  const [search, setSearch] = useState("");
  const [addColor, setAddColor] = useState<NoteColor>("amber");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Sort: pinned first, then by position
  const sorted: NoteDoc[] = notes
    ? [...notes].sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return a.position - b.position;
      })
    : [];

  // Filter by search
  const filtered = search.trim()
    ? sorted.filter((n) =>
        n.text.toLowerCase().includes(search.toLowerCase()),
      )
    : sorted;

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id || !notes) return;

      const ids = sorted.map((n) => n._id);
      const oldIdx = ids.indexOf(active.id as Id<"notes">);
      const newIdx = ids.indexOf(over.id as Id<"notes">);
      if (oldIdx === -1 || newIdx === -1) return;

      const reordered = [...ids];
      reordered.splice(oldIdx, 1);
      reordered.splice(newIdx, 0, active.id as Id<"notes">);

      reorderNotes({ ids: reordered });
    },
    [notes, sorted, reorderNotes],
  );

  const handleAdd = useCallback(async () => {
    const text = newText.trim();
    if (!text) return;
    await addNote({ text, color: addColor, pinned: false });
    setNewText("");
  }, [newText, addColor, addNote]);

  const handleUpdate = useCallback(
    (id: Id<"notes">, text: string) => {
      updateNote({ id, text });
    },
    [updateNote],
  );

  const handleDelete = useCallback(
    (id: Id<"notes">) => {
      removeNote({ id });
    },
    [removeNote],
  );

  const handleTogglePin = useCallback(
    (id: Id<"notes">, pinned: boolean) => {
      updateNote({ id, pinned });
    },
    [updateNote],
  );

  const handleColorChange = useCallback(
    (id: Id<"notes">, color: string) => {
      updateNote({ id, color });
    },
    [updateNote],
  );

  // Loading skeleton
  if (notes === undefined) {
    return (
      <WidgetSlot size="medium" label="Notes">
        <div className="p-3 flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-16 rounded-lg bg-ink-2/60 border border-rule-soft/30 animate-pulse"
            />
          ))}
        </div>
      </WidgetSlot>
    );
  }

  const pinnedCount = sorted.filter((n) => n.pinned).length;

  return (
    <WidgetSlot size="medium" label="Notes">
      <div className="flex flex-col gap-3 p-3 h-full">
        {/* Quick-add row */}
        <div className="flex gap-2 items-start">
          {/* Color picker for new note */}
          <div className="flex gap-1 pt-2 shrink-0">
            {NOTE_COLORS.map((nc) => (
              <button
                key={nc.id}
                type="button"
                title={nc.label}
                onClick={() => setAddColor(nc.id as NoteColor)}
                className={cn(
                  "w-3 h-3 rounded-full ring-1 ring-paper/10 hover:scale-125 transition-transform",
                  nc.dot,
                  addColor === nc.id && "ring-2 ring-paper/60 scale-125",
                )}
              />
            ))}
          </div>

          <textarea
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            placeholder="Add a note…"
            rows={2}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleAdd();
            }}
            className="flex-1 resize-none bg-ink-2/60 border border-rule-soft/40 rounded-lg px-3 py-2 text-[13px] text-paper placeholder:text-paper-faint outline-none focus:border-brass/50 transition-colors"
          />

          <button
            type="button"
            onClick={handleAdd}
            disabled={!newText.trim()}
            title="Add note (⌘↵)"
            className="shrink-0 mt-1 p-1.5 rounded-lg bg-brass/10 border border-brass/30 text-brass hover:bg-brass/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* Search bar — only show when notes exist */}
        {sorted.length > 2 && (
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-paper-faint pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search notes…"
              className="w-full pl-8 pr-8 py-1.5 text-[12px] bg-ink-2/40 border border-rule-soft/30 rounded-lg text-paper placeholder:text-paper-faint outline-none focus:border-brass/40 transition-colors"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-paper-faint hover:text-paper transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Pin section label */}
        {pinnedCount > 0 && !search && (
          <p className="section-rule flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-paper-faint">
            Pinned
          </p>
        )}

        {/* Notes list */}
        <div className="flex-1 overflow-y-auto min-h-0 -mx-1 px-1">
          {filtered.length === 0 && search ? (
            <EmptyState
              icon={<Search className="w-5 h-5" />}
              title="No matches"
              hint={`No notes matching "${search}"`}
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<StickyNote className="w-6 h-6" />}
              title="No notes yet"
              hint="Type above and press + to add"
            />
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={filtered.map((n) => n._id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="flex flex-col gap-2">
                  {filtered.map((note) => (
                    <NoteCard
                      key={note._id}
                      note={note}
                      onUpdate={handleUpdate}
                      onDelete={handleDelete}
                      onTogglePin={handleTogglePin}
                      onColorChange={handleColorChange}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>

        {/* Footer count */}
        {sorted.length > 0 && (
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint text-right">
            {sorted.length} note{sorted.length !== 1 ? "s" : ""}
            {pinnedCount > 0 ? ` · ${pinnedCount} pinned` : ""}
          </p>
        )}
      </div>
    </WidgetSlot>
  );
}
