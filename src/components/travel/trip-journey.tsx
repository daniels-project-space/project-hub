"use client";

/**
 * TripJourney — the master "everything in order" overlay (2026-07-04, per
 * Daniel's redesign). One view that unifies the trip's segments across TIME
 * (a node timeline of mini cards) and SPACE (the connected globe, points per
 * stop, arcs styled by the transport mode), plus a money/summary bar. Clicking
 * a timeline card focuses its point on the globe and vice-versa.
 *
 * Everything is computed from existing data (tripLegs + tripFlights + locked
 * tripStays) — no new backend. Stops come from legs when the trip is
 * multi-stop, otherwise the single destination.
 */

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  Plane,
  BedDouble,
  TrainFront,
  Car,
  MapPin,
  CalendarRange,
  Wallet,
  Globe2,
  Flag,
  Moon,
  Plus,
  X,
  Search,
  Loader2,
} from "lucide-react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { Sheet } from "@/components/ui/sheet";
import type { GlobePoint, GlobeArc } from "@/components/travel/trip-globe";
import { searchPlaces, type GeoPlace } from "@/lib/travel/geocode";

const TripGlobe = dynamic(() => import("@/components/travel/trip-globe").then((m) => m.TripGlobe), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-[12px] text-paper-faint">Loading globe…</div>,
});

const gbp = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(n);

function parseISO(d?: string): Date | null {
  if (!d) return null;
  const t = new Date(`${d}T00:00:00Z`);
  return Number.isNaN(t.getTime()) ? null : t;
}
function fmtShort(d?: string): string {
  const t = parseISO(d);
  return t ? t.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "";
}
function nightsBetween(a?: string, b?: string): number | null {
  const s = parseISO(a), e = parseISO(b);
  return s && e ? Math.max(0, Math.round((e.getTime() - s.getTime()) / 86_400_000)) : null;
}

type Stop = {
  id: string;
  city: string;
  countryCode?: string;
  lat?: number;
  lng?: number;
  arrive?: string;
  depart?: string;
  nights: number | null;
  transportInMode?: string; // "flight" | "car" | "train" | "bus"
  transportInSub?: string; // duration / carrier
  stayName?: string;
  stayCost?: number;
};

type TLSeg =
  | { type: "transport"; mode: string; label: string; sub?: string; cost?: number; stopId: string; key: string }
  | { type: "stay"; city: string; nights: number | null; dates: string; name?: string; cost?: number; stopId: string; key: string };

const MODE_ICON: Record<string, typeof Plane> = { flight: Plane, plane: Plane, car: Car, taxi: Car, train: TrainFront, bus: TrainFront };

