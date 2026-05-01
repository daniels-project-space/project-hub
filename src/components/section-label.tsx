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
    <div className="flex items-center gap-3 mb-3">
      <span className="font-sans text-[11px] font-semibold uppercase tracking-[0.18em] text-paper-faint whitespace-nowrap">
        {title}
      </span>
      {hint && (
        <span className="font-mono text-[10px] text-paper-faint/70 tracking-[0.04em] whitespace-nowrap">
          · {hint}
        </span>
      )}
      <span className="flex-1 h-px bg-rule-soft/70" />
      {action && <span className="shrink-0">{action}</span>}
    </div>
  );
}
