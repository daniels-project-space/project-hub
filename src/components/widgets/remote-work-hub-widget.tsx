export function RemoteWorkHubWidget() {
  return (
    <div className="rounded-lg border border-rule-soft/60 bg-ink-2/40 overflow-hidden shadow-2xl">
      <div className="px-5 py-3 flex items-center justify-between border-b border-rule-soft/60 bg-ink-2/70">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-soft pulse-dot" />
          <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-amber/80">
            Remote Work Hub
          </span>
          <span className="text-paper-faint">·</span>
          <span className="font-mono text-[10px] text-paper-faint">
            embedded · Claude Code agents
          </span>
        </div>
        <a
          href="https://remote-work-hub-sepia.vercel.app"
          target="_blank"
          rel="noreferrer"
          className="font-mono text-[10px] uppercase tracking-[0.2em] text-paper-faint hover:text-amber transition-colors"
        >
          open in tab ↗
        </a>
      </div>
      <iframe
        src="https://remote-work-hub-sepia.vercel.app"
        title="Remote Work Hub"
        className="w-full h-[720px] bg-ink"
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}
