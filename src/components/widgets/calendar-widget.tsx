"use client";

import { useState, useCallback } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
  Pencil,
  Trash2,
  MapPin,
  FileText,
  X,
} from "lucide-react";
import { WidgetSlot } from "../widget-slot";
import { EmptyState } from "@/components/ui/empty-state";
import { Sheet } from "@/components/ui/sheet";
import { Toggle } from "@/components/ui/toggle";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

type CalendarEvent = {
  _id: Id<"events">;
  title: string;
  start: number;
  end?: number;
  allDay: boolean;
  color: string;
  location?: string;
  notes?: string;
  ownerId?: string;
};

type EventColor = "brass" | "amber" | "emerald" | "rose" | "paper";

const COLOR_OPTIONS: { value: EventColor; label: string; dot: string }[] = [
  { value: "brass",   label: "Brass",   dot: "bg-brass" },
  { value: "amber",   label: "Amber",   dot: "bg-amber" },
  { value: "emerald", label: "Emerald", dot: "bg-emerald-soft" },
  { value: "rose",    label: "Rose",    dot: "bg-rose-soft" },
  { value: "paper",   label: "White",   dot: "bg-paper-dim" },
];

function colorDotClass(color: string): string {
  switch (color) {
    case "amber":   return "bg-amber";
    case "emerald": return "bg-emerald-soft";
    case "rose":    return "bg-rose-soft";
    case "paper":   return "bg-paper-dim";
    default:        return "bg-brass";
  }
}

// ─── Tiny date helpers (no external lib) ─────────────────────────────────────

function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function sameDay(a: number, b: number): boolean {
  return startOfDay(a) === startOfDay(b);
}

function localDatetimeValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localDateValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseLocalDatetime(val: string): number {
  // "YYYY-MM-DDTHH:MM" → local ms
  return new Date(val).getTime();
}

