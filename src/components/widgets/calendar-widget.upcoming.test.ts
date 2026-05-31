import { describe, it, expect } from "vitest";
import { getUpcomingEvents } from "./calendar-widget";

// Local-midnight of a fixed instant (matches the module's startOfDay()).
const NOW = new Date(2026, 5, 15, 13, 30, 0).getTime(); // 15 Jun 2026 13:30 local
function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
const SOD = startOfDay(NOW);
const DAY = 86_400_000;

function ev(overrides: Partial<{ _id: string; title: string; start: number; allDay: boolean; color: string; location: string }>) {
  return {
    _id: overrides._id ?? "id1",
    title: overrides.title ?? "t",
    start: overrides.start ?? NOW,
    allDay: overrides.allDay ?? false,
    color: overrides.color ?? "brass",
    location: overrides.location,
  } as any;
}

describe("getUpcomingEvents", () => {
  it("undefined events => []", () => {
    expect(getUpcomingEvents(undefined, NOW)).toEqual([]);
  });

  it("empty array => []", () => {
    expect(getUpcomingEvents([], NOW)).toEqual([]);
  });

  it("drops events before start-of-today, keeps today + future", () => {
    const yesterday = ev({ _id: "y", title: "yesterday", start: SOD - DAY });
    const earlierToday = ev({ _id: "e", title: "earlierToday", start: SOD + 60_000 }); // 00:01 today, before NOW
    const future = ev({ _id: "f", title: "future", start: SOD + 5 * DAY });
    const out = getUpcomingEvents([yesterday, future, earlierToday], NOW);
    expect(out.map((e) => e.title)).toEqual(["earlierToday", "future"]);
  });

  it("an all-day event earlier today (start === SOD) is KEPT (>= startOfDay)", () => {
    const allDayToday = ev({ _id: "a", title: "allday", start: SOD, allDay: true });
    const out = getUpcomingEvents([allDayToday], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("allday");
    expect(out[0].allDay).toBe(true);
  });

  it("sorts ascending by start", () => {
    const a = ev({ _id: "3", title: "c", start: SOD + 3 * DAY });
    const b = ev({ _id: "1", title: "a", start: SOD + 1 * DAY });
    const c = ev({ _id: "2", title: "b", start: SOD + 2 * DAY });
    const out = getUpcomingEvents([a, b, c], NOW);
    expect(out.map((e) => e.title)).toEqual(["a", "b", "c"]);
  });

  it("respects the limit (default 8) and slices after sorting", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      ev({ _id: `m${i}`, title: `m${i}`, start: SOD + (20 - i) * DAY }),
    );
    const out = getUpcomingEvents(many, NOW); // default limit 8
    expect(out).toHaveLength(8);
    // earliest after sort is the one with smallest start = m19 (1 day out)
    expect(out[0].title).toBe("m19");
  });

  it("custom limit honored", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      ev({ _id: `m${i}`, title: `m${i}`, start: SOD + (i + 1) * DAY }),
    );
    expect(getUpcomingEvents(many, NOW, 3)).toHaveLength(3);
  });

  it("maps to UpcomingEvent shape (id from _id, drops end/notes)", () => {
    const e = ev({ _id: "x99", title: "mapme", start: SOD + DAY, location: "HQ" });
    const [out] = getUpcomingEvents([e], NOW);
    expect(out).toEqual({
      id: "x99",
      title: "mapme",
      start: SOD + DAY,
      allDay: false,
      color: "brass",
      location: "HQ",
    });
  });

  it("EDGE: event exactly at NOW (mid-day) is kept", () => {
    const out = getUpcomingEvents([ev({ start: NOW })], NOW);
    expect(out).toHaveLength(1);
  });
});
