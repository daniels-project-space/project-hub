import type { ReactNode } from "react";

export function SectionLabel({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex min-w-0 items-center gap-3">
      <span className="shrink-0 whitespace-nowrap font-sans text-[11px] font-semibold uppercase tracking-[0.18em] text-paper-faint">
        {title}
      </span>
      {hint && (
        <span className="hidden min-w-0 truncate whitespace-nowrap font-mono text-[10px] tracking-[0.04em] text-paper-faint/70 md:inline">
          · {hint}
        </span>
      )}
      <span className="h-px min-w-3 flex-1 bg-rule-soft/70" />
      {action && <span className="shrink-0">{action}</span>}
    </div>
  );
}
