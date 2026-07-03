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
    slug: "db-cinema-v2",
    name: "Db Cinema Rentals",
    short: "DB",
    description: "Standalone film-gear rental storefront. Browse, book, pay.",
    status: "live",
    vercelUrl: "https://db-cinema-v2.vercel.app",
    githubUrl: "https://github.com/daniels-project-space/db-cinema-v2",
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
    slug: "finance-engine-v2",
    name: "Finance Engine v2",
    short: "FE",
    description: "Self-improving crypto strategy lab — gauntlet-validated, paper-incubated champions.",
    status: "live",
    vercelUrl: "https://finance-engine-v2-cyan.vercel.app",
    githubUrl: "https://github.com/daniels-project-space/finance-engine-v2",
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

  {
    slug: "dropship-ai",
    name: "Dropship AI",
    short: "DS",
    description: "Autonomous AI dropshipping control plane — multi-tenant Shopify+CJ stores, organic-first content engine, human-gated approval queue.",
    status: "live",
    vercelUrl: "https://dropship-ai-cyan.vercel.app",
    githubUrl: "https://github.com/daniels-project-space/dropship-ai",
    category: "ops",
  },

  {
    slug: "media-engine",
    name: "Media Engine",
    short: "ME",
    description: "Unified marketing & media engine — AI persona Instagram growth, UGC product ad streams, YouTube Shorts factory, email marketing.",
    status: "live",
    vercelUrl: "https://media-engine-seven.vercel.app",
    githubUrl: "https://github.com/daniels-project-space/media-engine",
    category: "creator",
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
