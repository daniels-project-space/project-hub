"use client";

/**
 * TripsOverview — the streamlined, visual default view of the Travel widget.
 *
 * v2 (2026-07-03, per Daniel): live prices wired in.
 *   - Permanent per-trip preferences: travelers + dates (persisted on the trip;
 *     every search uses them).
 *   - "Load live prices" runs ONE Google-Hotels search (SerpAPI — real prices,
 *     perks, free-cancellation flags, per-OTA offers) shaped by the trip
 *     budget, then renders a CAROUSEL PER PROVIDER (his five cashback portals
 *     first, then everything else): image, £/night + total, rating, perks,
 *     free-cancel badge, hyperlink, and a LOCK IN button.
 *   - Locking a stay saves it as THE booking for its period; the timeline
 *     shows locked stays as committed blocks so only transport is left —
 *     flight markers with times, plus real transport links (Google Flights /
 *     Rome2rio) for the gaps.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Plane,
  BedDouble,
  ExternalLink,
  CalendarRange,
  Maximize2,
  PiggyBank,
  Users,
  Lock,
  LockOpen,
  Star,
  Loader2,
  Search,
  TrainFront,
} from "lucide-react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { BOOKING_PROVIDERS } from "@/lib/travel/booking-links";

const gbp = (n: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(n);

function parseISO(d?: string): Date | null {
  if (!d) return null;
  const t = new Date(`${d}T00:00:00Z`);
  return Number.isNaN(t.getTime()) ? null : t;
}

function fmtShort(d?: string): string {
  const t = parseISO(d);
  if (!t) return "";
  return t.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

function phase(start?: string, end?: string): { label: string; tone: "amber" | "emerald" | "faint" } {
  const s = parseISO(start);
  const e = parseISO(end);
  const now = Date.now();
  if (!s) return { label: "no dates yet", tone: "faint" };
  if (now < s.getTime()) {
    const days = Math.ceil((s.getTime() - now) / 86_400_000);
    return { label: days === 1 ? "tomorrow" : `in ${days} days`, tone: "amber" };
  }
  if (e && now <= e.getTime() + 86_400_000) {
    const day = Math.floor((now - s.getTime()) / 86_400_000) + 1;
    const total = Math.max(1, Math.round((e.getTime() - s.getTime()) / 86_400_000));
    return { label: `day ${day} of ${total}`, tone: "emerald" };
  }
  return { label: "completed", tone: "faint" };
}

const BADGE_TONE: Record<string, string> = {
  amber: "border-amber/40 bg-amber/10 text-amber",
  emerald: "border-emerald-soft/40 bg-emerald-soft/10 text-emerald-soft",
  faint: "border-rule-soft/50 bg-ink-2/40 text-paper-faint",
};

// ── live search result shape (mirror travelActions.StayOption) ─────────────
type StayOption = {
  name: string;
  provider?: string;
  priceGbp?: number;
  totalGbp?: number;
  image?: string;
  rating?: number;
  freeCancellation?: boolean;
  link: string;
  googleLink?: string;
  propertyToken?: string;
  amenities?: string[];
  offers?: { source: string; priceGbp?: number }[];
};

// Map an OTA source string from Google Hotels onto one of the cashback
// providers (loose contains-match: "Booking.com", "Expedia.co.uk", …).
const PROVIDER_MATCH: { key: string; label: string; test: RegExp }[] = [
  { key: "booking", label: "Booking.com", test: /booking\.com/i },
  { key: "expedia", label: "Expedia", test: /expedia/i },
  { key: "trivago", label: "Trivago", test: /trivago/i },
  { key: "lastminute", label: "lastminute", test: /lastminute/i },
  { key: "trip", label: "Trip.com", test: /trip\.com/i },
];

function CashbackChips({ city, checkIn, checkOut, adults }: { city: string; checkIn?: string; checkOut?: string; adults?: number }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.18em] text-emerald-soft/80">
        <PiggyBank className="w-3 h-3" /> cashback
      </span>
      {BOOKING_PROVIDERS.map((p) => (
        <a
          key={p.key}
          href={p.url({ city, checkIn, checkOut, adults })}
          target="_blank"
          rel="noreferrer"
          className="rounded-full border border-rule-soft/50 bg-ink-2/40 px-2 py-0.5 font-mono text-[10px] text-paper-dim hover:border-brass/50 hover:text-brass transition-colors"
        >
          {p.label}
        </a>
      ))}
    </div>
  );
}

// ── stay result card (inside provider carousels) ────────────────────────────
function StayCard({
  o,
  otaPrice,
  onLock,
  locking,
}: {
  o: StayOption;
  otaPrice?: number;
  onLock: (o: StayOption) => void;
  locking: boolean;
}) {
  const nightly = otaPrice ?? o.priceGbp;
  return (
    <div className="w-[218px] shrink-0 snap-start overflow-hidden rounded-xl border border-rule-soft/60 bg-ink-2/40">
      {o.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={o.image} alt="" className="h-24 w-full object-cover" loading="lazy" />
      ) : (
        <div className="grid h-24 w-full place-items-center bg-ink-3/50 text-paper-faint">
          <BedDouble className="h-5 w-5" />
        </div>
      )}
      <div className="space-y-1.5 p-2.5">
        <div className="flex items-start justify-between gap-1.5">
          <p className="line-clamp-2 text-[12px] leading-snug text-paper">{o.name}</p>
          {typeof o.rating === "number" && (
            <span className="flex shrink-0 items-center gap-0.5 font-mono text-[10px] text-amber">
              <Star className="h-2.5 w-2.5 fill-current" />
              {o.rating.toFixed(1)}
            </span>
          )}
        </div>
        <p className="font-mono text-[13px] font-bold tabular-nums text-paper leading-none">
          {typeof nightly === "number" ? `${gbp(nightly)}/nt` : "price on site"}
          {typeof o.totalGbp === "number" && (
            <span className="ml-1.5 font-normal text-[10px] text-paper-faint">
              {gbp(o.totalGbp)} total
            </span>
          )}
        </p>
        <div className="flex min-h-[16px] flex-wrap gap-1">
          {o.freeCancellation && (
            <span className="rounded-full border border-emerald-soft/40 bg-emerald-soft/10 px-1.5 py-px font-mono text-[8px] uppercase tracking-[0.12em] text-emerald-soft">
              free cancel
            </span>
          )}
          {(o.amenities ?? []).slice(0, 2).map((a) => (
            <span
              key={a}
              className="rounded-full border border-rule-soft/50 px-1.5 py-px font-mono text-[8px] uppercase tracking-[0.08em] text-paper-faint"
            >
              {a}
            </span>
          ))}
        </div>
        <div className="flex items-center justify-between pt-0.5">
          <a
            href={o.link}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint hover:text-brass transition-colors"
          >
            open <ExternalLink className="h-2.5 w-2.5" />
          </a>
          <button
            type="button"
            disabled={locking}
            onClick={() => onLock(o)}
            className="flex items-center gap-1 rounded-md border border-brass/40 bg-brass/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-brass hover:bg-brass/20 transition-colors disabled:opacity-50"
          >
            <Lock className="h-2.5 w-2.5" /> lock in
          </button>
        </div>
      </div>
    </div>
  );
}

// ── visual booking timeline ─────────────────────────────────────────────────
// One cell per trip day; locked stays paint emerald spans (bed symbol), flights
// drop brass plane markers at their departure day. Uncovered days read as gaps.
function BookingTimeline({
  start,
  end,
  stays,
  flights,
}: {
  start: string;
  end: string;
  stays: { name: string; checkIn?: string; checkOut?: string }[];
  flights: { title: string; depart?: string; time?: string }[];
}) {
  const s = parseISO(start)!;
  const e = parseISO(end)!;
  const days = Math.max(1, Math.round((e.getTime() - s.getTime()) / 86_400_000));
  const idxOf = (iso?: string) => {
    const d = parseISO(iso ?? "");
    if (!d) return null;
    const i = Math.round((d.getTime() - s.getTime()) / 86_400_000);
    return i < 0 || i > days ? null : i;
  };
  const covered = new Array(days).fill(false);
  const spans = stays
    .map((st) => {
      const a = idxOf(st.checkIn);
      const b = idxOf(st.checkOut);
      if (a == null || b == null || b <= a) return null;
      for (let i = a; i < Math.min(b, days); i++) covered[i] = true;
      return { name: st.name, from: a, to: Math.min(b, days) };
    })
    .filter(Boolean) as { name: string; from: number; to: number }[];
  const marks = flights
    .map((f) => {
      const i = idxOf(f.depart?.slice(0, 10));
      return i == null ? null : { i, title: f.title, time: f.time };
    })
    .filter(Boolean) as { i: number; title: string; time?: string }[];
  const gaps: { from: number; to: number }[] = [];
  let g: number | null = null;
  for (let i = 0; i <= days; i++) {
    const open = i < days && !covered[i];
    if (open && g == null) g = i;
    if (!open && g != null) {
      gaps.push({ from: g, to: i });
      g = null;
    }
  }
  const pct = (i: number) => `${(i / days) * 100}%`;

  return (
    <div>
      <div className="relative mt-1 h-9">
        {/* base track */}
        <div className="absolute inset-x-0 top-4 h-1.5 rounded-full bg-ink-3/70" />
        {/* stay spans */}
        {spans.map((sp, i) => (
          <div
            key={i}
            className="absolute top-[13px] flex h-2 items-center rounded-full bg-emerald-soft/60"
            style={{ left: pct(sp.from), width: `calc(${pct(sp.to - sp.from)} )` }}
            title={sp.name}
          />
        ))}
        {/* stay symbols */}
        {spans.map((sp, i) => (
          <BedDouble
            key={`b${i}`}
            className="absolute top-0 h-3 w-3 text-emerald-soft"
            style={{ left: `calc(${pct((sp.from + sp.to) / 2)} - 6px)` }}
          />
        ))}
        {/* flight markers */}
        {marks.map((m, i) => (
          <div key={i} className="absolute top-[7px]" style={{ left: `calc(${pct(m.i)} - 6px)` }} title={m.title}>
            <Plane className="h-3 w-3 text-brass" />
            {m.time && (
              <span className="absolute left-1/2 top-4 -translate-x-1/2 font-mono text-[8px] text-paper-faint">
                {m.time}
              </span>
            )}
          </div>
        ))}
        {/* endpoint dates */}
        <span className="absolute left-0 top-6 font-mono text-[9px] text-paper-faint">{fmtShort(start)}</span>
        <span className="absolute right-0 top-6 font-mono text-[9px] text-paper-faint">{fmtShort(end)}</span>
      </div>
      {gaps.length > 0 && (
        <p className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-amber/80">
          {gaps.map((gp) => `no stay ${fmtShort(addDays(start, gp.from))}–${fmtShort(addDays(start, gp.to))}`).join(" · ")}
        </p>
      )}
    </div>
  );
}

