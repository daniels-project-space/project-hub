"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

// Lightweight modal / drawer. Side "center" = modal, "right" = drawer.
export function Sheet({
  open,
  onClose,
  title,
  children,
  side = "center",
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  side?: "center" | "right";
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const node = (
    <div
      className="fixed inset-0 z-50 flex"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="absolute inset-0 bg-ink/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={cn(
          "relative z-10 border border-rule-soft/70 shadow-2xl overflow-y-auto no-scrollbar",
          side === "center"
            ? "m-auto w-full max-w-lg max-h-[85dvh] rounded-2xl"
            : "ml-auto h-dvh w-full max-w-md rounded-l-2xl",
          className,
        )}
        style={{
          background:
            "linear-gradient(160deg, oklch(0.21 0.006 245 / 0.96), oklch(0.18 0.006 245 / 0.96))",
        }}
      >
        <div className="sticky top-0 flex items-center justify-between px-5 py-3 border-b border-rule-soft/50 bg-ink-2/80 backdrop-blur">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-brass/85">
            {title}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="close"
            className="text-paper-faint hover:text-paper transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );

  // Portal to <body>: a transformed ancestor (carousel, deferred-mount wrapper)
  // otherwise becomes the containing block for this fixed overlay and shoves it
  // out of the viewport.
  return typeof document !== "undefined" ? createPortal(node, document.body) : node;
}
