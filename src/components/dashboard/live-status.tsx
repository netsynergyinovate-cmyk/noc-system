"use client";

import { cn } from "cn";
import { liveStatusView } from "@/lib/dashboard/live-status-view";
import { useDashboardStore } from "@/lib/dashboard/store";

const timeFormat = new Intl.DateTimeFormat("id-ID", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

// Hanya komponen kecil ini yang membaca waktu pesan terakhir dan latensi.
export function LiveStatus() {
  const connection = useDashboardStore((state) => state.connection);
  const lastUpdateAt = useDashboardStore((state) => state.lastUpdateAt);
  const latencyMs = useDashboardStore((state) => state.latencyMs);
  const isMockFallback = useDashboardStore((state) => state.isMockFallback);
  const reconnectFeed = useDashboardStore((state) => state.reconnectFeed);
  const view = liveStatusView({
    connection,
    latencyMs,
    isMockFallback,
    hasReconnect: reconnectFeed !== null,
  });

  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/20 px-3 py-1 text-xs text-muted-foreground whitespace-nowrap backdrop-blur-xs"
      role="status"
      aria-live="polite"
    >
      <span className={cn("size-2 shrink-0 rounded-full", view.dot)} aria-hidden="true" />
      <span className="font-medium text-foreground">{view.label}</span>
      {view.fallbackBadge && (
        <span className="rounded border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {view.fallbackBadge}
        </span>
      )}
      {view.latency && (
        <>
          <span className="text-border select-none" aria-hidden="true">•</span>
          <span className="font-mono tabular-nums text-foreground/80">
            {view.latency}
          </span>
        </>
      )}
      {lastUpdateAt !== null && (
        <>
          <span className="text-border select-none" aria-hidden="true">•</span>
          <span className="tabular-nums text-muted-foreground">
            Diperbarui {timeFormat.format(new Date(lastUpdateAt * 1000))}
          </span>
        </>
      )}
      {view.showRetry && reconnectFeed && (
        <button
          type="button"
          onClick={reconnectFeed}
          aria-label="Coba sambungkan ulang aliran realtime"
          className="ml-1 font-medium text-primary underline hover:no-underline"
        >
          Coba lagi
        </button>
      )}
    </div>
  );
}
