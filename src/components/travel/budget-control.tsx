"use client";

/**
 * BudgetControl — shared budget toggle used across all travel modes (Planner /
 * Find / Trip). One per-trip budget (`trip.budgetGbp`); toggling off sets it to
 * 0 (no constraint). Always shows the TOTAL cost for the selected time period
 * (passed in by the caller, since each mode totals different things), and when
 * the budget is on, a progress bar + over-budget warning against it.
 *
 * Recommendations respect the budget elsewhere: planTrip hard-caps the itinerary
 * total; Find passes it as a max-price filter to the hotel/flight search.
 */

import { useEffect, useState } from "react";
import { Wallet } from "lucide-react";

// Budget slider range — total cap (GBP) used as the search ceiling in every mode.
const BUDGET_MIN = 50;
const BUDGET_MAX = 6000;
const BUDGET_STEP = 50;

const gbp = (n: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0);

/** Whole nights between two ISO dates (checkout − checkin); 0 if invalid. */
export function nightsBetween(start?: string, end?: string): number {
  if (!start || !end) return 0;
  const s = Date.parse(`${start}T00:00:00Z`);
  const e = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return 0;
  return Math.round((e - s) / 86_400_000);
}

export function BudgetControl({
  budgetGbp,
  onSetBudget,
  total,
  subLabel,
  defaultBudget = 1000,
}: {
  budgetGbp?: number;
  onSetBudget: (v: number) => void;
  /** Total cost for the selected period (caller-computed). */
  total: number;
  /** e.g. "5 nights" or "12–17 Jul" — describes the period the total covers. */
  subLabel?: string;
  defaultBudget?: number;
}) {
  const on = (budgetGbp ?? 0) > 0;
  // Live slider position (updates on every drag tick for instant feedback);
  // the value is committed to the trip on release to avoid write spam.
  const [slider, setSlider] = useState<number>(
    Math.min(BUDGET_MAX, budgetGbp && budgetGbp > 0 ? budgetGbp : defaultBudget),
  );
  useEffect(() => {
    if (on) setSlider(Math.min(BUDGET_MAX, budgetGbp as number));
  }, [budgetGbp, on]);

  const shown = on ? slider : 0;
  const over = on && shown > 0 && total > shown;
  const pct = on && shown > 0 ? Math.min(100, (total / shown) * 100) : 0;

  return (
    <div className="space-y-1.5 rounded-lg border border-rule-soft/40 bg-ink-2/20 px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="toggle budget"
          onClick={() =>
            onSetBudget(
              on ? 0 : Math.min(BUDGET_MAX, budgetGbp && budgetGbp > 0 ? budgetGbp : defaultBudget),
            )
          }
          className="flex items-center gap-1.5"
        >
          <span
            className={`relative h-4 w-7 rounded-full transition-colors ${
              on ? "bg-brass/70" : "border border-rule-soft/60 bg-ink-3/80"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-paper transition-transform ${
                on ? "translate-x-3" : "translate-x-0"
              }`}
            />
          </span>
          <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.16em] text-paper-faint">
            <Wallet className="h-3 w-3 text-brass/70" /> Budget
          </span>
        </button>

        {on && (
          <span className="text-[13px] font-semibold tabular-nums text-brass">
            {gbp(shown)}
            {shown >= BUDGET_MAX ? "+" : ""}
          </span>
        )}
      </div>

      {/* Draggable budget slider — the total cap searched in every mode. */}
      {on && (
        <input
          type="range"
          min={BUDGET_MIN}
          max={BUDGET_MAX}
          step={BUDGET_STEP}
          value={Math.min(BUDGET_MAX, Math.max(BUDGET_MIN, slider))}
          aria-label="budget amount"
          onChange={(e) => setSlider(Number(e.target.value))}
          onMouseUp={() => onSetBudget(slider)}
          onTouchEnd={() => onSetBudget(slider)}
          onKeyUp={() => onSetBudget(slider)}
          style={{ accentColor: "var(--color-brass)" }}
          className="h-1.5 w-full cursor-pointer"
        />
      )}

      <div className="flex items-center justify-between text-[11px]">
        <span className="text-paper-faint">
          Total{subLabel ? ` · ${subLabel}` : ""}
        </span>
        <span className={`tabular-nums ${over ? "text-rose-400" : "text-paper"}`}>
          {gbp(total)}
          {on ? ` / ${gbp(shown)}` : ""}
        </span>
      </div>

      {on && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-paper/[0.06]">
          <div
            className={`h-full rounded-full transition-[width] ${
              over ? "bg-rose-400" : "bg-brass/70"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {over && (
        <p className="text-[10px] text-rose-400">
          Over budget by {gbp(total - shown)}
        </p>
      )}
    </div>
  );
}

export default BudgetControl;
