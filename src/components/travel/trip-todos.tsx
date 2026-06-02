"use client";

/**
 * TripTodos — per-trip checklist (Stage 4). Convex-persisted via api.tripExtras:
 *   listTodos (reactive) → checkbox rows (toggleTodo) + delete (removeTodo)
 *   addTodo input; optional dnd-kit reorder (reorderTodos) reusing the same
 *   PointerSensor pattern as itinerary-timeline.
 *
 * Pure-ish: all reads come from the reactive listTodos query, all writes go
 * straight to the mutations, so the list re-renders after each change.
 */

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
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
  GripVertical,
  Trash2,
  Plus,
  Check,
  Square,
  ListChecks,
} from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id, Doc } from "../../../convex/_generated/dataModel";

type Todo = Doc<"tripTodos">;

function SortableTodo({
  todo,
  onToggle,
  onRemove,
}: {
  todo: Todo;
  onToggle: (id: Id<"tripTodos">) => void;
  onRemove: (id: Id<"tripTodos">) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: todo._id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
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
      <button
        type="button"
        onClick={() => onToggle(todo._id)}
        aria-label={todo.done ? "mark not done" : "mark done"}
        className={`shrink-0 transition-colors ${
          todo.done ? "text-emerald-soft" : "text-paper-faint hover:text-brass"
        }`}
      >
        {todo.done ? (
          <Check className="h-4 w-4" />
        ) : (
          <Square className="h-4 w-4" />
        )}
      </button>
      <span
        className={`flex-1 min-w-0 truncate text-[12px] leading-tight ${
          todo.done ? "line-through text-paper-faint" : "text-paper"
        }`}
      >
        {todo.text}
      </span>
      <button
        type="button"
        onClick={() => onRemove(todo._id)}
        aria-label="delete todo"
        className="shrink-0 text-paper-faint opacity-0 transition-opacity hover:text-rose-soft group-hover:opacity-100"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

export function TripTodos({ tripId }: { tripId: Id<"trips"> }) {
  const todos = useQuery(api.tripExtras.listTodos, { tripId }) as
    | Todo[]
    | undefined;
  const addTodo = useMutation(api.tripExtras.addTodo);
  const toggleTodo = useMutation(api.tripExtras.toggleTodo);
  const removeTodo = useMutation(api.tripExtras.removeTodo);
  const reorderTodos = useMutation(api.tripExtras.reorderTodos);

  const [text, setText] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const list = todos ?? [];
  const remaining = list.filter((t) => !t.done).length;

  const add = () => {
    const t = text.trim();
    if (!t) return;
    void addTodo({ tripId, text: t });
    setText("");
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = list.map((t) => t._id);
    const oldIdx = ids.indexOf(active.id as Id<"tripTodos">);
    const newIdx = ids.indexOf(over.id as Id<"tripTodos">);
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(ids, oldIdx, newIdx);
    void reorderTodos({ tripId, orderedIds: next });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
          <ListChecks className="h-3.5 w-3.5 text-brass/80" /> To-do
        </p>
        {list.length > 0 && (
          <span className="font-mono text-[10px] tabular-nums text-paper-faint">
            {remaining} left
          </span>
        )}
      </div>

      <div className="flex items-center gap-1.5 rounded-lg border border-rule-soft/50 bg-ink-2/40 px-2.5 py-1.5">
        <Plus className="h-3.5 w-3.5 shrink-0 text-brass/80" />
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="add a to-do…"
          className="flex-1 min-w-0 bg-transparent outline-none text-[12px] text-paper placeholder:text-paper-faint"
        />
        <button
          type="button"
          onClick={add}
          disabled={!text.trim()}
          className="shrink-0 rounded border border-brass/40 bg-brass/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.12em] text-brass hover:bg-brass/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Add
        </button>
      </div>

      {todos === undefined ? (
        <p className="text-[11px] text-paper-faint py-2">Loading…</p>
      ) : list.length === 0 ? (
        <p className="text-[11px] text-paper-faint py-2">
          Nothing to do yet — add a task above.
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={list.map((t) => t._id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="space-y-1">
              {list.map((t) => (
                <SortableTodo
                  key={t._id}
                  todo={t}
                  onToggle={(id) => void toggleTodo({ todoId: id })}
                  onRemove={(id) => void removeTodo({ todoId: id })}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

export default TripTodos;
