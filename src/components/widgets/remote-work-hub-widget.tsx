import { ExternalLink } from "lucide-react";
import { WidgetSlot } from "../widget-slot";

export function RemoteWorkHubWidget() {
  return (
    <WidgetSlot
      size="full"
      label="Remote Work Hub"
      status="embedded · Claude Code agents"
      action={
        <a
          href="https://remote-work-hub-sepia.vercel.app"
          target="_blank"
          rel="noreferrer"
          className="font-mono text-[10px] uppercase tracking-[0.2em] text-paper-faint hover:text-amber transition-colors flex items-center gap-1.5"
        >
          open in tab <ExternalLink className="w-3 h-3" />
        </a>
      }
    >
      <iframe
        src="https://remote-work-hub-sepia.vercel.app"
        title="Remote Work Hub"
        className="w-full h-[720px] bg-ink"
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
        allow="clipboard-read; clipboard-write"
      />
    </WidgetSlot>
  );
}
