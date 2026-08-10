"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery } from "convex/react";
import { LayoutGrid, Settings, Bell, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "../../convex/_generated/api";
import { APPS, type AppEntry } from "@/lib/apps";
import { getAppIcon } from "@/lib/app-icons";
import { SettingsPanel } from "@/components/settings-panel";
import {
  buildSearchIndex,
  filterResults,
  groupResults,
  navigateToResult,
  type SearchResult,
} from "@/lib/search";

const DASHBOARD_LINKS: Array<{ label: string; href: string }> = [
  { label: "github", href: "https://github.com/orgs/daniels-project-space/repositories" },
  { label: "vercel", href: "https://vercel.com/danielmabro-news-projects" },
  { label: "convex", href: "https://dashboard.convex.dev/t/Daniels-Project-Space" },
  { label: "trigger", href: "https://cloud.trigger.dev/orgs/daniels-project-space-be0b/projects" },
  { label: "r2", href: "https://dash.cloudflare.com/64d5a03b934b831bb62fec6893871fd8/r2/default/buckets" },
];

type CodingProvider = "codex" | "claude";
type LocalHandoverStatus = {
  provider: CodingProvider;
  targetRuntime: "vps_codex" | "vps_claude";
  updatedAt: number;
};

type JarvisHandoverBridge = {
  getCodingProviderStatus: () => Promise<LocalHandoverStatus>;
  setCodingProvider: (provider: CodingProvider) => Promise<LocalHandoverStatus>;
};

function jarvisHandoverBridge(): JarvisHandoverBridge | null {
  if (typeof window === "undefined") return null;
  const candidate = (window as Window & { JARVIS?: Partial<JarvisHandoverBridge> }).JARVIS;
  if (
    !candidate
    || typeof candidate.getCodingProviderStatus !== "function"
    || typeof candidate.setCodingProvider !== "function"
  ) return null;
  return candidate as JarvisHandoverBridge;
}

function parseLocalHandoverStatus(value: unknown): LocalHandoverStatus | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const provider = record.provider;
  if (provider !== "codex" && provider !== "claude") return null;
  const updatedAt = typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt)
    ? Math.max(0, record.updatedAt)
    : 0;
  return {
    provider,
    targetRuntime: provider === "claude" ? "vps_claude" : "vps_codex",
    updatedAt,
  };
}

export function TopBar() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [appsOpen, setAppsOpen] = useState(false);

  return (
    <header
      className="border-b border-rule-soft/60 sticky top-0 z-20 backdrop-blur-xl bg-ink/75"
      data-jarvis-id="navigation:top-bar"
      data-jarvis-label="Project Hub top navigation"
      data-jarvis-source="src/components/top-bar.tsx"
      data-jarvis-editable
    >
      <div className="max-w-[1440px] mx-auto px-6 lg:px-10 h-14 flex items-center gap-4">
        {/* Brand */}
        <Link href="/" className="flex items-center gap-2 shrink-0">
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
        </Link>

        {/* Search */}
        <SiteSearch />

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

        {/* Right cluster */}
        <div className="flex items-center gap-1.5">
          <CodingProviderToggle />
          <div className="relative">
            <BarBtn
              icon={<LayoutGrid className="w-3.5 h-3.5" />}
              label="Apps"
              jarvisId="control:apps"
              onClick={() => setAppsOpen((v) => !v)}
              active={appsOpen}
            />
            <AppsMenu open={appsOpen} onClose={() => setAppsOpen(false)} />
          </div>
          <BarIconBtn
            aria-label="Settings"
            data-jarvis-id="control:settings"
            data-jarvis-source="src/components/top-bar.tsx"
            onClick={() => setSettingsOpen(true)}
          >
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

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </header>
  );
}

