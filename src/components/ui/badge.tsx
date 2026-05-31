import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "default" | "emerald" | "amber" | "rose" | "brass";

const TONE_CLASSES: Record<Tone, string> = {
  default: "border-rule-soft/70 text-paper-dim",
  emerald: "border-emerald-soft/40 text-emerald-soft bg-emerald-soft/[0.08]",
  amber: "border-amber/40 text-amber bg-amber/[0.08]",
  rose: "border-rose-soft/40 text-rose-soft bg-rose-soft/[0.08]",
  brass: "border-brass/40 text-brass bg-brass/[0.08]",
};

export function Badge({
  children,
  tone = "default",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
        "font-mono text-[9px] uppercase tracking-[0.18em]",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
