"use client";

/**
 * PackingChecklist — a simple per-trip packing list. Persisted in localStorage
 * keyed by tripId (survives reload, no schema change required, SSR-safe via
 * window guards). Add/toggle/remove items; a small set of sensible defaults is
 * offered on an empty list.
 */

import { useEffect, useState } from "react";
import { Plus, Check, X, Luggage } from "lucide-react";

interface PackItem {
  id: string;
  text: string;
  done: boolean;
}

const DEFAULTS = [
  "Passport",
  "Phone charger",
  "Adapter",
  "Toiletries",
  "Medication",
];

function storageKey(tripId: string) {
  return `hub-packing:${tripId}`;
}

function load(tripId: string): PackItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(tripId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PackItem[]) : [];
  } catch {
    return [];
  }
}

function save(tripId: string, items: PackItem[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(tripId), JSON.stringify(items));
  } catch {
    /* ignore quota / disabled storage */
  }
}

export function PackingChecklist({ tripId }: { tripId: string }) {
  const [items, setItems] = useState<PackItem[]>([]);
  const [draft, setDraft] = useState("");

  // Load when the trip changes (client only).
  useEffect(() => {
    setItems(load(tripId));
  }, [tripId]);

  const commit = (next: PackItem[]) => {
    setItems(next);
    save(tripId, next);
  };

  const add = (text: string) => {
    const t = text.trim();
    if (!t) return;
    commit([
      ...items,
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text: t, done: false },
    ]);
    setDraft("");
  };

  const toggle = (id: string) =>
    commit(items.map((it) => (it.id === id ? { ...it, done: !it.done } : it)));

  const remove = (id: string) => commit(items.filter((it) => it.id !== id));

  const seedDefaults = () =>
    commit(
      DEFAULTS.map((text, i) => ({
        id: `def-${Date.now()}-${i}`,
        text,
        done: false,
      })),
    );

  const packed = items.filter((it) => it.done).length;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
          <Luggage className="h-3.5 w-3.5 text-brass/80" />
          Packing
        </span>
        {items.length > 0 && (
          <span className="font-mono text-[10px] text-paper-faint tabular-nums">
            {packed}/{items.length}
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <button
          type="button"
          onClick={seedDefaults}
          className="self-start rounded-lg border border-rule-soft/50 bg-ink-2/40 px-2.5 py-1 text-[11px] text-paper-faint hover:text-paper hover:border-brass/50 transition-colors"
        >
          + Add starter list
        </button>
      ) : (
        <ul className="space-y-0.5 max-h-40 overflow-auto pr-1">
          {items.map((it) => (
            <li key={it.id} className="group flex items-center gap-2">
              <button
                type="button"
                onClick={() => toggle(it.id)}
                aria-label={it.done ? "mark not packed" : "mark packed"}
                className={`grid h-4 w-4 shrink-0 place-items-center rounded border transition-colors ${
                  it.done
                    ? "border-emerald-soft/60 bg-emerald-soft/20 text-emerald-soft"
                    : "border-rule-soft/60 text-transparent hover:border-brass/60"
                }`}
              >
                <Check className="h-3 w-3" />
              </button>
              <span
                className={`flex-1 min-w-0 truncate text-[12px] ${
                  it.done ? "text-paper-faint line-through" : "text-paper"
                }`}
              >
                {it.text}
              </span>
              <button
                type="button"
                onClick={() => remove(it.id)}
                aria-label="remove"
                className="shrink-0 text-paper-faint opacity-0 transition-opacity hover:text-rose-soft group-hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-1.5 rounded-lg border border-rule-soft/50 bg-ink-2/40 px-2.5 py-1.5">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add(draft)}
          placeholder="Add item…"
          className="flex-1 min-w-0 bg-transparent outline-none text-sm text-paper placeholder:text-paper-faint"
        />
        <button
          type="button"
          onClick={() => add(draft)}
          disabled={!draft.trim()}
          aria-label="add packing item"
          className="shrink-0 text-paper-faint hover:text-brass disabled:opacity-40 transition-colors"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export default PackingChecklist;