function CodingProviderToggle() {
  const [status, setStatus] = useState<LocalHandoverStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const sync = () => {
      const bridge = jarvisHandoverBridge();
      if (!bridge) {
        if (attempts < 12) {
          attempts += 1;
          retryTimer = setTimeout(sync, 250);
          return;
        }
        if (!cancelled) {
          setLoading(false);
          setError("Jarvis is still connecting");
        }
        return;
      }
      void bridge.getCodingProviderStatus()
        .then((next) => {
          const parsed = parseLocalHandoverStatus(next);
          if (!parsed) throw new Error("Jarvis returned an invalid handover status");
          if (cancelled) return;
          setStatus(parsed);
          setError(null);
          setLoading(false);
        })
        .catch(() => {
          if (cancelled) return;
          setLoading(false);
          setError("Jarvis could not load the handover target");
        });
    };
    const onJarvisReady = () => {
      attempts = 0;
      setLoading(true);
      sync();
    };
    window.addEventListener("jarvis:ready", onJarvisReady);
    sync();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      window.removeEventListener("jarvis:ready", onJarvisReady);
    };
  }, []);

  const setProvider = async (provider: CodingProvider) => {
    if (switching || status?.provider === provider) return;
    const bridge = jarvisHandoverBridge();
    if (!bridge) {
      setError("Jarvis is still connecting");
      return;
    }
    setSwitching(true);
    setError(null);
    try {
      const next = parseLocalHandoverStatus(await bridge.setCodingProvider(provider));
      if (!next) throw new Error("Jarvis returned an invalid handover status");
      setStatus(next);
    } catch {
      setError("Jarvis could not save the handover target");
    } finally {
      setSwitching(false);
    }
  };

  const unavailable = loading || !status;
  const title = error
    ?? (status
      ? `Local VPS handover target: ${status.provider === "claude" ? "Claude" : "Codex"}`
      : "Connecting to Jarvis for the local VPS handover target");

  return (
    <div
      role="group"
      aria-label="Local VPS handover provider"
      aria-busy={loading || switching}
      data-jarvis-id="control:local-handover"
      data-jarvis-label="Local VPS handover provider"
      data-jarvis-source="src/components/top-bar.tsx"
      title={title}
      className="flex h-8 items-center rounded-md border border-rule-soft/70 bg-ink-2/45 p-0.5"
    >
      <span className="hidden xl:inline px-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-paper-faint">
        Handoff
      </span>
      {(["codex", "claude"] as const).map((provider) => {
        const selected = status?.provider === provider;
        return (
          <button
            key={provider}
            type="button"
            aria-pressed={selected}
            disabled={unavailable || switching}
            onClick={() => void setProvider(provider)}
            className={cn(
              "h-6 rounded px-1.5 font-mono text-[9px] uppercase tracking-[0.13em] transition-colors disabled:cursor-not-allowed disabled:opacity-50 sm:px-2",
              selected
                ? "bg-brass/20 text-brass shadow-[inset_0_0_0_1px_rgb(232_178_90_/_0.35)]"
                : "text-paper-dim hover:bg-ink-2 hover:text-paper",
            )}
          >
            {switching && selected ? "Saving" : provider}
          </button>
        );
      })}
      <span className="sr-only" aria-live="polite">
        {error ?? (status ? `Local VPS handover target is ${status.provider}` : "Loading local VPS handover target")}
      </span>
    </div>
  );
}

