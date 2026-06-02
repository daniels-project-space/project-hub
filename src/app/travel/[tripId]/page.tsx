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
 *   CENTER — animated 3D globe (Stage 5): itinerary + leg points, route + flight
 *            arcs, autorotate, fly-to on stop/leg select.
 *   RIGHT  — reused ItineraryTimeline (full editing) + legs/flights editors +
 *            To-do + Notes.
 *
 * SSR-safe: "use client" boundary; the globe is loaded ONLY via
 * next/dynamic(..., { ssr:false }) (react-globe.gl/three touch window at import),
 * so Next's server render / static generation never references it. No file
 * imports trip-globe statically. The dynamic route compiles as a client page.
 */

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
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
import {
  ItineraryTimeline,
  type TripItem,
  type TripDay,
} from "@/components/travel/itinerary-timeline";
import { TripTodos } from "@/components/travel/trip-todos";
import { TripNotes } from "@/components/travel/trip-notes";
import { TripLegs, TripFlights } from "@/components/travel/trip-journeys";
import type {
  GlobePoint,
  GlobeArc,
  GlobePointKind,
} from "@/components/travel/trip-globe";
import { findAirport } from "@/lib/travel/airports";

// SSR SAFETY: trip-globe (react-globe.gl → three) touches window at import time.
// The ONLY entry point is this dynamic import with ssr:false, so the module is
// never evaluated during Next's server render / static generation. No other file
// imports trip-globe statically.
const TripGlobe = dynamic(
  () => import("@/components/travel/trip-globe"),
  {
    ssr: false,
    loading: () => <GlobeSkeleton />,
  },
);

function GlobeSkeleton() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="flex flex-col items-center gap-2 text-paper-faint">
        <Globe2 className="h-6 w-6 animate-pulse text-brass/60" />
        <span className="font-mono text-[10px] uppercase tracking-[0.16em]">
          Spinning up the globe…
        </span>
      </div>
    </div>
  );
}

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

