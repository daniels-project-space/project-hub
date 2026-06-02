import type { ReactNode } from "react";
import { EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { MiniChart } from "@/components/ui/mini-chart";

type Tone = "default" | "emerald" | "amber" | "rose" | "brass";

const TONE_TEXT: Record<Tone, string> = {
  default: "text-paper",
  emerald: "text-emerald-soft",
  amber: "text-amber",
  rose: "text-rose-soft",
  brass: "text-brass",
};

const TONE_STROKE: Record<Tone, string> = {
  default: "var(--color-brass)",
  emerald: "var(--color-emerald-soft)",
  amber: "var(--color-amber)",
  rose: "var(--color-rose-soft)",
  brass: "var(--color-brass)",
};

export function StatTile({
  label,
  value,
  sub,
  badge,
  tone = "default",
  chart,
  onClick,
  onHide,
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  /** Optional trailing badge in the label row (e.g. a ±% delta). */
  badge?: ReactNode;
  tone?: Tone;
  /** Optional per-tile sparkline series (rendered faint behind the value). */
  chart?: number[];
  /** When provided, the tile becomes an interactive button (click-to-drill). */
  onClick?: () => void;
  /**
   * When provided, a small EyeOff hide control appears in the top-right corner
   * (revealed on group-hover). Clicking it calls onHide and stops propagation so
   * it never triggers the tile's onClick/drill. Display-only — hiding a tile does
   * not change any underlying value or total.
   */
  onHide?: () => void;
  className?: string;
}) {
  const interactive = typeof onClick === "function";
  const Tag = interactive ? "button" : "div";

  return (
    <Tag
      {...(interactive
        ? { type: "button" as const, onClick, "aria-label": label }
        : {})}
      className={cn(
        "group relative overflow-hidden rounded-lg border border-rule-soft/60 px-3 py-2.5 text-left w-full",
        interactive &&
          "cursor-pointer transition-colors hover:border-brass/50 focus:outline-none focus-visible:ring-1 focus-visible:ring-brass/60",
        className,
      )}
      style={{
        background:
          "linear-gradient(160deg, oklch(0.21 0.006 245 / 0.6), oklch(0.18 0.006 245 / 0.5))",
      }}
    >
      {/* Per-tile hide control — tiny, top-right, low-opacity, reveals on hover.
          stopPropagation so it never triggers the tile's onClick/drill. */}
      {onHide && (
        <span
          role="button"
          tabIndex={0}
          aria-label={`Hide ${label}`}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onHide();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              e.preventDefault();
              onHide();
            }
          }}
          className="absolute right-1 top-1 z-10 cursor-pointer rounded p-0.5 text-paper-faint opacity-0 transition-opacity hover:text-paper focus:opacity-100 focus:outline-none group-hover:opacity-60"
        >
          <EyeOff className="h-3 w-3" />
        </span>
      )}
      {/* faint sparkline ghost behind the number */}
      {chart && chart.length > 1 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-9 opacity-40">
          <MiniChart
            data={chart}
            width={200}
            height={36}
            className="w-full h-full"
            strokeColor={TONE_STROKE[tone]}
            endDot
          />
        </div>
      )}
      <div className="relative">
        <div className="flex items-center justify-between gap-1.5">
          <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-paper-faint">
            {label}
          </p>
          {badge}
        </div>
        <p
          className={cn(
            "mt-1 font-display text-[18px] leading-none tabular-nums",
            TONE_TEXT[tone],
          )}
        >
          {value}
        </p>
        {sub && (
          <p className="mt-1 font-mono text-[10px] text-paper-faint">{sub}</p>
        )}
      </div>
    </Tag>
  );
}
