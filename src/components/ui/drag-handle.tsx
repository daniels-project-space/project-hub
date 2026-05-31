"use client";

import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

// Presentational drag handle. Spread dnd-kit listeners/attributes onto it.
export function DragHandle({
  className,
  ...rest
}: React.HTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label="drag to reorder"
      className={cn(
        "cursor-grab active:cursor-grabbing touch-none text-paper-faint hover:text-brass transition-colors",
        className,
      )}
      {...rest}
    >
      <GripVertical className="w-4 h-4" />
    </button>
  );
}
