"use client";

/**
 * Expanded Trip Planner — full-screen view for one saved trip (Stage 4).
 *
 * Route: /travel/[tripId]. Client-rendered (useQuery), so we read tripId from
 * useParams() rather than awaiting a params prop (Next 15 client-component rule).
 * Everything is driven by the reactive api.trips.getFull + the tripExtras
 * queries (listLegs), so writes anywhere re-render the whole view.
 *
 * 3-pane layout (stacks on mobile, side-by-side on lg+):
 *   LEFT   — "What & Where" overview: trip header + sorted flat list of all
 *            stops (day/time/kind/place/link) + legs.
 *   CENTER — TripMap (2D markers + per-day routes) as the Stage-5 globe slot,
 *            with a caption flagging the animated globe is coming.
 *   RIGHT  — reused ItineraryTimeline (full editing) + To-do + Notes.
 *
 * SSR-safe: "use client" boundary; TripMap dynamic-imports maplibre in an effect;
 * no window access at module top. The dynamic route compiles as a client page.
 */

import { useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation } from "convex/react";
import {
  ArrowLeft,
  Plane,
  Loader2,
  MapPin,
  Utensils,
  BedDouble,
  Bus,
  Sparkles,
  CalendarRange,
  Wallet,
  Navigation,
  ExternalLink,
  Globe2,
  type LucideIcon,
} from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import type { Id, Doc } from "../../../../convex/_generated/dataModel";
import { Card } from "@/components/ui/card";
import { TripMap, type TripMarker } from "@/components/travel/trip-map";
import {
  ItineraryTimeline,
  kindToMarker,
  type TripItem,
  type TripDay,
} from "@/components/travel/itinerary-timeline";
import { TripTodos } from "@/components/travel/trip-todos";
import { TripNotes } from "@/components/travel/trip-notes";

type FullTrip = {
  trip: Doc<"trips">;
  days: Doc<"tripDays">[];
  items: Doc<"tripItems">[];
};

const KIND_ICON: Record<string, LucideIcon> = {
  place: MapPin,
  food: Utensils,
  stay: BedDouble,
  flight: Plane,
  transport: Bus,
  activity: Sparkles,
};

