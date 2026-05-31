"use client";

import { useState, useMemo } from "react";
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
  ListChecks,
  Plus,
  Trash2,
  CalendarDays,
  Tag,
  ChevronDown,
} from "lucide-react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { WidgetSlot } from "../widget-slot";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { DragHandle } from "@/components/ui/drag-handle";
import { EditableValue } from "@/components/ui/editable-value";
import { cn } from "@/lib/utils";
import { APPS } from "@/lib/apps";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type SortMode = "manual" | "due" | "priority" | "project";
type FilterMode = "all" | "active" | "done" | `tag:${string}` | `proj:${string}`;

interface Todo {
  _id: Id<"todos">;
  text: string;
  done: boolean;
  priority: number;
  dueDate?: number;
  tags: string[];
  projectSlug?: string;
  position: number;
  createdAt: number;
  ownerId?: string;
}

// ---------------------------------------------------------------------------
// Priority helpers
// ---------------------------------------------------------------------------
const PRIORITY_LABEL: Record<number, string> = { 0: "none", 1: "low", 2: "med", 3: "high" };
const PRIORITY_TONE: Record<number, "default" | "emerald" | "amber" | "rose"> = {
  0: "default",
  1: "emerald",
  2: "amber",
  3: "rose",
};

// ---------------------------------------------------------------------------
// Due-date helpers
// ---------------------------------------------------------------------------
function dueTone(ms: number): "rose" | "amber" | "emerald" | "default" {
  const now = Date.now();
  const day = 86_400_000;
  if (ms < now) return "rose";
  if (ms - now < day) return "amber";
  if (ms - now < 3 * day) return "emerald";
  return "default";
}

function dueLabel(ms: number): string {
  const now = Date.now();
  const day = 86_400_000;
  if (ms < now) return "overdue";
  const diff = ms - now;
  if (diff < day) return "today";
  const days = Math.ceil(diff / day);
  return `in ${days}d`;
}

