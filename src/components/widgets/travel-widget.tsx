"use client";

/**
 * TravelWidget — AI trip planner for the hub dashboard (Wave 2b).
 *
 * Consumes the Wave-1/2a backend EXACTLY:
 *   queries   : api.trips.list, api.trips.getFull
 *   mutations : api.trips.{update,setActive,create,addItem,removeItem,
 *               reorderItems,setItemStatus,saveToCalendar}
 *   actions   : api.travelActions.planTrip, api.travelActions.flightStatus
 *   libs      : src/lib/travel/* (consumed inside InfoRail)
 *   map       : src/components/travel/trip-map
 *
 * Responsive single tree: map + timeline stack on mobile, side-by-side on md+.
 * All async states (planning spinner, errors, empty) are handled; no crash when
 * a query/action returns null.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Plane,
  Sparkles,
  Mic,
  Loader2,
  CalendarPlus,
  ChevronDown,
  Check,
  Map as MapIcon,
  Tag,
  Globe2,
  CalendarRange,
  Maximize2,
  Utensils,
  Coffee,
  Landmark,
  Trees,
  Wine,
  ShoppingBasket,
  Mountain,
  type LucideIcon,
} from "lucide-react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { WidgetSlot } from "../widget-slot";
import { EditableValue } from "@/components/ui/editable-value";
import { cn } from "@/lib/utils";
import { TripMap, type TripMarker } from "@/components/travel/trip-map";
import {
  ItineraryTimeline,
  kindToMarker,
  type TripItem,
  type TripDay,
} from "@/components/travel/itinerary-timeline";
import { InfoRail } from "@/components/travel/info-rail";
import { FlightChip } from "@/components/travel/flight-chip";
import { PackingChecklist } from "@/components/travel/packing-checklist";
import {
  INTEREST_CATEGORIES,
  type CategoryIconName,
} from "@/lib/travel/categories";

// ── mode + category icon resolution ────────────────────────────────────────
type TravelMode = "planner" | "deal" | "trip";

// Map the category module's icon-name strings → actual lucide components, so the
// categories.ts module stays SSR-safe / icon-library-agnostic.
const CATEGORY_ICONS: Record<CategoryIconName, LucideIcon> = {
  Utensils,
  Coffee,
  Landmark,
  Trees,
  Wine,
  ShoppingBasket,
  Mountain,
};

// ── trip type (mirror convex/schema trips) ─────────────────────────────────
interface Trip {
  _id: Id<"trips">;
  title: string;
  startDate?: string;
  endDate?: string;
  budgetGbp?: number;
  currency?: string;
  originCity?: string;
  destCity?: string;
  destLat?: number;
  destLng?: number;
  destCountryCode?: string;
  active?: boolean;
  // v3 multi-mode (Stage 0) — drive the widget's mode + category chips.
  mode?: string;
  categories?: string[];
  notes?: string;
  createdAt: number;
}

const gbp = (n: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(n);

// Minimal SpeechRecognition typing (avoids `any`; guarded for SSR/unsupported).
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// ── Prompt + planning row ──────────────────────────────────────────────────
function PromptRow({
  onPlanned,
  categories,
  startDate,
  endDate,
}: {
  onPlanned: (tripId: Id<"trips">) => void;
  /** Enabled interest-category slugs (constrains generation). */
  categories?: string[];
  /** Timeframe (drives itinerary length + dates). */
  startDate?: string;
  endDate?: string;
}) {
  const planTrip = useAction(api.travelActions.planTrip);
  const [prompt, setPrompt] = useState("");
  const [budget, setBudget] = useState("");
  const [origin, setOrigin] = useState("");
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);

  const speechSupported = useMemo(() => getSpeechRecognitionCtor() !== null, []);

  const toggleVoice = () => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
    if (listening) {
      recRef.current?.stop();
      return;
    }
    try {
      const rec = new Ctor();
      rec.lang = "en-GB";
      rec.interimResults = false;
      rec.onresult = (e) => {
        const text = e.results?.[0]?.[0]?.transcript ?? "";
        if (text) setPrompt((p) => (p ? `${p} ${text}` : text));
      };
      rec.onerror = () => setListening(false);
      rec.onend = () => setListening(false);
      recRef.current = rec;
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  };

  const go = async () => {
    const p = prompt.trim();
    if (!p || planning) return;
    setPlanning(true);
    setError(null);
    try {
      const budgetNum = budget.trim() ? Number(budget) : undefined;
      const res = await planTrip({
        prompt: p,
        budgetGbp:
          budgetNum != null && Number.isFinite(budgetNum) ? budgetNum : undefined,
        originCity: origin.trim() || undefined,
        // Stage 1: shape generation by the current category + timeframe picks.
        categories: categories && categories.length > 0 ? categories : undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });
      setPrompt("");
      setBudget("");
      setOrigin("");
      if (res?.tripId) onPlanned(res.tripId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Trip planning failed";
      setError(
        /ANTHROPIC_API_KEY/.test(msg)
          ? "Planner unavailable — add ANTHROPIC_API_KEY to the vault."
          : msg,
      );
    } finally {
      setPlanning(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="flex items-center gap-1.5 flex-1 min-w-[12rem] rounded-lg border border-rule-soft/50 bg-ink-2/40 px-2.5 py-1.5">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-brass/80" />
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && go()}
            disabled={planning}
            placeholder="plan barcelona 3 days under 400"
            className="flex-1 min-w-0 bg-transparent outline-none text-sm text-paper placeholder:text-paper-faint disabled:opacity-60"
          />
          {speechSupported && (
            <button
              type="button"
              onClick={toggleVoice}
              aria-label="dictate trip"
              className={cn(
                "shrink-0 transition-colors",
                listening ? "text-rose-soft animate-pulse" : "text-paper-faint hover:text-brass",
              )}
            >
              <Mic className="h-4 w-4" />
            </button>
          )}
        </div>
        <input
          type="number"
          inputMode="numeric"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && go()}
          disabled={planning}
          placeholder="£ budget"
          className="w-24 rounded-lg border border-rule-soft/50 bg-ink-2/40 px-2.5 py-1.5 text-sm text-paper placeholder:text-paper-faint outline-none disabled:opacity-60"
        />
        <input
          type="text"
          value={origin}
          onChange={(e) => setOrigin(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && go()}
          disabled={planning}
          placeholder="from (origin)"
          className="w-28 rounded-lg border border-rule-soft/50 bg-ink-2/40 px-2.5 py-1.5 text-sm text-paper placeholder:text-paper-faint outline-none disabled:opacity-60"
        />
        <button
          type="button"
          onClick={go}
          disabled={planning || !prompt.trim()}
          className="shrink-0 flex items-center gap-1.5 rounded-lg border border-brass/40 bg-brass/10 px-3 py-1.5 text-[12px] font-mono uppercase tracking-[0.14em] text-brass hover:bg-brass/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {planning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {planning ? "Planning…" : "Go"}
        </button>
      </div>

      {planning && (
        <div className="flex items-center gap-2 rounded-lg border border-rule-soft/40 bg-ink-2/30 px-2.5 py-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-brass" />
          <span className="text-[12px] text-paper-faint">
            Planning your trip… this takes ~10–30s
          </span>
        </div>
      )}
      {error && !planning && (
        <p className="text-[11px] text-rose-soft">{error}</p>
      )}
    </div>
  );
}

// ── Trip selector (segmented + dropdown) ───────────────────────────────────
function TripSelector({
  trips,
  selectedId,
  onSelect,
}: {
  trips: Trip[];
  selectedId: Id<"trips"> | null;
  onSelect: (id: Id<"trips">) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = trips.find((t) => t._id === selectedId);
  if (trips.length === 0) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-lg border border-rule-soft/50 bg-ink-2/40 px-2.5 py-1.5 text-[12px] text-paper hover:border-brass/50 transition-colors max-w-[16rem]"
      >
        <Plane className="h-3.5 w-3.5 shrink-0 text-brass/80" />
        <span className="truncate">{selected?.title ?? "Select trip"}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-paper-faint" />
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-20"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <ul className="absolute left-0 top-full z-30 mt-1 max-h-64 w-64 overflow-auto rounded-lg border border-rule-soft/60 bg-ink/95 backdrop-blur-sm p-1 shadow-xl">
            {trips.map((t) => (
              <li key={t._id}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(t._id);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-paper hover:bg-brass/10 transition-colors"
                >
                  <span className="flex-1 min-w-0 truncate">{t.title}</span>
                  {t._id === selectedId && (
                    <Check className="h-3.5 w-3.5 shrink-0 text-brass" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// ── Budget bar ─────────────────────────────────────────────────────────────
function BudgetBar({
  trip,
  spent,
  onSetBudget,
}: {
  trip: Trip;
  spent: number;
  onSetBudget: (v: number) => void;
}) {
  const total = trip.budgetGbp ?? 0;
  const over = total > 0 && spent > total;
  const pct = total > 0 ? Math.min(100, (spent / total) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-mono uppercase tracking-[0.16em] text-paper-faint">
          Budget
        </span>
        <span className={cn("tabular-nums flex items-center gap-1", over ? "text-rose-soft" : "text-paper")}>
          <span>{gbp(spent)} / £</span>
          <EditableValue
            value={total ? String(total) : ""}
            type="number"
            placeholder="set budget"
            onCommit={(v) => {
              const n = Number(v);
              onSetBudget(Number.isFinite(n) ? n : 0);
            }}
            className="text-paper underline decoration-dotted decoration-paper-faint/50"
          />
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-paper/[0.06]">
        <div
          className={cn(
            "h-full rounded-full transition-[width]",
            over ? "bg-rose-soft" : "bg-brass/70",
          )}
          style={{ width: `${total > 0 ? pct : 0}%` }}
        />
      </div>
      {over && (
        <p className="text-[10px] text-rose-soft">
          Over budget by {gbp(spent - total)}
        </p>
      )}
    </div>
  );
}

// ── Mode switch (segmented: Planner | Find | Trip) ─────────────────────────
function ModeSwitch({
  mode,
  onChange,
}: {
  mode: TravelMode;
  onChange: (m: TravelMode) => void;
}) {
  const tabs: { value: TravelMode; label: string; Icon: LucideIcon }[] = [
    { value: "planner", label: "Planner", Icon: MapIcon },
    { value: "deal", label: "Find", Icon: Tag },
    { value: "trip", label: "Trip", Icon: Globe2 },
  ];
  return (
    <div
      role="tablist"
      aria-label="travel mode"
      className="inline-flex items-center gap-0.5 rounded-lg border border-rule-soft/50 bg-ink-2/40 p-0.5"
    >
      {tabs.map(({ value, label, Icon }) => {
        const on = value === mode;
        return (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(value)}
            className={cn(
              "flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-mono uppercase tracking-[0.12em] transition-colors",
              on
                ? "bg-brass/15 text-brass border border-brass/40"
                : "text-paper-faint hover:text-paper border border-transparent",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ── Category toggle chips ──────────────────────────────────────────────────
// `selected` is the enabled-slug set; empty array means "all" (no filter).
function CategoryChips({
  selected,
  onToggle,
  onRegenerate,
  canRegenerate,
}: {
  selected: string[];
  onToggle: (slug: string) => void;
  onRegenerate: () => void;
  canRegenerate: boolean;
}) {
  const all = selected.length === 0;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {INTEREST_CATEGORIES.map((c) => {
        const Icon = CATEGORY_ICONS[c.iconName];
        // "all" = every chip reads as on; otherwise highlight the chosen ones.
        const on = all || selected.includes(c.slug);
        return (
          <button
            key={c.slug}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(c.slug)}
            className={cn(
              "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.1em] transition-colors",
              on
                ? "border-brass/50 bg-brass/10 text-brass"
                : "border-rule-soft/50 bg-ink-2/30 text-paper-faint hover:text-paper",
            )}
          >
            <Icon className="h-3 w-3" />
            {c.label}
          </button>
        );
      })}
      {canRegenerate && !all && (
        <button
          type="button"
          onClick={onRegenerate}
          className="flex items-center gap-1 rounded-full border border-rule-soft/50 bg-ink-2/40 px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.1em] text-paper-faint hover:text-brass hover:border-brass/50 transition-colors"
        >
          <Sparkles className="h-3 w-3" /> Regenerate
        </button>
      )}
    </div>
  );
}

// ── Timeframe (native date range) ──────────────────────────────────────────
function DateRange({
  start,
  end,
  onChange,
}: {
  start?: string;
  end?: string;
  onChange: (patch: { startDate?: string; endDate?: string }) => void;
}) {
  const cls =
    "rounded-lg border border-rule-soft/50 bg-ink-2/40 px-2 py-1 text-[11px] text-paper [color-scheme:dark] outline-none focus:border-brass/50";
  return (
    <div className="flex items-center gap-1.5">
      <CalendarRange className="h-3.5 w-3.5 shrink-0 text-brass/80" />
      <input
        type="date"
        aria-label="trip start date"
        value={start ?? ""}
        max={end || undefined}
        onChange={(e) => onChange({ startDate: e.target.value || undefined })}
        className={cls}
      />
      <span className="text-[11px] text-paper-faint">→</span>
      <input
        type="date"
        aria-label="trip end date"
        value={end ?? ""}
        min={start || undefined}
        onChange={(e) => onChange({ endDate: e.target.value || undefined })}
        className={cls}
      />
    </div>
  );
}

// ── Find / Trip placeholders (real builds land in Stage 3 / Stage 4) ───────
function FindPlaceholder() {
  return (
    <div className="rounded-xl border border-rule-soft/50 bg-ink-2/30 p-5 text-center space-y-3">
      <Tag className="mx-auto h-6 w-6 text-brass/70" />
      <div className="space-y-1">
        <p className="text-sm font-display text-paper">Find a deal</p>
        <p className="text-[12px] text-paper-faint mx-auto max-w-sm">
          Hotel search with free cancellation &amp; pay-later. Arrives next.
        </p>
      </div>
      <input
        type="text"
        disabled
        placeholder="e.g. 4 nights in Lisbon, free cancellation, under £600"
        aria-label="deal search (coming soon)"
        className="w-full max-w-md mx-auto block rounded-lg border border-rule-soft/40 bg-ink-2/40 px-3 py-2 text-sm text-paper-faint placeholder:text-paper-faint/70 outline-none opacity-50 cursor-not-allowed"
      />
      <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-paper-faint/70">
        Stage 3 · coming soon
      </p>
    </div>
  );
}

function TripPanel({ tripId }: { tripId: Id<"trips"> | null }) {
  return (
    <div className="rounded-xl border border-rule-soft/50 bg-ink-2/30 p-5 text-center space-y-3">
      <Globe2 className="mx-auto h-6 w-6 text-brass/70" />
      <div className="space-y-1">
        <p className="text-sm font-display text-paper">Expanded Trip Planner</p>
        <p className="text-[12px] text-paper-faint mx-auto max-w-sm">
          Full-screen overview, map, itinerary, to-dos &amp; notes for the
          selected trip.
        </p>
      </div>
      {tripId ? (
        <Link
          href={`/travel/${tripId}`}
          className="mx-auto flex w-fit items-center gap-1.5 rounded-lg border border-brass/40 bg-brass/10 px-3 py-1.5 text-[12px] font-mono uppercase tracking-[0.14em] text-brass hover:bg-brass/20 transition-colors"
        >
          <Maximize2 className="h-3.5 w-3.5" /> Open
        </Link>
      ) : (
        <button
          type="button"
          disabled
          className="mx-auto flex items-center gap-1.5 rounded-lg border border-rule-soft/40 bg-ink-2/40 px-3 py-1.5 text-[12px] font-mono uppercase tracking-[0.14em] text-paper-faint opacity-50 cursor-not-allowed"
        >
          <Maximize2 className="h-3.5 w-3.5" /> Select a trip first
        </button>
      )}
    </div>
  );
}

// ── Main widget ────────────────────────────────────────────────────────────
export function TravelWidget() {
  const trips = useQuery(api.trips.list) as Trip[] | undefined;

  const updateTrip = useMutation(api.trips.update);
  const setActive = useMutation(api.trips.setActive);
  const addItem = useMutation(api.trips.addItem);
  const removeItem = useMutation(api.trips.removeItem);
  const reorderItems = useMutation(api.trips.reorderItems);
  const setItemStatus = useMutation(api.trips.setItemStatus);
  const saveToCalendar = useMutation(api.trips.saveToCalendar);

  // Local override of which trip is shown; null → derive from data.
  const [override, setOverride] = useState<Id<"trips"> | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // Selected trip: explicit override → active → most recent (list is desc).
  const selectedId: Id<"trips"> | null = useMemo(() => {
    if (!trips || trips.length === 0) return null;
    if (override && trips.some((t) => t._id === override)) return override;
    const active = trips.find((t) => t.active);
    return (active ?? trips[0])._id;
  }, [trips, override]);

  const full = useQuery(
    api.trips.getFull,
    selectedId ? { tripId: selectedId } : "skip",
  ) as { trip: Trip; days: TripDay[]; items: TripItem[] } | null | undefined;

  const onPlanned = async (tripId: Id<"trips">) => {
    setOverride(tripId);
    try {
      await setActive({ tripId });
    } catch {
      /* non-fatal — selection still works via override */
    }
  };

  // Selected trip from the (already-loaded, reactive) list — carries mode +
  // categories without waiting on getFull, so the header renders immediately.
  const selectedTrip = useMemo(
    () => trips?.find((t) => t._id === selectedId) ?? null,
    [trips, selectedId],
  );

  // ── Mode (Planner | Find | Trip) ─────────────────────────────────────────
  // Initialized from the active trip's persisted mode; falls back to "planner".
  // Local state mirrors the Convex value and re-syncs when the selection or its
  // persisted mode changes (e.g. after another client writes it).
  const [mode, setMode] = useState<TravelMode>(
    (selectedTrip?.mode as TravelMode) ?? "planner",
  );
  useEffect(() => {
    const m = (selectedTrip?.mode as TravelMode) ?? "planner";
    setMode(m);
  }, [selectedId, selectedTrip?.mode]);

  const changeMode = (m: TravelMode) => {
    setMode(m); // optimistic
    if (selectedId) {
      void updateTrip({ tripId: selectedId, patch: { mode: m } });
    }
  };

  // Enabled interest categories (persisted on the trip; [] = all).
  const enabledCategories = selectedTrip?.categories ?? [];
  const toggleCategory = (slug: string) => {
    if (!selectedId) return;
    const cur = selectedTrip?.categories ?? [];
    // Empty (= "all") → clicking a chip starts an explicit allowlist with the
    // OTHERS on minus the clicked one would be confusing; instead, first click
    // narrows to just that category. Subsequent clicks add/remove from the set.
    let next: string[];
    if (cur.length === 0) {
      next = [slug];
    } else if (cur.includes(slug)) {
      next = cur.filter((s) => s !== slug);
    } else {
      next = [...cur, slug];
    }
    void updateTrip({ tripId: selectedId, patch: { categories: next } });
  };

  // Re-run the planner for the current trip with the active category set.
  const planTripAction = useAction(api.travelActions.planTrip);
  const [regenerating, setRegenerating] = useState(false);
  const regenerateWithCategories = async () => {
    if (!selectedId || !selectedTrip || regenerating) return;
    setRegenerating(true);
    try {
      await planTripAction({
        prompt:
          selectedTrip.destCity
            ? `Re-plan a trip to ${selectedTrip.destCity}.`
            : selectedTrip.title,
        tripId: selectedId,
        budgetGbp: selectedTrip.budgetGbp,
        originCity: selectedTrip.originCity,
        categories: enabledCategories.length > 0 ? enabledCategories : undefined,
        startDate: selectedTrip.startDate || undefined,
        endDate: selectedTrip.endDate || undefined,
      });
    } catch {
      /* non-fatal — surfaced via the prompt row on manual replan */
    } finally {
      setRegenerating(false);
    }
  };

  const setDateRange = (patch: { startDate?: string; endDate?: string }) => {
    if (!selectedId) return;
    void updateTrip({ tripId: selectedId, patch });
  };

  // ── Empty state: just the prompt row + a hint ────────────────────────────
  if (trips && trips.length === 0) {
    return (
      <WidgetSlot size="full" label="Travel">
        <div className="p-4 space-y-2">
          <PromptRow onPlanned={onPlanned} />
          <p className="text-[12px] text-paper-faint text-center py-2">
            No trips yet — describe one above (e.g. “plan lisbon 4 days under
            600”) and I’ll build a day-by-day itinerary.
          </p>
        </div>
      </WidgetSlot>
    );
  }

  // ── Loading (first query) ────────────────────────────────────────────────
  if (trips === undefined) {
    return (
      <WidgetSlot size="full" label="Travel">
        <div className="p-4 flex items-center gap-2 text-paper-faint">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-[12px]">Loading trips…</span>
        </div>
      </WidgetSlot>
    );
  }

  const trip = full?.trip;
  const days = full?.days ?? [];
  const items = full?.items ?? [];
  const spent = items.reduce((s, it) => s + (it.priceGbp ?? 0), 0);

  // Map markers (items with coords) + per-day route polylines.
  const markers: TripMarker[] = items
    .filter((it) => it.lat != null && it.lng != null)
    .map((it) => ({
      lat: it.lat as number,
      lng: it.lng as number,
      label: it.title,
      kind: kindToMarker(it.kind),
    }));
  const routes = days
    .map((d) =>
      items
        .filter((it) => it.dayId === d._id && it.lat != null && it.lng != null)
        .map((it) => ({ lat: it.lat as number, lng: it.lng as number })),
    )
    .filter((r) => r.length >= 2);

  const handleSave = async () => {
    if (!selectedId) return;
    try {
      const res = await saveToCalendar({ tripId: selectedId });
      setSaveMsg(`Saved ${res?.inserted ?? 0} item(s) to calendar`);
    } catch {
      setSaveMsg("Could not save to calendar");
    }
    setTimeout(() => setSaveMsg(null), 3500);
  };

  const handleAddItem = (dayId: Id<"tripDays">) => {
    if (!selectedId) return;
    void addItem({
      tripId: selectedId,
      dayId,
      kind: "activity",
      title: "New item",
      status: "planned",
    });
  };

  return (
    <WidgetSlot size="full" label="Travel">
      <div className="p-4 space-y-3">
        {/* Header: selector + mode switch + save */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <TripSelector
              trips={trips}
              selectedId={selectedId}
              onSelect={(id) => setOverride(id)}
            />
            <ModeSwitch mode={mode} onChange={changeMode} />
          </div>
          <div className="flex items-center gap-2">
            {saveMsg && (
              <span className="text-[11px] text-emerald-soft">{saveMsg}</span>
            )}
            {selectedId && (
              <Link
                href={`/travel/${selectedId}`}
                aria-label="open expanded trip planner"
                title="Open expanded view"
                className="flex items-center gap-1.5 rounded-lg border border-rule-soft/50 bg-ink-2/40 px-2.5 py-1.5 text-[11px] font-mono uppercase tracking-[0.14em] text-paper-faint hover:text-brass hover:border-brass/50 transition-colors"
              >
                <Maximize2 className="h-3.5 w-3.5" /> Expand
              </Link>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={!selectedId || items.length === 0}
              className="flex items-center gap-1.5 rounded-lg border border-rule-soft/50 bg-ink-2/40 px-2.5 py-1.5 text-[11px] font-mono uppercase tracking-[0.14em] text-paper-faint hover:text-paper hover:border-brass/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <CalendarPlus className="h-3.5 w-3.5" /> Save → Calendar
            </button>
          </div>
        </div>

        {/* ── FIND mode (Stage 3 placeholder) ── */}
        {mode === "deal" && <FindPlaceholder />}

        {/* ── TRIP mode (expanded planner entry) ── */}
        {mode === "trip" && <TripPanel tripId={selectedId} />}

        {/* ── PLANNER mode (full current view) ── */}
        {mode === "planner" && (
          <>
            {/* Prompt row (always available to plan/replan) */}
            <PromptRow
              onPlanned={onPlanned}
              categories={enabledCategories}
              startDate={selectedTrip?.startDate}
              endDate={selectedTrip?.endDate}
            />

            {/* Timeframe + interest-category chips */}
            {selectedId && (
              <div className="flex flex-col gap-2 rounded-lg border border-rule-soft/40 bg-ink-2/20 px-2.5 py-2 sm:flex-row sm:items-center sm:justify-between">
                <DateRange
                  start={selectedTrip?.startDate}
                  end={selectedTrip?.endDate}
                  onChange={setDateRange}
                />
                <CategoryChips
                  selected={enabledCategories}
                  onToggle={toggleCategory}
                  onRegenerate={() => void regenerateWithCategories()}
                  canRegenerate={!!trip && days.length > 0}
                />
              </div>
            )}
            {regenerating && (
              <div className="flex items-center gap-2 rounded-lg border border-rule-soft/40 bg-ink-2/30 px-2.5 py-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-brass" />
                <span className="text-[12px] text-paper-faint">
                  Regenerating with your categories…
                </span>
              </div>
            )}

            {/* Budget bar */}
            {trip && (trip.budgetGbp != null || spent > 0) && (
              <BudgetBar
                trip={trip}
                spent={spent}
                onSetBudget={(v) =>
                  void updateTrip({
                    tripId: trip._id,
                    patch: { budgetGbp: Number.isFinite(v) ? v : 0 },
                  })
                }
              />
            )}

            {/* Info rail */}
            {trip && (
              <InfoRail
                input={{
                  destCity: trip.destCity,
                  destLat: trip.destLat,
                  destLng: trip.destLng,
                  destCountryCode: trip.destCountryCode,
                }}
              />
            )}

            {/* Map + timeline: stack on mobile, side-by-side on md+ */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <div className="h-56 md:h-72">
                  <TripMap markers={markers} routes={routes} />
                </div>
                <MapLegend />
              </div>
              <div className="max-h-72 overflow-auto pr-1">
                <ItineraryTimeline
                  days={days}
                  items={items}
                  enabledCategories={enabledCategories}
                  onReorder={(dayId, ordered) =>
                    void reorderItems({ dayId, orderedItemIds: ordered })
                  }
                  onSetStatus={(itemId, status) =>
                    void setItemStatus({ itemId, status })
                  }
                  onRemoveItem={(itemId) => void removeItem({ itemId })}
                  onAddItem={handleAddItem}
                />
              </div>
            </div>

            {/* Flight chip + packing */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 border-t border-rule-soft/40 pt-3">
              <FlightChip />
              {selectedId && <PackingChecklist tripId={selectedId} />}
            </div>
          </>
        )}
      </div>
    </WidgetSlot>
  );
}

// Small kind legend for the map.
function MapLegend() {
  const legend: { color: string; label: string }[] = [
    { color: "#0ea5e9", label: "Sight" },
    { color: "#f97316", label: "Food" },
    { color: "#7c3aed", label: "Stay" },
    { color: "#64748b", label: "Transit" },
    { color: "#10b981", label: "Activity" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {legend.map((l) => (
        <span key={l.label} className="flex items-center gap-1 text-[10px] text-paper-faint">
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: l.color }}
          />
          {l.label}
        </span>
      ))}
    </div>
  );
}

export default TravelWidget;
