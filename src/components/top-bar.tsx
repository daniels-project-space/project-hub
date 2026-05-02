"use client";

import { useState } from "react";
import {
  LayoutGrid,
  Settings,
  Bell,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";

const DASHBOARD_LINKS: Array<{ label: string; href: string }> = [
  { label: "github", href: "https://github.com/orgs/daniels-project-space/repositories" },
  { label: "vercel", href: "https://vercel.com/danielmabro-news-projects" },
  { label: "convex", href: "https://dashboard.convex.dev/t/Daniels-Project-Space" },
  { label: "trigger", href: "https://cloud.trigger.dev/orgs/daniels-project-space-be0b/projects" },
  { label: "r2", href: "https://dash.cloudflare.com/64d5a03b934b831bb62fec6893871fd8/r2/default/buckets" },
];

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

        {/* Search — compact */}
        <label className="hidden md:flex w-[200px] items-center gap-2 px-3 h-8 rounded-md bg-ink-2/60 border border-rule-soft/60 focus-within:border-brass/40 transition-colors">
          <Search className="w-3.5 h-3.5 text-paper-faint" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search..."
            className="bg-transparent text-[12px] text-paper placeholder:text-paper-faint outline-none w-full"
          />
        </label>

        {/* Dashboard links cluster */}
        <nav className="hidden lg:flex items-center gap-2 text-paper-faint">
          {DASHBOARD_LINKS.map((d, i) => (
            <span key={d.label} className="flex items-center gap-2">
              {i > 0 && <span className="text-paper-faint/30">·</span>}
              <a
                href={d.href}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[10px] uppercase tracking-[0.2em] hover:text-brass transition-colors"
              >
                {d.label}
              </a>
            </span>
          ))}
        </nav>

        <div className="flex-1" />

        {/* Right cluster — kept icons only */}
        <div className="flex items-center gap-1.5">
          <BarBtn icon={<LayoutGrid className="w-3.5 h-3.5" />} label="Apps" />
          <BarIconBtn aria-label="Settings">
            <Settings className="w-4 h-4" />
          </BarIconBtn>
          <BarIconBtn aria-label="Notifications">
            <Bell className="w-4 h-4" />
          </BarIconBtn>
          <a
            href="https://aria.example"
            target="_blank"
            rel="noreferrer"
            aria-label="Open ARIA"
            className="hidden lg:flex items-center gap-1 h-7 pl-0.5 pr-2 rounded-full border border-brass/30 bg-brass/[0.06] hover:bg-brass/[0.12] transition-colors"
          >
            <span className="w-5 h-5 rounded-full bg-brass/20 border border-brass/40 grid place-items-center font-display italic text-brass text-[10px]">
              A
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-soft pulse-dot" />
          </a>
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
