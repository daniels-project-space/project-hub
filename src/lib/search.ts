// Client-side site search index + navigation for the top-bar.
// Indexes APPS, widget types (WIDGET_META), and Convex lists (projects, notes,
// todos, events, hunts, alerts). Pure helpers — the top bar feeds Convex data in.

import { APPS, type AppEntry } from "@/lib/apps";
import { WIDGET_META } from "@/components/widget-meta";

export type SearchKind =
  | "App"
  | "Widget"
  | "Project"
  | "Note"
  | "Todo"
  | "Event"
  | "Hunt"
  | "Alert";

export type SearchResult = {
  id: string; // unique within a result set
  kind: SearchKind;
  title: string;
  sub?: string; // secondary line (status / description)
  // Navigation payload — interpreted by `navigateToResult`.
  url?: string; // App → open in new tab
  widgetType?: string; // Widget → scroll to w-${type}
  scrollWidget?: string; // owning widget id target (e.g. "projects" → w-projects)
  appSlug?: string;
};

// Display order of groups in the dropdown.
export const KIND_ORDER: SearchKind[] = [
  "App",
  "Widget",
  "Project",
  "Note",
  "Todo",
  "Event",
  "Hunt",
  "Alert",
];

// Convex list row shapes we read (only the fields we index/title with).
type ConvexLists = {
  projects?: Array<{ _id: string; name?: string; slug?: string; status?: string }>;
  notes?: Array<{ _id: string; text?: string }>;
  todos?: Array<{ _id: string; text?: string; done?: boolean }>;
  events?: Array<{ _id: string; title?: string }>;
  hunts?: Array<{ _id: string; query?: string }>;
  alerts?: Array<{ _id: string; symbol?: string; kind?: string; threshold?: number }>;
};

function appResult(a: AppEntry): SearchResult {
  return {
    id: `app-${a.slug}`,
    kind: "App",
    title: a.name,
    sub: a.status === "live" ? "live" : a.status,
    url: a.vercelUrl,
    appSlug: a.slug,
  };
}

// Build the full index. `lists` is optional (Convex may still be loading).
export function buildSearchIndex(lists: ConvexLists = {}): SearchResult[] {
  const out: SearchResult[] = [];

  // Apps
  for (const a of APPS) out.push(appResult(a));

  // Widgets (from WIDGET_META labels)
  for (const [type, meta] of Object.entries(WIDGET_META)) {
    out.push({
      id: `widget-${type}`,
      kind: "Widget",
      title: meta.label,
      sub: "widget",
      widgetType: type,
    });
  }

  // Projects → scroll to projects widget
  for (const p of lists.projects ?? []) {
    out.push({
      id: `project-${p._id}`,
      kind: "Project",
      title: p.name ?? p.slug ?? "Project",
      sub: p.status,
      scrollWidget: "projects",
    });
  }

  // Notes → scroll to notes widget
  for (const n of lists.notes ?? []) {
    const t = (n.text ?? "").trim();
    if (!t) continue;
    out.push({
      id: `note-${n._id}`,
      kind: "Note",
      title: t.length > 60 ? `${t.slice(0, 60)}…` : t,
      sub: "note",
      scrollWidget: "notes",
    });
  }

  // Todos → scroll to todo widget
  for (const t of lists.todos ?? []) {
    const text = (t.text ?? "").trim();
    if (!text) continue;
    out.push({
      id: `todo-${t._id}`,
      kind: "Todo",
      title: text.length > 60 ? `${text.slice(0, 60)}…` : text,
      sub: t.done ? "done" : "open",
      scrollWidget: "todo",
    });
  }

  // Events → scroll to calendar widget
  for (const e of lists.events ?? []) {
    const title = (e.title ?? "").trim();
    if (!title) continue;
    out.push({
      id: `event-${e._id}`,
      kind: "Event",
      title,
      sub: "event",
      scrollWidget: "calendar",
    });
  }

  // Hunts → scroll to hunts widget
  for (const h of lists.hunts ?? []) {
    const q = (h.query ?? "").trim();
    if (!q) continue;
    out.push({
      id: `hunt-${h._id}`,
      kind: "Hunt",
      title: q.length > 60 ? `${q.slice(0, 60)}…` : q,
      sub: "hunt",
      scrollWidget: "hunts",
    });
  }

  // Alerts → scroll to hunts widget (decoupled Hunts·Alerts lives there)
  for (const a of lists.alerts ?? []) {
    if (!a.symbol) continue;
    out.push({
      id: `alert-${a._id}`,
      kind: "Alert",
      title: `${a.symbol} ${a.kind ?? ""} ${a.threshold ?? ""}`.trim(),
      sub: "alert",
      scrollWidget: "hunts",
    });
  }

  return out;
}

// Case-insensitive substring match across title + sub.
export function filterResults(
  index: SearchResult[],
  rawQuery: string,
): SearchResult[] {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return [];
  return index.filter((r) => {
    const hay = `${r.title} ${r.sub ?? ""} ${r.appSlug ?? ""} ${
      r.widgetType ?? ""
    }`.toLowerCase();
    return hay.includes(q);
  });
}

// Group results by kind preserving KIND_ORDER. Returns [kind, results][].
export function groupResults(
  results: SearchResult[],
): Array<[SearchKind, SearchResult[]]> {
  const map = new Map<SearchKind, SearchResult[]>();
  for (const r of results) {
    const arr = map.get(r.kind) ?? [];
    arr.push(r);
    map.set(r.kind, arr);
  }
  return KIND_ORDER.filter((k) => map.has(k)).map((k) => [k, map.get(k)!]);
}

// Execute navigation for a chosen result. Returns true if it handled it.
export function navigateToResult(r: SearchResult): void {
  // App → open vercelUrl in a new tab if present, else scroll to carousel.
  if (r.kind === "App") {
    if (r.url) {
      window.open(r.url, "_blank", "noopener,noreferrer");
    } else {
      document
        .getElementById("apps-carousel")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    return;
  }

  // Widget → smooth-scroll to that widget by id.
  const targetType = r.widgetType ?? r.scrollWidget;
  if (targetType) {
    document
      .getElementById(`w-${targetType}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}
