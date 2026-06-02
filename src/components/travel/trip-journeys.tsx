"use client";

/**
 * TripJourneys — "connecting journeys" editors for the expanded trip view
 * (Stage 5). Two sibling editors, both driven by reactive api.tripExtras queries
 * so the globe + overview re-render on every write:
 *
 *   <TripLegs>    multi-destination stops. "Add destination" resolves a city via
 *                 geocodePlace (client) → addLeg({lat,lng,countryCode}). Edit
 *                 arrive/depart dates, remove, reorder (up/down → reorderLegs).
 *                 Legs feed globe points + the multi-destination route arcs.
 *
 *   <TripFlights> connecting flights. "Add flight" → a single-segment form
 *                 (from/to IATA-or-city + optional depart/arrive/carrier/flightNo)
 *                 → addFlight({segments:[...]}). List existing journeys (each may
 *                 be multi-segment), remove. Flight arcs are resolved/drawn by the
 *                 page using findAirport(iata) when coords are available.
 *
 * All reads come from the reactive queries; all writes go straight to the
 * mutations. Pure presentational state is local (the add forms).
 */

import { useState } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import {
  MapPin,
  Plane,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Loader2,
  Navigation,
  ArrowRight,
  Car,
  Train,
  Bus,
  ExternalLink,
} from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id, Doc } from "../../../convex/_generated/dataModel";
import { geocodePlace } from "@/lib/travel/geocode";

const inputCls =
  "w-full rounded-lg border border-rule-soft/60 bg-ink-2/40 px-2.5 py-1.5 text-[12px] text-paper placeholder:text-paper-faint/60 focus:border-brass/60 focus:outline-none";

const btnGhost =
  "flex items-center gap-1 rounded-lg border border-rule-soft/50 px-2 py-1 text-[10px] font-mono uppercase tracking-[0.12em] text-paper-faint hover:text-paper hover:border-brass/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

const btnAccent =
  "flex items-center justify-center gap-1.5 rounded-lg border border-brass/40 bg-brass/10 px-3 py-1.5 text-[11px] font-mono uppercase tracking-[0.12em] text-brass hover:bg-brass/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

