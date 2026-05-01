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
        "border border-rule-soft/60 rounded-2xl overflow-hidden backdrop-blur-sm",
        SIZE_CLASSES[size],
      )}
      style={{
        background:
          "linear-gradient(160deg, oklch(0.21 0.006 245 / 0.6), oklch(0.18 0.006 245 / 0.5))",
        boxShadow:
          "0 8px 32px -8px rgba(0,0,0,0.5), inset 0 1px 0 oklch(1 0 0 / 0.04)",
      }}
    >
      <div className="px-5 py-3 flex items-center justify-between border-b border-rule-soft/50">
        <div className="flex items-center gap-2">
          {status && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-soft pulse-dot" />
          )}
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-brass/85">
            {label}
          </span>
          {status && (
            <>
              <span className="text-paper-faint/60">·</span>
              <span className="font-mono text-[10px] text-paper-faint">
                {status}
              </span>
            </>
          )}
        </div>
        {action}
      </div>
      <div className="bg-ink/40">{children}</div>
    </div>
  );
}
