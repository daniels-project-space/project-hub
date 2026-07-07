"use client";

/**
 * TripsOverview — the streamlined, visual default view of the Travel widget.
 *
 * v3 (2026-07-03, per Daniel — "less stiff"):
 *  - YEAR BAND: all trips on a 12-month strip with a you-are-here marker;
 *    click a span to switch trips. Inline "+ trip" (city+dates+budget,
 *    geocoded client-side so the globe knows where it is).
 *  - GLOBE overlay: MapLibre globe (existing TripGlobe, dynamically loaded)
 *    plotting every trip by date — where you are, when.
 *  - Dynamic BUDGET slider (persisted; live ≤£/nt derives from nights).
 *  - Live prices (SerpAPI Google Hotels): "Best price" rail + carousel per
 *    cashback portal (now incl. Hotels.com). Cards expand into an OFFERS
 *    panel via resolveStayOffers: per-provider DIRECT links to the exact
 *    property page with dates/guests prefilled (the "auto-fill and open it
 *    for me" ask — no Browserbase needed), each labeled with its provider and
 *    carrying that rate's own perks + free-cancellation flag.
 *  - Lock-in stays, booking timeline with symbols/times, transfers chain.
 */

import { useMemo, useRef, useState, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import dynamic from "next/dynamic";
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
  Globe2,
  Plus,
  ChevronDown,
  ChevronUp,
  MapPin,
  Check,
  ArrowRight,
  ArrowLeft,
  SkipForward,
} from "lucide-react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { BOOKING_PROVIDERS } from "@/lib/travel/booking-links";
import { geocodePlace, searchPlaces, type GeoPlace } from "@/lib/travel/geocode";
import { AirportField } from "@/components/travel/airport-field";
import { TripJourney } from "@/components/travel/trip-journey";
import { Sheet } from "@/components/ui/sheet";
import type { GlobePoint, GlobeArc } from "@/components/travel/trip-globe";