function parseLocalDate(val: string): number {
  // "YYYY-MM-DD" → midnight local ms
  const [y, m, d] = val.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDayLabel(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  if (sameDay(ms, today.getTime())) return "Today";
  if (sameDay(ms, tomorrow.getTime())) return "Tomorrow";
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

/** Returns [year, month, daysInMonth, firstDow] where dow 0=Sun */
function monthInfo(year: number, month: number): [number, number, number, number] {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDow = new Date(year, month, 1).getDay();
  return [year, month, daysInMonth, firstDow];
}

// ─── Exported upcoming-events helper (feeds command-center header) ────────────

export type UpcomingEvent = {
  id: string;
  title: string;
  start: number;
  allDay: boolean;
  color: string;
  location?: string;
};

/**
 * Filter + sort events to upcoming N from a given `now` ms timestamp.
 * Exported so the command-center header can import and render the same list.
 */
export function getUpcomingEvents(
  events: CalendarEvent[] | undefined,
  now: number,
  limit = 8,
): UpcomingEvent[] {
  if (!events) return [];
  return events
    .filter((e) => e.start >= startOfDay(now))
    .sort((a, b) => a.start - b.start)
    .slice(0, limit)
    .map((e) => ({
      id: e._id,
      title: e.title,
      start: e.start,
      allDay: e.allDay,
      color: e.color,
      location: e.location,
    }));
}

// ─── Blank form factory ───────────────────────────────────────────────────────

type EventForm = {
  title: string;
  startInput: string;   // "YYYY-MM-DDTHH:MM" or "YYYY-MM-DD"
  endInput: string;
  allDay: boolean;
  color: EventColor;
  location: string;
  notes: string;
};

function blankForm(prefillDay?: number): EventForm {
  const base = prefillDay ?? Date.now();
  const d = new Date(base);
  d.setHours(9, 0, 0, 0);
  return {
    title: "",
    startInput: localDatetimeValue(d.getTime()),
    endInput: "",
    allDay: false,
    color: "brass",
    location: "",
    notes: "",
  };
}

function formFromEvent(ev: CalendarEvent): EventForm {
  return {
    title: ev.title,
    startInput: ev.allDay ? localDateValue(ev.start) : localDatetimeValue(ev.start),
    endInput: ev.end
      ? (ev.allDay ? localDateValue(ev.end) : localDatetimeValue(ev.end))
      : "",
    allDay: ev.allDay,
    color: (ev.color as EventColor) ?? "brass",
    location: ev.location ?? "",
    notes: ev.notes ?? "",
  };
}

// ─── Event form panel (shared add/edit) ──────────────────────────────────────

function EventFormPanel({
  form,
  setForm,
  onSave,
  onCancel,
  onDelete,
  saving,
}: {
  form: EventForm;
  setForm: (f: EventForm) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
  saving: boolean;
}) {
  const set = <K extends keyof EventForm>(k: K, v: EventForm[K]) =>
    setForm({ ...form, [k]: v });

  return (
    <div className="flex flex-col gap-4 p-5">
      {/* Title */}
      <div className="flex flex-col gap-1.5">
        <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
          Title
        </label>
        <input
          autoFocus
          value={form.title}
          onChange={(e) => set("title", e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onSave(); }}
          placeholder="Event title"
          className={cn(
            "w-full rounded-lg border border-rule-soft/60 bg-ink-3/50 px-3 py-2",
            "text-[14px] text-paper placeholder:text-paper-faint/50 outline-none",
            "focus:border-brass/60 transition-colors",
          )}
        />
      </div>

      {/* All-day toggle */}
      <div className="flex items-center gap-3">
        <Toggle
          checked={form.allDay}
          onChange={(v) => {
            // Convert datetime ↔ date when toggling
            if (v && form.startInput.includes("T")) {
              set("allDay", true);
              setForm({
                ...form,
                allDay: true,
                startInput: form.startInput.split("T")[0],
                endInput: form.endInput ? form.endInput.split("T")[0] : "",
              });
            } else if (!v && !form.startInput.includes("T")) {
              const d = new Date(form.startInput + "T00:00");
              d.setHours(9, 0, 0, 0);
              setForm({
                ...form,
                allDay: false,
                startInput: localDatetimeValue(d.getTime()),
                endInput: "",
              });
            } else {
              set("allDay", v);
            }
          }}
          label="All day"
        />
        <span className="font-mono text-[11px] text-paper-dim">All day</span>
      </div>

      {/* Start */}
      <div className="flex flex-col gap-1.5">
        <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
          {form.allDay ? "Date" : "Start"}
        </label>
        <input
          type={form.allDay ? "date" : "datetime-local"}
          value={form.startInput}
          onChange={(e) => set("startInput", e.target.value)}
          className={cn(
            "w-full rounded-lg border border-rule-soft/60 bg-ink-3/50 px-3 py-2",
            "text-[14px] text-paper outline-none focus:border-brass/60 transition-colors",
            "[color-scheme:dark]",
          )}
        />
      </div>

      {/* End (hidden for all-day single) */}
      {!form.allDay && (
        <div className="flex flex-col gap-1.5">
          <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
            End (optional)
          </label>
          <input
            type="datetime-local"
            value={form.endInput}
            onChange={(e) => set("endInput", e.target.value)}
            className={cn(
              "w-full rounded-lg border border-rule-soft/60 bg-ink-3/50 px-3 py-2",
              "text-[14px] text-paper outline-none focus:border-brass/60 transition-colors",
              "[color-scheme:dark]",
            )}
          />
        </div>
      )}

      {/* Color */}
      <div className="flex flex-col gap-1.5">
        <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
          Color
        </label>
        <div className="flex gap-2 flex-wrap">
          {COLOR_OPTIONS.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => set("color", c.value)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-mono transition-colors",
                form.color === c.value
                  ? "border-brass/70 bg-brass/10 text-brass"
                  : "border-rule-soft/50 bg-ink-3/40 text-paper-faint hover:border-rule-soft",
              )}
            >
              <span className={cn("w-2 h-2 rounded-full", c.dot)} />
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Location */}
      <div className="flex flex-col gap-1.5">
        <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
          Location (optional)
        </label>
        <input
          value={form.location}
          onChange={(e) => set("location", e.target.value)}
          placeholder="Where?"
          className={cn(
            "w-full rounded-lg border border-rule-soft/60 bg-ink-3/50 px-3 py-2",
            "text-[14px] text-paper placeholder:text-paper-faint/50 outline-none",
            "focus:border-brass/60 transition-colors",
          )}
        />
      </div>

      {/* Notes */}
      <div className="flex flex-col gap-1.5">
        <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
          Notes (optional)
        </label>
        <textarea
          value={form.notes}
          onChange={(e) => set("notes", e.target.value)}
          placeholder="Any notes…"
          rows={3}
          className={cn(
            "w-full rounded-lg border border-rule-soft/60 bg-ink-3/50 px-3 py-2",
            "text-[14px] text-paper placeholder:text-paper-faint/50 outline-none resize-none",
            "focus:border-brass/60 transition-colors",
          )}
        />
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between pt-1">
        <div className="flex gap-2">
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-soft/40 bg-rose-soft/10 text-rose-soft text-[12px] font-mono hover:bg-rose-soft/20 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded-lg border border-rule-soft/50 bg-ink-3/40 text-paper-faint text-[12px] font-mono hover:text-paper transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!form.title.trim() || !form.startInput || saving}
            className={cn(
              "px-3 py-1.5 rounded-lg border text-[12px] font-mono transition-colors",
              "border-brass/60 bg-brass/15 text-brass hover:bg-brass/25",
              "disabled:opacity-40 disabled:cursor-not-allowed",
            )}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Month grid ───────────────────────────────────────────────────────────────

function MonthGrid({
  events,
  onDayClick,
  onEventClick,
}: {
  events: CalendarEvent[];
  onDayClick: (dayMs: number) => void;
  onEventClick: (ev: CalendarEvent) => void;
}) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const [, , daysInMonth, firstDow] = monthInfo(viewYear, viewMonth);

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  };

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString([], {
    month: "long", year: "numeric",
  });

  // Build 6×7 grid cells (null = padding)
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const eventsInMonth = events.filter((e) => {
    const d = new Date(e.start);
    return d.getFullYear() === viewYear && d.getMonth() === viewMonth;
  });

  function dotsForDay(day: number): CalendarEvent[] {
    const dayMs = new Date(viewYear, viewMonth, day).getTime();
    return eventsInMonth.filter((e) => sameDay(e.start, dayMs));
  }

  const todayMs = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();

  return (
    <div className="flex flex-col gap-3 p-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={prevMonth}
          className="p-1.5 rounded-lg border border-rule-soft/50 bg-ink-3/40 text-paper-faint hover:text-paper transition-colors"
          aria-label="Previous month"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="font-display italic text-[15px] text-paper">{monthLabel}</span>
        <button
          type="button"
          onClick={nextMonth}
          className="p-1.5 rounded-lg border border-rule-soft/50 bg-ink-3/40 text-paper-faint hover:text-paper transition-colors"
          aria-label="Next month"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 gap-0.5">
        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
          <div
            key={d}
            className="text-center font-mono text-[9px] uppercase tracking-[0.15em] text-paper-faint py-1"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Calendar cells */}
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((day, idx) => {
          if (day === null) {
            return <div key={`pad-${idx}`} className="aspect-square" />;
          }
          const dayMs = new Date(viewYear, viewMonth, day).getTime();
          const isToday = dayMs === todayMs;
          const dots = dotsForDay(day);

          return (
            <button
              key={day}
              type="button"
              onClick={() => onDayClick(dayMs)}
              className={cn(
                "aspect-square flex flex-col items-center justify-start pt-1 rounded-lg",
                "text-[12px] font-mono transition-colors group",
                isToday
                  ? "bg-brass/20 border border-brass/40 text-brass"
                  : "hover:bg-ink-3/60 text-paper-dim border border-transparent",
              )}
            >
              <span className={cn(isToday && "font-bold")}>{day}</span>
              {dots.length > 0 && (
                <div className="flex gap-0.5 mt-0.5 flex-wrap justify-center max-w-[80%]">
                  {dots.slice(0, 3).map((e) => (
                    <button
                      key={e._id}
                      type="button"
                      onClick={(ev) => { ev.stopPropagation(); onEventClick(e); }}
                      title={e.title}
                      className={cn(
                        "w-1.5 h-1.5 rounded-full shrink-0 hover:scale-125 transition-transform",
                        colorDotClass(e.color),
                      )}
                    />
                  ))}
                  {dots.length > 3 && (
                    <span className="text-[8px] text-paper-faint leading-none">+{dots.length - 3}</span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Event list for this month, scrollable */}
      {eventsInMonth.length > 0 && (
        <div className="mt-1 flex flex-col gap-1 max-h-40 overflow-y-auto no-scrollbar">
          <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-paper-faint mb-1">
            This month
          </p>
          {eventsInMonth
            .sort((a, b) => a.start - b.start)
            .map((e) => (
              <button
                key={e._id}
                type="button"
                onClick={() => onEventClick(e)}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-ink-3/60 transition-colors text-left group"
              >
                <span className={cn("w-2 h-2 rounded-full shrink-0", colorDotClass(e.color))} />
                <span className="text-[12px] text-paper truncate flex-1">{e.title}</span>
                <span className="text-[10px] font-mono text-paper-faint shrink-0">
                  {e.allDay
                    ? new Date(e.start).toLocaleDateString([], { day: "numeric", month: "short" })
                    : formatTime(e.start)}
                </span>
                <Pencil className="w-3 h-3 text-paper-faint opacity-0 group-hover:opacity-100 shrink-0" />
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

// ─── Main widget ──────────────────────────────────────────────────────────────

type SheetMode =
  | { kind: "closed" }
  | { kind: "month" }
  | { kind: "add"; prefillDay?: number }
  | { kind: "edit"; event: CalendarEvent };

export function CalendarWidget() {
  const events = useQuery(api.events.list);
  const createEvent = useMutation(api.events.create);
  const updateEvent = useMutation(api.events.update);
  const removeEvent = useMutation(api.events.remove);

  const [sheet, setSheet] = useState<SheetMode>({ kind: "closed" });
  const [form, setForm] = useState<EventForm>(blankForm());
  const [saving, setSaving] = useState(false);

  const openAdd = useCallback((prefillDay?: number) => {
    setForm(blankForm(prefillDay));
    setSheet({ kind: "add", prefillDay });
  }, []);

  const openEdit = useCallback((ev: CalendarEvent) => {
    setForm(formFromEvent(ev));
    setSheet({ kind: "edit", event: ev });
  }, []);

  const closeSheet = useCallback(() => setSheet({ kind: "closed" }), []);

  const handleSave = useCallback(async () => {
    if (!form.title.trim() || !form.startInput) return;
    setSaving(true);
    try {
      const startMs = form.allDay
        ? parseLocalDate(form.startInput)
        : parseLocalDatetime(form.startInput);
      const endMs = form.endInput
        ? (form.allDay ? parseLocalDate(form.endInput) : parseLocalDatetime(form.endInput))
        : undefined;

      if (sheet.kind === "add") {
        await createEvent({
          title: form.title.trim(),
          start: startMs,
          end: endMs,
          allDay: form.allDay,
          color: form.color,
          location: form.location.trim() || undefined,
          notes: form.notes.trim() || undefined,
        });
      } else if (sheet.kind === "edit") {
        await updateEvent({
          id: sheet.event._id,
          title: form.title.trim(),
          start: startMs,
          end: endMs,
          allDay: form.allDay,
          color: form.color,
          location: form.location.trim() || undefined,
          notes: form.notes.trim() || undefined,
        });
      }
      // Return to month view if we came from it, else close
      setSheet({ kind: "month" });
    } finally {
      setSaving(false);
    }
  }, [form, sheet, createEvent, updateEvent]);

  const handleDelete = useCallback(async () => {
    if (sheet.kind !== "edit") return;
    setSaving(true);
    try {
      await removeEvent({ id: sheet.event._id });
      setSheet({ kind: "month" });
    } finally {
      setSaving(false);
    }
  }, [sheet, removeEvent]);

  // ── Upcoming agenda (compact widget body) ──
  const now = Date.now();
  const upcoming = getUpcomingEvents(events as CalendarEvent[] | undefined, now, 6);

  // Group by day
  const grouped: { dayMs: number; evs: UpcomingEvent[] }[] = [];
  for (const ev of upcoming) {
    const dayMs = startOfDay(ev.start);
    const last = grouped[grouped.length - 1];
    if (last && last.dayMs === dayMs) {
      last.evs.push(ev);
    } else {
      grouped.push({ dayMs, evs: [ev] });
    }
  }

  const isLoading = events === undefined;

  // ── Sheet content ──
  const sheetOpen = sheet.kind !== "closed";
  const sheetTitle =
    sheet.kind === "month" ? "Calendar"
    : sheet.kind === "add"  ? "Add event"
    : sheet.kind === "edit" ? "Edit event"
    : "";

  return (
    <>
      <WidgetSlot
        size="medium"
        label="Calendar"
        action={
          <button
            type="button"
            onClick={() => setSheet({ kind: "month" })}
            className="p-1.5 rounded-lg border border-rule-soft/50 bg-ink-3/40 text-paper-faint hover:text-paper transition-colors"
            aria-label="Open calendar"
          >
            <CalendarDays className="w-4 h-4" />
          </button>
        }
      >
        <div className="p-3">
          {isLoading ? (
            // Loading skeleton
            <div className="flex flex-col gap-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex gap-2 items-center">
                  <div className="w-1.5 h-1.5 rounded-full bg-ink-3/60 shrink-0" />
                  <div className="h-3 rounded bg-ink-3/60 flex-1 animate-pulse" style={{ width: `${50 + i * 15}%` }} />
                </div>
              ))}
            </div>
          ) : upcoming.length === 0 ? (
            <EmptyState
              icon={<CalendarDays className="w-5 h-5" />}
              title="No upcoming events"
              hint="Open calendar to add one"
              action={
                <button
                  type="button"
                  onClick={() => openAdd()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-brass/50 bg-brass/10 text-brass text-[12px] font-mono hover:bg-brass/20 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add event
                </button>
              }
              className="py-6"
            />
          ) : (
            <div className="flex flex-col gap-3">
              {grouped.map(({ dayMs, evs }) => (
                <div key={dayMs} className="flex flex-col gap-1">
                  <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-paper-faint px-1">
                    {formatDayLabel(dayMs)}
                  </p>
                  {evs.map((ev) => (
                    <button
                      key={ev.id}
                      type="button"
                      onClick={() => {
                        const full = (events as CalendarEvent[]).find((e) => e._id === ev.id);
                        if (full) openEdit(full);
                      }}
                      className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-ink-3/60 transition-colors text-left group"
                    >
                      <span className={cn("w-2 h-2 rounded-full shrink-0", colorDotClass(ev.color))} />
                      <span className="text-[13px] text-paper truncate flex-1">{ev.title}</span>
                      <span className="text-[10px] font-mono text-paper-faint shrink-0">
                        {ev.allDay ? "All day" : formatTime(ev.start)}
                      </span>
                      {ev.location && (
                        <MapPin className="w-3 h-3 text-paper-faint/60 shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              ))}
              <button
                type="button"
                onClick={() => setSheet({ kind: "month" })}
                className="self-start mt-1 font-mono text-[10px] uppercase tracking-[0.15em] text-brass/70 hover:text-brass transition-colors px-1"
              >
                View month →
              </button>
            </div>
          )}
        </div>
      </WidgetSlot>

      {/* ── Full-screen Sheet ── */}
      <Sheet
        open={sheetOpen}
        onClose={closeSheet}
        title={sheetTitle}
        side="right"
      >
        {sheet.kind === "month" && (
          <div className="flex flex-col min-h-0">
            {/* Sheet header action: Add */}
            <div className="px-5 pt-4 flex justify-end">
              <button
                type="button"
                onClick={() => openAdd()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-brass/50 bg-brass/10 text-brass text-[12px] font-mono hover:bg-brass/20 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Add event
              </button>
            </div>
            <MonthGrid
              events={(events as CalendarEvent[]) ?? []}
              onDayClick={(dayMs) => openAdd(dayMs)}
              onEventClick={openEdit}
            />
          </div>
        )}

        {(sheet.kind === "add" || sheet.kind === "edit") && (
          <EventFormPanel
            form={form}
            setForm={setForm}
            onSave={handleSave}
            onCancel={() => setSheet({ kind: "month" })}
            onDelete={sheet.kind === "edit" ? handleDelete : undefined}
            saving={saving}
          />
        )}
      </Sheet>
    </>
  );
}
