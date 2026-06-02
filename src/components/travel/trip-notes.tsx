"use client";

/**
 * TripNotes — free-text notes for a trip (Stage 4). A textarea bound to
 * trip.notes with debounced autosave via api.trips.update({tripId,patch:{notes}}).
 *
 * The canonical value lives on the trip (reactive). We keep a local draft so
 * typing is instant, debounce the write (~700ms after the last keystroke), and
 * surface a subtle "saving…/saved" indicator. When the persisted value changes
 * from elsewhere AND the user isn't mid-edit, we re-sync the draft.
 */

import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { NotebookPen, Check, Loader2 } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

type SaveState = "idle" | "saving" | "saved";

export function TripNotes({
  tripId,
  notes,
}: {
  tripId: Id<"trips">;
  /** Persisted notes from the reactive getFull query. */
  notes?: string;
}) {
  const updateTrip = useMutation(api.trips.update);
  const [draft, setDraft] = useState(notes ?? "");
  const [state, setState] = useState<SaveState>("idle");

  // Track whether the user is actively editing so an incoming reactive update
  // doesn't clobber an in-progress edit. dirtyRef true between keystroke + flush.
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-sync local draft when the persisted value changes and we're not dirty.
  useEffect(() => {
    if (!dirtyRef.current) setDraft(notes ?? "");
  }, [notes]);

  // Cleanup timers on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  const onChange = (value: string) => {
    setDraft(value);
    dirtyRef.current = true;
    setState("saving");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void (async () => {
        try {
          await updateTrip({ tripId, patch: { notes: value } });
          dirtyRef.current = false;
          setState("saved");
          if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
          savedTimerRef.current = setTimeout(() => setState("idle"), 1800);
        } catch {
          // Leave dirty so a later edit retries; drop the spinner.
          setState("idle");
        }
      })();
    }, 700);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
          <NotebookPen className="h-3.5 w-3.5 text-brass/80" /> Notes
        </p>
        <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-paper-faint">
          {state === "saving" && (
            <>
              <Loader2 className="h-3 w-3 animate-spin" /> Saving…
            </>
          )}
          {state === "saved" && (
            <>
              <Check className="h-3 w-3 text-emerald-soft" /> Saved
            </>
          )}
        </span>
      </div>
      <textarea
        value={draft}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Reservations, confirmation numbers, packing reminders, links…"
        rows={6}
        className="w-full resize-y rounded-lg border border-rule-soft/50 bg-ink-2/40 px-3 py-2 text-[12px] leading-relaxed text-paper placeholder:text-paper-faint outline-none focus:border-brass/50 transition-colors"
      />
    </div>
  );
}

export default TripNotes;
