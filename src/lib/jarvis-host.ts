const WIDGET_TARGETS: Array<{
  type: string;
  aliases: string[];
}> = [
  { type: "notes", aliases: ["notes", "note"] },
  { type: "calendar", aliases: ["calendar", "schedule"] },
  { type: "todo", aliases: ["todo", "to do", "tasks", "task list"] },
  { type: "wealth", aliases: ["wealth", "net worth", "finances"] },
  { type: "projects", aliases: ["projects", "portfolio", "apps"] },
  { type: "expenses", aliases: ["expenses", "costs"] },
  { type: "hunts", aliases: ["hunts", "alerts", "price alerts"] },
  { type: "idea", aliases: ["idea", "ideas", "daily idea"] },
  { type: "channelIdea", aliases: ["channel idea", "channel ideas", "youtube ideas"] },
  { type: "remoteWorkHub", aliases: ["remote work", "remote work hub", "workers", "agents"] },
  { type: "travel", aliases: ["travel", "trips", "trip planner"] },
  { type: "music", aliases: ["music", "songs", "ai music income"] },
];

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Resolve both model-friendly labels and canonical widget keys. */
export function resolveJarvisWidgetTarget(target: string): string | null {
  const wanted = normalize(target);
  if (!wanted) return null;
  const exact = WIDGET_TARGETS.find(({ type }) => normalize(type) === wanted);
  if (exact) return exact.type;

  // Prefer the most specific phrase: "channel idea" must not collapse to the
  // shorter generic "idea" widget.
  let match: { type: string; length: number } | null = null;
  for (const { type, aliases } of WIDGET_TARGETS) {
    for (const alias of aliases) {
      const normalized = normalize(alias);
      if (wanted.includes(normalized) && normalized.length > (match?.length ?? 0)) {
        match = { type, length: normalized.length };
      }
    }
  }
  return match?.type ?? null;
}
