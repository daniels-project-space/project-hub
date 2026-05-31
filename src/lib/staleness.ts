// Staleness helpers for the Wealth widget (and any future live-data widget).
// v1's #1 sin was showing stale numbers as if fresh — these make age explicit.

export type Tone = "default" | "emerald" | "amber" | "rose" | "brass";

// Thresholds (ms). <15m = fresh, <1h = aging (amber), >=1h = stale (rose).
export const FRESH_MS = 15 * 60 * 1000;
export const STALE_MS = 60 * 60 * 1000;

export function ageMs(pricedAt: number | null | undefined): number | null {
  if (pricedAt == null) return null;
  return Date.now() - pricedAt;
}

export function stalenessTone(pricedAt: number | null | undefined): Tone {
  const age = ageMs(pricedAt);
  if (age == null) return "rose"; // never priced
  if (age < FRESH_MS) return "emerald";
  if (age < STALE_MS) return "amber";
  return "rose";
}

export function agoLabel(pricedAt: number | null | undefined): string {
  const age = ageMs(pricedAt);
  if (age == null) return "never";
  const s = Math.floor(age / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function gbp(n: number | null | undefined, hidden = false): string {
  if (hidden) return "••••••";
  const v = n ?? 0;
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: v >= 1000 ? 0 : 2,
  }).format(v);
}

export function pct(part: number, whole: number): string {
  if (!whole) return "0%";
  return `${Math.round((part / whole) * 100)}%`;
}
