"use client";

/**
 * FindMode — the "Find a deal" mode (Mode B). Two sub-tabs:
 *
 *   Stays  → searchStays (SerpApi Google Hotels) for a place + timeframe. Cards
 *            show image, £/night, rating, a free-cancellation note, and a "Book on
 *            Booking.com" deep-link (free-cancellation filter pre-applied). Save a
 *            card onto the trip (tripStays).
 *   Flights→ searchFlights (SerpApi Google Flights) for a route + dates. Cards show
 *            airline, price, duration, stops; "Book" opens Google Flights. Save a
 *            card onto the trip (tripFlights, with price + book link).
 *
 * The timeframe drives the search. Saved results are read back from the reactive
 * tripExtras queries so they persist on the trip.
 */

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  BedDouble,
  Plane,
  Search,
  Loader2,
  ExternalLink,
  Star,
  Trash2,
  Plus,
  CheckCircle2,
} from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id, Doc } from "../../../convex/_generated/dataModel";
import { BudgetControl, nightsBetween } from "@/components/travel/budget-control";

type StayOption = {
  name: string;
  provider?: string;
  priceGbp?: number;
  totalGbp?: number;
  image?: string;
  rating?: number;
  freeCancellation?: boolean;
  lat?: number;
  lng?: number;
  link: string;
  googleLink?: string;
  propertyToken?: string;
};

type FlightOption = {
  priceGbp?: number;
  durationMin?: number;
  airline?: string;
  airlineLogo?: string;
  stops: number;
  from?: string;
  to?: string;
  departTime?: string;
  arriveTime?: string;
  bookLink: string;
};

const gbp = (n?: number) =>
  typeof n === "number"
    ? new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: "GBP",
        maximumFractionDigits: 0,
      }).format(n)
    : null;

function dur(min?: number): string | null {
  if (typeof min !== "number" || min <= 0) return null;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h ? `${h}h ` : ""}${m}m`.trim();
}

const inputCls =
  "rounded-lg border border-rule-soft/60 bg-ink-2/40 px-2.5 py-1.5 text-[12px] text-paper placeholder:text-paper-faint/60 focus:border-brass/60 focus:outline-none";
const btnAccent =
  "flex items-center justify-center gap-1.5 rounded-lg border border-brass/40 bg-brass/10 px-3 py-1.5 text-[11px] font-mono uppercase tracking-[0.12em] text-brass hover:bg-brass/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

export function FindMode({
  tripId,
  destCity,
  startDate,
  endDate,
  budgetGbp,
  onSetBudget,
}: {
  tripId: Id<"trips"> | null;
  destCity?: string;
  startDate?: string;
  endDate?: string;
  budgetGbp?: number;
  onSetBudget: (v: number) => void;
}) {
  const [tab, setTab] = useState<"stays" | "flights">("stays");

  // Combined committed Find spend for the period (saved stays × nights + flights).
  const stays = useQuery(
    api.tripExtras.listStays,
    tripId ? { tripId } : "skip",
  ) as Doc<"tripStays">[] | undefined;
  const flights = useQuery(
    api.tripExtras.listFlights,
    tripId ? { tripId } : "skip",
  ) as Doc<"tripFlights">[] | undefined;
  const tripNights = nightsBetween(startDate, endDate);
  const total =
    (stays ?? []).reduce(
      (s, x) =>
        s +
        (x.priceGbp ?? 0) *
          (nightsBetween(x.checkIn, x.checkOut) || tripNights || 1),
      0,
    ) + (flights ?? []).reduce((s, x) => s + (x.priceGbp ?? 0), 0);

  return (
    <div className="space-y-3">
      <BudgetControl
        budgetGbp={budgetGbp}
        onSetBudget={onSetBudget}
        total={total}
        subLabel={tripNights ? `${tripNights} nights` : "saved"}
      />
      <div className="inline-flex rounded-lg border border-rule-soft/60 bg-ink-2/40 p-0.5">
        {([
          { k: "stays", label: "Stays", Icon: BedDouble },
          { k: "flights", label: "Flights", Icon: Plane },
        ] as const).map(({ k, label, Icon }) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-[11px] font-mono uppercase tracking-[0.12em] transition-colors ${
              tab === k ? "bg-brass/20 text-brass" : "text-paper-faint hover:text-paper"
            }`}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      {tab === "stays" ? (
        <StaysSearch
          tripId={tripId}
          destCity={destCity}
          startDate={startDate}
          endDate={endDate}
          budgetGbp={budgetGbp}
        />
      ) : (
        <FlightsSearch
          tripId={tripId}
          startDate={startDate}
          endDate={endDate}
          budgetGbp={budgetGbp}
        />
      )}
    </div>
  );
}