export function TripJourney({
  tripId,
  trip,
  open,
  onClose,
}: {
  tripId: Id<"trips"> | null;
  trip: {
    title: string;
    destCity?: string;
    destLat?: number;
    destLng?: number;
    destCountryCode?: string;
    originCity?: string;
    startDate?: string;
    endDate?: string;
    budgetGbp?: number;
  } | null;
  open: boolean;
  onClose: () => void;
}) {
  const legs = useQuery(api.tripExtras.listLegs, tripId && open ? { tripId } : "skip") as
    | { _id: string; order: number; city: string; lat?: number; lng?: number; countryCode?: string; arriveDate?: string; departDate?: string; transportMode?: string; routeDurationText?: string }[]
    | undefined;
  const flights = useQuery(api.tripExtras.listFlights, tripId && open ? { tripId } : "skip") as
    | { _id: string; segments: { from: string; to: string; depart?: string; carrier?: string }[]; priceGbp?: number }[]
    | undefined;
  const stays = useQuery(api.tripExtras.listStays, tripId && open ? { tripId } : "skip") as
    | { _id: string; name: string; priceGbp?: number; checkIn?: string; checkOut?: string; lat?: number; lng?: number; locked?: boolean }[]
    | undefined;

  const [focusId, setFocusId] = useState<string | null>(null);
  const addLeg = useMutation(api.tripExtras.addLeg);
  const removeLeg = useMutation(api.tripExtras.removeLeg);

  const { stops, segments, points, arcs, totals } = useMemo(() => {
    const lockedStays = (stays ?? []).filter((s) => s.locked !== false);
    // ── stops: legs when multi-stop, else the single destination ──
    const rawStops: Stop[] =
      legs && legs.length > 0
        ? [...legs]
            .sort((a, b) => a.order - b.order)
            .map((l) => ({
              id: l._id,
              city: l.city,
              countryCode: l.countryCode,
              lat: l.lat,
              lng: l.lng,
              arrive: l.arriveDate,
              depart: l.departDate,
              nights: nightsBetween(l.arriveDate, l.departDate),
              transportInMode: l.transportMode,
              transportInSub: l.routeDurationText,
            }))
        : trip
          ? [
              {
                id: "dest",
                city: trip.destCity ?? trip.title,
                countryCode: trip.destCountryCode,
                lat: trip.destLat,
                lng: trip.destLng,
                arrive: trip.startDate,
                depart: trip.endDate,
                nights: nightsBetween(trip.startDate, trip.endDate),
              },
            ]
          : [];

    // attach a locked stay to each stop (by date overlap, else by order)
    rawStops.forEach((st, i) => {
      const match =
        lockedStays.find((s) => s.checkIn && st.arrive && s.checkIn.slice(0, 10) === st.arrive.slice(0, 10)) ??
        lockedStays[i];
      if (match) {
        st.stayName = match.name;
        st.stayCost = match.priceGbp;
        if (st.lat == null && match.lat != null) st.lat = match.lat;
        if (st.lng == null && match.lng != null) st.lng = match.lng;
        if (st.nights == null) st.nights = nightsBetween(match.checkIn, match.checkOut);
      }
    });

    // ── timeline segments ──
    const segs: TLSeg[] = [];
    // getting-there flight (first flight by depart)
    const firstFlight = (flights ?? [])
      .flatMap((f) => f.segments.map((s) => ({ ...s, priceGbp: f.priceGbp, id: f._id })))
      .filter((s) => s.depart)
      .sort((a, b) => (a.depart ?? "").localeCompare(b.depart ?? ""))[0];
    if (firstFlight) {
      segs.push({
        type: "transport",
        mode: "flight",
        label: `${firstFlight.from} → ${firstFlight.to}`,
        sub: firstFlight.carrier,
        cost: firstFlight.priceGbp,
        stopId: rawStops[0]?.id ?? "dest",
        key: `f-${firstFlight.id}`,
      });
    }
    rawStops.forEach((st, i) => {
      if (i > 0 && st.transportInMode) {
        segs.push({
          type: "transport",
          mode: st.transportInMode,
          label: `${rawStops[i - 1].city} → ${st.city}`,
          sub: st.transportInSub,
          stopId: st.id,
          key: `t-${st.id}`,
        });
      }
      segs.push({
        type: "stay",
        city: st.city,
        nights: st.nights,
        dates: st.arrive ? `${fmtShort(st.arrive)}${st.depart ? ` – ${fmtShort(st.depart)}` : ""}` : "",
        name: st.stayName,
        cost: st.stayCost,
        stopId: st.id,
        key: `s-${st.id}`,
      });
    });

    // ── globe points + arcs ──
    const pts: GlobePoint[] = rawStops
      .filter((s) => typeof s.lat === "number" && typeof s.lng === "number")
      .map((s) => ({ id: s.id, lat: s.lat!, lng: s.lng!, kind: "leg", label: `${s.city}${s.nights ? ` · ${s.nights}nt` : ""}` }));
    const ar: GlobeArc[] = [];
    for (let i = 1; i < rawStops.length; i++) {
      const a = rawStops[i - 1], b = rawStops[i];
      if (a.lat != null && b.lat != null) {
        ar.push({ startLat: a.lat, startLng: a.lng!, endLat: b.lat, endLng: b.lng!, kind: b.transportInMode === "flight" || !b.transportInMode ? "flight" : "route" });
      }
    }

    const stayTotal = rawStops.reduce((n, s) => n + (s.stayCost ?? 0), 0);
    const flightTotal = (flights ?? []).reduce((n, f) => n + (f.priceGbp ?? 0), 0);
    const nightsTotal = rawStops.reduce((n, s) => n + (s.nights ?? 0), 0);
    const countries = Array.from(new Set(rawStops.map((s) => s.countryCode).filter(Boolean)));

    return {
      stops: rawStops,
      segments: segs,
      points: pts,
      arcs: ar,
      totals: { money: stayTotal + flightTotal, stayTotal, flightTotal, nights: nightsTotal, countries, stopsCount: rawStops.length },
    };
  }, [legs, flights, stays, trip]);

  const focusStop = stops.find((s) => s.id === focusId);
  const loading = tripId && open && (legs === undefined || flights === undefined || stays === undefined);

  return (
    <Sheet open={open} onClose={onClose} title={`Journey · ${trip?.destCity ?? trip?.title ?? ""}`} className="w-[96vw] max-w-[1200px] max-h-[92dvh]">
      <div className="space-y-4 p-4">
        {/* ── summary bar ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {[
            { icon: CalendarRange, label: "dates", val: trip?.startDate ? `${fmtShort(trip.startDate)} – ${fmtShort(trip.endDate)}` : "—" },
            { icon: Moon, label: "nights", val: totals.nights ? String(totals.nights) : "—" },
            { icon: MapPin, label: "stops", val: String(totals.stopsCount) },
            { icon: Flag, label: "countries", val: totals.countries.length ? totals.countries.join(" · ").toUpperCase() : "—" },
            { icon: Wallet, label: "planned £", val: totals.money ? gbp(totals.money) : "—" },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-rule-soft/50 bg-ink-2/40 px-3 py-2">
              <p className="flex items-center gap-1 font-mono text-[8px] uppercase tracking-[0.18em] text-paper-faint">
                <s.icon className="h-3 w-3" /> {s.label}
              </p>
              <p className="mt-0.5 truncate font-mono text-[13px] tabular-nums text-paper">{s.val}</p>
            </div>
          ))}
        </div>
        {typeof trip?.budgetGbp === "number" && trip.budgetGbp > 0 && (
          <p className="font-mono text-[10px] text-paper-faint">
            planned {gbp(totals.money)} of {gbp(trip.budgetGbp)} budget
            {totals.money > trip.budgetGbp ? <span className="text-rose-soft"> · over by {gbp(totals.money - trip.budgetGbp)}</span> : <span className="text-emerald-soft"> · {gbp(trip.budgetGbp - totals.money)} left</span>}
          </p>
        )}

        {/* ── connected globe ─────────────────────────────────────────────── */}
        <div className="h-[340px] w-full overflow-hidden rounded-xl border border-rule-soft/50">
          {points.length === 0 ? (
            <div className="grid h-full place-items-center px-6 text-center text-[12px] text-paper-faint">
              <span>
                <Globe2 className="mx-auto mb-2 h-6 w-6 opacity-50" />
                Add stops with locations (destination or route legs) to see the map.
              </span>
            </div>
          ) : (
            <TripGlobe
              points={points}
              arcs={arcs}
              focus={focusStop && focusStop.lat != null ? { lat: focusStop.lat, lng: focusStop.lng! } : null}
              onPointClick={(id) => setFocusId(id)}
              className="h-full w-full"
            />
          )}
        </div>

        {/* ── editable route: build the trip on the map (drop stops in order) ── */}
        {tripId && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.2em] text-paper-faint">
              <MapPin className="h-3 w-3" /> route
            </span>
            {stops.map((st, i) => (
              <span
                key={st.id}
                className={cn(
                  "group flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] transition-colors",
                  focusId === st.id ? "border-brass/60 bg-brass/10 text-brass" : "border-rule-soft/60 bg-ink-2/40 text-paper-dim",
                )}
              >
                {i > 0 && <span className="text-paper-faint/40">→</span>}
                <button type="button" onClick={() => setFocusId(focusId === st.id ? null : st.id)}>
                  {st.city}
                  {st.nights ? <span className="text-paper-faint"> · {st.nights}nt</span> : ""}
                </button>
                {st.id !== "dest" && (
                  <button
                    type="button"
                    onClick={() => void removeLeg({ legId: st.id as Id<"tripLegs"> })}
                    className="text-paper-faint/50 hover:text-rose-soft"
                    aria-label={`remove ${st.city}`}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                )}
              </span>
            ))}
            <AddStop
              onAdd={(place) =>
                void addLeg({
                  tripId,
                  city: place.name,
                  lat: place.lat,
                  lng: place.lng,
                  countryCode: place.countryCode,
                })
              }
            />
          </div>
        )}

        {/* ── node timeline ───────────────────────────────────────────────── */}
        <div>
          <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.22em] text-paper-faint">Timeline</p>
          {loading ? (
            <p className="py-4 text-[12px] text-paper-faint">Loading journey…</p>
          ) : segments.length === 0 ? (
            <p className="rounded-lg border border-dashed border-rule-soft/60 px-3 py-4 text-[12px] text-paper-faint">
              Nothing planned yet — lock a stay and add transport to build the journey.
            </p>
          ) : (
            <div className="no-scrollbar flex items-stretch gap-0 overflow-x-auto pb-2">
              {segments.map((seg, i) => {
                const on = focusId != null && seg.stopId === focusId;
                const Icon = seg.type === "stay" ? BedDouble : MODE_ICON[seg.mode] ?? TrainFront;
                return (
                  <div key={seg.key} className="flex items-center">
                    {i > 0 && (
                      <div className="flex w-8 shrink-0 items-center">
                        <span className="h-px flex-1 bg-rule-soft/50" />
                        <span className="h-1.5 w-1.5 rounded-full bg-brass/70" />
                        <span className="h-px flex-1 bg-rule-soft/50" />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => setFocusId(on ? null : seg.stopId)}
                      className={cn(
                        "w-[168px] shrink-0 rounded-xl border px-3 py-2.5 text-left transition-colors",
                        on ? "border-brass/60 bg-brass/[0.08]" : "border-rule-soft/60 bg-ink-2/40 hover:border-rule-soft",
                      )}
                    >
                      <span
                        className={cn(
                          "grid h-7 w-7 place-items-center rounded-md border",
                          seg.type === "stay" ? "border-emerald-soft/30 bg-emerald-soft/[0.08] text-emerald-soft" : "border-brass/30 bg-brass/[0.08] text-brass",
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      {seg.type === "stay" ? (
                        <>
                          <p className="mt-1.5 truncate text-[13px] text-paper">{seg.city}</p>
                          <p className="truncate font-mono text-[10px] text-paper-faint">
                            {seg.nights != null ? `${seg.nights} night${seg.nights === 1 ? "" : "s"}` : "stay"}
                            {seg.dates ? ` · ${seg.dates}` : ""}
                          </p>
                          {seg.name && <p className="truncate font-mono text-[9px] text-paper-faint/70">{seg.name}</p>}
                          {typeof seg.cost === "number" && <p className="mt-0.5 font-mono text-[12px] font-bold tabular-nums text-brass">{gbp(seg.cost)}</p>}
                        </>
                      ) : (
                        <>
                          <p className="mt-1.5 truncate text-[13px] text-paper capitalize">{seg.mode}</p>
                          <p className="truncate font-mono text-[10px] text-paper-faint">{seg.label}</p>
                          {seg.sub && <p className="truncate font-mono text-[9px] text-paper-faint/70">{seg.sub}</p>}
                          {typeof seg.cost === "number" && <p className="mt-0.5 font-mono text-[12px] font-bold tabular-nums text-brass">{gbp(seg.cost)}</p>}
                        </>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {tripId && (
          <a
            href={`/travel/${tripId}`}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-rule-soft/50 bg-ink-2/30 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-paper-faint hover:border-brass/40 hover:text-brass transition-colors"
          >
            make the detailed day-by-day plan →
          </a>
        )}
      </div>
    </Sheet>
  );
}

// Compact place-search chip to drop a new stop onto the route.
function AddStop({ onAdd }: { onAdd: (p: GeoPlace) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<GeoPlace[]>([]);
  const [busy, setBusy] = useState(false);

  const run = async (text: string) => {
    setQ(text);
    if (text.trim().length < 2) {
      setHits([]);
      return;
    }
    setBusy(true);
    try {
      setHits(await searchPlaces(text.trim(), 5));
    } catch {
      setHits([]);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 rounded-full border border-dashed border-brass/40 px-2 py-0.5 font-mono text-[10px] text-brass hover:bg-brass/10 transition-colors"
      >
        <Plus className="h-2.5 w-2.5" /> add stop
      </button>
    );
  }
  return (
    <span className="relative inline-flex">
      <span className="flex items-center gap-1 rounded-full border border-brass/50 bg-ink-2/60 px-2 py-0.5">
        <Search className="h-2.5 w-2.5 text-paper-faint" />
        <input
          autoFocus
          value={q}
          onChange={(e) => void run(e.target.value)}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          placeholder="city…"
          className="w-24 bg-transparent font-mono text-[11px] text-paper outline-none placeholder:text-paper-faint/60"
        />
        {busy && <Loader2 className="h-2.5 w-2.5 animate-spin text-paper-faint" />}
      </span>
      {hits.length > 0 && (
        <ul className="absolute left-0 top-full z-50 mt-1 max-h-48 w-52 overflow-y-auto rounded-lg border border-rule-soft/70 bg-ink-2 shadow-2xl">
          {hits.map((h, i) => (
            <li key={`${h.name}-${h.lat}-${i}`}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onAdd(h);
                  setOpen(false);
                  setQ("");
                  setHits([]);
                }}
                className="flex w-full items-baseline gap-1.5 px-2.5 py-1.5 text-left hover:bg-brass/10 transition-colors"
              >
                <span className="text-[11px] text-paper">{h.name}</span>
                <span className="font-mono text-[9px] text-paper-faint">{[h.admin1, h.country].filter(Boolean).join(" · ")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