// ── Site search ──────────────────────────────────────────────────────────────
function SiteSearch() {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Convex lists (fetched here; cheap, cached by Convex client).
  const projects = useQuery(api.projects.list);
  const notes = useQuery(api.notes.list);
  const todos = useQuery(api.todos.list);
  const events = useQuery(api.events.list);
  const hunts = useQuery(api.hunts.list);
  const alerts = useQuery(api.alerts.list);

  // Debounce input ~120ms.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 120);
    return () => clearTimeout(t);
  }, [q]);

  const index = useMemo(
    () =>
      buildSearchIndex({
        projects: projects as never,
        notes: notes as never,
        todos: todos as never,
        events: events as never,
        hunts: hunts as never,
        alerts: alerts as never,
      }),
    [projects, notes, todos, events, hunts, alerts],
  );

  const results = useMemo(
    () => filterResults(index, debounced).slice(0, 30),
    [index, debounced],
  );
  const grouped = useMemo(() => groupResults(results), [results]);

  // Flat list (group order) for keyboard navigation.
  const flat = useMemo(() => grouped.flatMap(([, rs]) => rs), [grouped]);

  // Clamp the highlight into range at render time (avoids a setState-in-effect):
  // when the result set shrinks/changes, fall back to the first item.
  const activeIndex = flat.length === 0 ? -1 : Math.min(active, flat.length - 1);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const choose = (r: SearchResult) => {
    navigateToResult(r);
    setOpen(false);
    setQ("");
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open || flat.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (Math.max(0, i) + 1) % flat.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (Math.max(0, i) - 1 + flat.length) % flat.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = flat[activeIndex];
      if (r) choose(r);
    }
  };

  const showDropdown = open && debounced.trim().length > 0;

  return (
    <div ref={wrapRef} className="relative hidden md:block">
      <label className="flex w-[200px] items-center gap-2 px-3 h-8 rounded-md bg-ink-2/60 border border-rule-soft/60 focus-within:border-brass/40 transition-colors">
        <Search className="w-3.5 h-3.5 text-paper-faint" />
        <input
          type="text"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => q && setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search..."
          className="bg-transparent text-[12px] text-paper placeholder:text-paper-faint outline-none w-full"
        />
      </label>

      {showDropdown && (
        <div className="absolute left-0 top-[calc(100%+6px)] w-[340px] max-h-[60vh] overflow-y-auto no-scrollbar rounded-md border border-rule-soft/70 bg-ink-2/95 backdrop-blur-xl shadow-2xl z-50">
          {results.length === 0 ? (
            <div className="px-3 py-4 font-mono text-[11px] text-paper-faint text-center">
              No results
            </div>
          ) : (
            grouped.map(([kind, rs]) => (
              <div key={kind} className="py-1">
                <div className="px-3 py-1 font-mono text-[9px] uppercase tracking-[0.22em] text-paper-faint/70">
                  {kind}
                </div>
                {rs.map((r) => {
                  const idx = flat.indexOf(r);
                  const isActive = idx === activeIndex;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => choose(r)}
                      className={cn(
                        "w-full flex items-center justify-between gap-3 px-3 py-1.5 text-left transition-colors",
                        isActive ? "bg-brass-dim" : "hover:bg-paper/[0.04]",
                      )}
                    >
                      <span
                        className={cn(
                          "text-[12px] truncate",
                          isActive ? "text-brass" : "text-paper",
                        )}
                      >
                        {r.title}
                      </span>
                      {r.sub && (
                        <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-paper-faint shrink-0">
                          {r.sub}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Apps dropdown ────────────────────────────────────────────────────────────
function AppsMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const groups: Array<{ label: string; apps: AppEntry[] }> = useMemo(
    () => [
      { label: "Live", apps: APPS.filter((a) => a.status === "live") },
      { label: "WIP", apps: APPS.filter((a) => a.status === "wip") },
      { label: "Idea", apps: APPS.filter((a) => a.status === "idea") },
    ],
    [],
  );

  if (!open) return null;

  const onPick = (a: AppEntry) => {
    if (a.status === "live" && a.vercelUrl) {
      window.open(a.vercelUrl, "_blank", "noopener,noreferrer");
    } else {
      document
        .getElementById("apps-carousel")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    onClose();
  };

  return (
    <div
      ref={ref}
      className="absolute right-0 top-[calc(100%+6px)] w-[280px] max-h-[70vh] overflow-y-auto no-scrollbar rounded-md border border-rule-soft/70 bg-ink-2/95 backdrop-blur-xl shadow-2xl z-50"
    >
      {groups.map((g) =>
        g.apps.length === 0 ? null : (
          <div key={g.label} className="py-1">
            <div className="px-3 py-1 font-mono text-[9px] uppercase tracking-[0.22em] text-paper-faint/70">
              {g.label}
            </div>
            {g.apps.map((a) => {
              const launchable = a.status === "live" && a.vercelUrl;
              return (
                <button
                  key={a.slug}
                  type="button"
                  onClick={() => onPick(a)}
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left hover:bg-paper/[0.04] transition-colors"
                >
                  <span
                    className={cn(
                      "w-4 h-4 shrink-0 grid place-items-center [&>svg]:w-4 [&>svg]:h-4",
                      launchable ? "text-brass" : "text-paper-faint",
                    )}
                  >
                    {getAppIcon(a.slug)}
                  </span>
                  <span
                    className={cn(
                      "text-[12px] truncate",
                      launchable ? "text-paper" : "text-paper-dim",
                    )}
                  >
                    {a.name}
                  </span>
                  {launchable && (
                    <span className="ml-auto font-mono text-[10px] text-paper-faint">
                      ↗
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ),
      )}
    </div>
  );
}

function BarBtn({
  icon,
  label,
  onClick,
  active,
  jarvisId,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  active?: boolean;
  jarvisId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-expanded={active}
      data-jarvis-id={jarvisId}
      data-jarvis-label={label}
      data-jarvis-source="src/components/top-bar.tsx"
      className={cn(
        "hidden sm:flex items-center gap-1.5 h-8 px-2.5 rounded-md border transition-colors",
        active
          ? "border-brass/50 bg-brass-dim text-brass"
          : "border-rule-soft/60 bg-ink-2/40 hover:bg-ink-2/70 hover:border-rule text-paper-dim hover:text-paper",
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
