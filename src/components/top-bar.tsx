export function TopBar() {
  return (
    <header className="border-b border-rule-soft/60 sticky top-0 z-20 backdrop-blur-xl bg-ink/70">
      <div className="max-w-[1440px] mx-auto px-8 lg:px-14 py-4 flex items-center justify-between gap-6">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-sm bg-amber/20 border border-amber/40 grid place-items-center">
            <span className="font-display italic text-amber text-sm leading-none">
              D
            </span>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-amber/80">
            Daniel&apos;s Project Space
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] font-mono uppercase tracking-[0.2em] text-paper-faint">
          <a
            href="https://github.com/daniels-project-space"
            target="_blank"
            rel="noreferrer"
            className="hover:text-amber transition-colors"
          >
            github
          </a>
          <span className="text-rule">·</span>
          <a
            href="https://vercel.com/danielmabro-news-projects"
            target="_blank"
            rel="noreferrer"
            className="hover:text-amber transition-colors"
          >
            vercel
          </a>
          <span className="text-rule">·</span>
          <a
            href="https://dashboard.convex.dev"
            target="_blank"
            rel="noreferrer"
            className="hover:text-amber transition-colors"
          >
            convex
          </a>
        </div>
      </div>
    </header>
  );
}
