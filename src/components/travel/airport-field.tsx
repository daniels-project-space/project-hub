"use client";

/**
 * AirportField — type a city / country / airport and pick from a dropdown; the
 * selected airport's IATA code is reported via onChange. Backed by the bundled
 * OpenFlights dataset (searchAirports), debounced. Once chosen, shows a compact
 * chip ("LHR · London") with a clear button; clearing returns to the input.
 */

import { useEffect, useRef, useState } from "react";
import { Plane, X, Loader2 } from "lucide-react";
import { searchAirports, type Airport } from "@/lib/travel/airports";

export function AirportField({
  value,
  label,
  onChange,
  placeholder,
}: {
  /** Selected IATA code (controlled). */
  value: string;
  /** Display label for the current value (e.g. "LHR · London"), if known. */
  label?: string;
  /** Reports the chosen IATA code + a display label. Empty string = cleared. */
  onChange: (iata: string, label: string) => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Airport[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement | null>(null);

  // Debounced search.
  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      const r = await searchAirports(q, 8);
      if (!cancelled) {
        setResults(r);
        setActive(0);
        setOpen(true);
        setLoading(false);
      }
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  // Close on outside click.
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const pick = (a: Airport) => {
    onChange(a.iata, `${a.iata} · ${a.city}`);
    setQ("");
    setResults([]);
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(results[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const inputCls =
    "w-full rounded-lg border border-rule-soft/60 bg-ink-2/40 px-2.5 py-1.5 text-[12px] text-paper placeholder:text-paper-faint/60 focus:border-brass/60 focus:outline-none";

  // Selected → chip with clear.
  if (value) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg border border-brass/40 bg-brass/10 px-2.5 py-1.5 text-[12px] text-paper">
        <Plane className="h-3 w-3 shrink-0 text-brass/80" />
        <span className="min-w-0 flex-1 truncate">{label || value}</span>
        <button
          type="button"
          aria-label="clear airport"
          onClick={() => onChange("", "")}
          className="shrink-0 text-paper-faint hover:text-paper"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKey}
        onFocus={() => results.length > 0 && setOpen(true)}
        placeholder={placeholder ?? "City, country or airport"}
        className={inputCls}
        autoComplete="off"
      />
      {loading && (
        <Loader2 className="absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 animate-spin text-paper-faint" />
      )}
      {open && results.length > 0 && (
        <ul className="absolute z-40 mt-1 max-h-60 w-[min(20rem,80vw)] overflow-auto rounded-lg border border-rule-soft/60 bg-ink-2 shadow-xl">
          {results.map((a, i) => (
            <li key={`${a.iata}-${i}`}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(a)}
                className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] transition-colors ${
                  i === active ? "bg-brass/15" : "hover:bg-paper/[0.04]"
                }`}
              >
                <span className="shrink-0 rounded bg-brass/15 px-1.5 py-0.5 font-mono text-[10px] text-brass">
                  {a.iata}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-paper">{a.city}, {a.country}</span>
                  <span className="block truncate text-[10px] text-paper-faint">{a.name}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default AirportField;
