import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Card({
  children,
  className,
  ...rest
}: {
  children: ReactNode;
  className?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-xl border border-rule-soft/70 p-4",
        className,
      )}
      style={{
        background:
          "linear-gradient(160deg, oklch(0.23 0.006 245 / 0.7), oklch(0.18 0.006 245 / 0.6))",
        boxShadow: "inset 0 1px 0 oklch(1 0 0 / 0.04)",
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
