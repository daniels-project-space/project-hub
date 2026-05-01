import type { ReactNode } from "react";

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const ICONS: Record<string, ReactNode> = {
  // Platform / agents
  "remote-work-hub": (
    <svg viewBox="0 0 24 24" {...stroke}>
      <circle cx="12" cy="12" r="2.5" />
      <path d="M12 4v3.5M12 16.5V20M4 12h3.5M16.5 12H20M6.3 6.3l2.5 2.5M15.2 15.2l2.5 2.5M17.7 6.3l-2.5 2.5M8.8 15.2l-2.5 2.5" />
    </svg>
  ),
  "project-hub": (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M3 6h7v6H3zM14 6h7v4h-7zM14 14h7v4h-7zM3 16h7v2H3z" />
    </svg>
  ),
  "rental-manager": (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M4 9l8-6 8 6v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <path d="M9 22V12h6v10" />
    </svg>
  ),
  "app-factory": (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M2 20h20V10l-5 3V10l-5 3V10l-5 3V6H2z" />
      <path d="M6 20v-4M10 20v-4M14 20v-4M18 20v-4" />
    </svg>
  ),
  autostudio: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <rect x="2" y="6" width="14" height="12" rx="2" />
      <path d="M16 10l5-3v10l-5-3z" />
    </svg>
  ),
  aria: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
    </svg>
  ),
  "lofi-generator": (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  ),
  "ai-instagram": (
    <svg viewBox="0 0 24 24" {...stroke}>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  ),
  "caption-ai": (
    <svg viewBox="0 0 24 24" {...stroke}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
      <path d="M14 21h7v-7" />
    </svg>
  ),
  "marketing-agent": (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  ),
  "finance-engine": (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  ),
  "ai-music-empire": (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  ),
  "the-council": (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M3 21V10l9-6 9 6v11" />
      <path d="M3 21h18" />
      <path d="M9 21v-7M15 21v-7M12 14V8" />
    </svg>
  ),
  storyforge: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5V4.5A2.5 2.5 0 0 1 6.5 2z" />
      <path d="M9 7h7M9 11h7" />
    </svg>
  ),
  "db-cinema": (
    <svg viewBox="0 0 24 24" {...stroke}>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M2 8h20" />
      <circle cx="12" cy="14" r="3" />
    </svg>
  ),
  "factory-2": (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M2 20h20V10l-6 3.5V10l-6 3.5V10l-6 3.5z" />
      <circle cx="6" cy="6" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  ),
};

const fallback = (
  <svg viewBox="0 0 24 24" {...stroke}>
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <path d="M9 9h6v6H9z" />
  </svg>
);

export function getAppIcon(slug: string): ReactNode {
  return ICONS[slug] ?? fallback;
}
