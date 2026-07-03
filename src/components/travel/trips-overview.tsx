"use client";

/**
 * TripsOverview — the streamlined, visual default view of the Travel widget
 * (2026-07-03, per Daniel: "much more streamlined, easy to use and visual …
 * for my trips and upcoming bookings").
 *
 * One glance answers three questions:
 *   1. What's my next trip and how far away is it? (hero: destination,
 *      countdown, dates, nights, budget)
 *   2. What's already booked / shortlisted? (chronological bookings list —
 *      flights + saved stays from tripExtras)
 *   3. Where do I book the rest? (cashback provider chips — Booking.com,
 *      Expedia, Trivago, lastminute, Trip.com — prefilled with city + dates;
 *      Daniel earns cashback on all five)
 *
 * Read-only composition of existing queries; the heavy editing lives in the
 * Planner/Find modes and the full /travel/[tripId] page.
 */

import Link from "next/link";
import {
  Plane,
  BedDouble,
  ExternalLink,
  CalendarRange,
  Maximize2,
  PiggyBank,
} from "lucide-react";
import { useQuery } from "convex/react";
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

/** Trip phase → the hero's countdown badge. */
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

function CashbackChips({
  city,
  checkIn,
  checkOut,
  compact = false,
}: {
  city: string;
  checkIn?: string;
  checkOut?: string;
  compact?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {!compact && (
        <span className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.18em] text-emerald-soft/80">
          <PiggyBank className="w-3 h-3" /> cashback
        </span>
      )}
      {BOOKING_PROVIDERS.map((p) => (
        <a
          key={p.key}
          href={p.url({ city, checkIn, checkOut })}
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

type BookingRow = {
  key: string;
  kind: "flight" | "stay";
  title: string;
  when: string; // display
  sortDate: string; // ISO-ish for ordering ("" sorts last)
  priceGbp?: number;
  link?: string;
  sub?: string;
};

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
  } | null;
}) {
  const flights = useQuery(api.tripExtras.listFlights, tripId ? { tripId } : "skip");
  const stays = useQuery(api.tripExtras.listStays, tripId ? { tripId } : "skip");

  if (!tripId || !trip) {
    return (
      <p className="py-6 text-center text-[12px] text-paper-faint">
        No trip selected — create one from the prompt above.
      </p>
    );
  }

  const city = trip.destCity || trip.title;
  const ph = phase(trip.startDate, trip.endDate);
  const s = parseISO(trip.startDate);
  const e = parseISO(trip.endDate);
  const nights = s && e ? Math.max(0, Math.round((e.getTime() - s.getTime()) / 86_400_000)) : null;

  // ── bookings: flights + SAVED stays, chronological ────────────────────────
  const rows: BookingRow[] = [];
  for (const f of flights ?? []) {
    const seg0 = f.segments[0];
    const segN = f.segments[f.segments.length - 1];
    if (!seg0) continue;
    rows.push({
      key: `f-${f._id}`,
      kind: "flight",
      title: `${seg0.from} → ${segN.to}${f.segments.length > 1 ? ` · ${f.segments.length} legs` : ""}`,
      when: seg0.depart ?? "",
      sortDate: seg0.depart ?? "",
      priceGbp: f.priceGbp,
      link: f.bookLink,
      sub: [seg0.carrier, seg0.flightNo].filter(Boolean).join(" "),
    });
  }
  for (const st of stays ?? []) {
    if (st.saved === false) continue; // transient search results are not bookings
    rows.push({
      key: `s-${st._id}`,
      kind: "stay",
      title: st.name,
      when:
        st.checkIn && st.checkOut
          ? `${fmtShort(st.checkIn)} – ${fmtShort(st.checkOut)}`
          : (fmtShort(st.checkIn) ?? ""),
      sortDate: st.checkIn ?? "",
      priceGbp: st.priceGbp,
      link: st.link,
      sub: st.provider,
    });
  }
  rows.sort((a, b) => (a.sortDate || "9999").localeCompare(b.sortDate || "9999"));
  const loadingRows = flights === undefined || stays === undefined;

  return (
    <div className="space-y-3">
      {/* ── hero: next trip ─────────────────────────────────────────────── */}
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
            <p className="mt-1.5 font-mono text-[11px] text-paper-dim">
              {trip.startDate ? (
                <>
                  {fmtShort(trip.startDate)}
                  {trip.endDate ? ` → ${fmtShort(trip.endDate)}` : ""}
                  {nights ? ` · ${nights} night${nights === 1 ? "" : "s"}` : ""}
                </>
              ) : (
                "dates not set"
              )}
              {trip.originCity ? ` · from ${trip.originCity}` : ""}
            </p>
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
        {typeof trip.budgetGbp === "number" && trip.budgetGbp > 0 && (
          <p className="mt-2.5 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
            budget <span className="text-brass tabular-nums">{gbp(trip.budgetGbp)}</span>
          </p>
        )}
        <div className="mt-3">
          <CashbackChips city={city} checkIn={trip.startDate} checkOut={trip.endDate} />
        </div>
      </div>

      {/* ── upcoming bookings ───────────────────────────────────────────── */}
      <div>
        <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.22em] text-paper-faint">
          Bookings · {loadingRows ? "…" : rows.length}
        </p>
        {loadingRows ? (
          <p className="py-3 text-[12px] text-paper-faint">Loading bookings…</p>
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-rule-soft/60 px-3 py-3">
            <p className="text-[12px] text-paper-faint">
              Nothing booked yet — search stays/flights in{" "}
              <span className="text-paper-dim">Find</span>, or book direct with
              cashback above and save it here.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-rule-soft/30 rounded-lg border border-rule-soft/50 overflow-hidden">
            {rows.map((r) => (
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
                  <p className="truncate text-[13px] text-paper">{r.title}</p>
                  <p className="font-mono text-[10px] text-paper-faint">
                    {[r.when, r.sub].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                {typeof r.priceGbp === "number" && (
                  <span className="font-mono text-[12px] tabular-nums text-paper-dim">
                    {gbp(r.priceGbp)}
                  </span>
                )}
                {r.link ? (
                  <a
                    href={r.link}
                    target="_blank"
                    rel="noreferrer"
                    className="text-paper-faint hover:text-brass transition-colors"
                    aria-label={`open ${r.title}`}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : r.kind === "stay" ? (
                  <div className="hidden sm:block">
                    <CashbackChips
                      city={city}
                      checkIn={trip.startDate}
                      checkOut={trip.endDate}
                      compact
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── full planner link ───────────────────────────────────────────── */}
      <Link
        href={`/travel/${tripId}`}
        className="flex items-center justify-center gap-1.5 rounded-lg border border-rule-soft/50 bg-ink-2/30 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-paper-faint hover:border-brass/40 hover:text-brass transition-colors"
      >
        <Maximize2 className="h-3 w-3" /> open full planner
      </Link>
    </div>
  );
}