function fmtDate(d?: string): string | null {
  if (!d) return null;
  const t = new Date(`${d}T00:00:00`);
  if (Number.isNaN(t.getTime())) return null;
  return t.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

const TRANSPORT_MODES = [
  { key: "car", Icon: Car, label: "Car" },
  { key: "train", Icon: Train, label: "Train" },
  { key: "bus", Icon: Bus, label: "Bus" },
] as const;

/** Google Maps directions deep-link — the "view route / book" link for a hop. */
function mapsDirLink(
  prev: Doc<"tripLegs">,
  leg: Doc<"tripLegs">,
  mode: string,
): string | null {
  if (prev.lat == null || prev.lng == null || leg.lat == null || leg.lng == null)
    return null;
  const travelmode = mode === "car" ? "driving" : "transit";
  return `https://www.google.com/maps/dir/?api=1&origin=${prev.lat},${prev.lng}&destination=${leg.lat},${leg.lng}&travelmode=${travelmode}`;
}

/** Transport connector between two consecutive legs: mode toggle + real time +
 *  distance (from Google Directions) + a "view route" deep-link. */
function TransportConnector({
  prev,
  leg,
  routing,
  onPick,
}: {
  prev: Doc<"tripLegs">;
  leg: Doc<"tripLegs">;
  routing: boolean;
  onPick: (mode: "car" | "train" | "bus") => void;
}) {
  const coords =
    prev.lat != null && prev.lng != null && leg.lat != null && leg.lng != null;
  const link = mapsDirLink(prev, leg, leg.transportMode ?? "car");
  return (
    <div className="mb-1 ml-2 flex flex-wrap items-center gap-1.5 border-l border-dashed border-rule-soft/50 pl-3 py-0.5">
      <div className="inline-flex overflow-hidden rounded-md border border-rule-soft/60">
        {TRANSPORT_MODES.map(({ key, Icon, label }) => {
          const active = leg.transportMode === key;
          return (
            <button
              key={key}
              type="button"
              aria-label={`${label} to ${leg.city}`}
              aria-pressed={active}
              disabled={!coords || routing}
              onClick={() => onPick(key)}
              className={`flex items-center gap-1 px-1.5 py-0.5 text-[10px] transition-colors disabled:opacity-40 ${
                active
                  ? "bg-brass/20 text-brass"
                  : "text-paper-faint hover:text-paper"
              }`}
            >
              <Icon className="h-3 w-3" />
            </button>
          );
        })}
      </div>
      {routing ? (
        <Loader2 className="h-3 w-3 animate-spin text-brass/70" />
      ) : leg.routeDurationText ? (
        <span className="text-[10px] text-paper-faint tabular-nums">
          {leg.routeDurationText}
          {leg.routeDistanceText ? ` · ${leg.routeDistanceText}` : ""}
        </span>
      ) : leg.transportMode && !coords ? (
        <span className="text-[10px] text-paper-faint/70">need coords</span>
      ) : null}
      {leg.transportMode && link && (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-0.5 text-[10px] text-paper-faint hover:text-brass transition-colors"
        >
          Route <ExternalLink className="h-2.5 w-2.5" />
        </a>
      )}
    </div>
  );
}

// ── Legs (multi-destination) ────────────────────────────────────────────────
export function TripLegs({ tripId }: { tripId: Id<"trips"> }) {
  const legs = useQuery(api.tripExtras.listLegs, { tripId }) as
    | Doc<"tripLegs">[]
    | undefined;
  const addLeg = useMutation(api.tripExtras.addLeg);
  const updateLeg = useMutation(api.tripExtras.updateLeg);
  const removeLeg = useMutation(api.tripExtras.removeLeg);
  const reorderLegs = useMutation(api.tripExtras.reorderLegs);
  const routeLeg = useAction(api.travelActions.routeLeg);

  const [city, setCity] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Which leg is currently fetching a route (shows a spinner on its connector).
  const [routingId, setRoutingId] = useState<Id<"tripLegs"> | null>(null);

  // Pick a transport mode for the hop INTO `leg` (from `prev`): persist the mode,
  // then fetch the real time/distance/route from Google Directions and cache it
  // on the leg (so the globe can draw the actual road/rail geometry).
  const applyMode = async (
    prev: Doc<"tripLegs">,
    leg: Doc<"tripLegs">,
    mode: "car" | "train" | "bus",
  ) => {
    await updateLeg({ legId: leg._id, patch: { transportMode: mode } });
    if (prev.lat == null || prev.lng == null || leg.lat == null || leg.lng == null)
      return;
    setRoutingId(leg._id);
    try {
      const r = await routeLeg({
        fromLat: prev.lat,
        fromLng: prev.lng,
        toLat: leg.lat,
        toLng: leg.lng,
        mode,
      });
      await updateLeg({
        legId: leg._id,
        patch: r.available
          ? {
              transportMode: mode,
              routeDurationText: r.durationText,
              routeDistanceText: r.distanceText,
              routePolyline: r.polyline,
            }
          : { routeDurationText: "", routeDistanceText: "", routePolyline: "" },
      });
    } catch {
      /* keep the chosen mode; route stays whatever it was */
    } finally {
      setRoutingId(null);
    }
  };

  const handleAdd = async () => {
    const q = city.trim();
    if (!q || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const geo = await geocodePlace(q);
      await addLeg({
        tripId,
        city: geo?.name || q,
        lat: geo?.lat,
        lng: geo?.lng,
        countryCode: geo?.countryCode || undefined,
      });
      setCity("");
    } catch {
      setErr("Couldn’t resolve that place — added without coords.");
      // Best-effort: still record the city so the leg exists.
      try {
        await addLeg({ tripId, city: q });
        setCity("");
      } catch {
        /* give up silently */
      }
    } finally {
      setBusy(false);
    }
  };

  const move = (i: number, dir: -1 | 1) => {
    if (!legs) return;
    const j = i + dir;
    if (j < 0 || j >= legs.length) return;
    const ids = legs.map((l) => l._id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void reorderLegs({ tripId, orderedIds: ids });
  };

  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
        <Navigation className="h-3 w-3 text-brass/70" /> Destinations
      </p>

      {legs === undefined ? (
        <p className="text-[11px] text-paper-faint">Loading…</p>
      ) : legs.length === 0 ? (
        <p className="mb-2 text-[11px] text-paper-faint">
          No destinations yet. Add cities to build a multi-stop route on the
          globe.
        </p>
      ) : (
        <ol className="mb-2 space-y-1">
          {legs.map((leg, i) => (
            <li key={leg._id}>
              {i > 0 && (
                <TransportConnector
                  prev={legs[i - 1]}
                  leg={leg}
                  routing={routingId === leg._id}
                  onPick={(mode) => void applyMode(legs[i - 1], leg, mode)}
                />
              )}
              <div className="flex items-center gap-2 rounded-lg border border-rule-soft/40 bg-ink-2/30 px-2 py-1.5">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-brass/50 font-mono text-[8px] text-brass">
                {i + 1}
              </span>
              <MapPin className="h-3 w-3 shrink-0 text-brass/60" />
              <span className="min-w-0 flex-1 truncate text-[12px] text-paper">
                {leg.city}
                {leg.countryCode ? (
                  <span className="ml-1 text-[10px] text-paper-faint">
                    {leg.countryCode}
                  </span>
                ) : null}
              </span>
              <input
                type="date"
                aria-label={`arrive date for ${leg.city}`}
                value={leg.arriveDate ?? ""}
                onChange={(e) =>
                  void updateLeg({
                    legId: leg._id,
                    patch: { arriveDate: e.target.value || undefined },
                  })
                }
                className="shrink-0 rounded border border-rule-soft/50 bg-ink-2/40 px-1 py-0.5 text-[10px] text-paper-faint [color-scheme:dark]"
              />
              <div className="flex shrink-0 flex-col">
                <button
                  type="button"
                  aria-label="move up"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className="text-paper-faint hover:text-brass disabled:opacity-30"
                >
                  <ChevronUp className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  aria-label="move down"
                  onClick={() => move(i, 1)}
                  disabled={i === legs.length - 1}
                  className="text-paper-faint hover:text-brass disabled:opacity-30"
                >
                  <ChevronDown className="h-3 w-3" />
                </button>
              </div>
              <button
                type="button"
                aria-label={`remove ${leg.city}`}
                onClick={() => void removeLeg({ legId: leg._id })}
                className="shrink-0 text-paper-faint hover:text-red-400"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              </div>
            </li>
          ))}
        </ol>
      )}

      <div className="flex items-center gap-2">
        <input
          value={city}
          onChange={(e) => setCity(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleAdd();
          }}
          placeholder="Add destination (city)…"
          className={inputCls}
        />
        <button
          type="button"
          onClick={() => void handleAdd()}
          disabled={busy || !city.trim()}
          className={btnAccent}
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          Add
        </button>
      </div>
      {err && <p className="mt-1 text-[10px] text-amber-400/80">{err}</p>}
    </div>
  );
}

// ── Flights (connecting journeys) ───────────────────────────────────────────
export function TripFlights({ tripId }: { tripId: Id<"trips"> }) {
  const flights = useQuery(api.tripExtras.listFlights, { tripId }) as
    | Doc<"tripFlights">[]
    | undefined;
  const addFlight = useMutation(api.tripExtras.addFlight);
  const removeFlight = useMutation(api.tripExtras.removeFlight);

  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [depart, setDepart] = useState("");
  const [arrive, setArrive] = useState("");
  const [carrier, setCarrier] = useState("");
  const [flightNo, setFlightNo] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setFrom("");
    setTo("");
    setDepart("");
    setArrive("");
    setCarrier("");
    setFlightNo("");
  };

  const handleAdd = async () => {
    if (!from.trim() || !to.trim() || busy) return;
    setBusy(true);
    try {
      await addFlight({
        tripId,
        segments: [
          {
            from: from.trim().toUpperCase(),
            to: to.trim().toUpperCase(),
            depart: depart || undefined,
            arrive: arrive || undefined,
            carrier: carrier.trim() || undefined,
            flightNo: flightNo.trim() || undefined,
          },
        ],
      });
      reset();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
          <Plane className="h-3 w-3 text-brass/70" /> Flights
        </p>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={btnGhost}
        >
          <Plus className="h-3 w-3" /> Add flight
        </button>
      </div>

      {flights === undefined ? (
        <p className="text-[11px] text-paper-faint">Loading…</p>
      ) : flights.length === 0 ? (
        <p className="mb-2 text-[11px] text-paper-faint">No flights added.</p>
      ) : (
        <ul className="mb-2 space-y-1">
          {flights.map((f) => (
            <li
              key={f._id}
              className="flex items-start gap-2 rounded-lg border border-rule-soft/40 bg-ink-2/30 px-2 py-1.5"
            >
              <Plane className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brass/70" />
              <div className="min-w-0 flex-1 space-y-0.5">
                {f.segments.map((s, si) => (
                  <div
                    key={si}
                    className="flex items-center gap-1.5 text-[12px] text-paper"
                  >
                    <span className="font-mono">{s.from}</span>
                    <ArrowRight className="h-3 w-3 text-paper-faint" />
                    <span className="font-mono">{s.to}</span>
                    {(s.carrier || s.flightNo) && (
                      <span className="text-[10px] text-paper-faint">
                        {s.carrier ?? ""} {s.flightNo ?? ""}
                      </span>
                    )}
                    {(fmtDate(s.depart) || fmtDate(s.arrive)) && (
                      <span className="ml-auto text-[10px] text-paper-faint tabular-nums">
                        {fmtDate(s.depart) ?? "?"} → {fmtDate(s.arrive) ?? "?"}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <button
                type="button"
                aria-label="remove flight"
                onClick={() => void removeFlight({ flightId: f._id })}
                className="shrink-0 text-paper-faint hover:text-red-400"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div className="space-y-2 rounded-lg border border-rule-soft/40 bg-ink-2/20 p-2.5">
          <div className="grid grid-cols-2 gap-2">
            <input
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              placeholder="From (IATA/city)"
              className={inputCls}
            />
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="To (IATA/city)"
              className={inputCls}
            />
            <input
              type="date"
              aria-label="depart date"
              value={depart}
              onChange={(e) => setDepart(e.target.value)}
              className={`${inputCls} [color-scheme:dark]`}
            />
            <input
              type="date"
              aria-label="arrive date"
              value={arrive}
              onChange={(e) => setArrive(e.target.value)}
              className={`${inputCls} [color-scheme:dark]`}
            />
            <input
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
              placeholder="Carrier (opt.)"
              className={inputCls}
            />
            <input
              value={flightNo}
              onChange={(e) => setFlightNo(e.target.value)}
              placeholder="Flight no. (opt.)"
              className={inputCls}
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleAdd()}
              disabled={busy || !from.trim() || !to.trim()}
              className={btnAccent}
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              Save flight
            </button>
            <button
              type="button"
              onClick={() => {
                reset();
                setOpen(false);
              }}
              className={btnGhost}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