// ---------------------------------------------------------------------------
// Sortable todo row
// ---------------------------------------------------------------------------
function TodoRow({
  todo,
  sortMode,
  onToggle,
  onDelete,
  onUpdateText,
  onUpdatePriority,
  onUpdateDue,
  onUpdateTags,
  onUpdateProject,
}: {
  todo: Todo;
  sortMode: SortMode;
  onToggle: () => void;
  onDelete: () => void;
  onUpdateText: (t: string) => void;
  onUpdatePriority: (p: number) => void;
  onUpdateDue: (d: number | undefined) => void;
  onUpdateTags: (tags: string[]) => void;
  onUpdateProject: (slug: string | undefined) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: todo._id });

  const [showMeta, setShowMeta] = useState(false);
  const [tagInput, setTagInput] = useState("");

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const trimmed = tagInput.trim().replace(/^,+|,+$/g, "");
      if (trimmed && !todo.tags.includes(trimmed)) {
        onUpdateTags([...todo.tags, trimmed]);
      }
      setTagInput("");
    }
    if (e.key === "Backspace" && !tagInput && todo.tags.length > 0) {
      onUpdateTags(todo.tags.slice(0, -1));
    }
  };

  const dueDateValue = todo.dueDate
    ? new Date(todo.dueDate).toISOString().slice(0, 10)
    : "";

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="group flex flex-col gap-1 rounded-lg border border-rule-soft/40 bg-ink-2/60 px-2 py-1.5"
    >
      {/* Main row */}
      <div className="flex items-center gap-2">
        {/* Drag handle — only in manual mode */}
        {sortMode === "manual" && (
          <DragHandle className="shrink-0 opacity-0 group-hover:opacity-100" {...attributes} {...listeners} />
        )}

        {/* Checkbox */}
        <button
          type="button"
          onClick={onToggle}
          aria-label={todo.done ? "Mark incomplete" : "Mark complete"}
          className={cn(
            "shrink-0 w-4 h-4 rounded border transition-colors",
            todo.done
              ? "border-emerald-soft/60 bg-emerald-soft/20 text-emerald-soft"
              : "border-rule-soft hover:border-brass",
          )}
        >
          {todo.done && (
            <svg viewBox="0 0 16 16" fill="none" className="w-full h-full p-0.5">
              <path d="M3 8l3.5 3.5 6-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>

        {/* Text */}
        <div className={cn("flex-1 min-w-0 text-sm text-paper", todo.done && "line-through text-paper-faint")}>
          <EditableValue
            value={todo.text}
            onCommit={onUpdateText}
            placeholder="Task text…"
            className="w-full text-sm"
          />
        </div>

        {/* Priority badge */}
        {todo.priority > 0 && (
          <Badge tone={PRIORITY_TONE[todo.priority]}>{PRIORITY_LABEL[todo.priority]}</Badge>
        )}

        {/* Due badge */}
        {todo.dueDate && (
          <Badge tone={dueTone(todo.dueDate)}>{dueLabel(todo.dueDate)}</Badge>
        )}

        {/* Meta toggle */}
        <button
          type="button"
          onClick={() => setShowMeta((v) => !v)}
          aria-label="Toggle metadata"
          className="shrink-0 opacity-0 group-hover:opacity-100 text-paper-faint hover:text-brass transition-colors"
        >
          <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", showMeta && "rotate-180")} />
        </button>

        {/* Delete */}
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete task"
          className="shrink-0 opacity-0 group-hover:opacity-100 text-paper-faint hover:text-rose-soft transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Expanded meta */}
      {showMeta && (
        <div className="pl-6 flex flex-wrap gap-2 items-center mt-0.5">
          {/* Priority selector */}
          <select
            value={todo.priority}
            onChange={(e) => onUpdatePriority(Number(e.target.value))}
            className="bg-ink-2 border border-rule-soft/60 rounded text-[10px] font-mono uppercase tracking-wide text-paper-dim px-1.5 py-0.5 outline-none"
          >
            {[0, 1, 2, 3].map((p) => (
              <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
            ))}
          </select>

          {/* Due date */}
          <div className="flex items-center gap-1 text-paper-faint">
            <CalendarDays className="w-3 h-3" />
            <input
              type="date"
              value={dueDateValue}
              onChange={(e) => {
                const val = e.target.value;
                onUpdateDue(val ? new Date(val).getTime() : undefined);
              }}
              className="bg-ink-2 border border-rule-soft/60 rounded text-[10px] font-mono text-paper-dim px-1.5 py-0.5 outline-none"
            />
            {todo.dueDate && (
              <button
                type="button"
                onClick={() => onUpdateDue(undefined)}
                className="text-paper-faint hover:text-rose-soft text-[10px]"
              >
                ×
              </button>
            )}
          </div>

          {/* Project link */}
          <div className="flex items-center gap-1 text-paper-faint">
            <span className="font-mono text-[9px] uppercase tracking-[0.18em]">proj</span>
            <select
              value={todo.projectSlug ?? ""}
              onChange={(e) => onUpdateProject(e.target.value || undefined)}
              className="bg-ink-2 border border-rule-soft/60 rounded text-[10px] font-mono text-paper-dim px-1.5 py-0.5 outline-none max-w-[120px]"
            >
              <option value="">none</option>
              {APPS.map((a) => (
                <option key={a.slug} value={a.slug}>{a.name}</option>
              ))}
            </select>
          </div>

          {/* Tags */}
          <div className="flex items-center gap-1 flex-wrap">
            <Tag className="w-3 h-3 text-paper-faint shrink-0" />
            {todo.tags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => onUpdateTags(todo.tags.filter((t) => t !== tag))}
                className="inline-flex items-center gap-0.5 rounded-full border border-rule-soft/50 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.15em] text-paper-dim hover:border-rose-soft/50 hover:text-rose-soft transition-colors"
              >
                {tag} ×
              </button>
            ))}
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
              placeholder="add tag…"
              className="bg-transparent border-b border-rule-soft/40 text-[10px] font-mono text-paper-dim placeholder:text-paper-faint outline-none w-16 px-0.5"
            />
          </div>
        </div>
      )}

      {/* Inline tag chips (collapsed view) */}
      {!showMeta && todo.tags.length > 0 && (
        <div className="pl-6 flex flex-wrap gap-1">
          {todo.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-rule-soft/40 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-paper-faint"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Quick-add form
// ---------------------------------------------------------------------------
function QuickAdd({ onAdd }: { onAdd: (text: string, priority: number, dueDate: number | undefined, tags: string[], projectSlug: string | undefined) => void }) {
  const [text, setText] = useState("");
  const [priority, setPriority] = useState(0);
  const [dueDate, setDueDate] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [projectSlug, setProjectSlug] = useState<string>("");
  const [expanded, setExpanded] = useState(false);

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const trimmed = tagInput.trim().replace(/^,+|,+$/g, "");
      if (trimmed && !tags.includes(trimmed)) setTags((t) => [...t, trimmed]);
      setTagInput("");
    }
    if (e.key === "Backspace" && !tagInput && tags.length > 0) {
      setTags((t) => t.slice(0, -1));
    }
  };

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    onAdd(t, priority, dueDate ? new Date(dueDate).getTime() : undefined, tags, projectSlug || undefined);
    setText("");
    setPriority(0);
    setDueDate("");
    setTags([]);
    setTagInput("");
    setProjectSlug("");
    setExpanded(false);
  };

  return (
    <div className="rounded-lg border border-rule-soft/40 bg-ink-2/40 px-2 py-1.5 flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Plus className="w-3.5 h-3.5 text-paper-faint shrink-0" />
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Tab" && text) { e.preventDefault(); setExpanded(true); }
          }}
          placeholder="Add task… (Enter to save, Tab for options)"
          className="flex-1 bg-transparent outline-none text-sm text-paper placeholder:text-paper-faint"
        />
        {text && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-paper-faint hover:text-brass transition-colors text-[10px] font-mono uppercase tracking-wide"
          >
            {expanded ? "less" : "more"}
          </button>
        )}
        {text && (
          <button
            type="button"
            onClick={submit}
            className="shrink-0 rounded bg-brass/20 border border-brass/30 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide text-brass hover:bg-brass/30 transition-colors"
          >
            Add
          </button>
        )}
      </div>

      {expanded && (
        <div className="pl-5 flex flex-wrap gap-2 items-center">
          {/* Priority */}
          <select
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
            className="bg-ink-2 border border-rule-soft/60 rounded text-[10px] font-mono uppercase tracking-wide text-paper-dim px-1.5 py-0.5 outline-none"
          >
            {[0, 1, 2, 3].map((p) => (
              <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
            ))}
          </select>

          {/* Due */}
          <div className="flex items-center gap-1">
            <CalendarDays className="w-3 h-3 text-paper-faint" />
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="bg-ink-2 border border-rule-soft/60 rounded text-[10px] font-mono text-paper-dim px-1.5 py-0.5 outline-none"
            />
          </div>

          {/* Project */}
          <select
            value={projectSlug}
            onChange={(e) => setProjectSlug(e.target.value)}
            className="bg-ink-2 border border-rule-soft/60 rounded text-[10px] font-mono text-paper-dim px-1.5 py-0.5 outline-none max-w-[120px]"
          >
            <option value="">no project</option>
            {APPS.map((a) => (
              <option key={a.slug} value={a.slug}>{a.name}</option>
            ))}
          </select>

          {/* Tags */}
          <div className="flex items-center gap-1 flex-wrap">
            <Tag className="w-3 h-3 text-paper-faint shrink-0" />
            {tags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => setTags((t) => t.filter((x) => x !== tag))}
                className="inline-flex items-center gap-0.5 rounded-full border border-rule-soft/50 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.15em] text-paper-dim hover:border-rose-soft/50 hover:text-rose-soft transition-colors"
              >
                {tag} ×
              </button>
            ))}
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
              placeholder="tag…"
              className="bg-transparent border-b border-rule-soft/40 text-[10px] font-mono text-paper-dim placeholder:text-paper-faint outline-none w-12 px-0.5"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main widget
