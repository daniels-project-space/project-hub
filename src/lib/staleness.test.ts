import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ageMs,
  stalenessTone,
  agoLabel,
  gbp,
  pct,
  FRESH_MS,
  STALE_MS,
} from "./staleness";

const NOW = 1_700_000_000_000; // fixed clock

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("ageMs", () => {
  it("returns null for null/undefined", () => {
    expect(ageMs(null)).toBeNull();
    expect(ageMs(undefined)).toBeNull();
  });
  it("returns elapsed ms for a past timestamp", () => {
    expect(ageMs(NOW - 5000)).toBe(5000);
  });
  it("returns 0 at exactly now", () => {
    expect(ageMs(NOW)).toBe(0);
  });
});

describe("stalenessTone thresholds (15m fresh, 1h stale)", () => {
  it("null pricedAt => rose (never priced)", () => {
    expect(stalenessTone(null)).toBe("rose");
    expect(stalenessTone(undefined)).toBe("rose");
  });
  it("age 0 => emerald", () => {
    expect(stalenessTone(NOW)).toBe("emerald");
  });
  it("just under 15m => emerald", () => {
    expect(stalenessTone(NOW - (FRESH_MS - 1))).toBe("emerald");
  });
  it("exactly 15m => amber (boundary is < FRESH_MS for emerald)", () => {
    expect(stalenessTone(NOW - FRESH_MS)).toBe("amber");
  });
  it("just under 1h => amber", () => {
    expect(stalenessTone(NOW - (STALE_MS - 1))).toBe("amber");
  });
  it("exactly 1h => rose (boundary is < STALE_MS for amber)", () => {
    expect(stalenessTone(NOW - STALE_MS)).toBe("rose");
  });
  it("well over 1h => rose", () => {
    expect(stalenessTone(NOW - 5 * STALE_MS)).toBe("rose");
  });
});

describe("agoLabel boundaries", () => {
  it("null => 'never'", () => {
    expect(agoLabel(null)).toBe("never");
  });
  it("seconds boundary: 59s vs 60s", () => {
    expect(agoLabel(NOW - 59_000)).toBe("59s ago");
    expect(agoLabel(NOW - 60_000)).toBe("1m ago");
  });
  it("minutes boundary: 59m vs 60m", () => {
    expect(agoLabel(NOW - 59 * 60_000)).toBe("59m ago");
    expect(agoLabel(NOW - 60 * 60_000)).toBe("1h ago");
  });
  it("hours boundary: 23h vs 24h", () => {
    expect(agoLabel(NOW - 23 * 3_600_000)).toBe("23h ago");
    expect(agoLabel(NOW - 24 * 3_600_000)).toBe("1d ago");
  });
  it("days: floors correctly", () => {
    expect(agoLabel(NOW - 50 * 3_600_000)).toBe("2d ago"); // 50h => 2d
  });
  it("0s ago at now", () => {
    expect(agoLabel(NOW)).toBe("0s ago");
  });
});

describe("gbp privacy masking + formatting", () => {
  it("hidden=true masks regardless of value", () => {
    expect(gbp(123456, true)).toBe("••••••");
    expect(gbp(null, true)).toBe("••••••");
  });
  it("null/undefined => £0.00", () => {
    expect(gbp(null)).toBe("£0.00");
    expect(gbp(undefined)).toBe("£0.00");
  });
  it("under 1000 keeps 2 decimals", () => {
    expect(gbp(12.5)).toBe("£12.50");
  });
  it(">=1000 drops decimals", () => {
    // en-GB groups thousands with comma
    expect(gbp(1500)).toBe("£1,500");
  });
  it("negative values format with sign", () => {
    expect(gbp(-5)).toBe("-£5.00");
  });
});

describe("pct", () => {
  it("zero whole => '0%' (no NaN/division-by-zero)", () => {
    expect(pct(5, 0)).toBe("0%");
  });
  it("rounds to nearest integer percent", () => {
    expect(pct(1, 3)).toBe("33%");
    expect(pct(2, 3)).toBe("67%");
  });
  it("100% and 0 part", () => {
    expect(pct(50, 50)).toBe("100%");
    expect(pct(0, 50)).toBe("0%");
  });
});
