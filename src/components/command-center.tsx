"use client";

import { useState, useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import {
  getUpcomingEvents,
  type UpcomingEvent,
} from "@/components/widgets/calendar-widget";
import { WeatherChip } from "@/components/weather-chip";
import { useSettings } from "@/components/settings-provider";
import { APPS } from "@/lib/apps";

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

// Compact money formatter that honors the `nwCurrency` setting. GBP shows £; USD
// shows $ after converting via usdPerGbp. When the FX rate is missing we fall
// back to GBP rather than fabricate a conversion.
function formatMoney(
  gbp: number,
  currency: "GBP" | "USD",
  usdPerGbp: number | null | undefined,
): string {
  let value = gbp;
  let sym = "£";
  if (currency === "USD" && usdPerGbp) {
    value = gbp * usdPerGbp;
    sym = "$";
  }
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}${sym}${(abs / 1_000_000).toFixed(2)}m`;
  if (abs >= 1_000) return `${sign}${sym}${(abs / 1_000).toFixed(1)}k`;
  return `${sign}${sym}${abs.toFixed(0)}`;
}

const MONTH_LABEL = new Date().toLocaleDateString("en-GB", { month: "short" });

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

// A compact labelled figure. `tone` tints the value (e.g. ±cashflow, overdue).
function StatCell({
  label,
  value,
  sub,
  tone = "default",
  loading = false,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "emerald" | "rose" | "brass";
  loading?: boolean;
}) {
  const toneClass =
    tone === "emerald"
      ? "text-emerald-soft"
      : tone === "rose"
        ? "text-rose-soft"
        : tone === "brass"
          ? "text-brass"
          : "text-paper";
  return (
    <div className="min-w-0">
      <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-paper-faint mb-1 truncate">
        {label}
      </p>
      {loading ? (
        <span className="inline-block w-16 h-4 rounded bg-paper/[0.06] animate-pulse" />
      ) : (
        <p
          className={`font-display text-[18px] leading-none tabular-nums ${toneClass}`}
        >
          {value}
          {sub && (
            <span className="font-mono text-[9px] text-paper-faint/60 ml-1 tracking-normal">
              {sub}
            </span>
          )}
        </p>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CommandCenter() {
  const wealthData = useQuery(api.wealth.getWealth);
  const events = useQuery(api.events.list);
  const todos = useQuery(api.todos.list);
  const hunts = useQuery(api.hunts.list);
  const alerts = useQuery(api.alerts.list);

  const { get } = useSettings();
  const nwCurrency = get("nwCurrency", "GBP") as "GBP" | "USD";

  // Gate current-time text behind mount: server-cached HTML would carry a
  // different hour/day than the client's fresh clock, causing a hydration
  // mismatch (#418) that can break interactivity across the dashboard.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const now = Date.now();
  const today = new Date();
  const greeting = timeGreeting();
  const dateDisplay = formatDateDisplay(today);
  const upcoming = getUpcomingEvents(
    events as Parameters<typeof getUpcomingEvents>[0],
    now,
    4,
  );

  // ── Derived stats (each from a real query; never fabricated) ────────────────
  const usdPerGbp = wealthData?.live?.usdPerGbp ?? wealthData?.usdPerGbp ?? null;
  // Freshest current total for the headline (live intraday → else summed).
  const totalGBP = wealthData
    ? (wealthData.currentTotalGBP ?? wealthData.totalGBP)
    : 0;

  // "Today's move": intraday delta of live vs the snapshot total when a live
  // doc exists; otherwise fall back to the truthful monthly net cashflow.
  const liveTotal = wealthData?.live?.totalGBP;
  const hasIntraday = typeof liveTotal === "number" && wealthData != null;
  const intradayDelta = hasIntraday
    ? liveTotal - wealthData!.totalGBP
    : 0;
  const moveLabel = hasIntraday ? "Today's move" : "Net cashflow";
  const moveValue = hasIntraday ? intradayDelta : (wealthData?.netCashflowGbp ?? 0);
  const moveTone =
    moveValue > 0 ? "emerald" : moveValue < 0 ? "rose" : "default";
  const moveStr =
    (moveValue > 0 ? "+" : "") + formatMoney(moveValue, nwCurrency, usdPerGbp);

  // Todos: open + overdue (dueDate in the past, still open).
  const openTodos = todos?.filter((t) => !t.done) ?? [];
  const overdueTodos = openTodos.filter(
    (t) => typeof t.dueDate === "number" && t.dueDate < now,
  );

  // Live apps from the static catalog (status === "live").
  const liveApps = APPS.filter((a) => a.status === "live").length;
  const totalApps = APPS.length;

  // Active hunts / alerts (cheap — both lists already fetched).
  const activeHunts = hunts?.filter((h) => h.active).length ?? 0;
  const activeAlerts = alerts?.filter((a) => a.active).length ?? 0;

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
          {mounted ? today.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : ""}
        </span>
      </div>

      <div className="px-5 py-5">
        {/* Greeting row — date on the left, geolocated weather chip on the right */}
        <div className="flex items-start justify-between gap-4 mb-5">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-brass/75 mb-1">
              {mounted ? greeting : "Hello"},&nbsp;Daniel
            </p>
            <h2 className="font-display text-[26px] md:text-[32px] leading-[1.05] tracking-tight text-paper">
              {mounted ? dateDisplay : " "}
            </h2>
          </div>
          <WeatherChip />
        </div>

        {/* Stat grid — compact labelled figures, all from real queries */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-6 gap-y-4 border-t border-rule-soft/40 pt-4">
          <StatCell
            label={`Net Worth · ${nwCurrency}`}
            value={formatMoney(totalGBP, nwCurrency, usdPerGbp)}
            sub={
              wealthData ? `${wealthData.assetCount} assets` : undefined
            }
            tone="emerald"
            loading={wealthData === undefined}
          />
          <StatCell
            label={moveLabel}
            value={moveStr}
            tone={moveTone}
            loading={wealthData === undefined}
          />
          <StatCell
            label={`Rental · ${MONTH_LABEL}`}
            value={formatMoney(
              wealthData?.confirmedRentalGbp ?? 0,
              nwCurrency,
              usdPerGbp,
            )}
            sub="confirmed"
            tone="brass"
            loading={wealthData === undefined}
          />
          <StatCell
            label="Expenses · mo"
            value={formatMoney(
              wealthData?.expensesMonthlyGbp ?? 0,
              nwCurrency,
              usdPerGbp,
            )}
            tone="rose"
            loading={wealthData === undefined}
          />
          <StatCell
            label="Open Todos"
            value={String(openTodos.length)}
            sub={
              overdueTodos.length > 0
                ? `${overdueTodos.length} overdue`
                : undefined
            }
            tone={overdueTodos.length > 0 ? "rose" : "default"}
            loading={todos === undefined}
          />
          <StatCell
            label="Live Apps"
            value={String(liveApps)}
            sub={`of ${totalApps}`}
          />
        </div>

        {/* Optional: active hunts + alerts (only when there are any) */}
        {(activeHunts > 0 || activeAlerts > 0) && (
          <div className="flex items-center gap-4 mt-3 font-mono text-[9px] uppercase tracking-[0.18em] text-paper-faint/70">
            {activeHunts > 0 && <span>{activeHunts} active hunts</span>}
            {activeHunts > 0 && activeAlerts > 0 && (
              <span className="w-px h-3 bg-rule-soft/50" />
            )}
            {activeAlerts > 0 && <span>{activeAlerts} price alerts</span>}
          </div>
        )}

        {/* Upcoming events strip */}
        <div className="mt-5 border-t border-rule-soft/40 pt-4">
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