function addDays(iso: string, n: number): string {
  const d = parseISO(iso)!;
  return new Date(d.getTime() + n * 86_400_000).toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
export function TripsOverview({
  tripId,
  trip,
}: {
  tripId: Id<"trips"> | null;
  trip: {
    title: string;
    startDate?: string;
    endDate?: string;
    budgetGbp?: number;
    originCity?: string;
    destCity?: string;
    destCountryCode?: string;
    travelers?: number;
  } | null;
}) {
  const flights = useQuery(api.tripExtras.listFlights, tripId ? { tripId } : "skip");
  const stays = useQuery(api.tripExtras.listStays, tripId ? { tripId } : "skip");
  const updateTrip = useMutation(api.trips.update);
  const saveStay = useMutation(api.tripExtras.saveStay);
  const setLocked = useMutation(api.tripExtras.setStayLocked);
  const removeStay = useMutation(api.tripExtras.removeStay);
  const search = useAction(api.travelActions.searchStays);

  const [results, setResults] = useState<StayOption[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [lockingName, setLockingName] = useState<string | null>(null);

  const city = trip?.destCity || trip?.title || "";
  const travelers = trip?.travelers && trip.travelers > 0 ? trip.travelers : 2;
  const s = parseISO(trip?.startDate);
  const e = parseISO(trip?.endDate);
  const nights = s && e ? Math.max(0, Math.round((e.getTime() - s.getTime()) / 86_400_000)) : null;
  const perNightBudget =
    trip?.budgetGbp && nights ? Math.max(20, Math.floor(trip.budgetGbp / nights)) : undefined;

  // Group results per cashback provider (property listed when that OTA prices
  // it). Anything unmatched lands in "Best price" so no result is hidden.
  const carousels = useMemo(() => {
    if (!results) return [];
    const byProvider = PROVIDER_MATCH.map((pm) => ({
      ...pm,
      items: results
        .map((o) => {
          const offer = (o.offers ?? []).find((x) => pm.test.test(x.source));
          return offer ? { o, otaPrice: offer.priceGbp } : null;
        })
        .filter(Boolean) as { o: StayOption; otaPrice?: number }[],
    })).filter((c) => c.items.length > 0);
    const rails: { key: string; label: string; items: { o: StayOption; otaPrice?: number }[] }[] = [
      {
        key: "best",
        label: "Best price",
        items: results.slice(0, 16).map((o) => ({ o, otaPrice: undefined })),
      },
      ...byProvider.map((c) => ({
        key: c.key,
        label: c.label,
        items: c.items.sort((a, b) => (a.otaPrice ?? 9e9) - (b.otaPrice ?? 9e9)).slice(0, 12),
      })),
    ];
    return rails;
  }, [results]);

  if (!tripId || !trip) {
    return (
      <p className="py-6 text-center text-[12px] text-paper-faint">
        No trip selected — create one from the prompt above.
      </p>
    );
  }

  const ph = phase(trip.startDate, trip.endDate);
  const canSearch = !!city && !!trip.startDate && !!trip.endDate;

  const runSearch = async () => {
    if (!canSearch || searching) return;
    setSearching(true);
    setSearchErr(null);
    try {
      const res = await search({
        query: `${city} hotels`,
        checkIn: trip.startDate!,
        checkOut: trip.endDate!,
        adults: travelers,
        maxPricePerNight: perNightBudget,
      });
      if (!res.available) setSearchErr(res.reason ?? "search unavailable");
      setResults(res.options ?? []);
    } catch (err) {
      setSearchErr(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  };

  const lockIn = async (o: StayOption, otaSource?: string, otaPrice?: number) => {
    setLockingName(o.name);
    try {
      await saveStay({
        tripId,
        name: o.name,
        provider: otaSource ?? o.provider,
        priceGbp: o.totalGbp ?? otaPrice ?? o.priceGbp,
        image: o.image,
        link: o.link,
        freeCancellation: o.freeCancellation,
        checkIn: trip.startDate,
        checkOut: trip.endDate,
        saved: true,
        locked: true,
      });
    } finally {
      setLockingName(null);
    }
  };

  // bookings (saved stays + flights, chronological)
  const savedStays = (stays ?? []).filter((st) => st.saved !== false);
  const bookingRows = [
    ...(flights ?? []).map((f) => {
      const seg0 = f.segments[0];
      const segN = f.segments[f.segments.length - 1];
      return {
        key: `f-${f._id}`,
        kind: "flight" as const,
        title: seg0 ? `${seg0.from} → ${segN.to}` : "Flight",
        when: seg0?.depart ?? "",
        sortDate: seg0?.depart ?? "",
        priceGbp: f.priceGbp,
        link: f.bookLink,
        locked: false,
        stayId: null as Id<"tripStays"> | null,
      };
    }),
    ...savedStays.map((st) => ({
      key: `s-${st._id}`,
      kind: "stay" as const,
      title: st.name,
      when:
        st.checkIn && st.checkOut ? `${fmtShort(st.checkIn)} – ${fmtShort(st.checkOut)}` : fmtShort(st.checkIn),
      sortDate: st.checkIn ?? "",
      priceGbp: st.priceGbp,
      link: st.link,
      locked: st.locked === true,
      stayId: st._id,
    })),
  ].sort((a, b) => (a.sortDate || "9999").localeCompare(b.sortDate || "9999"));

  return (
    <div className="space-y-3">
      {/* ── hero + permanent preferences ──────────────────────────────────── */}
      <div
        className="relative overflow-hidden rounded-xl border border-rule-soft/60 px-4 py-4"
        style={{
          background:
            "linear-gradient(150deg, oklch(0.24 0.02 75 / 0.55), oklch(0.17 0.008 245 / 0.75) 55%)",
        }}
      >
        <div
          className="absolute inset-x-0 top-0 h-px opacity-40"
          style={{
            background:
              "linear-gradient(90deg, transparent, var(--color-brass) 35%, var(--color-brass) 65%, transparent)",
          }}
        />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-paper-faint">
              Next trip{trip.destCountryCode ? ` · ${trip.destCountryCode.toUpperCase()}` : ""}
            </p>
            <h3 className="mt-0.5 font-display italic font-light text-[30px] leading-none text-paper truncate">
              {city}
            </h3>
          </div>
          <span
            className={cn(
              "shrink-0 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em]",
              BADGE_TONE[ph.tone],
            )}
          >
            <CalendarRange className="mr-1 inline h-3 w-3 -translate-y-px" />
            {ph.label}
          </span>
        </div>

        {/* permanent search preferences: dates + travelers (persisted) */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={trip.startDate ?? ""}
            onChange={(ev) => void updateTrip({ tripId, patch: { startDate: ev.target.value } })}
            className="rounded-md border border-rule-soft/60 bg-ink-3/60 px-2 py-1 font-mono text-[11px] text-paper focus:outline-none focus:border-brass/50"
          />
          <span className="text-paper-faint">→</span>
          <input
            type="date"
            value={trip.endDate ?? ""}
            onChange={(ev) => void updateTrip({ tripId, patch: { endDate: ev.target.value } })}
            className="rounded-md border border-rule-soft/60 bg-ink-3/60 px-2 py-1 font-mono text-[11px] text-paper focus:outline-none focus:border-brass/50"
          />
          <div className="flex items-center gap-1 rounded-md border border-rule-soft/60 bg-ink-3/60 px-2 py-1">
            <Users className="h-3 w-3 text-paper-faint" />
            <button
              type="button"
              onClick={() => void updateTrip({ tripId, patch: { travelers: Math.max(1, travelers - 1) } })}
              className="px-1 font-mono text-[12px] text-paper-faint hover:text-paper"
            >
              −
            </button>
            <span className="font-mono text-[11px] tabular-nums text-paper">{travelers}</span>
            <button
              type="button"
              onClick={() => void updateTrip({ tripId, patch: { travelers: Math.min(9, travelers + 1) } })}
              className="px-1 font-mono text-[12px] text-paper-faint hover:text-paper"
            >
              +
            </button>
          </div>
          {typeof trip.budgetGbp === "number" && trip.budgetGbp > 0 && (
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-paper-faint">
              budget <span className="text-brass tabular-nums">{gbp(trip.budgetGbp)}</span>
              {perNightBudget ? ` · ≤${gbp(perNightBudget)}/nt` : ""}
            </span>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <CashbackChips city={city} checkIn={trip.startDate} checkOut={trip.endDate} adults={travelers} />
          <button
            type="button"
            disabled={!canSearch || searching}
            onClick={runSearch}
            className="flex items-center gap-1.5 rounded-lg border border-brass/40 bg-brass/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-brass hover:bg-brass/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {searching ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
            {results ? "refresh prices" : "load live prices"}
          </button>
        </div>
        {!canSearch && (
          <p className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-paper-faint">
            set both dates to enable live prices
          </p>
        )}
        {searchErr && (
          <p className="mt-1.5 font-mono text-[10px] text-rose-soft">{searchErr}</p>
        )}
      </div>

      {/* ── provider carousels ────────────────────────────────────────────── */}
      {carousels.map((rail) => (
        <div key={rail.key}>
          <p className="mb-1.5 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.22em] text-paper-faint">
            {rail.label}
            <span className="text-paper-faint/50">· {rail.items.length}</span>
            {rail.key !== "best" && (
              <span className="flex items-center gap-1 text-emerald-soft/70">
                <PiggyBank className="h-2.5 w-2.5" /> cashback
              </span>
            )}
          </p>
          <div className="no-scrollbar flex snap-x gap-2.5 overflow-x-auto pb-1">
            {rail.items.map(({ o, otaPrice }, i) => (
              <StayCard
                key={`${rail.key}-${i}-${o.name}`}
                o={o}
                otaPrice={otaPrice}
                locking={lockingName === o.name}
                onLock={(opt) =>
                  void lockIn(
                    opt,
                    rail.key !== "best" ? rail.label : undefined,
                    otaPrice,
                  )
                }
              />
            ))}
          </div>
        </div>
      ))}

      {/* ── visual timeline (locked stays + flights + gaps) ───────────────── */}
      {trip.startDate && trip.endDate && (
        <div className="rounded-xl border border-rule-soft/50 bg-ink-2/30 px-4 py-3">
          <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-paper-faint">
            Trip timeline
          </p>
          <BookingTimeline
            start={trip.startDate}
            end={trip.endDate}
            stays={savedStays.filter((st) => st.locked === true)}
            flights={(flights ?? []).map((f) => {
              const seg0 = f.segments[0];
              const dep = seg0?.depart ?? "";
              return {
                title: seg0 ? `${seg0.from} → ${f.segments[f.segments.length - 1].to}` : "Flight",
                depart: dep,
                time: /\d{2}:\d{2}/.test(dep) ? dep.match(/\d{2}:\d{2}/)![0] : undefined,
              };
            })}
          />
          {/* real transport links for what's left */}
          {trip.originCity && (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <span className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.18em] text-paper-faint">
                <TrainFront className="h-3 w-3" /> transport
              </span>
              <a
                href={`https://www.google.com/travel/flights?q=${encodeURIComponent(`flights from ${trip.originCity} to ${city} on ${trip.startDate}`)}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-rule-soft/50 bg-ink-2/40 px-2 py-0.5 font-mono text-[10px] text-paper-dim hover:border-brass/50 hover:text-brass transition-colors"
              >
                Google Flights
              </a>
              <a
                href={`https://www.rome2rio.com/s/${encodeURIComponent(trip.originCity)}/${encodeURIComponent(city)}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-rule-soft/50 bg-ink-2/40 px-2 py-0.5 font-mono text-[10px] text-paper-dim hover:border-brass/50 hover:text-brass transition-colors"
              >
                Rome2rio (all modes + prices)
              </a>
            </div>
          )}
        </div>
      )}

      {/* ── bookings list ─────────────────────────────────────────────────── */}
      <div>
        <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.22em] text-paper-faint">
          Bookings · {flights === undefined || stays === undefined ? "…" : bookingRows.length}
        </p>
        {flights === undefined || stays === undefined ? (
          <p className="py-3 text-[12px] text-paper-faint">Loading bookings…</p>
        ) : bookingRows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-rule-soft/60 px-3 py-3">
            <p className="text-[12px] text-paper-faint">
              Nothing locked in yet — load live prices above and lock a stay, or
              search flights in <span className="text-paper-dim">Find</span>.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-rule-soft/30 overflow-hidden rounded-lg border border-rule-soft/50">
            {bookingRows.map((r) => (
              <li key={r.key} className="flex items-center gap-3 bg-ink-2/30 px-3 py-2.5">
                <span
                  className={cn(
                    "grid h-7 w-7 shrink-0 place-items-center rounded-md border",
                    r.kind === "flight"
                      ? "border-brass/30 bg-brass/[0.08] text-brass"
                      : "border-emerald-soft/30 bg-emerald-soft/[0.08] text-emerald-soft",
                  )}
                >
                  {r.kind === "flight" ? <Plane className="h-3.5 w-3.5" /> : <BedDouble className="h-3.5 w-3.5" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-[13px] text-paper">
                    {r.title}
                    {r.locked && (
                      <span className="flex shrink-0 items-center gap-0.5 rounded-full border border-amber/40 bg-amber/10 px-1.5 py-px font-mono text-[8px] uppercase tracking-[0.12em] text-amber">
                        <Lock className="h-2 w-2" /> locked
                      </span>
                    )}
                  </p>
                  <p className="font-mono text-[10px] text-paper-faint">{r.when || "—"}</p>
                </div>
                {typeof r.priceGbp === "number" && (
                  <span className="font-mono text-[12px] tabular-nums text-paper-dim">{gbp(r.priceGbp)}</span>
                )}
                {r.stayId && (
                  <button
                    type="button"
                    onClick={() =>
                      r.locked
                        ? void setLocked({ stayId: r.stayId!, locked: false })
                        : void setLocked({ stayId: r.stayId!, locked: true })
                    }
                    className="text-paper-faint hover:text-amber transition-colors"
                    aria-label={r.locked ? "unlock stay" : "lock stay"}
                  >
                    {r.locked ? <LockOpen className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                  </button>
                )}
                {r.stayId && !r.locked && (
                  <button
                    type="button"
                    onClick={() => void removeStay({ stayId: r.stayId! })}
                    className="font-mono text-[11px] text-paper-faint/50 hover:text-rose-soft transition-colors"
                    aria-label="remove stay"
                  >
                    ×
                  </button>
                )}
                {r.link && (
                  <a
                    href={r.link}
                    target="_blank"
                    rel="noreferrer"
                    className="text-paper-faint hover:text-brass transition-colors"
                    aria-label={`open ${r.title}`}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Link
        href={`/travel/${tripId}`}
        className="flex items-center justify-center gap-1.5 rounded-lg border border-rule-soft/50 bg-ink-2/30 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-paper-faint hover:border-brass/40 hover:text-brass transition-colors"
      >
        <Maximize2 className="h-3 w-3" /> open full planner
      </Link>
    </div>
  );
}
