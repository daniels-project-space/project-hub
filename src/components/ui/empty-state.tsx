import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon,
  title,
  hint,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 py-10 px-4 text-center",
        className,
      )}
    >
      {icon && <div className="text-paper-faint/70">{icon}</div>}
      <p className="font-display italic text-[15px] text-paper-dim">{title}</p>
      {hint && (
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint max-w-xs">
          {hint}
        </p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
