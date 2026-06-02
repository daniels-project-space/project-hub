"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

// ── SETTINGS CONTRACT (Pass 1) ───────────────────────────────────────────────
// Exact keys + defaults. Pass 2 reads tempUnit / blurAmountsDefault / nwCurrency.
export const SETTINGS_DEFAULTS = {
  tempUnit: "C" as "C" | "F",
  blurAmountsDefault: false as boolean,
  nwCurrency: "GBP" as "GBP" | "USD",
  accent: "brass" as string, // preset key: brass | pink | cyan | violet | emerald
};

export type SettingsValues = Record<string, unknown>;

// Accent presets → hex. `accent` setting stores the preset KEY; we resolve to
// this hex and write it onto --color-brass so every brass-tinted element recolors
// live. brass hex ≈ the existing oklch(0.78 0.08 65) warm tone (#d4a574 lineage).
export const ACCENT_PRESETS: Record<string, string> = {
  brass: "#d4a574",
  pink: "#ec4899",
  cyan: "#06b6d4",
  violet: "#8b5cf6",
  emerald: "#34d399",
};

const LS_KEY = "hub-settings";

function readLocal(): SettingsValues {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as SettingsValues) : {};
  } catch {
    return {};
  }
}

function writeLocal(values: SettingsValues) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(values));
  } catch {
    /* ignore quota / disabled storage */
  }
}

// Apply the chosen accent preset to the document so the whole app recolors.
function applyAccent(accent: unknown) {
  if (typeof document === "undefined") return;
  const key = typeof accent === "string" ? accent : "brass";
  const hex = ACCENT_PRESETS[key] ?? ACCENT_PRESETS.brass;
  const root = document.documentElement;
  if (key === "brass") {
    // Default → drop the override so the globals.css @theme value wins.
    root.style.removeProperty("--color-brass");
    root.style.removeProperty("--color-brass-dim");
  } else {
    root.style.setProperty("--color-brass", hex);
    // brass-dim is the same accent at low alpha (used for chips/active states).
    root.style.setProperty("--color-brass-dim", `${hex}24`);
  }
}

type SettingsContextValue = {
  values: SettingsValues;
  get: <T>(key: string, fallback: T) => T;
  set: (key: string, value: unknown) => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const remote = useQuery(api.settings.all);
  const setRemote = useMutation(api.settings.set);

  // Seed from localStorage for instant paint before Convex resolves.
  const [local, setLocal] = useState<SettingsValues>(() => readLocal());

  // Merge order: defaults < remote (Convex truth) < local optimistic.
  // Once remote resolves it becomes authoritative, but the user's just-made
  // optimistic local writes still win until the round-trip lands.
  const values = useMemo<SettingsValues>(
    () => ({ ...SETTINGS_DEFAULTS, ...(remote ?? {}), ...local }),
    [remote, local],
  );

  // Mirror resolved Convex truth into localStorage so the next cold paint is
  // already correct (without clobbering pending local writes we just keep both).
  useEffect(() => {
    if (remote === undefined) return;
    const merged = { ...remote, ...local };
    writeLocal(merged);
  }, [remote, local]);

  // Apply accent on load + whenever it changes.
  const accent = values.accent;
  useEffect(() => {
    applyAccent(accent);
  }, [accent]);

  const set = useCallback(
    (key: string, value: unknown) => {
      // 1) optimistic local + localStorage immediately
      setLocal((prev) => {
        const next = { ...prev, [key]: value };
        writeLocal({ ...SETTINGS_DEFAULTS, ...(remote ?? {}), ...next });
        return next;
      });
      // 2) persist to Convex (fire-and-forget; errors are non-fatal for UI)
      void setRemote({ key, value });
    },
    [setRemote, remote],
  );

  const get = useCallback(
    <T,>(key: string, fallback: T): T => {
      const v = values[key];
      return (v === undefined ? fallback : v) as T;
    },
    [values],
  );

  const ctx = useMemo<SettingsContextValue>(
    () => ({ values, get, set }),
    [values, get, set],
  );

  return (
    <SettingsContext.Provider value={ctx}>{children}</SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return ctx;
}
