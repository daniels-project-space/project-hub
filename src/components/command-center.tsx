"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import {
  getUpcomingEvents,
  type UpcomingEvent,
} from "@/components/widgets/calendar-widget";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function formatDateDisplay(now: Date): string {
  return now.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatNW(gbp: number): string {
  if (gbp >= 1_000_000) return `£${(gbp / 1_000_000).toFixed(2)}m`;
  if (gbp >= 1_000) return `£${(gbp / 1_000).toFixed(1)}k`;
  return `£${gbp.toFixed(0)}`;
}

function formatEventTime(start: number, allDay: boolean): string {
  if (allDay) return "all day";
  return new Date(start).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatEventDay(start: number, now: number): string {
  const startDay = new Date(start);
  const todayDay = new Date(now);
  const diff = Math.round(
    (startDay.setHours(0, 0, 0, 0) - todayDay.setHours(0, 0, 0, 0)) /
      86_400_000,
  );
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return new Date(start).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function NWSkeleton() {
  return (
    <span className="inline-block w-20 h-3.5 rounded bg-paper/[0.06] animate-pulse" />
  );
}

function EventChip({ event, now }: { event: UpcomingEvent; now: number }) {
  const day = formatEventDay(event.start, now);
  const time = formatEventTime(event.start, event.allDay);

  return (
    <div className="flex items-center gap-2 rounded-lg border border-rule-soft/50 bg-paper/[0.025] px-3 py-2 shrink-0 max-w-[220px]">
      {/* Color dot */}
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: event.color || "oklch(0.78 0.13 160)" }}
      />
      <div className="min-w-0">
        <p className="font-display text-[12px] text-paper truncate leading-tight">
          {event.title}
        </p>
        <p className="font-mono text-[9px] text-paper-faint uppercase tracking-[0.14em] mt-0.5">
          {day} · {time}
        </p>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CommandCenter() {
  const wealthData = useQuery(api.wealth.getWealth);
  const events = useQuery(api.events.list);

  const now = Date.now();
  const today = new Date();
  const greeting = timeGreeting();
  const dateDisplay = formatDateDisplay(today);
  const upcoming = getUpcomingEvents(
    events as Parameters<typeof getUpcomingEvents>[0],
    now,
    4,
  );

  return (
    <div className="mb-8 rounded-2xl border border-rule-soft/50 overflow-hidden"
      style={{
        background:
          "linear-gradient(160deg, oklch(0.21 0.006 245 / 0.55), oklch(0.17 0.006 245 / 0.45))",
        boxShadow:
          "0 8px 32px -8px rgba(0,0,0,0.4), inset 0 1px 0 oklch(1 0 0 / 0.04)",
      }}
    >
      {/* Top bar label */}
      <div className="px-5 py-2.5 flex items-center justify-between border-b border-rule-soft/40">
        <span className="font-mono text-[9px] uppercase tracking-[0.28em] text-brass/70">
          Command Center
        </span>
        <span className="font-mono text-[9px] text-paper-faint/50 uppercase tracking-[0.18em]">
          {today.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
        </span>
      </div>

      <div className="px-5 py-5 flex flex-col md:flex-row md:items-end gap-5 md:gap-10">
        {/* Left: greeting + date + net worth */}
        <div className="flex-1 min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-brass/75 mb-1">
            {greeting},&nbsp;Daniel
          </p>
          <h2 className="font-display text-[26px] md:text-[32px] leading-[1.05] tracking-tight text-paper mb-3">
            {dateDisplay}
          </h2>

          {/* Net worth */}
          <div className="flex items-baseline gap-2.5">
            <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-paper-faint">
              Net Worth
            </span>
            <span className="w-px h-3 bg-rule-soft/60 shrink-0" />
            {wealthData === undefined ? (
              <NWSkeleton />
            ) : (
              <span className="font-display italic font-light text-[22px] text-emerald-soft leading-none tabular-nums">
                {formatNW(wealthData.totalGBP)}
              </span>
            )}
            {wealthData !== undefined && (
              <span className="font-mono text-[9px] text-paper-faint/60">
                across {wealthData.assetCount} assets
              </span>
            )}
          </div>
        </div>

        {/* Right: upcoming events strip */}
        <div className="flex-1 min-w-0">
          <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-paper-faint mb-2.5">
            Upcoming
          </p>
          {events === undefined ? (
            /* Loading skeleton */
            <div className="flex gap-2">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="w-40 h-12 rounded-lg bg-paper/[0.04] animate-pulse"
                />
              ))}
            </div>
          ) : upcoming.length === 0 ? (
            <p className="font-mono text-[10px] text-paper-faint/50 italic">
              No upcoming events
            </p>
          ) : (
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-0.5">
              {upcoming.map((ev) => (
                <EventChip key={ev.id} event={ev} now={now} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
