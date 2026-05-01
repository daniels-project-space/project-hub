"use client";

import { useState } from "react";
import {
  LayoutGrid,
  Pencil,
  Settings,
  Bell,
  Zap,
  Search,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function TopBar() {
  const [q, setQ] = useState("");

  return (
    <header className="border-b border-rule-soft/60 sticky top-0 z-20 backdrop-blur-xl bg-ink/75">
      <div className="max-w-[1440px] mx-auto px-6 lg:px-10 h-14 flex items-center gap-4">
        {/* Brand */}
        <a href="/" className="flex items-center gap-2 shrink-0">
          <span
            className="w-6 h-6 rounded-md grid place-items-center text-brass"
            style={{
              background:
                "linear-gradient(160deg, oklch(0.23 0.006 245 / 0.95), oklch(0.18 0.006 245 / 0.9))",
              border: "1px solid oklch(0.32 0.006 245 / 0.7)",
              boxShadow: "inset 0 1px 0 oklch(1 0 0 / 0.06)",
            }}
          >
            <svg
              viewBox="0 0 24 24"
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
          </span>
          <span className="font-display text-[15px] tracking-tight text-paper">
            Project Hub
          </span>
        </a>

        {/* Search */}
        <label className="hidden md:flex flex-1 max-w-md items-center gap-2 px-3 h-8 rounded-md bg-ink-2/60 border border-rule-soft/60 focus-within:border-brass/40 transition-colors">
          <Search className="w-3.5 h-3.5 text-paper-faint" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search projects..."
            className="bg-transparent text-[12px] text-paper placeholder:text-paper-faint outline-none w-full"
          />
        </label>

        <div className="flex-1 md:hidden" />

        {/* Right cluster */}
        <div className="flex items-center gap-1.5">
          <BarBtn icon={<LayoutGrid className="w-3.5 h-3.5" />} label="Apps" />
          <BarBtn icon={<Pencil className="w-3.5 h-3.5" />} label="Edit" />
          <BarIconBtn aria-label="Settings">
            <Settings className="w-4 h-4" />
          </BarIconBtn>
          <BarIconBtn aria-label="Notifications">
            <Bell className="w-4 h-4" />
          </BarIconBtn>
          <button
            type="button"
            aria-label="Autopilot"
            className="hidden lg:flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-rule-soft/60 bg-ink-2/40 hover:border-brass/40 text-paper-dim hover:text-brass transition-colors"
          >
            <Zap className="w-3.5 h-3.5" />
            <span className="font-mono text-[10px] uppercase tracking-[0.2em]">
              Autopilot
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-paper-faint/60" />
          </button>
          <a
            href="https://aria.example"
            target="_blank"
            rel="noreferrer"
            className="hidden lg:flex items-center gap-2 h-8 pl-1 pr-3 rounded-full border border-brass/30 bg-brass/[0.06] hover:bg-brass/[0.12] transition-colors"
          >
            <span className="w-6 h-6 rounded-full bg-brass/20 border border-brass/40 grid place-items-center font-display italic text-brass text-[11px]">
              A
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-brass">
              ARIA
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-soft pulse-dot" />
          </a>
          <button
            type="button"
            className="flex items-center gap-1.5 h-8 px-2.5 rounded-md bg-brass/[0.12] border border-brass/40 text-brass hover:bg-brass/[0.18] transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="font-mono text-[10px] uppercase tracking-[0.22em]">
              New
            </span>
          </button>
        </div>
      </div>
    </header>
  );
}

function BarBtn({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      className={cn(
        "hidden sm:flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-rule-soft/60",
        "bg-ink-2/40 hover:bg-ink-2/70 hover:border-rule transition-colors",
        "text-paper-dim hover:text-paper",
      )}
    >
      {icon}
      <span className="font-mono text-[10px] uppercase tracking-[0.2em]">
        {label}
      </span>
    </button>
  );
}

function BarIconBtn({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className="w-8 h-8 grid place-items-center rounded-md text-paper-dim hover:text-paper hover:bg-ink-2/60 transition-colors"
    >
      {children}
    </button>
  );
}
