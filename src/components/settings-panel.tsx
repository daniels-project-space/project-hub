"use client";

import { Sheet } from "@/components/ui/sheet";
import {
  useSettings,
  ACCENT_PRESETS,
} from "@/components/settings-provider";

// Settings drawer. Every control reads from useSettings() and writes via set(),
// which persists to BOTH Convex and localStorage. The accent control recolors
// the app live (SettingsProvider writes --color-brass on change).
export function SettingsPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { get, set } = useSettings();

  const tempUnit = get<"C" | "F">("tempUnit", "C");
  const blurAmounts = get<boolean>("blurAmountsDefault", false);
  const nwCurrency = get<"GBP" | "USD">("nwCurrency", "GBP");
  const accent = get<string>("accent", "brass");

  return (
    <Sheet open={open} onClose={onClose} title="Settings" side="right">
      <div className="flex flex-col gap-6">
        {/* 1 — Temperature units */}
        <Row
          label="Temperature units"
          hint="Used by the weather widget."
        >
          <SegmentToggle
            options={[
              { value: "C", label: "°C" },
              { value: "F", label: "°F" },
            ]}
            value={tempUnit}
            onChange={(v) => set("tempUnit", v)}
          />
        </Row>

        {/* 2 — Blur amounts by default */}
        <Row
          label="Blur amounts by default"
          hint="Hide monetary values until revealed."
        >
          <Switch
            checked={blurAmounts}
            onChange={(v) => set("blurAmountsDefault", v)}
            ariaLabel="Blur amounts by default"
          />
        </Row>

        {/* 3 — Net worth currency */}
        <Row
          label="Net worth currency"
          hint="Display currency for wealth totals."
        >
          <SegmentToggle
            options={[
              { value: "GBP", label: "GBP" },
              { value: "USD", label: "USD" },
            ]}
            value={nwCurrency}
            onChange={(v) => set("nwCurrency", v)}
          />
        </Row>

        {/* 4 — Accent color (LIVE) */}
        <Row
          label="Accent color"
          hint="Recolors the interface instantly."
        >
          <div className="flex items-center gap-2">
            {Object.entries(ACCENT_PRESETS).map(([key, hex]) => {
              const active = accent === key;
              return (
                <button
                  key={key}
                  type="button"
                  aria-label={`accent ${key}`}
                  aria-pressed={active}
                  onClick={() => set("accent", key)}
                  className={`w-6 h-6 rounded-full transition-transform ${
                    active
                      ? "ring-2 ring-offset-2 ring-offset-ink scale-110"
                      : "hover:scale-105 ring-1 ring-rule-soft/60"
                  }`}
                  style={{
                    background: hex,
                    ...(active ? { boxShadow: `0 0 0 2px ${hex}` } : {}),
                  }}
                />
              );
            })}
          </div>
        </Row>

        {/* 5 — Resources */}
        <div className="flex flex-col gap-2 border-t border-rule-soft/40 pt-5">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-paper-faint">
            Resources
          </span>
          <a
            href="/handbook.pdf"
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center justify-between gap-3 rounded-md border border-rule-soft/60 bg-paper/[0.025] hover:bg-paper/[0.05] hover:border-paper/[0.14] transition-colors px-3 py-2.5"
          >
            <span className="flex flex-col leading-tight">
              <span className="font-sans text-[13px] text-paper">
                Project Handbook
              </span>
              <span className="font-mono text-[10px] text-paper-faint mt-0.5">
                Project infrastructure · PDF
              </span>
            </span>
            <span className="font-mono text-[11px] text-paper-faint group-hover:text-paper transition-colors">
              ↗
            </span>
          </a>
        </div>
      </div>
    </Sheet>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col">
        <span className="font-sans text-[13px] text-paper">{label}</span>
        {hint && (
          <span className="font-mono text-[10px] text-paper-faint mt-0.5">
            {hint}
          </span>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function SegmentToggle<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-rule-soft/60 bg-ink-2/40 p-0.5">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={`px-2.5 py-1 rounded font-mono text-[11px] uppercase tracking-[0.12em] transition-colors ${
              active
                ? "bg-brass-dim text-brass"
                : "text-paper-faint hover:text-paper"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function Switch({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-5 rounded-full transition-colors ${
        checked ? "bg-brass/70" : "bg-ink-3/80 border border-rule-soft/60"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-paper transition-transform ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}
