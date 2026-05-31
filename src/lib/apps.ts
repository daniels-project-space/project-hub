// Known apps catalog. Single source of truth — populated as apps migrate to
// Vercel / are wired up. Status drives visual treatment in the dock.

export type AppStatus = "live" | "wip" | "idea";

export type AppEntry = {
  slug: string;
  name: string;
  short: string; // 1-2 letter monogram
  description: string;
  status: AppStatus;
  vercelUrl?: string;
  githubUrl?: string;
  category: "platform" | "creator" | "ops" | "ai" | "experiment";
};

export const APPS: AppEntry[] = [
  // Live / deployed
  {
    slug: "remote-work-hub",
    name: "Remote Work Hub",
    short: "RW",
    description: "Cloud Claude Code agents per project.",
    status: "live",
    vercelUrl: "https://remote-work-hub-sepia.vercel.app",
    githubUrl: "https://github.com/daniels-project-space/remote-work-hub",
    category: "platform",
  },
  {
    slug: "project-hub",
    name: "Project Hub",
    short: "PH",
    description: "This dashboard. Umbrella for all apps.",
    status: "live",
    vercelUrl: "https://project-hub-olive-pi.vercel.app",
    githubUrl: "https://github.com/daniels-project-space/project-hub",
    category: "platform",
  },

  {
    slug: "rental-manager-v2",
    name: "Rental Manager",
    short: "RM",
    description: "Hygglo rental ops dashboard — DB Cinema + Leo Adams.",
    status: "live",
    vercelUrl: "https://rental-manager-v2-nu.vercel.app",
    githubUrl: "https://github.com/daniels-project-space/rental-manager-v2",
    category: "ops",
  },
  {
    slug: "app-factory",
    name: "App Factory",
    short: "AF",
    description: "Autonomous React Native pipeline.",
    status: "wip",
    category: "platform",
  },
  {
    slug: "autostudio",
    name: "AutoStudio",
    short: "AS",
    description: "Video pipeline.",
    status: "wip",
    category: "creator",
  },
  {
    slug: "aria",
    name: "ARIA",
    short: "Aⓡ",
    description: "Personal assistant + finance ledger.",
    status: "wip",
    category: "ai",
  },
  {
    slug: "lofi-generator",
    name: "Lofi Pipeline",
    short: "LF",
    description: "Locked music YouTube pipeline.",
    status: "wip",
    category: "creator",
  },
  {
    slug: "ai-instagram",
    name: "AI Instagram",
    short: "IG",
    description: "Instagram automation.",
    status: "wip",
    category: "creator",
  },
  {
    slug: "caption-ai",
    name: "CaptionAI",
    short: "CA",
    description: "Caption generation.",
    status: "wip",
    category: "ai",
  },
  {
    slug: "marketing-agent",
    name: "Marketing Agent",
    short: "MA",
    description: "Outreach + content workflows.",
    status: "wip",
    category: "ops",
  },
  {
    slug: "finance-engine",
    name: "Finance Engine",
    short: "FE",
    description: "Net worth + portfolio.",
    status: "wip",
    category: "ops",
  },
  {
    slug: "music-house",
    name: "Music House",
    short: "MH",
    description: "AI music label. Suno + Mureka generation, catalog, lyrics.",
    status: "live",
    vercelUrl: "https://music-house-nine.vercel.app",
    githubUrl: "https://github.com/daniels-project-space/music-house",
    category: "creator",
  },
  {
    slug: "youtube-studio-ai",
    name: "YouTube Studio AI",
    short: "YS",
    description: "Modular AI YouTube video factory — block-based pipeline (Convex + Mastra + Trigger + R2 + Higgsfield).",
    status: "live",
    vercelUrl: "https://youtube-studio-ai.vercel.app",
    githubUrl: "https://github.com/daniels-project-space/youtube-studio-ai",
    category: "creator",
  },
  {
    slug: "the-council",
    name: "The Council",
    short: "TC",
    description: "Multi-LLM panel review.",
    status: "wip",
    category: "ai",
  },
  {
    slug: "storyforge",
    name: "StoryForge",
    short: "SF",
    description: "Long-form story workflow.",
    status: "wip",
    category: "creator",
  },
  {
    slug: "db-cinema",
    name: "DB Cinema",
    short: "DB",
    description: "Cinema-grade rental DB.",
    status: "wip",
    category: "ops",
  },

  // Idea / not yet started
  {
    slug: "factory-2",
    name: "Factory 2.0 · Forge Lab",
    short: "F2",
    description: "Next-gen autonomous factory.",
    status: "idea",
    category: "experiment",
  },
];

export const APP_BY_SLUG: Record<string, AppEntry> = Object.fromEntries(
  APPS.map((a) => [a.slug, a]),
);