// ── Stays ───────────────────────────────────────────────────────────────────
function StaysSearch({
  tripId,
  destCity,
  startDate,
  endDate,
  budgetGbp,
}: {
  tripId: Id<"trips"> | null;
  destCity?: string;
  startDate?: string;
  endDate?: string;
  budgetGbp?: number;
}) {
  const search = useAction(api.travelActions.searchStays);
  const resolveLink = useAction(api.travelActions.resolveStayLink);
  const saveStay = useMutation(api.tripExtras.saveStay);
  const removeStay = useMutation(api.tripExtras.removeStay);
  const stays = useQuery(
    api.tripExtras.listStays,
    tripId ? { tripId } : "skip",
  ) as Doc<"tripStays">[] | undefined;

  const [q, setQ] = useState(destCity ? `${destCity} hotel` : "");
  const [ci, setCi] = useState(startDate ?? "");
  const [co, setCo] = useState(endDate ?? "");
  const [adults, setAdults] = useState(2);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [results, setResults] = useState<StayOption[]>([]);

  const run = async () => {
    if (!q.trim() || !ci || !co) {
      setErr("Enter a place and check-in / check-out dates.");
      return;
    }
    setBusy(true);
    setErr(null);
    // Budget shapes the search: cap per-night so the whole stay fits the budget.
    const nN = nightsBetween(ci, co);
    const maxPricePerNight =
      budgetGbp && budgetGbp > 0
        ? Math.max(1, Math.floor(nN > 0 ? budgetGbp / nN : budgetGbp))
        : undefined;
    try {
      const r = await search({
        query: q.trim(),
        checkIn: ci,
        checkOut: co,
        adults,
        maxPricePerNight,
      });
      if (!r.available) {
        setErr(r.reason ?? "No results.");
        setResults([]);
      } else {
        setResults(r.options);
        if (r.options.length === 0) setErr("No hotels found for those dates.");
      }
    } catch {
      setErr("Search failed — try again.");
    } finally {
      setBusy(false);
    }
  };

  // Resolve the exact per-hotel booking link (Booking.com etc.) on demand.
  const resolveFor = async (o: StayOption): Promise<string | null> => {
    if (!o.propertyToken) return null;
    try {
      const r = await resolveLink({
        propertyToken: o.propertyToken,
        query: q.trim(),
        checkIn: ci,
        checkOut: co,
        adults,
      });
      return r.url ?? null;
    } catch {
      return null;
    }
  };

  const save = (o: StayOption, link: string) => {
    if (!tripId) return;
    void saveStay({
      tripId,
      name: o.name,
      provider: o.provider ?? "Booking.com",
      priceGbp: o.priceGbp,
      image: o.image,
      link,
      freeCancellation: o.freeCancellation ?? true,
      lat: o.lat,
      lng: o.lng,
      checkIn: ci || undefined,
      checkOut: co || undefined,
      saved: true,
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void run()}
          placeholder="e.g. luxury Bali resort"
          className={`${inputCls} min-w-[10rem] flex-1`}
        />
        <input
          type="date"
          aria-label="check-in"
          value={ci}
          onChange={(e) => setCi(e.target.value)}
          className={`${inputCls} [color-scheme:dark]`}
        />
        <input
          type="date"
          aria-label="check-out"
          value={co}
          onChange={(e) => setCo(e.target.value)}
          className={`${inputCls} [color-scheme:dark]`}
        />
        <input
          type="number"
          min={1}
          max={12}
          aria-label="adults"
          value={adults}
          onChange={(e) => setAdults(Math.max(1, Number(e.target.value) || 1))}
          className={`${inputCls} w-14`}
        />
        <button type="button" onClick={() => void run()} disabled={busy} className={btnAccent}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Search
        </button>
      </div>
      {err && <p className="text-[11px] text-amber-400/80">{err}</p>}

      {results.length > 0 && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {results.map((o, i) => (
            <StayCard
              key={`${o.name}-${i}`}
              o={o}
              nights={nightsBetween(ci, co)}
              canSave={!!tripId}
              onResolve={resolveFor}
              onSave={(link) => save(o, link)}
            />
          ))}
        </div>
      )}

      {stays && stays.length > 0 && (
        <div className="space-y-1.5 border-t border-rule-soft/40 pt-3">
          <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-paper-faint">
            Saved · {stays.length}
          </p>
          {stays.map((s) => (
            <div
              key={s._id}
              className="flex items-center gap-2 rounded-lg border border-rule-soft/40 bg-ink-2/30 px-2 py-1.5"
            >
              {s.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.image} alt="" className="h-8 w-10 shrink-0 rounded object-cover" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] text-paper">{s.name}</p>
                <p className="text-[10px] text-paper-faint">
                  {gbp(s.priceGbp) ? `${gbp(s.priceGbp)}/night` : "—"}
                  {s.provider ? ` · ${s.provider}` : ""}
                </p>
              </div>
              {s.link && (
                <a
                  href={s.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-paper-faint hover:text-brass"
                  aria-label="open booking link"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
              <button
                type="button"
                aria-label="remove saved stay"
                onClick={() => void removeStay({ stayId: s._id })}
                className="shrink-0 text-paper-faint hover:text-red-400"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StayCard({
  o,
  nights,
  canSave,
  onResolve,
  onSave,
}: {
  o: StayOption;
  nights: number;
  canSave: boolean;
  /** Resolve the exact booking link (null → use the search deep-link). */
  onResolve: (o: StayOption) => Promise<string | null>;
  onSave: (link: string) => void;
}) {
  const periodTotal =
    typeof o.priceGbp === "number" && nights > 0 ? o.priceGbp * nights : undefined;
  // Cache the resolved direct link so we only hit SerpApi once per card.
  const [resolved, setResolved] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const ensureLink = async (): Promise<string> => {
    if (resolved) return resolved;
    setLoading(true);
    try {
      const u = (await onResolve(o)) ?? o.link;
      setResolved(u);
      return u;
    } finally {
      setLoading(false);
    }
  };
  const book = async () => {
    // Open the tab synchronously (inside the click gesture) so popup blockers
    // don't kill it, then point it at the resolved link once it returns.
    const w = window.open("about:blank", "_blank");
    const u = await ensureLink();
    if (w) {
      try {
        w.opener = null;
      } catch {
        /* ignore */
      }
      w.location.href = u;
    } else {
      window.open(u, "_blank", "noopener,noreferrer");
    }
  };
  const save = async () => {
    const u = await ensureLink();
    onSave(u);
  };

  return (
    <div className="overflow-hidden rounded-lg border border-rule-soft/40 bg-ink-2/30">
      {o.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={o.image}
          alt=""
          className="h-28 w-full object-cover"
          onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
        />
      )}
      <div className="space-y-1 p-2.5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[12px] font-medium leading-tight text-paper">{o.name}</p>
          {typeof o.rating === "number" && (
            <span className="flex shrink-0 items-center gap-0.5 text-[10px] text-paper-faint">
              <Star className="h-3 w-3 fill-brass/70 text-brass/70" /> {o.rating.toFixed(1)}
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-2">
          {gbp(o.priceGbp) && (
            <span className="text-[13px] font-semibold tabular-nums text-paper">
              {gbp(o.priceGbp)}
              <span className="text-[10px] font-normal text-paper-faint"> /night</span>
            </span>
          )}
          {periodTotal != null && (
            <span className="text-[10px] tabular-nums text-paper-faint">
              {gbp(periodTotal)} · {nights} night{nights > 1 ? "s" : ""}
            </span>
          )}
        </div>
        <span className="flex w-fit items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] text-emerald-300">
          <CheckCircle2 className="h-2.5 w-2.5" /> Free cancellation
        </span>
        <div className="flex items-center gap-2 pt-0.5">
          <button
            type="button"
            onClick={() => void book()}
            disabled={loading}
            className="flex flex-1 items-center justify-center gap-1 rounded-md border border-brass/40 bg-brass/10 px-2 py-1 text-[10px] font-mono uppercase tracking-[0.1em] text-brass hover:bg-brass/20 transition-colors disabled:opacity-60"
          >
            {loading ? (
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
            ) : (
              <>
                Book on Booking.com <ExternalLink className="h-2.5 w-2.5" />
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!canSave || loading}
            aria-label="save to trip"
            className="flex items-center gap-1 rounded-md border border-rule-soft/50 px-2 py-1 text-[10px] font-mono uppercase tracking-[0.1em] text-paper-faint hover:text-paper hover:border-brass/50 transition-colors disabled:opacity-40"
          >
            <Plus className="h-3 w-3" /> Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Flights ─────────────────────────────────────────────────────────────────
function FlightsSearch({
  tripId,
  startDate,
  endDate,
  budgetGbp,
}: {
  tripId: Id<"trips"> | null;
  startDate?: string;
  endDate?: string;
  budgetGbp?: number;
}) {
  const search = useAction(api.travelActions.searchFlights);
  const addFlight = useMutation(api.tripExtras.addFlight);
  const removeFlight = useMutation(api.tripExtras.removeFlight);
  const flights = useQuery(
    api.tripExtras.listFlights,
    tripId ? { tripId } : "skip",
  ) as Doc<"tripFlights">[] | undefined;

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [outbound, setOutbound] = useState(startDate ?? "");
  const [ret, setRet] = useState(endDate ?? "");
  const [adults, setAdults] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [results, setResults] = useState<FlightOption[]>([]);

  const run = async () => {
    if (!from.trim() || !to.trim() || !outbound) {
      setErr("Enter origin, destination (IATA codes) and a departure date.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await search({
        origin: from.trim(),
        destination: to.trim(),
        outboundDate: outbound,
        returnDate: ret || undefined,
        adults,
        maxPrice: budgetGbp && budgetGbp > 0 ? budgetGbp : undefined,
      });
      if (!r.available) {
        setErr(r.reason ?? "No results.");
        setResults([]);
      } else {
        setResults(r.options);
        if (r.options.length === 0) setErr("No flights found for that route/date.");
      }
    } catch {
      setErr("Search failed — try again.");
    } finally {
      setBusy(false);
    }
  };

  const save = (o: FlightOption) => {
    if (!tripId) return;
    void addFlight({
      tripId,
      segments: [
        {
          from: o.from ?? from.trim().toUpperCase(),
          to: o.to ?? to.trim().toUpperCase(),
          depart: outbound || undefined,
          arrive: ret || undefined,
          carrier: o.airline,
        },
      ],
      priceGbp: o.priceGbp,
      bookLink: o.bookLink,
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          placeholder="From (e.g. LHR)"
          className={`${inputCls} w-28`}
        />
        <input
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="To (e.g. DPS)"
          className={`${inputCls} w-28`}
        />
        <input
          type="date"
          aria-label="outbound date"
          value={outbound}
          onChange={(e) => setOutbound(e.target.value)}
          className={`${inputCls} [color-scheme:dark]`}
        />
        <input
          type="date"
          aria-label="return date (optional)"
          value={ret}
          onChange={(e) => setRet(e.target.value)}
          className={`${inputCls} [color-scheme:dark]`}
        />
        <input
          type="number"
          min={1}
          max={9}
          aria-label="adults"
          value={adults}
          onChange={(e) => setAdults(Math.max(1, Number(e.target.value) || 1))}
          className={`${inputCls} w-14`}
        />
        <button type="button" onClick={() => void run()} disabled={busy} className={btnAccent}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Search
        </button>
      </div>
      {err && <p className="text-[11px] text-amber-400/80">{err}</p>}

      {results.length > 0 && (
        <div className="space-y-1.5">
          {results.map((o, i) => (
            <FlightCard key={i} o={o} canSave={!!tripId} onSave={() => save(o)} />
          ))}
        </div>
      )}

      {flights && flights.length > 0 && (
        <div className="space-y-1.5 border-t border-rule-soft/40 pt-3">
          <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-paper-faint">
            Saved flights · {flights.length}
          </p>
          {flights.map((f) => (
            <div
              key={f._id}
              className="flex items-center gap-2 rounded-lg border border-rule-soft/40 bg-ink-2/30 px-2 py-1.5"
            >
              <Plane className="h-3.5 w-3.5 shrink-0 text-brass/70" />
              <span className="min-w-0 flex-1 truncate text-[12px] text-paper">
                {f.segments[0]?.from} → {f.segments[0]?.to}
                {f.segments[0]?.carrier ? ` · ${f.segments[0].carrier}` : ""}
              </span>
              {gbp(f.priceGbp) && (
                <span className="shrink-0 text-[11px] tabular-nums text-paper-faint">
                  {gbp(f.priceGbp)}
                </span>
              )}
              {f.bookLink && (
                <a
                  href={f.bookLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-paper-faint hover:text-brass"
                  aria-label="open flight booking"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
              <button
                type="button"
                aria-label="remove saved flight"
                onClick={() => void removeFlight({ flightId: f._id })}
                className="shrink-0 text-paper-faint hover:text-red-400"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FlightCard({
  o,
  canSave,
  onSave,
}: {
  o: FlightOption;
  canSave: boolean;
  onSave: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-rule-soft/40 bg-ink-2/30 px-2.5 py-2">
      {o.airlineLogo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={o.airlineLogo} alt="" className="h-5 w-5 shrink-0 rounded object-contain" />
      ) : (
        <Plane className="h-4 w-4 shrink-0 text-brass/70" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] text-paper">
          {o.from} → {o.to}
          {o.airline ? <span className="text-paper-faint"> · {o.airline}</span> : null}
        </p>
        <p className="text-[10px] text-paper-faint">
          {dur(o.durationMin) ?? ""}
          {dur(o.durationMin) ? " · " : ""}
          {o.stops === 0 ? "non-stop" : `${o.stops} stop${o.stops > 1 ? "s" : ""}`}
          {o.departTime ? ` · ${o.departTime}` : ""}
        </p>
      </div>
      {gbp(o.priceGbp) && (
        <span className="shrink-0 text-[13px] font-semibold tabular-nums text-paper">
          {gbp(o.priceGbp)}
        </span>
      )}
      <a
        href={o.bookLink}
        target="_blank"
        rel="noopener noreferrer"
        className="flex shrink-0 items-center gap-1 rounded-md border border-brass/40 bg-brass/10 px-2 py-1 text-[10px] font-mono uppercase tracking-[0.1em] text-brass hover:bg-brass/20 transition-colors"
      >
        Book <ExternalLink className="h-2.5 w-2.5" />
      </a>
      <button
        type="button"
        onClick={onSave}
        disabled={!canSave}
        aria-label="save flight to trip"
        className="flex shrink-0 items-center gap-1 rounded-md border border-rule-soft/50 px-1.5 py-1 text-[10px] font-mono uppercase tracking-[0.1em] text-paper-faint hover:text-paper hover:border-brass/50 transition-colors disabled:opacity-40"
      >
        <Plus className="h-3 w-3" />
      </button>
    </div>
  );
}

export default FindMode;
