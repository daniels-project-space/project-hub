import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "default" | "emerald" | "amber" | "rose" | "brass";

const TONE_TEXT: Record<Tone, string> = {
  default: "text-paper",
  emerald: "text-emerald-soft",
  amber: "text-amber",
  rose: "text-rose-soft",
  brass: "text-brass",
};

export function StatTile({
  label,
  value,
  sub,
  tone = "default",
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-rule-soft/60 px-3.5 py-3",
        className,
      )}
      style={{
        background:
          "linear-gradient(160deg, oklch(0.21 0.006 245 / 0.6), oklch(0.18 0.006 245 / 0.5))",
      }}
    >
      <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-paper-faint">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 font-display text-[22px] leading-none tabular-nums",
          TONE_TEXT[tone],
        )}
      >
        {value}
      </p>
      {sub && (
        <p className="mt-1 font-mono text-[10px] text-paper-faint">{sub}</p>
      )}
    </div>
  );
}
