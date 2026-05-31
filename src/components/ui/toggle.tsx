"use client";

import { cn } from "@/lib/utils";

export function Toggle({
  checked,
  onChange,
  label,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors",
        checked
          ? "bg-brass/30 border-brass/50"
          : "bg-ink-3/60 border-rule-soft/70",
        className,
      )}
    >
      <span
        className={cn(
          "inline-block h-3.5 w-3.5 rounded-full transition-transform",
          checked ? "translate-x-4 bg-brass" : "translate-x-1 bg-paper-faint",
        )}
      />
    </button>
  );
}
