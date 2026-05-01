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
    <div className="flex items-center justify-between mb-4">
      <h2 className="font-mono text-[11px] uppercase tracking-[0.32em] text-paper-faint">
        {title}
      </h2>
      <div className="flex items-center gap-3">
        {hint && (
          <p className="font-mono text-[11px] text-paper-faint">{hint}</p>
        )}
        {action}
      </div>
    </div>
  );
}
