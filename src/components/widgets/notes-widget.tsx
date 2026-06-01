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
  rectSortingStrategy,
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
  Plus,
  Trash2,
  Pin,
  Search,
  X,
} from "lucide-react";

// ── Color palette mapped to design tokens ──────────────────────────────────
// Post-it tints: slightly richer fill than the old list cards so each cube
// reads as paper, while staying within the hub's muted dark system.
const NOTE_COLORS = [
  { id: "amber",   label: "Amber",   bg: "bg-amber/[0.16]",        border: "border-amber/30",        dot: "bg-amber" },
  { id: "emerald", label: "Emerald", bg: "bg-emerald-soft/[0.16]", border: "border-emerald-soft/30", dot: "bg-emerald-soft" },
  { id: "rose",    label: "Rose",    bg: "bg-rose-soft/[0.16]",    border: "border-rose-soft/30",    dot: "bg-rose-soft" },
  { id: "brass",   label: "Brass",   bg: "bg-brass/[0.16]",        border: "border-brass/30",        dot: "bg-brass" },
  { id: "default", label: "Default", bg: "bg-ink-2/70",            border: "border-rule-soft/40",    dot: "bg-paper-faint" },
] as const;

type NoteColor = (typeof NOTE_COLORS)[number]["id"];

function colorFor(id: string): (typeof NOTE_COLORS)[number] {
  return NOTE_COLORS.find((c) => c.id === id) ?? NOTE_COLORS[NOTE_COLORS.length - 1];
}

// Tiny deterministic rotation per note for post-it "pinned to a board" feel.
const ROTATIONS = ["-rotate-1", "rotate-1", "-rotate-2", "rotate-2", "rotate-0"] as const;
function rotationFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ROTATIONS[h % ROTATIONS.length];
}

// Fixed post-it cube footprint (compact, responsive wrap handles overflow).
const CUBE = "w-[150px] h-[150px]";

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
  const [editing, setEditing] = useState(false);
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
        // Fixed post-it cube: square, soft paper shadow, slight rotation that
        // straightens on hover for a tactile feel.
        "group relative rounded-xl border p-2.5 flex flex-col gap-1.5 shrink-0",
        "shadow-[0_6px_18px_-8px_rgba(0,0,0,0.55)] transition-[transform,box-shadow,background-color] duration-200",
        "hover:rotate-0 hover:shadow-[0_10px_26px_-8px_rgba(0,0,0,0.6)] hover:z-10",
        CUBE,
        c.bg,
        c.border,
        isDragging ? "rotate-0" : rotationFor(note._id),
      )}
    >
      {/* Header row: drag handle + color dot + pin + trash */}
      <div className="flex items-center gap-1">
        <DragHandle {...attributes} {...listeners} className="shrink-0" />

        {/* Color dot — click to open palette */}
        <button
          type="button"
          title="Change colour"
          onClick={() => setShowPalette((v) => !v)}
          className={cn(
            "w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-paper/10 hover:scale-125 transition-transform",
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
          <Pin className="w-3 h-3" fill={note.pinned ? "currentColor" : "none"} />
        </button>

        {/* Delete */}
        <button
          type="button"
          title="Delete note"
          onClick={() => onDelete(note._id)}
          className="text-paper-faint opacity-0 group-hover:opacity-100 hover:text-rose-soft transition-colors"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {/* Colour palette */}
      {showPalette && (
        <div className="flex gap-1 flex-wrap">
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
                "w-3.5 h-3.5 rounded-full ring-1 ring-paper/10 hover:scale-125 transition-transform",
                nc.dot,
                note.color === nc.id && "ring-2 ring-paper/60 scale-125",
              )}
            />
          ))}
        </div>
      )}

      {/* Body: clamped text by default; click to expand into the editor.
          Full text is always available via the title tooltip. */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {editing ? (
          <EditableValue
            value={note.text}
            onCommit={(t) => {
              onUpdate(note._id, t);
              setEditing(false);
            }}
            placeholder="Empty note…"
            multiline
            className="text-[12px] leading-snug text-paper/90 w-full"
            inputClassName="text-[12px] leading-snug min-h-[88px]"
          />
        ) : (
          <button
            type="button"
            title={note.text || "Empty note — click to edit"}
            onClick={() => setEditing(true)}
            className="w-full h-full text-left"
          >
            <p
              className={cn(
                "text-[12px] leading-snug whitespace-pre-wrap break-words line-clamp-5",
                note.text ? "text-paper/90" : "italic text-paper-faint",
              )}
            >
              {note.text || "Empty note…"}
            </p>
          </button>
        )}
      </div>
    </div>
  );
}

