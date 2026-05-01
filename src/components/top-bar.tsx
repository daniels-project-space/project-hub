export function TopBar() {
  return (
    <header className="border-b border-rule-soft/60 sticky top-0 z-20 backdrop-blur-xl bg-ink/70">
      <div className="max-w-[1440px] mx-auto px-8 lg:px-14 py-4 flex items-center justify-between gap-6">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-md grid place-items-center"
            style={{
              background: "linear-gradient(160deg, oklch(0.18 0.01 245 / 0.95), oklch(0.13 0.01 245 / 0.9))",
              border: "1px solid oklch(0.27 0.013 245 / 0.7)",
              boxShadow: "inset 0 1px 0 oklch(1 0 0 / 0.06)",
            }}>
            <span className="font-display italic text-brass text-sm leading-none">
              D
            </span>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-brass/80">
            Daniel&apos;s Project Space
          </span>
        </div>
        <div className="flex items-center gap-3 text-[10px] font-mono uppercase tracking-[0.22em] text-paper-faint">
          <a
            href="https://github.com/daniels-project-space"
            target="_blank"
            rel="noreferrer"
            className="hover:text-brass transition-colors"
          >
            github
          </a>
          <span className="text-rule">·</span>
          <a
            href="https://vercel.com/danielmabro-news-projects"
            target="_blank"
            rel="noreferrer"
            className="hover:text-brass transition-colors"
          >
            vercel
          </a>
          <span className="text-rule">·</span>
          <a
            href="https://dashboard.convex.dev"
            target="_blank"
            rel="noreferrer"
            className="hover:text-brass transition-colors"
          >
            convex
          </a>
        </div>
      </div>
    </header>
  );
}