// Map a tripItem.kind → globe point kind (drives marker color on the globe).
const GLOBE_KINDS = new Set<GlobePointKind>([
  "place",
  "food",
  "stay",
  "flight",
  "transport",
  "activity",
  "leg",
  "default",
]);
function itemKindToGlobe(kind: string): GlobePointKind {
  return GLOBE_KINDS.has(kind as GlobePointKind)
    ? (kind as GlobePointKind)
    : "default";
}

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
  onFocus,
}: {
  full: FullTrip;
  legs: Doc<"tripLegs">[] | undefined;
  /** Click a stop/leg with coords → fly the globe there. */
  onFocus: (loc: { lat: number; lng: number }) => void;
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
            {legs.map((leg, i) => {
              const hasCoords = leg.lat != null && leg.lng != null;
              return (
                <li key={leg._id}>
                  <button
                    type="button"
                    disabled={!hasCoords}
                    onClick={() =>
                      hasCoords &&
                      onFocus({ lat: leg.lat as number, lng: leg.lng as number })
                    }
                    className="flex w-full items-center gap-2 rounded text-left text-[12px] text-paper enabled:hover:text-brass disabled:cursor-default"
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
                  </button>
                </li>
              );
            })}
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
              const hasCoords = it.lat != null && it.lng != null;
              return (
                <li
                  key={it._id}
                  onClick={() =>
                    hasCoords &&
                    onFocus({
                      lat: it.lat as number,
                      lng: it.lng as number,
                    })
                  }
                  className={`flex items-start gap-2 rounded-lg border border-rule-soft/40 bg-ink-2/30 px-2 py-1.5 ${
                    hasCoords
                      ? "cursor-pointer hover:border-brass/40 hover:bg-ink-2/50"
                      : ""
                  }`}
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

// ── CENTER pane: animated 3D globe (Stage 5) ────────────────────────────────
function GlobePane({
  full,
  legs,
  flights,
  focus,
  onPointClick,
}: {
  full: FullTrip;
  legs: Doc<"tripLegs">[] | undefined;
  flights: Doc<"tripFlights">[] | undefined;
  focus: { lat: number; lng: number } | null;
  onPointClick: (id: string) => void;
}) {
  const { items } = full;

  // Points: itinerary items with coords + legs (multi-destination cities).
  const points = useMemo<GlobePoint[]>(() => {
    const out: GlobePoint[] = [];
    for (const it of items) {
      if (it.lat == null || it.lng == null) continue;
      out.push({
        id: it._id,
        lat: it.lat,
        lng: it.lng,
        label: it.title,
        kind: itemKindToGlobe(it.kind),
        imageUrl: it.image ?? undefined,
      });
    }
    for (const leg of legs ?? []) {
      if (leg.lat == null || leg.lng == null) continue;
      out.push({
        id: leg._id,
        lat: leg.lat,
        lng: leg.lng,
        label: leg.city,
        kind: "leg",
      });
    }
    return out;
  }, [items, legs]);

  // Route arcs: between consecutive ordered stops that have coords. Legs (if any)
  // define the high-level multi-destination route; otherwise fall back to the
  // ordered itinerary items.
  const [flightArcs, setFlightArcs] = useState<GlobeArc[]>([]);

  const routeArcs = useMemo<GlobeArc[]>(() => {
    const ordered: Array<{ lat: number; lng: number }> = [];
    const legPts = (legs ?? []).filter((l) => l.lat != null && l.lng != null);
    if (legPts.length >= 2) {
      for (const l of legPts)
        ordered.push({ lat: l.lat as number, lng: l.lng as number });
    } else {
      for (const it of items) {
        if (it.lat == null || it.lng == null) continue;
        ordered.push({ lat: it.lat, lng: it.lng });
      }
    }
    const arcs: GlobeArc[] = [];
    for (let i = 0; i < ordered.length - 1; i++) {
      arcs.push({
        startLat: ordered[i].lat,
        startLng: ordered[i].lng,
        endLat: ordered[i + 1].lat,
        endLng: ordered[i + 1].lng,
        kind: "route",
      });
    }
    return arcs;
  }, [items, legs]);

  // Flight arcs: resolve segment from/to via findAirport (IATA/city → coords).
  // Async + bundled dataset, so we compute in an effect and store in state.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const segs = (flights ?? []).flatMap((f) => f.segments);
      if (segs.length === 0) {
        if (!cancelled) setFlightArcs([]);
        return;
      }
      const resolved: GlobeArc[] = [];
      for (const s of segs) {
        try {
          const a = await findAirport(s.from);
          const b = await findAirport(s.to);
          if (a && b) {
            resolved.push({
              startLat: a.lat,
              startLng: a.lng,
              endLat: b.lat,
              endLng: b.lng,
              kind: "flight",
            });
          }
        } catch {
          /* unresolved airport → just skip the arc */
        }
      }
      if (!cancelled) setFlightArcs(resolved);
    })();
    return () => {
      cancelled = true;
    };
  }, [flights]);

  const arcs = useMemo<GlobeArc[]>(
    () => [...routeArcs, ...flightArcs],
    [routeArcs, flightArcs],
  );

  return (
    <Card className="flex h-full flex-col overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-rule-soft/40 px-4 py-2.5">
        <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-paper-faint">
          Globe
        </p>
        <span className="flex items-center gap-1 rounded-full border border-brass/40 bg-brass/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-brass">
          <Globe2 className="h-3 w-3" /> {points.length} stops
        </span>
      </div>
      <div className="min-h-0 flex-1 bg-[radial-gradient(circle_at_50%_40%,oklch(0.22_0.03_255_/_0.6),oklch(0.12_0.02_255_/_0.9))]">
        {points.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <p className="text-[12px] text-paper-faint">
              No mapped stops yet. Add destinations or itinerary items with a
              location to plot them on the globe.
            </p>
          </div>
        ) : (
          <TripGlobe
            points={points}
            arcs={arcs}
            focus={focus}
            onPointClick={onPointClick}
          />
        )}
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

      <Card className="space-y-4">
        <TripLegs tripId={tripId} />
        <div className="border-t border-rule-soft/40 pt-4">
          <TripFlights tripId={tripId} />
        </div>
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
  const flights = useQuery(
    api.tripExtras.listFlights,
    tripId ? { tripId } : "skip",
  ) as Doc<"tripFlights">[] | undefined;

  // Selected stop/leg → globe flies there. A fresh object identity each click
  // (even to the same coords) lets the globe's effect re-fire a fly-to.
  const [focus, setFocus] = useState<{ lat: number; lng: number } | null>(null);

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
              <OverviewSidebar
                full={full}
                legs={legs}
                onFocus={(loc) => setFocus(loc)}
              />
            </div>
          </div>

          {/* CENTER — animated 3D globe */}
          <div className="lg:col-span-5">
            <div className="h-[480px] lg:sticky lg:top-[4.5rem] lg:h-[calc(100dvh-6rem)]">
              <GlobePane
                full={full}
                legs={legs}
                flights={flights}
                focus={focus}
                onPointClick={(id) => {
                  const it = full.items.find((x) => x._id === id);
                  if (it?.lat != null && it?.lng != null) {
                    setFocus({ lat: it.lat, lng: it.lng });
                    return;
                  }
                  const leg = legs?.find((l) => l._id === id);
                  if (leg?.lat != null && leg?.lng != null) {
                    setFocus({ lat: leg.lat, lng: leg.lng });
                  }
                }}
              />
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