// ── Add-note cube ──────────────────────────────────────────────────────────
// Dashed cube tile that sits in the grid. Click to reveal an inline composer.
function AddCube({
  color,
  onColorChange,
  onAdd,
}: {
  color: NoteColor;
  onColorChange: (c: NoteColor) => void;
  onAdd: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    onAdd(t);
    setText("");
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Add note"
        className={cn(
          "shrink-0 rounded-xl border border-dashed border-rule-soft/60 bg-ink-2/30",
          "flex flex-col items-center justify-center gap-1 text-paper-faint",
          "hover:border-brass/50 hover:text-brass hover:bg-brass/[0.06] transition-colors",
          CUBE,
        )}
      >
        <Plus className="w-5 h-5" />
        <span className="font-mono text-[9px] uppercase tracking-[0.16em]">Add note</span>
      </button>
    );
  }

  const c = colorFor(color);
  return (
    <div
      className={cn(
        "shrink-0 rounded-xl border p-2.5 flex flex-col gap-1.5",
        "shadow-[0_6px_18px_-8px_rgba(0,0,0,0.55)]",
        CUBE,
        c.bg,
        c.border,
      )}
    >
      {/* Tint picker + close */}
      <div className="flex items-center gap-1">
        {NOTE_COLORS.map((nc) => (
          <button
            key={nc.id}
            type="button"
            title={nc.label}
            onClick={() => onColorChange(nc.id as NoteColor)}
            className={cn(
              "w-2.5 h-2.5 rounded-full ring-1 ring-paper/10 hover:scale-125 transition-transform",
              nc.dot,
              color === nc.id && "ring-2 ring-paper/60 scale-125",
            )}
          />
        ))}
        <span className="flex-1" />
        <button
          type="button"
          title="Cancel"
          onClick={() => {
            setOpen(false);
            setText("");
          }}
          className="text-paper-faint hover:text-paper transition-colors"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="New note…"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          if (e.key === "Escape") {
            setOpen(false);
            setText("");
          }
        }}
        className="flex-1 min-h-0 w-full resize-none bg-transparent text-[12px] leading-snug text-paper placeholder:text-paper-faint outline-none"
      />

      <button
        type="button"
        onClick={submit}
        disabled={!text.trim()}
        title="Add note (⌘↵)"
        className="self-end p-1 rounded-md bg-brass/10 border border-brass/30 text-brass hover:bg-brass/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
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

  const handleAdd = useCallback(
    async (text: string) => {
      const t = text.trim();
      if (!t) return;
      await addNote({ text: t, color: addColor, pinned: false });
    },
    [addColor, addNote],
  );

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

  // Loading skeleton — cube placeholders
  if (notes === undefined) {
    return (
      <WidgetSlot size="medium" label="Notes">
        <div className="p-3 flex flex-wrap gap-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={cn(
                "rounded-xl bg-ink-2/60 border border-rule-soft/30 animate-pulse",
                CUBE,
              )}
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
        {/* Search bar — only show when there are enough notes to warrant it */}
        {sorted.length > 3 && (
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

        {/* Cube grid: post-it cubes wrap to fill the cell; add-cube is the
            first tile. Search results suppress the add-cube to avoid noise. */}
        <div className="flex-1 overflow-y-auto min-h-0 -mx-1 px-1">
          {filtered.length === 0 && search ? (
            <EmptyState
              icon={<Search className="w-5 h-5" />}
              title="No matches"
              hint={`No notes matching "${search}"`}
            />
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={filtered.map((n) => n._id)}
                strategy={rectSortingStrategy}
              >
                <div className="flex flex-wrap gap-3 content-start">
                  {!search && (
                    <AddCube
                      color={addColor}
                      onColorChange={setAddColor}
                      onAdd={handleAdd}
                    />
                  )}
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

          {/* Sensible empty state hint alongside the add-cube */}
          {sorted.length === 0 && !search && (
            <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-paper-faint">
              No notes yet · tap the dashed cube to add one
            </p>
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