// ---------------------------------------------------------------------------
export function TodoWidget() {
  const todos = useQuery(api.todos.list) as Todo[] | undefined;
  const addTodo = useMutation(api.todos.add);
  const updateTodo = useMutation(api.todos.update);
  const removeTodo = useMutation(api.todos.remove);
  const reorderTodos = useMutation(api.todos.reorder);

  const [sortMode, setSortMode] = useState<SortMode>("manual");
  const [filter, setFilter] = useState<FilterMode>("all");
  // Local order mirror for instant drag feedback (manual mode only)
  const [localIds, setLocalIds] = useState<Id<"todos">[]>([]);

  // Sync localIds when todos load / change (manual mode)
  const prevIdsKey = todos?.map((t) => t._id).join(",") ?? "";
  useMemo(() => {
    if (todos) {
      setLocalIds((prev) => {
        // Preserve manual order; add new; remove deleted
        const existingSet = new Set(todos.map((t) => t._id));
        const filtered = prev.filter((id) => existingSet.has(id));
        const added = todos.filter((t) => !filtered.includes(t._id)).map((t) => t._id);
        return [...filtered, ...added];
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prevIdsKey]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // ---------------------------------------------------------------------------
  // Derived: collect all unique tags and projects
  // ---------------------------------------------------------------------------
  const allTags = useMemo(() => {
    if (!todos) return [];
    const set = new Set<string>();
    todos.forEach((t) => t.tags.forEach((tag) => set.add(tag)));
    return [...set];
  }, [todos]);

  const allProjects = useMemo(() => {
    if (!todos) return [];
    const set = new Set<string>();
    todos.forEach((t) => { if (t.projectSlug) set.add(t.projectSlug); });
    return [...set];
  }, [todos]);

  // ---------------------------------------------------------------------------
  // Sorting
  // ---------------------------------------------------------------------------
  const sorted = useMemo(() => {
    if (!todos) return [];
    const list = [...todos];
    switch (sortMode) {
      case "due":
        return list.sort((a, b) => {
          if (!a.dueDate && !b.dueDate) return 0;
          if (!a.dueDate) return 1;
          if (!b.dueDate) return -1;
          return a.dueDate - b.dueDate;
        });
      case "priority":
        return list.sort((a, b) => b.priority - a.priority);
      case "project":
        return list.sort((a, b) => (a.projectSlug ?? "").localeCompare(b.projectSlug ?? ""));
      case "manual":
      default: {
        const idxMap = new Map(localIds.map((id, i) => [id, i]));
        return list.sort((a, b) => (idxMap.get(a._id) ?? 999) - (idxMap.get(b._id) ?? 999));
      }
    }
  }, [todos, sortMode, localIds]);

  // ---------------------------------------------------------------------------
  // Filtering
  // ---------------------------------------------------------------------------
  const filtered = useMemo(() => {
    switch (filter) {
      case "active": return sorted.filter((t) => !t.done);
      case "done": return sorted.filter((t) => t.done);
      default:
        if (filter.startsWith("tag:")) {
          const tag = filter.slice(4);
          return sorted.filter((t) => t.tags.includes(tag));
        }
        if (filter.startsWith("proj:")) {
          const slug = filter.slice(5);
          return sorted.filter((t) => t.projectSlug === slug);
        }
        return sorted;
    }
  }, [sorted, filter]);

  // ---------------------------------------------------------------------------
  // Drag handler
  // ---------------------------------------------------------------------------
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setLocalIds((ids) => {
      const oldIdx = ids.indexOf(active.id as Id<"todos">);
      const newIdx = ids.indexOf(over.id as Id<"todos">);
      const next = arrayMove(ids, oldIdx, newIdx);
      reorderTodos({ ids: next });
      return next;
    });
  };

  // ---------------------------------------------------------------------------
  // Add
  // ---------------------------------------------------------------------------
  const handleAdd = (
    text: string,
    priority: number,
    dueDate: number | undefined,
    tags: string[],
    projectSlug: string | undefined,
  ) => {
    addTodo({ text, priority, dueDate, tags, projectSlug });
  };

  // ---------------------------------------------------------------------------
  // Counts for filter badges
  // ---------------------------------------------------------------------------
  const activeCount = todos?.filter((t) => !t.done).length ?? 0;
  const doneCount = todos?.filter((t) => t.done).length ?? 0;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <WidgetSlot size="medium" label="To-Do">
      <div className="flex flex-col gap-2 p-2">
        {/* Sort controls */}
        <div className="flex items-center gap-1 flex-wrap">
          <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-paper-faint mr-1">sort</span>
          {(["manual", "due", "priority", "project"] as SortMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setSortMode(m)}
              className={cn(
                "rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.15em] transition-colors",
                sortMode === m
                  ? "bg-brass/20 border border-brass/40 text-brass"
                  : "text-paper-faint hover:text-paper border border-transparent",
              )}
            >
              {m}
            </button>
          ))}
        </div>

        {/* Filter chips */}
        <div className="flex items-center gap-1 flex-wrap">
          {([
            ["all", `all (${todos?.length ?? 0})`],
            ["active", `active (${activeCount})`],
            ["done", `done (${doneCount})`],
          ] as [FilterMode, string][]).map(([val, label]) => (
            <button
              key={val}
              type="button"
              onClick={() => setFilter(val)}
              className={cn(
                "rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] border transition-colors",
                filter === val
                  ? "bg-brass/20 border-brass/40 text-brass"
                  : "border-rule-soft/40 text-paper-faint hover:text-paper",
              )}
            >
              {label}
            </button>
          ))}
          {allTags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => setFilter(filter === `tag:${tag}` ? "all" : `tag:${tag}`)}
              className={cn(
                "rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] border transition-colors",
                filter === `tag:${tag}`
                  ? "bg-brass/20 border-brass/40 text-brass"
                  : "border-rule-soft/40 text-paper-faint hover:text-paper",
              )}
            >
              #{tag}
            </button>
          ))}
          {allProjects.map((slug) => {
            const app = APPS.find((a) => a.slug === slug);
            return (
              <button
                key={slug}
                type="button"
                onClick={() => setFilter(filter === `proj:${slug}` ? "all" : `proj:${slug}`)}
                className={cn(
                  "rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] border transition-colors",
                  filter === `proj:${slug}`
                    ? "bg-brass/20 border-brass/40 text-brass"
                    : "border-rule-soft/40 text-paper-faint hover:text-paper",
                )}
              >
                {app?.short ?? slug}
              </button>
            );
          })}
        </div>

        {/* Quick-add */}
        <QuickAdd onAdd={handleAdd} />

        {/* Todo list */}
        {todos === undefined ? (
          <div className="py-6 flex items-center justify-center">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint animate-pulse">
              loading…
            </span>
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<ListChecks className="w-6 h-6" />}
            title={filter === "all" ? "No tasks yet" : "Nothing here"}
            hint={filter === "all" ? "Add a task above" : "Try a different filter"}
          />
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext
              items={filtered.map((t) => t._id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="flex flex-col gap-1">
                {filtered.map((todo) => (
                  <TodoRow
                    key={todo._id}
                    todo={todo}
                    sortMode={sortMode}
                    onToggle={() => updateTodo({ id: todo._id, done: !todo.done })}
                    onDelete={() => removeTodo({ id: todo._id })}
                    onUpdateText={(text) => updateTodo({ id: todo._id, text })}
                    onUpdatePriority={(priority) => updateTodo({ id: todo._id, priority })}
                    onUpdateDue={(dueDate) => updateTodo({ id: todo._id, dueDate })}
                    onUpdateTags={(tags) => updateTodo({ id: todo._id, tags })}
                    onUpdateProject={(projectSlug) => updateTodo({ id: todo._id, projectSlug })}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </WidgetSlot>
  );
}