const gbp = (n: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(n);

function fmtDate(d?: string): string | null {
  if (!d) return null;
  const t = new Date(`${d}T00:00:00`);
  if (Number.isNaN(t.getTime())) return null;
  return t.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtDayBadge(day: Doc<"tripDays"> | undefined): string {
  if (!day) return "—";
  if (day.date) {
    const t = new Date(`${day.date}T00:00:00`);
    if (!Number.isNaN(t.getTime()))
      return t.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  }
  return `Day ${day.dayIndex + 1}`;
}

// ── Back bar ───────────────────────────────────────────────────────────────
function TopBar({ title }: { title: string }) {
  return (
    <header className="sticky top-0 z-20 border-b border-rule-soft/50 bg-ink/85 backdrop-blur-sm">
      <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-5 py-3 lg:px-8">
        <Link
          href="/"
          className="flex items-center gap-1.5 rounded-lg border border-rule-soft/50 bg-ink-2/40 px-2.5 py-1.5 text-[11px] font-mono uppercase tracking-[0.14em] text-paper-faint hover:text-paper hover:border-brass/50 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to hub
        </Link>
        <Plane className="h-4 w-4 shrink-0 text-brass/80" />
        <h1 className="truncate font-display text-[15px] text-paper">{title}</h1>
      </div>
    </header>
  );
}

// ── LEFT pane: "What & Where" overview ──────────────────────────────────────
function OverviewSidebar({
  full,
  legs,
}: {
  full: FullTrip;
  legs: Doc<"tripLegs">[] | undefined;
}) {
  const { trip, days, items } = full;
  const dayById = useMemo(() => {
    const m = new Map<string, Doc<"tripDays">>();
    for (const d of days) m.set(d._id, d);
    return m;
  }, [days]);

  // Flatten + sort: dayIndex, then sortOrder. getFull already returns items in
  // this order, but re-sort defensively so the overview is always canonical.
  const order = useMemo(() => {
    const idx = new Map<string, number>();
    days.forEach((d, i) => idx.set(d._id, i));
    return idx;
  }, [days]);

  const stops = useMemo(() => {
    return [...items].sort((a, b) => {
      const da = order.get(a.dayId) ?? Number.MAX_SAFE_INTEGER;
      const db = order.get(b.dayId) ?? Number.MAX_SAFE_INTEGER;
      if (da !== db) return da - db;
      return a.sortOrder - b.sortOrder;
    });
  }, [items, order]);

  const dateRange =
    fmtDate(trip.startDate) && fmtDate(trip.endDate)
      ? `${fmtDate(trip.startDate)} → ${fmtDate(trip.endDate)}`
      : fmtDate(trip.startDate) ?? fmtDate(trip.endDate);

  return (
    <Card className="flex h-full flex-col overflow-hidden p-0">
      {/* trip header */}
      <div className="border-b border-rule-soft/40 p-4">
        <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-paper-faint">
          What &amp; where
        </p>
        <h2 className="mt-1 font-display text-[17px] leading-tight text-paper">
          {trip.title}
        </h2>
        {trip.destCity && (
          <p className="mt-0.5 flex items-center gap-1 text-[12px] text-paper-faint">
            <MapPin className="h-3 w-3 text-brass/70" /> {trip.destCity}
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-paper-faint">
          {dateRange && (
            <span className="flex items-center gap-1">
              <CalendarRange className="h-3 w-3 text-brass/70" /> {dateRange}
            </span>
          )}
          {trip.budgetGbp != null && trip.budgetGbp > 0 && (
            <span className="flex items-center gap-1 tabular-nums">
              <Wallet className="h-3 w-3 text-brass/70" /> {gbp(trip.budgetGbp)}
            </span>
          )}
        </div>
      </div>

      {/* legs (multi-destination), if any */}
      {legs && legs.length > 0 && (
        <div className="border-b border-rule-soft/40 p-4">
          <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-paper-faint">
            Journey
          </p>
          <ol className="space-y-1">
            {legs.map((leg, i) => (
              <li
                key={leg._id}
                className="flex items-center gap-2 text-[12px] text-paper"
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-brass/50 font-mono text-[8px] text-brass">
                  {i + 1}
                </span>
                <Navigation className="h-3 w-3 shrink-0 text-brass/60" />
                <span className="flex-1 min-w-0 truncate">{leg.city}</span>
                {(leg.arriveDate || leg.departDate) && (
                  <span className="shrink-0 text-[10px] text-paper-faint tabular-nums">
                    {fmtDate(leg.arriveDate) ?? ""}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* sorted flat list of all stops */}
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.2em] text-paper-faint">
          All stops · {stops.length}
        </p>
        {stops.length === 0 ? (
          <p className="text-[12px] text-paper-faint">No stops yet.</p>
        ) : (
          <ul className="space-y-1">
            {stops.map((it) => {
              const Icon = KIND_ICON[it.kind] ?? Sparkles;
              const day = dayById.get(it.dayId);
              const time = it.startTime
                ? `${it.startTime}${it.endTime ? `–${it.endTime}` : ""}`
                : null;
              const place = it.address;
              return (
                <li
                  key={it._id}
                  className="flex items-start gap-2 rounded-lg border border-rule-soft/40 bg-ink-2/30 px-2 py-1.5"
                >
                  <span className="mt-0.5 shrink-0 rounded border border-rule-soft/50 bg-ink-2/50 px-1 py-0.5 font-mono text-[8px] uppercase tracking-[0.08em] text-paper-faint">
                    {fmtDayBadge(day)}
                  </span>
                  <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brass/80" />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1 text-[12px] leading-tight text-paper">
                      <span className="truncate">{it.title}</span>
                      {it.link && (
                        <a
                          href={it.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`open ${it.title} link`}
                          className="shrink-0 text-paper-faint hover:text-brass transition-colors"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </p>
                    {(time || place) && (
                      <p className="truncate text-[10px] text-paper-faint">
                        {time}
                        {time && place ? " · " : ""}
                        {place ?? ""}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}

// ── CENTER pane: map (Stage-5 globe slot) ───────────────────────────────────
function MapPane({ full }: { full: FullTrip }) {
  const { days, items } = full;
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

  return (
    <Card className="flex h-full flex-col overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-rule-soft/40 px-4 py-2.5">
        <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-paper-faint">
          Map view
        </p>
        <span className="flex items-center gap-1 rounded-full border border-brass/40 bg-brass/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-brass">
          <Globe2 className="h-3 w-3" /> Animated globe — Stage 5
        </span>
      </div>
      <div className="min-h-0 flex-1 p-3">
        <TripMap markers={markers} routes={routes} className="h-full" />
      </div>
    </Card>
  );
}

// ── RIGHT pane: itinerary + todos + notes ───────────────────────────────────
function PlanningPane({
  full,
  tripId,
}: {
  full: FullTrip;
  tripId: Id<"trips">;
}) {
  const { trip, days, items } = full;
  const reorderItems = useMutation(api.trips.reorderItems);
  const setItemStatus = useMutation(api.trips.setItemStatus);
  const removeItem = useMutation(api.trips.removeItem);
  const addItem = useMutation(api.trips.addItem);

  const handleAddItem = (dayId: Id<"tripDays">) => {
    void addItem({
      tripId,
      dayId,
      kind: "activity",
      title: "New item",
      status: "planned",
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
          Itinerary
        </p>
        <ItineraryTimeline
          days={days as TripDay[]}
          items={items as TripItem[]}
          onReorder={(dayId, ordered) =>
            void reorderItems({ dayId, orderedItemIds: ordered })
          }
          onSetStatus={(itemId, status) =>
            void setItemStatus({ itemId, status })
          }
          onRemoveItem={(itemId) => void removeItem({ itemId })}
          onAddItem={handleAddItem}
        />
      </Card>

      <Card>
        <TripTodos tripId={tripId} />
      </Card>

      <Card>
        <TripNotes tripId={tripId} notes={trip.notes} />
      </Card>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────
export default function TripPlannerPage() {
  const params = useParams<{ tripId: string }>();
  const tripId = params.tripId as Id<"trips">;

  const full = useQuery(api.trips.getFull, tripId ? { tripId } : "skip") as
    | FullTrip
    | null
    | undefined;
  const legs = useQuery(api.tripExtras.listLegs, tripId ? { tripId } : "skip") as
    | Doc<"tripLegs">[]
    | undefined;

  // Loading (query still resolving).
  if (full === undefined) {
    return (
      <main className="min-h-dvh">
        <TopBar title="Trip" />
        <div className="flex items-center justify-center gap-2 py-32 text-paper-faint">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Loading trip…</span>
        </div>
      </main>
    );
  }

  // Not found (trip doesn't exist / was deleted).
  if (full === null) {
    return (
      <main className="min-h-dvh">
        <TopBar title="Trip not found" />
        <div className="mx-auto max-w-md px-5 py-32 text-center">
          <Plane className="mx-auto h-8 w-8 text-brass/60" />
          <p className="mt-4 text-sm text-paper">This trip doesn’t exist.</p>
          <p className="mt-1 text-[12px] text-paper-faint">
            It may have been deleted. Head back to the hub to pick another.
          </p>
          <Link
            href="/"
            className="mt-5 inline-flex items-center gap-1.5 rounded-lg border border-brass/40 bg-brass/10 px-3 py-1.5 text-[12px] font-mono uppercase tracking-[0.14em] text-brass hover:bg-brass/20 transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to hub
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh">
      <TopBar title={full.trip.title} />
      <div className="mx-auto max-w-[1600px] px-5 py-5 lg:px-8 lg:py-6">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* LEFT — overview (persistent, scrollable on lg) */}
          <div className="lg:col-span-3">
            <div className="lg:sticky lg:top-[4.5rem] lg:max-h-[calc(100dvh-6rem)]">
              <OverviewSidebar full={full} legs={legs} />
            </div>
          </div>

          {/* CENTER — map / globe slot */}
          <div className="lg:col-span-5">
            <div className="h-[420px] lg:sticky lg:top-[4.5rem] lg:h-[calc(100dvh-6rem)]">
              <MapPane full={full} />
            </div>
          </div>

          {/* RIGHT — itinerary + todos + notes */}
          <div className="lg:col-span-4">
            <PlanningPane full={full} tripId={tripId} />
          </div>
        </div>
      </div>
    </main>
  );
}
