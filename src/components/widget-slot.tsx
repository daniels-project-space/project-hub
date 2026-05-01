import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type WidgetSize = "small" | "medium" | "wide" | "full";

const SIZE_CLASSES: Record<WidgetSize, string> = {
  small: "col-span-1",
  medium: "col-span-1 md:col-span-2",
  wide: "col-span-1 md:col-span-3",
  full: "col-span-1 md:col-span-4",
};

export function WidgetSlot({
  size = "full",
  label,
  status,
  action,
  children,
}: {
  size?: WidgetSize;
  label: string;
  status?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "bg-ink-2/40 border border-rule-soft/60 rounded-lg overflow-hidden shadow-2xl",
        SIZE_CLASSES[size],
      )}
    >
      <div className="px-5 py-3 flex items-center justify-between border-b border-rule-soft/60 bg-ink-2/70">
        <div className="flex items-center gap-2">
          {status && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-soft pulse-dot" />
          )}
          <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-amber/80">
            {label}
          </span>
          {status && (
            <>
              <span className="text-paper-faint">·</span>
              <span className="font-mono text-[10px] text-paper-faint">
                {status}
              </span>
            </>
          )}
        </div>
        {action}
      </div>
      <div className="bg-ink">{children}</div>
    </div>
  );
}