// MapLibre dereferences window — load the globe only when the overlay opens.
const TripGlobe = dynamic(
  () => import("@/components/travel/trip-globe").then((m) => m.TripGlobe),
  { ssr: false, loading: () => <p className="p-6 text-[12px] text-paper-faint">Loading globe…</p> },
);

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
function addDays(iso: string, n: number): string {
  const d = parseISO(iso)!;
  return new Date(d.getTime() + n * 86_400_000).toISOString().slice(0, 10);
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

type StayOption = {
  name: string;
  provider?: string;
  priceGbp?: number;
  totalGbp?: number;
  image?: string;
  thumb?: string;
  propertyType?: string;
  hotelClass?: number;
  rating?: number;
  freeCancellation?: boolean;
  link: string;
  googleLink?: string;
  propertyToken?: string;
  amenities?: string[];
  offers?: { source: string; priceGbp?: number }[];
  gallery?: string[];
};

// Dorm / shared-room detector (2026-07-03): Google's lowest rate for hostels
// is a DORM BED price that reads absurdly cheap next to private rooms. Flag it
// loudly so a £8/nt bunk is never mistaken for a £8/nt room.
function dormLikely(o: StayOption): boolean {
  if (/hostel/i.test(o.propertyType ?? "")) return true;
  if (
    /hostel|dorm(itory)?|capsule|bunk|backpacker|shared (room|bathroom)|pod hotel/i.test(
      `${o.name} ${(o.amenities ?? []).join(" ")}`,
    )
  )
    return true;
  // Price-floor heuristic: a "private room" under ~£6/nt in ANY market is a
  // dorm bed being sold per-person. Star class 4+ exempts (flash deals).
  const nightly = o.priceGbp;
  if (typeof nightly === "number" && nightly > 0 && nightly < 6 && (o.hotelClass ?? 0) < 4) return true;
  return false;
}


type ResolvedOffer = {
  source: string;
  link?: string;
  priceGbp?: number;
  totalGbp?: number;
  freeCancellation?: boolean;
  cancellationNote?: string;
  perks: string[];
};

type StayDetail = {
  amenities: string[];
  images: string[];
  address?: string;
  lat?: number;
  lng?: number;
  offers: ResolvedOffer[];
};

// Cashback portals ↔ Google Hotels offer sources (loose contains-match).
const PROVIDER_MATCH: { key: string; label: string; test: RegExp; domain: string }[] = [
  { key: "booking", label: "Booking.com", test: /booking\.com/i, domain: "booking.com" },
  { key: "expedia", label: "Expedia", test: /expedia/i, domain: "expedia.co.uk" },
  { key: "hotels", label: "Hotels.com", test: /hotels\.com/i, domain: "hotels.com" },
  { key: "trivago", label: "Trivago", test: /trivago/i, domain: "trivago.co.uk" },
  { key: "lastminute", label: "lastminute", test: /lastminute/i, domain: "lastminute.com" },
  { key: "stayforlong", label: "Stayforlong", test: /stayforlong/i, domain: "stayforlong.com" },
  { key: "trip", label: "Trip.com", test: /trip\.com/i, domain: "trip.com" },
];

type TripLite = {
  _id: Id<"trips">;
  title: string;
  startDate?: string;
  endDate?: string;
  budgetGbp?: number;
  originCity?: string;
  destCity?: string;
  destLat?: number;
  destLng?: number;
  destCountryCode?: string;
  travelers?: number;
  stayStyle?: string;
  active?: boolean;
};

// ── YEAR BAND: every trip on a 12-month strip ───────────────────────────────
function YearBand({
  trips,
  selectedId,
  onSelect,
}: {
  trips: TripLite[];
  selectedId: Id<"trips"> | null;
  onSelect: (id: Id<"trips">) => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const year = new Date().getUTCFullYear();
  const y0 = Date.UTC(year, 0, 1);
  const y1 = Date.UTC(year + 1, 0, 1);
  const span = y1 - y0;
  const pctOf = (t: number) => Math.min(100, Math.max(0, ((t - y0) / span) * 100));
  const nowPct = pctOf(Date.now());
  const dated = trips.filter((t) => parseISO(t.startDate) && parseISO(t.endDate));

  return (
    <div className="rounded-xl border border-rule-soft/50 bg-ink-2/30 px-3 pb-2 pt-2.5">
      <div className="mb-1 flex items-center justify-between">
        <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-paper-faint">{year} · trips</p>
        <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-paper-faint/60">
          {dated.length} scheduled
        </p>
      </div>
      <div className="relative h-10">
        {/* month grid */}
        {Array.from({ length: 12 }, (_, m) => (
          <div key={m} className="absolute top-0 h-full border-l border-rule-soft/25" style={{ left: `${(m / 12) * 100}%` }}>
            <span className="absolute -left-px top-6 font-mono text-[8px] uppercase text-paper-faint/50">
              {new Date(Date.UTC(year, m, 1)).toLocaleDateString("en-GB", { month: "narrow", timeZone: "UTC" })}
            </span>
          </div>
        ))}
        {/* today marker */}
        {mounted && nowPct > 0 && nowPct < 100 && (
          <div className="absolute top-0 h-6 w-px bg-amber" style={{ left: `${nowPct}%` }}>
            <span className="absolute -top-0.5 left-1 font-mono text-[8px] uppercase tracking-[0.1em] text-amber">now</span>
          </div>
        )}
        {/* trip spans */}
        {dated.map((t) => {
          const a = pctOf(parseISO(t.startDate)!.getTime());
          const b = pctOf(parseISO(t.endDate)!.getTime());
          const on = t._id === selectedId;
          return (
            <button
              key={t._id}
              type="button"
              onClick={() => onSelect(t._id)}
              title={`${t.destCity ?? t.title} · ${fmtShort(t.startDate)}–${fmtShort(t.endDate)}`}
              className={cn(
                "absolute top-2.5 h-2.5 rounded-full transition-colors",
                on ? "bg-brass" : "bg-brass/40 hover:bg-brass/70",
              )}
              style={{ left: `${a}%`, width: `${Math.max(1.2, b - a)}%` }}
            />
          );
        })}
      </div>
    </div>
  );
}

// ── custom calendar field (2026-07-04): fully house-styled popover — no more
//    native picker chrome anywhere near the travel planner. ──────────────────
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function isoOf(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// Anchored popover: renders `children` in a portal to <body>, positioned under
// the anchor rect, so it can never be clipped by an ancestor's overflow/height
// (the recurring "cut-off card" bug). Flips above the anchor near the viewport
// bottom, and closes on outside-click / scroll / resize.
function AnchoredPopover({
  anchorRef,
  open,
  onClose,
  width,
  children,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  width: number;
  children: React.ReactNode;
}) {
  const [pos, setPos] = useState<{ left: number; top: number; flip: boolean } | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const spaceBelow = window.innerHeight - r.bottom;
      const flip = spaceBelow < 320 && r.top > spaceBelow;
      const left = Math.min(Math.max(8, r.left), vw - width - 8);
      setPos({ left, top: flip ? r.top : r.bottom, flip });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, anchorRef, width]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (popRef.current?.contains(e.target as Node)) return;
      if (anchorRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, onClose, anchorRef]);

  if (!open || !pos || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={popRef}
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        width,
        transform: pos.flip ? "translateY(-100%)" : undefined,
        marginTop: pos.flip ? -6 : 6,
        zIndex: 60,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

function DateField({
  value,
  min,
  onChange,
  className,
}: {
  value: string;
  min?: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const seed = parseISO(value) ?? parseISO(min ?? "") ?? new Date();
  const [vy, setVy] = useState(seed.getUTCFullYear());
  const [vm, setVm] = useState(seed.getUTCMonth());

  const openCal = () => {
    const d = parseISO(value) ?? parseISO(min ?? "") ?? new Date();
    setVy(d.getUTCFullYear());
    setVm(d.getUTCMonth());
    setOpen(true);
  };

  const daysInMonth = new Date(Date.UTC(vy, vm + 1, 0)).getUTCDate();
  const firstDow = (new Date(Date.UTC(vy, vm, 1)).getUTCDay() + 6) % 7; // Mon=0
  const todayIso = new Date().toISOString().slice(0, 10);

  const cells: (number | null)[] = [
    ...Array.from({ length: firstDow }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <div className={cn("relative", className)}>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openCal())}
        className={cn(
          "group flex items-center gap-1.5 rounded-lg border bg-ink-3/60 px-2.5 py-1.5 transition-colors hover:border-rule-soft",
          open ? "border-brass/60" : "border-rule-soft/60",
        )}
      >
        <CalendarRange className={cn("h-3.5 w-3.5 transition-colors", open ? "text-brass" : "text-paper-faint")} />
        <span className={cn("font-mono text-[11px]", value ? "text-paper" : "text-paper-faint/60")}>
          {value
            ? parseISO(value)!.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
            : "pick a date"}
        </span>
      </button>
      <AnchoredPopover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} width={248}>
          <div className="w-[248px] rounded-xl border border-rule-soft/70 bg-ink-2 p-3 shadow-2xl">
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                onClick={() => (vm === 0 ? (setVm(11), setVy(vy - 1)) : setVm(vm - 1))}
                className="grid h-6 w-6 place-items-center rounded-md border border-rule-soft/50 text-paper-faint hover:border-brass/50 hover:text-brass transition-colors"
              >
                <ChevronDown className="h-3 w-3 rotate-90" />
              </button>
              <span className="font-display italic text-[14px] text-paper">
                {MONTHS[vm]} <span className="text-paper-faint">{vy}</span>
              </span>
              <button
                type="button"
                onClick={() => (vm === 11 ? (setVm(0), setVy(vy + 1)) : setVm(vm + 1))}
                className="grid h-6 w-6 place-items-center rounded-md border border-rule-soft/50 text-paper-faint hover:border-brass/50 hover:text-brass transition-colors"
              >
                <ChevronDown className="h-3 w-3 -rotate-90" />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-0.5">
              {WEEKDAYS.map((w) => (
                <span key={w} className="py-1 text-center font-mono text-[8px] uppercase tracking-[0.1em] text-paper-faint/60">
                  {w}
                </span>
              ))}
              {cells.map((d, i) => {
                if (d === null) return <span key={`e${i}`} />;
                const iso = isoOf(vy, vm, d);
                const disabled = !!min && iso < min;
                const selected = iso === value;
                const isToday = iso === todayIso;
                return (
                  <button
                    key={iso}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      onChange(iso);
                      setOpen(false);
                    }}
                    className={cn(
                      "grid h-7 w-7 place-items-center rounded-md font-mono text-[11px] tabular-nums transition-colors",
                      selected
                        ? "bg-brass text-ink font-bold"
                        : disabled
                          ? "text-paper-faint/25 cursor-not-allowed"
                          : "text-paper-dim hover:bg-brass/15 hover:text-brass",
                      isToday && !selected && "border border-amber/50",
                    )}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </div>
      </AnchoredPopover>
    </div>
  );
}

// ── place autocomplete: as-you-type results for ANY destination ─────────────
function PlaceField({
  placeholder,
  selected,
  onSelect,
}: {
  placeholder: string;
  selected: GeoPlace | null;
  onSelect: (p: GeoPlace | null) => void;
}) {
  const [q, setQ] = useState(selected?.name ?? "");
  const [results, setResults] = useState<GeoPlace[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);

  const query = async (text: string) => {
    setQ(text);
    onSelect(null); // typing invalidates the previous pick
    if (text.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      const hits = await searchPlaces(text.trim(), 6);
      setResults(hits);
      setOpen(hits.length > 0);
    } catch {
      setResults([]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative min-w-[170px] flex-1" ref={anchorRef}>
      <div className="group flex items-center gap-1.5 rounded-lg border border-rule-soft/60 bg-ink-3/60 px-2.5 py-1.5 transition-colors focus-within:border-brass/60">
        <Search className="h-3 w-3 shrink-0 text-paper-faint transition-colors group-focus-within:text-brass" />
        <input
          value={q}
          onChange={(ev) => void query(ev.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder={placeholder}
          className="w-full bg-transparent text-[12px] text-paper outline-none placeholder:text-paper-faint/60"
        />
        {busy && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-paper-faint" />}
        {selected && <span className="shrink-0 rounded bg-emerald-soft/15 px-1 font-mono text-[8px] uppercase text-emerald-soft">set</span>}
      </div>
      <AnchoredPopover
        anchorRef={anchorRef}
        open={open && results.length > 0}
        onClose={() => setOpen(false)}
        width={anchorRef.current?.offsetWidth ?? 220}
      >
        <ul className="max-h-56 overflow-y-auto rounded-lg border border-rule-soft/70 bg-ink-2 shadow-2xl">
          {results.map((r, i) => (
            <li key={`${r.name}-${r.lat}-${i}`}>
              <button
                type="button"
                onMouseDown={(ev) => ev.preventDefault()}
                onClick={() => {
                  onSelect(r);
                  setQ(r.name);
                  setOpen(false);
                }}
                className="flex w-full items-baseline gap-2 px-3 py-2 text-left hover:bg-brass/10 transition-colors"
              >
                <span className="text-[12px] text-paper">{r.name}</span>
                <span className="font-mono text-[10px] text-paper-faint">
                  {[r.admin1, r.country].filter(Boolean).join(" · ")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </AnchoredPopover>
    </div>
  );
}

// ── provider deal rail: hunts THAT site's own listings on demand ────────────
function ProviderDealRail({
  railKey,
  label,
  state,
  onHunt,
  onOpenDeal,
}: {
  railKey: string;
  label: string;
  state?: { loading: boolean; deals: { name: string; priceNight?: string; priceTotal?: string; priceGbpNight?: number; priceGbpTotal?: number; link?: string; image?: string; images?: string[]; note?: string }[] | null };
  onOpenDeal?: (d: { name: string; priceNight?: string; priceTotal?: string; link?: string; images?: string[]; note?: string }) => void;
  onHunt: () => void;
}) {
  if (!state || (!state.loading && state.deals === null)) {
    return (
      <button
        type="button"
        onClick={onHunt}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-rule-soft/60 px-3 py-2.5 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint hover:border-brass/40 hover:text-brass transition-colors"
      >
        <Search className="h-3 w-3" /> hunt {label} deals for this destination
      </button>
    );
  }
  if (state.loading) {
    return (
      <p className="flex items-center gap-2 rounded-lg border border-rule-soft/50 px-3 py-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
        <Loader2 className="h-3 w-3 animate-spin" /> hunting {label}'s own listings…
      </p>
    );
  }
  if (!state.deals || state.deals.length === 0) {
    return (
      <button
        type="button"
        onClick={onHunt}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-amber/40 px-3 py-2.5 font-mono text-[10px] uppercase tracking-[0.18em] text-amber/80 hover:border-amber/70 hover:text-amber transition-colors"
      >
        <Search className="h-3 w-3" /> {label} hunt came back empty this pass — retry
      </button>
    );
  }
  return (
    <ul key={railKey} className="divide-y divide-rule-soft/30 rounded-lg border border-rule-soft/50">
      {state.deals.map((d, i) => (
        <li key={i} className="flex flex-wrap items-center gap-2 px-3 py-2">
          {d.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={d.image} alt="" loading="lazy" className="h-14 w-20 shrink-0 rounded-md object-cover" />
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] text-paper">{d.name}</span>
            {d.note && <span className="block truncate font-mono text-[9px] text-paper-faint">{d.note}</span>}
          </span>
          {d.priceTotal && (
            <span className="font-mono text-[12px] font-bold tabular-nums text-brass">
              {d.priceTotal} <span className="text-[9px] font-normal uppercase text-paper-faint">total</span>
            </span>
          )}
          {d.priceNight && (
            <span className="font-mono text-[11px] tabular-nums text-paper-dim">
              {d.priceNight} <span className="text-[9px] uppercase text-paper-faint">/nt</span>
            </span>
          )}
          {!d.priceTotal && !d.priceNight && typeof d.priceGbpTotal === "number" && (
            <span className="font-mono text-[12px] font-bold tabular-nums text-brass">≈{gbp(d.priceGbpTotal)} total</span>
          )}
          {onOpenDeal && (
            <button type="button" onClick={() => onOpenDeal(d)} className="font-mono text-[9px] uppercase tracking-[0.14em] text-paper-faint hover:text-brass transition-colors">
              photos+
            </button>
          )}
          {d.link && (
            <a href={d.link} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-md border border-brass/40 bg-brass/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-brass hover:bg-brass/20 transition-colors">
              open <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

// ── collapsible section: one visual unit per concern (simplified nav) ──────
function Section({
  title,
  count,
  children,
  defaultOpen = true,
  action,
}: {
  title: string;
  count?: number | string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  action?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-rule-soft/50 bg-ink-2/20">
      <div className="flex items-center justify-between px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-paper-dim hover:text-paper transition-colors"
        >
          {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {title}
          {count !== undefined && <span className="text-paper-faint/60">· {count}</span>}
        </button>
        {action}
      </div>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

// ── stay card ───────────────────────────────────────────────────────────────
function StayCard({
  o,
  otaPrice,
  checkIn,
  checkOut,
  adults,
  onLock,
  onDetails,
  locking,
  locked = false,
  expanded,
  fluid = false,
}: {
  o: StayOption;
  otaPrice?: number;
  checkIn?: string;
  checkOut?: string;
  adults?: number;
  onLock: (o: StayOption) => void;
  onDetails: (o: StayOption) => void;
  locking: boolean;
  locked?: boolean;
  expanded: boolean;
  /** Grid mode (fullscreen browser) — fill the cell instead of rail width. */
  fluid?: boolean;
}) {
  const nightly = otaPrice ?? o.priceGbp;
  const dorm = dormLikely(o);
  return (
    <div
      className={cn(
        "shrink-0 snap-start overflow-hidden rounded-xl border bg-ink-2/40 transition-colors",
        fluid ? "w-full" : "w-[232px]",
        expanded ? "border-brass/60" : "border-rule-soft/60 hover:border-rule-soft",
      )}
    >
      <button type="button" onClick={() => onDetails(o)} className="block w-full text-left">
        {o.thumb || o.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={o.thumb ?? o.image} alt="" className="h-[104px] w-full object-cover" loading="lazy" decoding="async" />
        ) : (
          <div className="grid h-[104px] w-full place-items-center bg-ink-3/50 text-paper-faint">
            <BedDouble className="h-5 w-5" />
          </div>
        )}
      </button>
      <div className="space-y-1.5 p-2.5">
        <div className="flex items-start justify-between gap-1.5">
          <p className="line-clamp-2 text-[12px] leading-snug text-paper">{o.name}</p>
          <span className="flex shrink-0 flex-col items-end gap-0.5">
            {typeof o.rating === "number" && (
              <span className="flex items-center gap-0.5 font-mono text-[10px] text-amber">
                <Star className="h-2.5 w-2.5 fill-current" />
                {o.rating.toFixed(1)}
              </span>
            )}
            {typeof o.hotelClass === "number" && o.hotelClass > 0 && (
              <span className="font-mono text-[8px] tracking-tight text-paper-faint">{"★".repeat(Math.round(o.hotelClass))}</span>
            )}
          </span>
        </div>
        {/* room-type honesty + provider */}
        <div className="flex flex-wrap items-center gap-1">
          {dorm ? (
            <span className="rounded-full border border-rose-soft/50 bg-rose-soft/10 px-1.5 py-px font-mono text-[8px] uppercase tracking-[0.12em] text-rose-soft">
              dorm / shared
            </span>
          ) : (
            <span className="rounded-full border border-rule-soft/50 px-1.5 py-px font-mono text-[8px] uppercase tracking-[0.12em] text-paper-faint">
              {o.propertyType === "vacation rental" ? "private rental" : "private room"}
            </span>
          )}
          {o.freeCancellation && (
            <span className="rounded-full border border-emerald-soft/40 bg-emerald-soft/10 px-1.5 py-px font-mono text-[8px] uppercase tracking-[0.12em] text-emerald-soft">
              free cancel
            </span>
          )}
        </div>
        {/* TOTAL headline, nightly secondary */}
        <p className="font-mono text-[15px] font-bold tabular-nums leading-none text-paper">
          {typeof o.totalGbp === "number"
            ? gbp(o.totalGbp)
            : typeof nightly === "number"
              ? `${gbp(nightly)}/nt`
              : "price on site"}
          {typeof o.totalGbp === "number" && (
            <span className="ml-1 text-[9px] font-normal uppercase tracking-[0.1em] text-paper-faint">
              total{typeof nightly === "number" ? ` · ${gbp(nightly)}/nt` : ""}
            </span>
          )}
        </p>
        {/* WHICH SITE prices this + how many compare */}
        <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-emerald-soft/80">
          via {o.provider ?? o.offers?.[0]?.source ?? "Google best price"}
          {(o.offers ?? []).length > 1 && (
            <span className="text-paper-faint"> · {(o.offers ?? []).length} providers priced</span>
          )}
        </p>
        {/* perks straight from the search payload — visible without the sheet */}
        {(o.amenities ?? []).length > 0 && (
          <div className="flex flex-wrap gap-1">
            {(o.amenities ?? []).slice(0, 3).map((a) => (
              <span key={a} className="rounded-full border border-rule-soft/50 px-1.5 py-px font-mono text-[8px] uppercase tracking-[0.08em] text-paper-faint">
                {a}
              </span>
            ))}
          </div>
        )}
        {/* ALL providers for THIS place — price shown where Google knows it,
            every chip deep-links to that provider searched for this property. */}
        <div className="flex flex-wrap gap-1">
          {PROVIDER_MATCH.map((pm) => {
            const priced = (o.offers ?? []).find((x) => pm.test.test(x.source) && typeof x.priceGbp === "number");
            const bp = BOOKING_PROVIDERS.find((b) => b.key === pm.key);
            if (!bp) return null;
            const href = bp.url({ city: o.name, checkIn, checkOut, adults });
            return (
              <a
                key={pm.key}
                href={href}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  "rounded-full border px-1.5 py-px font-mono text-[9px] transition-colors",
                  priced
                    ? "border-brass/40 bg-brass/[0.08] text-brass hover:bg-brass/20"
                    : "border-rule-soft/50 bg-ink-3/50 text-paper-dim hover:border-brass/50 hover:text-brass",
                )}
              >
                {pm.label}
                {priced ? ` ${gbp(priced.priceGbp!)}` : ""}
              </a>
            );
          })}
        </div>
        <div className="flex items-center gap-1.5 pt-0.5">
          <a
            href={o.link}
            target="_blank"
            rel="noreferrer"
            className="flex flex-1 items-center justify-center gap-1 rounded-md border border-paper-faint/30 bg-ink-3/60 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-paper hover:border-brass/50 hover:text-brass transition-colors"
          >
            open · booking <ExternalLink className="h-2.5 w-2.5" />
          </a>
          <button
            type="button"
            disabled={locking || locked}
            onClick={() => onLock(o)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1 rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors disabled:opacity-100",
              locked
                ? "border-emerald-soft/50 bg-emerald-soft/15 text-emerald-soft"
                : "border-brass/40 bg-brass/10 text-brass hover:bg-brass/20 disabled:opacity-50",
            )}
          >
            {locking ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : locked ? <Check className="h-2.5 w-2.5" /> : <Lock className="h-2.5 w-2.5" />}
            {locked ? "locked" : "lock"}
          </button>
        </div>
        <button
          type="button"
          onClick={() => onDetails(o)}
          className="flex w-full items-center justify-center gap-1 font-mono text-[9px] uppercase tracking-[0.16em] text-paper-faint hover:text-brass transition-colors"
        >
          compare providers + photos {expanded ? <ChevronUp className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />}
        </button>
      </div>
    </div>
  );
}

// ── booking timeline ────────────────────────────────────────────────────────
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
        <div className="absolute inset-x-0 top-4 h-1.5 rounded-full bg-ink-3/70" />
        {spans.map((sp, i) => (
          <div key={i} className="absolute top-[13px] h-2 rounded-full bg-emerald-soft/60" style={{ left: pct(sp.from), width: pct(sp.to - sp.from) }} title={sp.name} />
        ))}
        {spans.map((sp, i) => (
          <BedDouble key={`b${i}`} className="absolute top-0 h-3 w-3 text-emerald-soft" style={{ left: `calc(${pct((sp.from + sp.to) / 2)} - 6px)` }} />
        ))}
        {marks.map((m, i) => (
          <div key={i} className="absolute top-[7px]" style={{ left: `calc(${pct(m.i)} - 6px)` }} title={m.title}>
            <Plane className="h-3 w-3 text-brass" />
            {m.time && <span className="absolute left-1/2 top-4 -translate-x-1/2 font-mono text-[8px] text-paper-faint">{m.time}</span>}
          </div>
        ))}
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

// Country taxi meter tariffs (approx GBP base + per-km) — turns distance into
// a realistic local range instead of one global rate. Fallback: mid European.
const TAXI_TARIFFS: Record<string, { base: number; perKm: number }> = {
  ID: { base: 0.35, perKm: 0.35 }, // Bluebird
  TH: { base: 0.8, perKm: 0.25 },
  VN: { base: 0.4, perKm: 0.45 },
  MY: { base: 0.5, perKm: 0.35 },
  TR: { base: 0.9, perKm: 0.55 },
  GB: { base: 3.2, perKm: 2.0 },
  ES: { base: 2.1, perKm: 1.0 },
  IT: { base: 3.0, perKm: 1.3 },
  FR: { base: 2.6, perKm: 1.5 },
  DE: { base: 3.5, perKm: 1.9 },
  PT: { base: 2.0, perKm: 0.8 },
  GR: { base: 1.2, perKm: 0.9 },
  US: { base: 2.5, perKm: 1.6 },
};

// ── TRANSFER TILE: figure out the leg + real prices (2026-07-03) ────────────
// Dedicated transport solver: resolves both ends to airports, pulls REAL
// flight prices (SerpAPI google_flights, 1 credit per search), and offers
// train/bus/taxi via Rome2rio + Omio and flights via Skyscanner deep links.
type FlightHit = {
  priceGbp?: number;
  airline?: string;
  stops: number;
  departTime?: string;
  arriveTime?: string;
  durationMin?: number;
  bookLink: string;
};

function TransferTile({
  tripId,
  defaultFrom,
  defaultTo,
  defaultDate,
  adults,
}: {
  tripId: Id<"trips"> | null;
  defaultFrom: string;
  defaultTo: string;
  defaultDate?: string;
  adults: number;
}) {
  const searchFlights = useAction(api.travelActions.searchFlights);
  const routeLeg = useAction(api.travelActions.routeLeg);
  const groundFares = useAction(api.travelActions.groundFares);
  const addFlight = useMutation(api.tripExtras.addFlight);

  type TransportMode = "plane" | "ground" | "taxi";
  const [tmode, setTmode] = useState<TransportMode>("plane");
  const [date, setDate] = useState(defaultDate ?? "");
  // plane ends (IATA via dropdown)
  const [fromIata, setFromIata] = useState("");
  const [fromLabel, setFromLabel] = useState("");
  const [toIata, setToIata] = useState("");
  const [toLabel, setToLabel] = useState("");
  // ground ends (place autocomplete; coords come with the pick)
  const [fromGeo, setFromGeo] = useState<GeoPlace | null>(null);
  const [toGeo, setToGeo] = useState<GeoPlace | null>(null);
  const fromPlace = fromGeo?.name ?? defaultFrom;
  const toPlace = toGeo?.name ?? defaultTo;
  const [hits, setHits] = useState<FlightHit[] | null>(null);
  const [route, setRoute] = useState<{ durationText?: string; distanceText?: string; distanceKm?: number; fareText?: string } | null>(null);
  const [fares, setFares] = useState<{ label: string; price: string; priceGbp?: number; source?: string; link?: string }[] | null>(null);
  const [faresBusy, setFaresBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  const runPlane = async () => {
    if (!fromIata || !toIata || !date || busy) return;
    setBusy(true); setErr(null); setRoute(null);
    try {
      const res = await searchFlights({ origin: fromIata, destination: toIata, outboundDate: date, adults });
      if (!res.available) setErr(res.reason ?? "no flights returned");
      setHits((res.options ?? []).slice(0, 16) as FlightHit[]);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally { setBusy(false); }
  };

  const runGround = async () => {
    if (busy) return;
    setBusy(true); setErr(null); setHits(null);
    try {
      // Picked places carry coords; fall back to geocoding the defaults.
      const [a, b] = await Promise.all([
        fromGeo ?? (fromPlace.trim() ? geocodePlace(fromPlace.trim()) : null),
        toGeo ?? (toPlace.trim() ? geocodePlace(toPlace.trim()) : null),
      ]);
      if (!a || !b) { setErr(`could not locate "${!a ? (fromPlace || "origin") : (toPlace || "destination")}"`); setRoute(null); return; }
      const res: any = await routeLeg({
        fromLat: a.lat, fromLng: a.lng, toLat: b.lat, toLng: b.lng,
        mode: tmode === "taxi" ? "car" : "train",
      });
      if (!res?.available) { setErr(res?.reason ?? "no route returned"); setRoute(null); return; }
      const km = typeof res.distanceMeters === "number" ? res.distanceMeters / 1000 : undefined;
      setRoute({ durationText: res.durationText, distanceText: res.distanceText, distanceKm: km, fareText: res.fareText });
      // Hunt REAL quoted prices for this leg (1 search credit + tiny LLM call).
      setFares(null);
      setFaresBusy(true);
      void groundFares({ from: a.name, to: b.name, kind: tmode === "taxi" ? "taxi" : "ground" })
        .then((f) => setFares(f.offers ?? []))
        .catch(() => setFares([]))
        .finally(() => setFaresBusy(false));
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally { setBusy(false); }
  };

  const addToTrip = async (opts: { from: string; to: string; carrier?: string; depart?: string; arrive?: string; priceGbp?: number; bookLink?: string; key: string }) => {
    if (!tripId) return;
    await addFlight({
      tripId,
      segments: [{ from: opts.from, to: opts.to, depart: opts.depart, arrive: opts.arrive, carrier: opts.carrier }],
      priceGbp: opts.priceGbp,
      bookLink: opts.bookLink,
    });
    setAdded(opts.key);
  };

  const yymmdd = date ? date.replace(/-/g, "").slice(2) : "";
  const planeReady = !!(fromIata && toIata && date);
  const skyscanner = planeReady
    ? `https://www.skyscanner.net/transport/flights/${fromIata.toLowerCase()}/${toIata.toLowerCase()}/${yymmdd}/`
    : "https://www.skyscanner.net/";
  const tripcom = planeReady
    ? `https://uk.trip.com/flights/showfarefirst?dcity=${fromIata}&acity=${toIata}&ddate=${date}&triptype=ow&class=y&quantity=${adults}`
    : "https://uk.trip.com/flights/";
  const gFrom = fromPlace || defaultFrom || "London";
  const gTo = toPlace || defaultTo;
  const tariff = TAXI_TARIFFS[(fromGeo?.countryCode ?? toGeo?.countryCode ?? "").toUpperCase()] ?? { base: 2.5, perKm: 1.2 };
  const taxiLo = route?.distanceKm ? Math.max(1, Math.round(tariff.base + route.distanceKm * tariff.perKm * 0.85)) : null;
  const taxiHi = route?.distanceKm ? Math.round(tariff.base + route.distanceKm * tariff.perKm * 1.25) : null;
  const taxiEst = taxiHi;

  return (
    <div className="rounded-xl border border-rule-soft/50 bg-ink-2/30 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.22em] text-paper-faint">
          <TrainFront className="h-3 w-3" /> Transport finder
        </p>
        <div className="flex items-center gap-0.5 rounded-md border border-rule-soft/60 bg-ink-3/60 p-0.5">
          {([
            ["plane", "flights"],
            ["ground", "train · bus"],
            ["taxi", "taxi · car"],
          ] as const).map(([m, label]) => (
            <button
              key={m}
              type="button"
              onClick={() => { setTmode(m); setErr(null); setHits(null); setRoute(null); }}
              className={cn(
                "rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors",
                tmode === m ? "bg-brass/20 text-brass" : "text-paper-faint hover:text-paper",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {tmode === "plane" ? (
          <>
            <div className="min-w-[160px] flex-1">
              <AirportField value={fromIata} label={fromIata ? fromLabel : undefined} placeholder={defaultFrom ? `From (e.g. ${defaultFrom})` : "From (city or airport)"} onChange={(i, l) => { setFromIata(i); setFromLabel(l); }} />
            </div>
            <span className="text-paper-faint">→</span>
            <div className="min-w-[160px] flex-1">
              <AirportField value={toIata} label={toIata ? toLabel : undefined} placeholder={defaultTo ? `To (e.g. ${defaultTo})` : "To (city or airport)"} onChange={(i, l) => { setToIata(i); setToLabel(l); }} />
            </div>
          </>
        ) : (
          <>
            <PlaceField placeholder={defaultFrom ? `From (e.g. ${defaultFrom})` : "From (any place)"} selected={fromGeo} onSelect={setFromGeo} />
            <span className="text-paper-faint">→</span>
            <PlaceField placeholder={defaultTo ? `To (e.g. ${defaultTo})` : "To (any place)"} selected={toGeo} onSelect={setToGeo} />
          </>
        )}
        <DateField value={date} onChange={setDate} />
        <button
          type="button"
          disabled={busy || (tmode === "plane" ? !planeReady : !(fromGeo || fromPlace.trim()) || !(toGeo || toPlace.trim()))}
          onClick={() => void (tmode === "plane" ? runPlane() : runGround())}
          className="flex items-center gap-1.5 rounded-md border border-brass/40 bg-brass/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-brass hover:bg-brass/20 disabled:opacity-40 transition-colors"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : tmode === "plane" ? <Plane className="h-3 w-3" /> : <TrainFront className="h-3 w-3" />}
          find
        </button>
      </div>
      {tmode === "plane" && !planeReady && (
        <p className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-paper-faint">
          pick BOTH airports from the dropdown + a date, then hit find
        </p>
      )}
      {err && <p className="mt-1.5 font-mono text-[10px] text-rose-soft">{err}</p>}

      {/* flight results */}
      {tmode === "plane" && hits && hits.length > 0 && (
        <ul className="mt-2 max-h-72 divide-y divide-rule-soft/30 overflow-y-auto rounded-lg border border-rule-soft/50">
          {hits.map((h, i) => {
            const key = `f${i}`;
            return (
              <li key={i} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <Plane className="h-3 w-3 text-brass" />
                <span className="font-mono text-[11px] text-paper">{h.airline ?? "Flight"}</span>
                <span className="font-mono text-[10px] text-paper-faint">
                  {[h.departTime, h.arriveTime].filter(Boolean).join(" → ")}
                  {h.stops === 0 ? " · direct" : ` · ${h.stops} stop${h.stops === 1 ? "" : "s"}`}
                </span>
                <span className="flex-1" />
                {typeof h.priceGbp === "number" && <span className="font-mono text-[13px] font-bold tabular-nums text-brass">{gbp(h.priceGbp)}</span>}
                <a href={h.bookLink} target="_blank" rel="noreferrer" className="rounded-md border border-rule-soft/50 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim hover:border-brass/50 hover:text-brass transition-colors">book</a>
                <button
                  type="button"
                  disabled={added === key || !tripId}
                  onClick={() => void addToTrip({ from: fromIata, to: toIata, carrier: h.airline, depart: h.departTime, arrive: h.arriveTime, priceGbp: h.priceGbp, bookLink: h.bookLink, key })}
                  className="flex items-center gap-1 rounded-md border border-emerald-soft/40 bg-emerald-soft/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-emerald-soft hover:bg-emerald-soft/20 disabled:opacity-50 transition-colors"
                >
                  <Plus className="h-2.5 w-2.5" /> {added === key ? "added" : "add to trip"}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* ground route result: real fare when Google knows it + provider rows */}
      {tmode !== "plane" && route && (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-rule-soft/50 px-3 py-2">
            <TrainFront className="h-3 w-3 text-brass" />
            <span className="font-mono text-[11px] text-paper">
              {fromPlace} → {toPlace}
            </span>
            <span className="font-mono text-[10px] text-paper-faint">
              {[route.durationText, route.distanceText].filter(Boolean).join(" · ")}
            </span>
            {route.fareText && (
              <span className="font-mono text-[12px] font-bold tabular-nums text-brass">fare {route.fareText}</span>
            )}
            {tmode === "taxi" && taxiLo && taxiHi && (
              <span className="font-mono text-[11px] tabular-nums text-brass">meter {gbp(taxiLo)}–{gbp(taxiHi)} <span className="text-[9px] font-normal text-paper-faint">local tariff est</span></span>
            )}
            <span className="flex-1" />
            <button
              type="button"
              disabled={added === "g" || !tripId}
              onClick={() => void addToTrip({ from: fromPlace, to: toPlace, carrier: tmode === "taxi" ? "Taxi / Car" : "Train / Bus", depart: date || undefined, priceGbp: tmode === "taxi" && taxiEst ? taxiEst : undefined, bookLink: `https://www.rome2rio.com/s/${encodeURIComponent(fromPlace)}/${encodeURIComponent(toPlace)}`, key: "g" })}
              className="flex items-center gap-1 rounded-md border border-emerald-soft/40 bg-emerald-soft/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-emerald-soft hover:bg-emerald-soft/20 disabled:opacity-50 transition-colors"
            >
              <Plus className="h-2.5 w-2.5" /> {added === "g" ? "added" : "add to trip"}
            </button>
          </div>
          {/* LIVE quoted prices for this exact leg */}
          {(faresBusy || (fares && fares.length > 0)) && (
            <div className="rounded-lg border border-brass/30 bg-brass/[0.04] px-3 py-2">
              <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.2em] text-brass/85">
                best offers found {faresBusy && <Loader2 className="ml-1 inline h-2.5 w-2.5 animate-spin" />}
              </p>
              {fares && fares.length > 0 && (
                <ul className="divide-y divide-rule-soft/20">
                  {fares.map((f, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-2 py-1.5">
                      <span className="font-mono text-[11px] text-paper">{f.label}</span>
                      <span className="font-mono text-[12px] font-bold tabular-nums text-brass">{f.price}</span>
                      {typeof f.priceGbp === "number" && !f.price.includes("£") && (
                        <span className="font-mono text-[10px] text-paper-faint">≈{gbp(f.priceGbp)}</span>
                      )}
                      <span className="flex-1" />
                      {f.source && <span className="font-mono text-[9px] text-paper-faint/70">{f.source}</span>}
                      {f.link && (
                        <a href={f.link} target="_blank" rel="noreferrer" className="text-paper-faint hover:text-brass transition-colors">
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {fares && fares.length === 0 && !faresBusy && (
            <p className="font-mono text-[10px] text-paper-faint">no concrete fares found online for this leg — use the provider links below</p>
          )}
          {/* book it: providers with the route prefilled */}
          <ul className="divide-y divide-rule-soft/30 rounded-lg border border-rule-soft/50">
            {(tmode === "taxi"
              ? [
                  fromGeo && toGeo
                    ? { name: "Uber", note: "live fare estimate for this exact route", href: `https://m.uber.com/ul/?action=setPickup&pickup[latitude]=${fromGeo.lat}&pickup[longitude]=${fromGeo.lng}&pickup[nickname]=${encodeURIComponent(fromGeo.name)}&dropoff[latitude]=${toGeo.lat}&dropoff[longitude]=${toGeo.lng}&dropoff[nickname]=${encodeURIComponent(toGeo.name)}` }
                    : null,
                  { name: "Rome2rio", note: "taxi + all modes, priced", href: `https://www.rome2rio.com/s/${encodeURIComponent(fromPlace)}/${encodeURIComponent(toPlace)}` },
                ]
              : [
                  { name: "12Go", note: "SE-Asia trains, buses + ferries, bookable", href: `https://12go.asia/en/travel/${encodeURIComponent(fromPlace.toLowerCase().replace(/\s+/g, "-"))}/${encodeURIComponent(toPlace.toLowerCase().replace(/\s+/g, "-"))}${date ? `?date=${date}&people=${adults}` : ""}` },
                  { name: "Omio", note: "EU trains + buses, prices compared", href: `https://www.omio.co.uk/search?departure=${encodeURIComponent(fromPlace)}&arrival=${encodeURIComponent(toPlace)}` },
                  { name: "Trainline", note: "rail fares", href: "https://www.thetrainline.com/" },
                  { name: "Rome2rio", note: "every mode, priced", href: `https://www.rome2rio.com/s/${encodeURIComponent(fromPlace)}/${encodeURIComponent(toPlace)}` },
                ]
            )
              .filter(Boolean)
              .map((pv) => (
                <li key={pv!.name} className="flex items-center gap-2 px-3 py-2">
                  <span className="min-w-[76px] font-mono text-[11px] font-bold text-paper">{pv!.name}</span>
                  <span className="flex-1 font-mono text-[10px] text-paper-faint">{pv!.note}</span>
                  <a href={pv!.href} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-md border border-brass/40 bg-brass/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-brass hover:bg-brass/20 transition-colors">
                    open <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                </li>
              ))}
          </ul>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {tmode === "plane" ? (
          <>
            <a href={skyscanner} target="_blank" rel="noreferrer" className="rounded-full border border-rule-soft/50 bg-ink-2/40 px-2 py-0.5 font-mono text-[10px] text-paper-dim hover:border-brass/50 hover:text-brass transition-colors">Skyscanner</a>
            <a href={tripcom} target="_blank" rel="noreferrer" className="rounded-full border border-rule-soft/50 bg-ink-2/40 px-2 py-0.5 font-mono text-[10px] text-paper-dim hover:border-brass/50 hover:text-brass transition-colors">Trip.com flights</a>
          </>
        ) : (
          <>
            <a href={`https://www.omio.co.uk/search?departure=${encodeURIComponent(gFrom)}&arrival=${encodeURIComponent(gTo)}`} target="_blank" rel="noreferrer" className="rounded-full border border-rule-soft/50 bg-ink-2/40 px-2 py-0.5 font-mono text-[10px] text-paper-dim hover:border-brass/50 hover:text-brass transition-colors">Omio</a>
            <a href="https://www.thetrainline.com/" target="_blank" rel="noreferrer" className="rounded-full border border-rule-soft/50 bg-ink-2/40 px-2 py-0.5 font-mono text-[10px] text-paper-dim hover:border-brass/50 hover:text-brass transition-colors">Trainline</a>
          </>
        )}
        <a href={`https://www.rome2rio.com/s/${encodeURIComponent(gFrom)}/${encodeURIComponent(gTo)}`} target="_blank" rel="noreferrer" className="rounded-full border border-rule-soft/50 bg-ink-2/40 px-2 py-0.5 font-mono text-[10px] text-paper-dim hover:border-brass/50 hover:text-brass transition-colors">Rome2rio (all modes + prices)</a>
      </div>
    </div>
  );
}

// ── guided trip stages (2026-07-04 redesign): one focused task at a time ────
const TRIP_STAGES = [
  { key: "setup", label: "Setup", icon: MapPin, hint: "where · when · who · budget" },
  { key: "stays", label: "Stays", icon: BedDouble, hint: "find + lock a place" },
  { key: "transport", label: "Transport", icon: TrainFront, hint: "how you get around" },
  { key: "plan", label: "Plan", icon: CalendarRange, hint: "bookings + day-by-day" },
] as const;
type TripStage = (typeof TRIP_STAGES)[number]["key"];

function StageStepper({
  stage,
  setStage,
  status,
}: {
  stage: TripStage;
  setStage: (s: TripStage) => void;
  status: Record<TripStage, "done" | "skipped" | "todo">;
}) {
  return (
    <div className="no-scrollbar flex items-stretch gap-1 overflow-x-auto rounded-xl border border-rule-soft/50 bg-ink-2/30 p-1">
      {TRIP_STAGES.map((s, i) => {
        const on = stage === s.key;
        const st = status[s.key];
        return (
          <button
            key={s.key}
            type="button"
            onClick={() => setStage(s.key)}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2.5 py-1.5 transition-colors",
              on ? "bg-brass/15 text-brass" : "text-paper-faint hover:text-paper",
            )}
          >
            <span
              className={cn(
                "grid h-5 w-5 shrink-0 place-items-center rounded-full border font-mono text-[9px]",
                on ? "border-brass/60 bg-brass/20 text-brass" : st === "done" ? "border-emerald-soft/50 bg-emerald-soft/15 text-emerald-soft" : "border-rule-soft/60 text-paper-faint",
              )}
            >
              {st === "done" ? <Check className="h-3 w-3" /> : i + 1}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-mono text-[10px] uppercase tracking-[0.14em]">{s.label}</span>
              {on && <span className="block truncate font-mono text-[8px] normal-case tracking-normal text-paper-faint">{s.hint}</span>}
            </span>
            {st === "skipped" && <span className="ml-auto shrink-0 font-mono text-[7px] uppercase text-paper-faint/60">skip</span>}
          </button>
        );
      })}
    </div>
  );
}

// Bottom nav for the current stage: back / skip / next.
function StageNav({
  stage,
  setStage,
  onSkip,
}: {
  stage: TripStage;
  setStage: (s: TripStage) => void;
  onSkip?: () => void;
}) {
  const idx = TRIP_STAGES.findIndex((s) => s.key === stage);
  const prev = TRIP_STAGES[idx - 1];
  const next = TRIP_STAGES[idx + 1];
  return (
    <div className="flex items-center justify-between gap-2 pt-1">
      {prev ? (
        <button type="button" onClick={() => setStage(prev.key)} className="flex items-center gap-1 rounded-lg border border-rule-soft/50 bg-ink-2/40 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-paper-faint hover:text-paper transition-colors">
          <ArrowLeft className="h-3 w-3" /> {prev.label}
        </button>
      ) : (
        <span />
      )}
      <div className="flex items-center gap-2">
        {onSkip && next && (
          <button type="button" onClick={() => { onSkip(); setStage(next.key); }} className="flex items-center gap-1 rounded-lg border border-rule-soft/50 bg-ink-2/40 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-paper-faint hover:text-paper transition-colors">
            <SkipForward className="h-3 w-3" /> skip
          </button>
        )}
        {next && (
          <button type="button" onClick={() => setStage(next.key)} className="flex items-center gap-1 rounded-lg border border-brass/40 bg-brass/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-brass hover:bg-brass/20 transition-colors">
            {next.label} <ArrowRight className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
export function TripsOverview({
  tripId,
  trip,
  trips,
  onSelectTrip,
}: {
  tripId: Id<"trips"> | null;
  trip: TripLite | null;
  trips: TripLite[];
  onSelectTrip: (id: Id<"trips">) => void;
}) {
  const flights = useQuery(api.tripExtras.listFlights, tripId ? { tripId } : "skip");
  const stays = useQuery(api.tripExtras.listStays, tripId ? { tripId } : "skip");
  const legs = useQuery(api.tripExtras.listLegs, tripId ? { tripId } : "skip") as
    | { _id: string; city: string; transportMode?: string; routeDurationText?: string; routeDistanceText?: string }[]
    | undefined;
  const updateTrip = useMutation(api.trips.update);
  const createTrip = useMutation(api.trips.create);
  const saveStay = useMutation(api.tripExtras.saveStay);
  const setLocked = useMutation(api.tripExtras.setStayLocked);
  const removeStay = useMutation(api.tripExtras.removeStay);
  const search = useAction(api.travelActions.searchStays);
  const ppHotels = useAction(api.travelActions.ppHotels);
  const resolveByName = useAction(api.travelActions.resolveStayByName);
  const resolveOffers = useAction(api.travelActions.resolveStayOffers);
  const providerDealsLive = useAction(api.browserbaseActions.providerDealsLive);

  const [results, setResults] = useState<StayOption[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [lockingName, setLockingName] = useState<string | null>(null);
  const [globeOpen, setGlobeOpen] = useState(false);
  const [journeyOpen, setJourneyOpen] = useState(false);
  const [stage, setStage] = useState<TripStage>("setup");
  const [transportSkipped, setTransportSkipped] = useState(false);
  // Gate time-relative text (countdown, NOW marker) behind mount so the
  // server's cached day-count can't mismatch the client's fresh one — a
  // hydration mismatch (#418) breaks click handlers and froze the stages.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [browseOpen, setBrowseOpen] = useState(false);
  type ProviderDeal = { name: string; priceNight?: string; priceTotal?: string; priceGbpNight?: number; priceGbpTotal?: number; link?: string; image?: string; images?: string[]; note?: string };
  const [providerDealState, setProviderDealState] = useState<Record<string, { loading: boolean; deals: ProviderDeal[] | null }>>({});
  // ONE-CLICK provider enrichment: property-detail calls return the FULL
  // per-OTA price list Google truncates out of search results. Cache each
  // detail so compare overlays open instantly afterwards.
  const [detailCache, setDetailCache] = useState<Record<string, StayDetail>>({});
  const [enriching, setEnriching] = useState(false);
  const [enriched, setEnriched] = useState(false);
  const [bookingLive, setBookingLive] = useState<{ loading: boolean; options: StayOption[] }>({ loading: false, options: [] });
  // Apify-backed live rails for the Akamai-walled portals (Expedia/Hotels.com).
  const [dealOpen, setDealOpen] = useState<{ name: string; priceNight?: string; priceTotal?: string; link?: string; images?: string[]; note?: string } | null>(null);
  // Dorms/hostels are OFF by default (Daniel books private places).
  const [showHostels, setShowHostels] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newPlace, setNewPlace] = useState<GeoPlace | null>(null);
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");
  const [creating, setCreating] = useState(false);
  // offers panel: which property + its resolved offers
  const [offersFor, setOffersFor] = useState<StayOption | null>(null);
  const [offersData, setOffersData] = useState<StayDetail | null>(null);
  const [offersLoading, setOffersLoading] = useState(false);
  const [budgetDraft, setBudgetDraft] = useState<number | null>(null);

  const city = trip?.destCity || trip?.title || "";
  const travelers = trip?.travelers && trip.travelers > 0 ? trip.travelers : 1;
  const stayStyle = trip?.stayStyle ?? "any";
  const s = parseISO(trip?.startDate);
  const e = parseISO(trip?.endDate);
  const nights = s && e ? Math.max(0, Math.round((e.getTime() - s.getTime()) / 86_400_000)) : null;
  // Portals cap a single stay search at ~30 nights — longer ranges silently
  // collapse to 1 night (the "£7 total" bug). HARD-clamp everything to 29
  // nights (a margin under every portal's limit) and say so.
  const clamped = !!(nights && nights > 29);
  const effCheckOut =
    clamped && trip?.startDate ? addDays(trip.startDate, 29) : trip?.endDate;
  const budget = budgetDraft ?? trip?.budgetGbp ?? 0;
  const perNightBudget = budget && nights ? Math.max(20, Math.floor(budget / nights)) : undefined;
  // Every rail respects the budget: keep stays whose nightly rate fits (or whose
  // price is unknown, so we don't hide a maybe-fine option).
  const withinBudget = (opts: StayOption[]) =>
    perNightBudget ? opts.filter((o) => o.priceGbp == null || o.priceGbp <= perNightBudget) : opts;

  // Reactive cache read — shows a prior search's stays the instant the trip is
  // opened (no scrape), then the user can refresh for live prices.
  const cacheCity = stayStyle === "villas" ? `${city} villas` : city;
  const cachedStays = useQuery(
    api.travelCache.getCachedStays,
    city && trip?.startDate && (effCheckOut ?? trip?.endDate)
      ? { city: cacheCity, checkIn: trip.startDate, checkOut: (effCheckOut ?? trip.endDate)!, adults: travelers }
      : "skip",
  );
  useEffect(() => {
    // Pre-fill from cache only when we have nothing yet (never clobber a live search).
    if (results === null && cachedStays && Array.isArray(cachedStays.options) && cachedStays.options.length > 0) {
      setResults(cachedStays.options as StayOption[]);
    }
  }, [cachedStays, results]);

  const carousels = useMemo(() => {
    if (!results) return [];
    const budgeted = perNightBudget
      ? results.filter((o) => o.priceGbp == null || o.priceGbp <= perNightBudget)
      : results;
    const visible = showHostels ? budgeted : budgeted.filter((o) => !dormLikely(o));
    // EVERY provider gets a rail. Priced rails use Google's per-OTA offers;
    // providers Google didn't price fall back to the top picks, whose cards
    // deep-link that provider's search for the exact property + dates.
    const byProvider = PROVIDER_MATCH.map((pm) => {
      const priced = visible
        .map((o) => {
          const offer = (o.offers ?? []).find((x) => pm.test.test(x.source));
          return offer ? { o, otaPrice: offer.priceGbp } : null;
        })
        .filter(Boolean) as { o: StayOption; otaPrice?: number }[];
      return {
        ...pm,
        fallback: priced.length === 0,
        items: priced, // fallback rails hunt provider-site deals on demand instead
      };
    });
    return [
      { key: "best", label: "Best price", items: visible.slice(0, 40).map((o) => ({ o, otaPrice: undefined as number | undefined })) },
      ...byProvider.map((c) => ({
        key: c.key,
        label: c.label,
        domain: c.domain,
        fallback: c.fallback,
        items: c.items.sort((a, b) => (a.otaPrice ?? 9e9) - (b.otaPrice ?? 9e9)).slice(0, 20),
      })),
    ];
  }, [results, showHostels, perNightBudget]);

  // globe data: all trips with coords, chronological arcs, focus = current/next
  const globeData = useMemo(() => {
    const dated = trips
      .filter((t) => typeof t.destLat === "number" && typeof t.destLng === "number")
      .sort((a, b) => (a.startDate ?? "9999").localeCompare(b.startDate ?? "9999"));
    const points: GlobePoint[] = dated.map((t) => ({
      id: t._id,
      lat: t.destLat!,
      lng: t.destLng!,
      kind: "leg",
      label: `${t.destCity ?? t.title}${t.startDate ? ` · ${fmtShort(t.startDate)}–${fmtShort(t.endDate)}` : ""}`,
    }));
    const arcs: GlobeArc[] = [];
    for (let i = 1; i < dated.length; i++) {
      arcs.push({
        startLat: dated[i - 1].destLat!,
        startLng: dated[i - 1].destLng!,
        endLat: dated[i].destLat!,
        endLng: dated[i].destLng!,
        kind: "flight",
      });
    }
    const focusTrip = dated.find((t) => {
      const st = parseISO(t.startDate);
      const en = parseISO(t.endDate);
      return st && en && Date.now() <= en.getTime() + 86_400_000;
    });
    return { points, arcs, focus: focusTrip ? { lat: focusTrip.destLat!, lng: focusTrip.destLng! } : null };
  }, [trips]);

  const runSearch = async (force = false) => {
    if (!city || !trip?.startDate || !trip?.endDate || searching) return;
    setSearching(true);
    setSearchErr(null);
    setOffersFor(null);
    try {
      // FREE path first: the Printing Press bridge (hotel-goat) returns full
      // results with per-OTA prices + galleries; serpapi remains the fallback.
      // Cache-first (force=true on an explicit "refresh prices").
      let res: { available: boolean; reason?: string; options: StayOption[] };
      const pp = await ppHotels({
        city: stayStyle === "villas" ? `${city} villas` : city,
        checkIn: trip.startDate,
        checkOut: (effCheckOut ?? trip.endDate)!,
        adults: travelers,
        force,
      }).catch(() => ({ available: false as const, options: [] as StayOption[] }));
      if (pp.available && pp.options.length >= 8) {
        const capped = perNightBudget
          ? pp.options.filter((o) => (o.priceGbp ?? 0) <= perNightBudget || o.priceGbp == null)
          : pp.options;
        res = { available: true, options: capped };
      } else {
        res = (await search({
          query: stayStyle === "villas" ? `${city} villas` : `${city} hotels`,
          checkIn: trip.startDate,
          checkOut: effCheckOut ?? trip.endDate,
          adults: travelers,
          maxPricePerNight: perNightBudget,
          vacationRentals: stayStyle === "villas" ? true : undefined,
        })) as { available: boolean; reason?: string; options: StayOption[] };
      }
      if (!res.available) setSearchErr(res.reason ?? "search unavailable");
      const opts = (res.options ?? []) as StayOption[];
      setResults(opts);
      // AUTOMATIC full comparison (2026-07-04, per Daniel): provider price
      // enrichment + the three Browserbase live hunts fire with the search.
      setEnriched(false);
      // Booking.com LIVE (residential-proxy render — real 40+ results, correct
      // total-and-nightly prices, no login) as its own rail.
      setBookingLive({ loading: true, options: [] });
      void ppHotels({
        city,
        checkIn: trip.startDate!,
        checkOut: (effCheckOut ?? trip.endDate)!,
        adults: travelers,
        site: "booking",
      })
        .then((b) => setBookingLive({ loading: false, options: (b.options ?? []) as StayOption[] }))
        .catch(() => setBookingLive({ loading: false, options: [] }));
      // Every uncovered provider — Expedia included — hunts via the free
      // Browserbase renderer (real deals from each portal's SEO/property pages).
      // Apify's Expedia actor needs the paid Pro rental, so it's not auto-fired.
      void (async () => {
        const enrichedList = (await deepCompare(opts)) ?? opts;
        const toHunt = PROVIDER_MATCH.filter((pm) => {
          if (pm.key === "booking") return false; // always priced via Google
          return !enrichedList.some((o) => (o.offers ?? []).some((x) => pm.test.test(x.source)));
        });
        // Serialise in small batches — Browserbase caps concurrent sessions, and
        // firing all at once was making several hunts come back empty.
        for (let i = 0; i < toHunt.length; i += 2) {
          await Promise.all(
            toHunt.slice(i, i + 2).map((pm) => huntProviderDeals(pm.key, pm.label, pm.domain)),
          );
        }
      })();
    } catch (err) {
      setSearchErr(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  };

  const openOffers = async (o: StayOption) => {
    if (offersFor?.name === o.name) {
      setOffersFor(null);
      return;
    }
    setOffersFor(o);
    setOffersData(null);
    if (!o.propertyToken) {
      // Show the card's own gallery instantly, then enrich by name with the
      // full Google-Hotels detail (10 photos, amenities, per-OTA perks).
      setOffersData({
        amenities: o.amenities ?? [],
        images: o.gallery ?? (o.image ? [o.image] : []),
        offers: (o.offers ?? []).map((x) => ({ source: x.source, priceGbp: x.priceGbp, perks: [] })),
      });
      if (trip?.startDate && trip?.endDate) {
        setOffersLoading(true);
        try {
          const rich = await resolveByName({
            name: o.name,
            city,
            checkIn: trip.startDate,
            checkOut: effCheckOut ?? trip.endDate,
            adults: travelers,
          });
          if (rich.available && (rich.images.length > 0 || rich.offers.length > 0)) {
            setOffersData({
              amenities: rich.amenities.length ? rich.amenities : (o.amenities ?? []),
              images: rich.images.length ? rich.images : (o.gallery ?? (o.image ? [o.image] : [])),
              address: rich.address,
              lat: rich.lat,
              lng: rich.lng,
              offers: rich.offers.length
                ? rich.offers
                : (o.offers ?? []).map((x) => ({ source: x.source, priceGbp: x.priceGbp, perks: [] })),
            } as StayDetail);
          }
        } catch {
          /* keep the instant gallery */
        } finally {
          setOffersLoading(false);
        }
      }
      return;
    }
    if (!trip?.startDate || !trip?.endDate) return;
    const cached = detailCache[o.propertyToken];
    if (cached) {
      setOffersData(cached);
      return;
    }
    setOffersLoading(true);
    try {
      const res = await resolveOffers({
        propertyToken: o.propertyToken,
        query: `${city} hotels`,
        checkIn: trip.startDate,
        checkOut: effCheckOut ?? trip.endDate,
        adults: travelers,
      });
      setOffersData(res as StayDetail);
      if (o.propertyToken) setDetailCache((c) => ({ ...c, [o.propertyToken!]: res as StayDetail }));
    } catch {
      setOffersData({ amenities: [], images: [], offers: [] });
    } finally {
      setOffersLoading(false);
    }
  };

  const lockIn = async (o: StayOption, otaSource?: string, otaPrice?: number) => {
    if (!tripId) return;
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
        checkIn: trip?.startDate,
        checkOut: trip?.endDate,
        saved: true,
        locked: true,
      });
    } finally {
      setLockingName(null);
    }
  };

  const huntProviderDeals = async (key: string, label: string, domain: string) => {
    setProviderDealState((st) => ({ ...st, [key]: { loading: true, deals: st[key]?.deals ?? null } }));
    // EVERY provider hunt uses the REAL browser (Browserbase). Rendered pages
    // are timing-sensitive, so give an empty first pass ONE retry before we
    // conclude the portal really has nothing (concurrency made hunts flaky).
    const runOnce = () =>
      providerDealsLive({
        providerKey: key,
        provider: label,
        domain,
        city,
        checkIn: trip?.startDate,
        checkOut: effCheckOut ?? trip?.endDate,
        adults: travelers,
      });
    try {
      let res = await runOnce();
      if (!res.deals || res.deals.length === 0) {
        res = await runOnce().catch(() => res);
      }
      setProviderDealState((st) => ({ ...st, [key]: { loading: false, deals: res.deals ?? [] } }));
    } catch {
      setProviderDealState((st) => ({ ...st, [key]: { loading: false, deals: [] } }));
    }
  };

  // "Compare all providers": detail-fetch the top visible properties in
  // parallel (one click ≈ 8 serpapi credits) and merge every portal's real
  // prices back into the results — provider rails then fill with proper CARDS
  // (image, price at that portal, perks, overlay) for every OTA Google lists.
  const deepCompare = async (list?: StayOption[]) => {
    const source = list ?? results;
    if (!source || enriching || !trip?.startDate) return;
    const visible = showHostels ? source : source.filter((o) => !dormLikely(o));
    const top = visible.filter((o) => o.propertyToken).slice(0, 8);
    if (top.length === 0) return;
    setEnriching(true);
    try {
      const details = await Promise.all(
        top.map((o) =>
          resolveOffers({
            propertyToken: o.propertyToken!,
            query: `${city} hotels`,
            checkIn: trip.startDate!,
            checkOut: (effCheckOut ?? trip.endDate)!,
            adults: travelers,
          })
            .then((d) => ({ token: o.propertyToken!, detail: d as StayDetail }))
            .catch(() => null),
        ),
      );
      const byToken: Record<string, StayDetail> = {};
      for (const d of details) if (d) byToken[d.token] = d.detail;
      setDetailCache((c) => ({ ...c, ...byToken }));
      setResults((prev) =>
        prev
          ? prev.map((o) => {
              const d = o.propertyToken ? byToken[o.propertyToken] : undefined;
              if (!d || d.offers.length === 0) return o;
              return {
                ...o,
                offers: d.offers.map((x) => ({ source: x.source, priceGbp: x.priceGbp })),
                amenities: o.amenities?.length ? o.amenities : d.amenities.slice(0, 4),
              };
            })
          : prev,
      );
      setEnriched(true);
      return source.map((o) => {
        const d = o.propertyToken ? byToken[o.propertyToken] : undefined;
        return d && d.offers.length > 0
          ? { ...o, offers: d.offers.map((x) => ({ source: x.source, priceGbp: x.priceGbp })) }
          : o;
      });
    } finally {
      setEnriching(false);
    }
  };

  const addTrip = async () => {
    if (!newPlace || creating) return;
    setCreating(true);
    try {
      const id = await createTrip({
        title: newPlace.name,
        destCity: newPlace.name,
        destLat: newPlace.lat,
        destLng: newPlace.lng,
        destCountryCode: newPlace.countryCode,
        startDate: newStart || undefined,
        endDate: newEnd || undefined,
      });
      setAdding(false);
      setNewPlace(null);
      setNewStart("");
      setNewEnd("");
      onSelectTrip(id);
    } finally {
      setCreating(false);
    }
  };

  const savedStays = (stays ?? []).filter((st) => st.saved !== false);
  const lockedNames = new Set(savedStays.filter((st) => st.locked === true).map((st) => st.name));
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
        sub: seg0?.carrier as string | undefined,
        stayId: null as Id<"tripStays"> | null,
      };
    }),
    ...savedStays.map((st) => ({
      key: `s-${st._id}`,
      kind: "stay" as const,
      title: st.name,
      when: st.checkIn && st.checkOut ? `${fmtShort(st.checkIn)} – ${fmtShort(st.checkOut)}` : fmtShort(st.checkIn),
      sortDate: st.checkIn ?? "",
      priceGbp: st.priceGbp,
      link: st.link,
      locked: st.locked === true,
      sub: st.provider as string | undefined,
      stayId: st._id,
    })),
  ].sort((a, b) => (a.sortDate || "9999").localeCompare(b.sortDate || "9999"));

  const ph = trip ? phase(trip.startDate, trip.endDate) : null;
  const canSearch = !!city && !!trip?.startDate && !!trip?.endDate;

  return (
    <div className="space-y-3">
      {/* ── year band + add trip + globe ──────────────────────────────────── */}
      <YearBand trips={trips} selectedId={tripId} onSelect={onSelectTrip} />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setAdding((a) => !a)}
          className="flex items-center gap-1.5 rounded-lg border border-rule-soft/50 bg-ink-2/40 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-paper-faint hover:border-brass/40 hover:text-brass transition-colors"
        >
          <Plus className="h-3 w-3" /> trip
        </button>
        <button
          type="button"
          onClick={() => setJourneyOpen(true)}
          disabled={!tripId}
          className="flex items-center gap-1.5 rounded-lg border border-brass/40 bg-brass/10 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-brass hover:bg-brass/20 disabled:opacity-40 transition-colors"
        >
          <Globe2 className="h-3 w-3" /> journey · map + timeline
        </button>
      </div>
      {adding && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-brass/30 bg-ink-2/40 px-3 py-2.5">
          <PlaceField placeholder="Destination city…" selected={newPlace} onSelect={setNewPlace} />
          <DateField
            value={newStart}
            onChange={(v) => {
              setNewStart(v);
              if (!newEnd || newEnd < v) setNewEnd(addDays(v, 7));
            }}
          />
          <DateField value={newEnd} min={newStart} onChange={setNewEnd} />
          <button
            type="button"
            disabled={!newPlace || creating}
            onClick={() => void addTrip()}
            className="rounded-md border border-brass/40 bg-brass/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-brass hover:bg-brass/20 disabled:opacity-40 transition-colors"
          >
            {creating ? "adding…" : "add"}
          </button>
        </div>
      )}

      {!trip || !tripId ? (
        <p className="py-6 text-center text-[12px] text-paper-faint">No trip selected — add one above.</p>
      ) : (
        <>
          {/* ── guided stage stepper ─────────────────────────────────────────── */}
          <StageStepper
            stage={stage}
            setStage={setStage}
            status={{
              setup: trip.startDate && trip.endDate ? "done" : "todo",
              stays: savedStays.some((st) => st.locked === true) ? "done" : "todo",
              transport: (flights ?? []).length > 0 ? "done" : transportSkipped ? "skipped" : "todo",
              plan: "todo",
            }}
          />

          {/* ── STAGE: setup — hero + preferences + dynamic budget ──────────── */}
          {stage === "setup" && (
          <>
          <div
            className="relative overflow-hidden rounded-xl border border-rule-soft/60 px-4 py-4"
            style={{ background: "linear-gradient(150deg, oklch(0.24 0.02 75 / 0.55), oklch(0.17 0.008 245 / 0.75) 55%)" }}
          >
            <div className="absolute inset-x-0 top-0 h-px opacity-40" style={{ background: "linear-gradient(90deg, transparent, var(--color-brass) 35%, var(--color-brass) 65%, transparent)" }} />
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-paper-faint">
                  Next trip{trip.destCountryCode ? ` · ${trip.destCountryCode.toUpperCase()}` : ""}
                </p>
                <h3 className="mt-0.5 truncate font-display italic font-light text-[30px] leading-none text-paper">{city}</h3>
              </div>
              {mounted && ph && (
                <span className={cn("shrink-0 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em]", BADGE_TONE[ph.tone])}>
                  <CalendarRange className="mr-1 inline h-3 w-3 -translate-y-px" />
                  {ph.label}
                </span>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <DateField
                value={trip.startDate ?? ""}
                onChange={(v) => {
                  // SMART DATES: the end follows the start. Keep the trip's
                  // current duration when both ends exist; default a week when
                  // the end is missing or would precede the new start.
                  const patch: { startDate: string; endDate?: string } = { startDate: v };
                  const oldS = parseISO(trip.startDate);
                  const oldE = parseISO(trip.endDate);
                  if (!trip.endDate || (oldE && oldE.getTime() < new Date(`${v}T00:00:00Z`).getTime())) {
                    const durDays = oldS && oldE ? Math.max(1, Math.round((oldE.getTime() - oldS.getTime()) / 86_400_000)) : 7;
                    patch.endDate = addDays(v, durDays);
                  }
                  void updateTrip({ tripId, patch });
                }}
              />
              <span className="text-paper-faint">→</span>
              <DateField
                value={trip.endDate ?? ""}
                min={trip.startDate}
                onChange={(v) => void updateTrip({ tripId, patch: { endDate: v } })}
              />
              <div className="flex items-center gap-1 rounded-md border border-rule-soft/60 bg-ink-3/60 px-2 py-1">
                <Users className="h-3 w-3 text-paper-faint" />
                <button type="button" onClick={() => void updateTrip({ tripId, patch: { travelers: Math.max(1, travelers - 1) } })} className="px-1 font-mono text-[12px] text-paper-faint hover:text-paper">−</button>
                <span className="font-mono text-[11px] tabular-nums text-paper">{travelers}</span>
                <button type="button" onClick={() => void updateTrip({ tripId, patch: { travelers: Math.min(9, travelers + 1) } })} className="px-1 font-mono text-[12px] text-paper-faint hover:text-paper">+</button>
              </div>
              {/* stay style: villas for Bali-likes, hotels for Turkey-likes */}
              <div className="flex items-center gap-0.5 rounded-md border border-rule-soft/60 bg-ink-3/60 p-0.5">
                {(["any", "villas", "hotels"] as const).map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => void updateTrip({ tripId, patch: { stayStyle: st } })}
                    className={cn(
                      "rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors",
                      stayStyle === st ? "bg-brass/20 text-brass" : "text-paper-faint hover:text-paper",
                    )}
                  >
                    {st}
                  </button>
                ))}
              </div>
              {clamped && (
                <span className="rounded-full border border-amber/40 bg-amber/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-amber">
                  portals cap at 29 nights — searching {fmtShort(trip.startDate)}–{fmtShort(effCheckOut)}
                </span>
              )}
            </div>

            {/* dynamic budget slider */}
            <div className="mt-3 flex items-center gap-3">
              <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-paper-faint">budget</span>
              <input
                type="range"
                min={100}
                max={8000}
                step={50}
                value={budget || 100}
                onChange={(ev) => setBudgetDraft(Number(ev.target.value))}
                onMouseUp={() => budgetDraft != null && void updateTrip({ tripId, patch: { budgetGbp: budgetDraft } })}
                onTouchEnd={() => budgetDraft != null && void updateTrip({ tripId, patch: { budgetGbp: budgetDraft } })}
                className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-ink-3 accent-[var(--color-brass)]"
              />
              <span className="font-mono text-[12px] font-bold tabular-nums text-brass">{gbp(budget || 0)}</span>
              {perNightBudget && <span className="font-mono text-[10px] text-paper-faint">≤{gbp(perNightBudget)}/nt</span>}
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.18em] text-emerald-soft/80">
                  <PiggyBank className="h-3 w-3" /> cashback
                </span>
                {BOOKING_PROVIDERS.map((p) => (
                  <a key={p.key} href={p.url({ city, checkIn: trip.startDate, checkOut: effCheckOut, adults: travelers })} target="_blank" rel="noreferrer" className="rounded-full border border-rule-soft/50 bg-ink-2/40 px-2 py-0.5 font-mono text-[10px] text-paper-dim hover:border-brass/50 hover:text-brass transition-colors">
                    {p.label}
                  </a>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-amber/80">lastminute deals</span>
                <a href={`https://www.lastminute.com/hotels/${encodeURIComponent(city.toLowerCase().replace(/\s+/g, "-"))}.html`} target="_blank" rel="noreferrer" className="rounded-full border border-amber/30 bg-amber/5 px-2 py-0.5 font-mono text-[10px] text-paper-dim hover:border-amber/60 hover:text-amber transition-colors">
                  {city} hotels
                </a>
                <a href={`https://www.lastminute.com/holidays/${encodeURIComponent(city.toLowerCase().replace(/\s+/g, "-"))}.html`} target="_blank" rel="noreferrer" className="rounded-full border border-amber/30 bg-amber/5 px-2 py-0.5 font-mono text-[10px] text-paper-dim hover:border-amber/60 hover:text-amber transition-colors">
                  {city} holidays
                </a>
                <a href="https://www.lastminute.com/deals" target="_blank" rel="noreferrer" className="rounded-full border border-amber/30 bg-amber/5 px-2 py-0.5 font-mono text-[10px] text-paper-dim hover:border-amber/60 hover:text-amber transition-colors">
                  deals hub
                </a>
              </div>
              <button
                type="button"
                disabled={!canSearch || searching}
                onClick={() => {
                  void runSearch();
                  setStage("stays"); // results render on the Stays stage
                }}
                className="flex items-center gap-1.5 rounded-lg border border-brass/40 bg-brass/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-brass hover:bg-brass/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {searching ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
                find stays <ArrowRight className="h-3 w-3" />
              </button>
            </div>
            {!canSearch && <p className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-paper-faint">set both dates to enable live prices</p>}
            {searchErr && <p className="mt-1.5 font-mono text-[10px] text-rose-soft">{searchErr}</p>}
          </div>
          <StageNav stage={stage} setStage={setStage} />
          </>
          )}

          {/* ── STAGE: stays — live search results + provider rails ──────────── */}
          {stage === "stays" && (
          <>
          {!(results && results.length > 0) && !searching && (
            <button
              type="button"
              disabled={!canSearch}
              onClick={() => void runSearch(results !== null)}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-brass/40 bg-brass/10 px-3 py-2.5 font-mono text-[10px] uppercase tracking-[0.18em] text-brass hover:bg-brass/20 disabled:opacity-40 transition-colors"
            >
              <Search className="h-3 w-3" />{" "}
              {!canSearch
                ? "set dates in Setup first"
                : results === null
                  ? "load live prices across all providers"
                  : "no stays found — refresh prices"}
            </button>
          )}
          {results && results.length > 0 && (
            <div className="flex items-center justify-between gap-2">
              <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-paper-faint">
                {cachedStays && !searching ? "cached · instant" : "live"} · {results.length} stays
              </p>
              <button
                type="button"
                disabled={searching}
                onClick={() => void runSearch(true)}
                className="flex items-center gap-1 rounded-md border border-rule-soft/50 bg-ink-2/40 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-paper-faint hover:border-brass/40 hover:text-brass transition-colors disabled:opacity-40"
              >
                {searching ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Search className="h-2.5 w-2.5" />} refresh prices
              </button>
            </div>
          )}

          {/* aggregation buffer: search + enrichment + live hunts all at once */}
          {(searching || enriching || Object.values(providerDealState).some((st) => st.loading)) && (
            <div className="rounded-lg border border-rule-soft/50 bg-ink-2/30 px-3 py-2">
              {(() => {
                const hunts = Object.values(providerDealState);
                const total = 2 + hunts.length; // search + enrichment + each hunt
                const done =
                  (searching ? 0 : 1) +
                  (enriching ? 0 : 1) +
                  hunts.filter((st) => !st.loading).length;
                const pct = Math.round((done / Math.max(1, total)) * 100);
                return (
                  <>
                    <p className="mb-1 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.2em] text-paper-faint">
                      <Loader2 className="h-3 w-3 animate-spin text-brass" />
                      aggregating providers · {done}/{total} sources in
                    </p>
                    <div className="h-1 overflow-hidden rounded-full bg-ink-3/70">
                      <div className="h-full rounded-full bg-brass transition-all duration-500" style={{ width: `${Math.max(6, pct)}%` }} />
                    </div>
                  </>
                );
              })()}
            </div>
          )}

          {/* searching skeleton — instant feedback while SerpAPI pages arrive */}
          {searching && !results && (
            <div className="no-scrollbar flex gap-2.5 overflow-x-auto pb-1">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="w-[232px] shrink-0 animate-pulse overflow-hidden rounded-xl border border-rule-soft/40 bg-ink-2/40">
                  <div className="h-[104px] w-full bg-ink-3/60" />
                  <div className="space-y-2 p-2.5">
                    <div className="h-3 w-3/4 rounded bg-ink-3/60" />
                    <div className="h-4 w-1/2 rounded bg-ink-3/60" />
                    <div className="h-3 w-full rounded bg-ink-3/50" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── provider carousels ─────────────────────────────────────────── */}
          {results && results.length > 0 && (
            <Section
              title="Stays"
              count={results.length}
              action={
                <span className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={enriching}
                    onClick={() => void deepCompare()}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] transition-colors",
                      enriched
                        ? "border-emerald-soft/50 bg-emerald-soft/10 text-emerald-soft"
                        : "border-brass/40 bg-brass/10 text-brass hover:bg-brass/20",
                    )}
                  >
                    {enriching ? <Loader2 className="h-3 w-3 animate-spin" /> : <PiggyBank className="h-3 w-3" />}
                    {enriched ? "providers compared" : "compare all providers"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowHostels((h) => !h)}
                    className={cn(
                      "rounded-md border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] transition-colors",
                      showHostels
                        ? "border-rose-soft/50 bg-rose-soft/10 text-rose-soft"
                        : "border-rule-soft/50 bg-ink-2/40 text-paper-faint hover:text-paper",
                    )}
                  >
                    {showHostels ? "hostels shown" : "hostels hidden"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setBrowseOpen(true)}
                    className="flex items-center gap-1.5 rounded-md border border-brass/40 bg-brass/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-brass hover:bg-brass/20 transition-colors"
                  >
                    <Maximize2 className="h-3 w-3" /> browse fullscreen
                  </button>
                </span>
              }
            >
              <div className="space-y-3">
          {(() => {
            const bkOpts = withinBudget(bookingLive.options);
            if (!bookingLive.loading && bkOpts.length === 0) return null;
            return (
            <div>
              <p className="mb-1.5 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.22em] text-paper-faint">
                Booking.com · live
                {bookingLive.loading ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <span className="text-paper-faint/50">· {bkOpts.length}</span>}
                <span className="flex items-center gap-1 text-emerald-soft/70"><PiggyBank className="h-2.5 w-2.5" /> cashback</span>
              </p>
              {bkOpts.length > 0 && (
                <div className="no-scrollbar flex snap-x gap-2.5 overflow-x-auto pb-1">
                  {bkOpts.map((o, i) => (
                    <StayCard
                      key={`bk-${i}-${o.name}`}
                      o={o}
                      checkIn={trip.startDate}
                      checkOut={effCheckOut}
                      adults={travelers}
                      locking={lockingName === o.name}
                      locked={lockedNames.has(o.name)}
                      expanded={offersFor?.name === o.name}
                      onDetails={(opt) => void openOffers(opt)}
                      onLock={(opt) => void lockIn(opt, "Booking.com", opt.priceGbp)}
                    />
                  ))}
                </div>
              )}
            </div>
            );
          })()}
          {carousels.map((rail) => (
            <div key={rail.key}>
              <p className="mb-1.5 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.22em] text-paper-faint">
                {rail.label}
                {!("fallback" in rail && rail.fallback) && <span className="text-paper-faint/50">· {rail.items.length}</span>}
                {rail.key !== "best" && (
                  <span className="flex items-center gap-1 text-emerald-soft/70">
                    <PiggyBank className="h-2.5 w-2.5" /> cashback
                  </span>
                )}
              </p>
              {"fallback" in rail && rail.fallback ? (
                <ProviderDealRail
                  railKey={rail.key}
                  label={rail.label}
                  state={providerDealState[rail.key]}
                  onHunt={() => void huntProviderDeals(rail.key, rail.label, (rail as { domain?: string }).domain ?? "")}
                  onOpenDeal={(d) => setDealOpen(d)}
                />
              ) : (
              <div className="no-scrollbar flex snap-x gap-2.5 overflow-x-auto pb-1">
                {rail.items.map(({ o, otaPrice }, i) => (
                  <StayCard
                    key={`${rail.key}-${i}-${o.name}`}
                    o={o}
                    otaPrice={otaPrice}
                    checkIn={trip.startDate}
                    checkOut={effCheckOut}
                    adults={travelers}
                    locking={lockingName === o.name}
                    locked={lockedNames.has(o.name)}
                    expanded={offersFor?.name === o.name}
                    onDetails={(opt) => void openOffers(opt)}
                    onLock={(opt) => void lockIn(opt, rail.key !== "best" ? rail.label : undefined, otaPrice)}
                  />
                ))}
              </div>
              )}
            </div>
          ))}
              </div>
            </Section>
          )}
          <StageNav stage={stage} setStage={setStage} />
          </>
          )}

          {/* ── property detail sheet: gallery + map + provider comparison ─── */}
          <Sheet
            open={!!offersFor}
            onClose={() => setOffersFor(null)}
            title={offersFor?.name ?? ""}
          >
            {offersLoading ? (
              <p className="flex items-center gap-2 p-6 text-[12px] text-paper-faint">
                <Loader2 className="h-3 w-3 animate-spin" /> resolving offers, photos + exact provider pages…
              </p>
            ) : offersFor && offersData ? (
              <div className="max-h-[70vh] space-y-3 overflow-y-auto p-1">
                {/* room / property gallery — scrollable */}
                {(offersData.images.length > 0 || offersFor.image) && (
                  <div className="no-scrollbar flex snap-x gap-2 overflow-x-auto">
                    {(offersData.images.length > 0 ? offersData.images : [offersFor.image!]).map((im, i) => (
                      <a key={i} href={im} target="_blank" rel="noreferrer" className="shrink-0 snap-start">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={im} alt="" loading="lazy" className="h-40 w-auto rounded-lg object-cover transition-opacity hover:opacity-80" />
                      </a>
                    ))}
                  </div>
                )}
                {/* provider price comparison — TOTALS first, choose + lock */}
                <div>
                  <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.22em] text-brass">
                    compare providers · total for your stay
                  </p>
                  {offersData.amenities.length > 0 && (
                    <p className="mb-1.5 font-mono text-[9px] text-emerald-soft/80">
                      property includes: {offersData.amenities.slice(0, 6).join(" · ").toLowerCase()}
                    </p>
                  )}
                  {offersData.offers.length === 0 ? (
                    <p className="py-2 text-[12px] text-paper-faint">No per-provider offers returned for these dates.</p>
                  ) : (
                    <ul className="divide-y divide-rule-soft/30 rounded-lg border border-rule-soft/50">
                      {offersData.offers.map((of, i) => (
                        <li key={i} className="flex flex-wrap items-center gap-2 px-3 py-2">
                          <span className="min-w-[104px] font-mono text-[11px] font-bold text-paper">{of.source}</span>
                          <span className="font-mono text-[13px] font-bold tabular-nums text-brass">
                            {typeof of.totalGbp === "number"
                              ? `${gbp(of.totalGbp)} total`
                              : typeof of.priceGbp === "number"
                                ? `${gbp(of.priceGbp)}/nt`
                                : "—"}
                          </span>
                          {typeof of.totalGbp === "number" && typeof of.priceGbp === "number" && (
                            <span className="font-mono text-[10px] text-paper-faint">{gbp(of.priceGbp)}/nt</span>
                          )}
                          {of.freeCancellation ? (
                            <span className="rounded-full border border-emerald-soft/40 bg-emerald-soft/10 px-1.5 py-px font-mono text-[8px] uppercase tracking-[0.12em] text-emerald-soft">free cancel</span>
                          ) : of.cancellationNote ? (
                            <span className="rounded-full border border-amber/40 bg-amber/10 px-1.5 py-px font-mono text-[8px] uppercase tracking-[0.12em] text-amber">{of.cancellationNote}</span>
                          ) : null}
                          {of.perks.slice(0, 3).map((pk) => (
                            <span key={pk} className="rounded-full border border-rule-soft/50 px-1.5 py-px font-mono text-[8px] uppercase tracking-[0.08em] text-paper-faint">{pk}</span>
                          ))}
                          <span className="flex-1" />
                          {of.link && (
                            <a href={of.link} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-md border border-rule-soft/50 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim hover:border-brass/50 hover:text-brass transition-colors">
                              open <ExternalLink className="h-2.5 w-2.5" />
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              void lockIn(
                                { ...offersFor, link: of.link ?? offersFor.link, totalGbp: of.totalGbp ?? offersFor.totalGbp },
                                of.source,
                                of.priceGbp,
                              );
                              setOffersFor(null);
                            }}
                            className="flex items-center gap-1 rounded-md border border-brass/40 bg-brass/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-brass hover:bg-brass/20 transition-colors"
                          >
                            <Lock className="h-2.5 w-2.5" /> lock this
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {/* amenities */}
                {offersData.amenities.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {offersData.amenities.map((a) => (
                      <span key={a} className="rounded-full border border-rule-soft/50 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-paper-faint">{a}</span>
                    ))}
                  </div>
                )}
                {/* embedded Google map */}
                {typeof offersData.lat === "number" && typeof offersData.lng === "number" && (
                  <div>
                    <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.22em] text-paper-faint">
                      location{offersData.address ? ` · ${offersData.address}` : ""}
                    </p>
                    <iframe
                      title="map"
                      src={`https://www.google.com/maps?q=${offersData.lat},${offersData.lng}&z=14&output=embed`}
                      className="h-56 w-full rounded-lg border border-rule-soft/50"
                      loading="lazy"
                    />
                  </div>
                )}
              </div>
            ) : null}
          </Sheet>

          {/* ── STAGE: transport — timeline + transfer finder ───────────────── */}
          {stage === "transport" && (
          <>
          {/* ── trip timeline + transfers ──────────────────────────────────── */}
          {trip.startDate && trip.endDate && (
            <Section title="Trip timeline">
              <div className="px-1">
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
              {(legs ?? []).length > 0 && (
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  <span className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.18em] text-paper-faint">
                    <TrainFront className="h-3 w-3" /> transfers
                  </span>
                  {(legs ?? []).map((l, i) => (
                    <span key={l._id} className="font-mono text-[10px] text-paper-dim">
                      {i > 0 && <span className="text-paper-faint/50"> → </span>}
                      {l.city}
                      {l.routeDurationText && <span className="text-paper-faint"> ({l.transportMode ?? "route"} · {l.routeDurationText})</span>}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-2 flex justify-end">
                <Link href={`/travel/${tripId}`} className="rounded-full border border-rule-soft/50 bg-ink-2/40 px-2 py-0.5 font-mono text-[10px] text-paper-dim hover:border-brass/50 hover:text-brass transition-colors">
                  plan multi-stop transfers →
                </Link>
              </div>
              </div>
            </Section>
          )}

          {/* ── dedicated transfer tile (real prices) ──────────────────────── */}
          <TransferTile
            tripId={tripId}
            defaultFrom={trip.originCity ?? ""}
            defaultTo={city}
            defaultDate={trip.startDate}
            adults={travelers}
          />
          <StageNav stage={stage} setStage={setStage} onSkip={() => setTransportSkipped(true)} />
          </>
          )}

          {/* ── STAGE: plan — bookings summary + day-by-day ─────────────────── */}
          {stage === "plan" && (
          <>
          {/* ── bookings ───────────────────────────────────────────────────── */}
          <div>
            <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.22em] text-paper-faint">
              Bookings · {flights === undefined || stays === undefined ? "…" : bookingRows.length}
            </p>
            {flights === undefined || stays === undefined ? (
              <p className="py-3 text-[12px] text-paper-faint">Loading bookings…</p>
            ) : bookingRows.length === 0 ? (
              <div className="rounded-lg border border-dashed border-rule-soft/60 px-3 py-3">
                <p className="text-[12px] text-paper-faint">
                  Nothing locked in yet — load live prices above and lock a stay, or search flights in <span className="text-paper-dim">Find</span>.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-rule-soft/30 overflow-hidden rounded-lg border border-rule-soft/50">
                {bookingRows.map((r) => (
                  <li key={r.key} className="flex items-center gap-3 bg-ink-2/30 px-3 py-2.5">
                    <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-md border", r.kind === "flight" ? "border-brass/30 bg-brass/[0.08] text-brass" : "border-emerald-soft/30 bg-emerald-soft/[0.08] text-emerald-soft")}>
                      {r.kind === "flight" ? (/taxi|train|bus|car/i.test(r.title) || /taxi|train|bus|car/i.test(String(r.sub ?? "")) ? <TrainFront className="h-3.5 w-3.5" /> : <Plane className="h-3.5 w-3.5" />) : <BedDouble className="h-3.5 w-3.5" />}
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
                      <p className="font-mono text-[10px] text-paper-faint">{[r.when, r.sub].filter(Boolean).join(" · ") || "—"}</p>
                    </div>
                    {typeof r.priceGbp === "number" && <span className="font-mono text-[12px] tabular-nums text-paper-dim">{gbp(r.priceGbp)}</span>}
                    {r.stayId && r.locked && (
                      <span className="hidden items-center gap-1 sm:flex">
                        <input
                          type="date"
                          defaultValue={r.sortDate || undefined}
                          onChange={(ev) => void setLocked({ stayId: r.stayId!, locked: true, checkIn: ev.target.value })}
                          className="rounded border border-rule-soft/60 bg-ink-3/60 px-1 py-0.5 font-mono text-[10px] text-paper focus:outline-none [color-scheme:dark]"
                        />
                        <input
                          type="date"
                          onChange={(ev) => void setLocked({ stayId: r.stayId!, locked: true, checkOut: ev.target.value })}
                          className="rounded border border-rule-soft/60 bg-ink-3/60 px-1 py-0.5 font-mono text-[10px] text-paper focus:outline-none [color-scheme:dark]"
                        />
                      </span>
                    )}
                    {r.stayId && (
                      <button type="button" onClick={() => void setLocked({ stayId: r.stayId!, locked: !r.locked })} className="text-paper-faint hover:text-amber transition-colors" aria-label={r.locked ? "unlock stay" : "lock stay"}>
                        {r.locked ? <LockOpen className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                      </button>
                    )}
                    {r.stayId && !r.locked && (
                      <button type="button" onClick={() => void removeStay({ stayId: r.stayId! })} className="font-mono text-[11px] text-paper-faint/50 hover:text-rose-soft transition-colors" aria-label="remove stay">×</button>
                    )}
                    {r.link && (
                      <a href={r.link} target="_blank" rel="noreferrer" className="text-paper-faint hover:text-brass transition-colors" aria-label={`open ${r.title}`}>
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Link href={`/travel/${tripId}`} className="flex items-center justify-center gap-1.5 rounded-lg border border-rule-soft/50 bg-ink-2/30 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-paper-faint hover:border-brass/40 hover:text-brass transition-colors">
        <Maximize2 className="h-3 w-3" /> open full planner
          </Link>
          <StageNav stage={stage} setStage={setStage} />
          </>
          )}
        </>
      )}

      {/* ── fullscreen stay browser: grid of everything found ────────────── */}
      <Sheet
        open={browseOpen}
        onClose={() => setBrowseOpen(false)}
        title={`Stays · ${city} · ${results?.length ?? 0} found`}
        className="w-[96vw] max-w-[1280px] max-h-[92dvh]"
      >
        <div className="space-y-5 p-4">
          {carousels.map((rail) => (
            <div key={`fs-${rail.key}`}>
              <p className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-brass/85">
                {rail.label}
                <span className="text-paper-faint/60">· {rail.items.length}</span>
              </p>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                {rail.items.map(({ o, otaPrice }, i) => (
                  <StayCard
                    key={`fs-${rail.key}-${i}-${o.name}`}
                    o={o}
                    otaPrice={otaPrice}
                    fluid
                    checkIn={trip?.startDate}
                    checkOut={effCheckOut}
                    adults={travelers}
                    locking={lockingName === o.name}
                    locked={lockedNames.has(o.name)}
                    expanded={offersFor?.name === o.name}
                    onDetails={(opt) => void openOffers(opt)}
                    onLock={(opt) => void lockIn(opt, rail.key !== "best" ? rail.label : undefined, otaPrice)}
                  />
                ))}
              </div>
            </div>
          ))}
          {(!results || results.length === 0) && (
            <p className="py-8 text-center text-[12px] text-paper-faint">Load live prices first, then browse everything here.</p>
          )}
        </div>
      </Sheet>

      {/* ── hunted-deal overlay: photos + info + link ─────────────────────── */}
      <Sheet open={!!dealOpen} onClose={() => setDealOpen(null)} title={dealOpen?.name ?? ""}>
        {dealOpen && (
          <div className="space-y-3 p-4">
            {(dealOpen.images ?? []).length > 0 && (
              <div className="no-scrollbar flex snap-x gap-2 overflow-x-auto">
                {(dealOpen.images ?? []).map((im, i) => (
                  <a key={i} href={im} target="_blank" rel="noreferrer" className="shrink-0 snap-start">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={im} alt="" loading="lazy" className="h-40 w-auto rounded-lg object-cover transition-opacity hover:opacity-80" />
                  </a>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {dealOpen.priceTotal && (
                <span className="font-mono text-[15px] font-bold tabular-nums text-brass">{dealOpen.priceTotal} <span className="text-[10px] font-normal uppercase text-paper-faint">total</span></span>
              )}
              {dealOpen.priceNight && (
                <span className="font-mono text-[12px] tabular-nums text-paper-dim">{dealOpen.priceNight} <span className="text-[9px] uppercase text-paper-faint">/nt</span></span>
              )}
              {dealOpen.note && <span className="font-mono text-[10px] text-paper-faint">{dealOpen.note}</span>}
            </div>
            {dealOpen.link && (
              <a href={dealOpen.link} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-1.5 rounded-lg border border-brass/40 bg-brass/10 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-brass hover:bg-brass/20 transition-colors">
                open on the provider <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        )}
      </Sheet>

      {/* ── globe overlay: where you are, when ───────────────────────────── */}
      <Sheet open={globeOpen} onClose={() => setGlobeOpen(false)} title="Trips · where & when">
        <div className="h-[420px] w-full">
          {globeData.points.length === 0 ? (
            <p className="p-6 text-center text-[12px] text-paper-faint">
              No trips with coordinates yet — new trips added here are geocoded automatically.
            </p>
          ) : (
            <TripGlobe
              points={globeData.points}
              arcs={globeData.arcs}
              focus={globeData.focus}
              onPointClick={(id) => {
                onSelectTrip(id as Id<"trips">);
                setGlobeOpen(false);
              }}
              className="h-full w-full rounded-xl overflow-hidden"
            />
          )}
        </div>
      </Sheet>

      {/* ── Journey master overlay: connected globe + node timeline + money ── */}
      <TripJourney tripId={tripId} trip={trip} open={journeyOpen} onClose={() => setJourneyOpen(false)} />
    </div>
  );
}
