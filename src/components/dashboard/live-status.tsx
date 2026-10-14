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
      className="flex flex-wrap items-center gap-2 text-xs"
      role="status"
      aria-live="polite"
    >
      <span className={cn("size-2 rounded-full", view.dot)} aria-hidden="true" />
      <span className="font-medium text-foreground">{view.label}</span>
      {view.fallbackBadge && (
        <span className="rounded border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {view.fallbackBadge}
        </span>
      )}
      {view.latency && (
        <span className="font-mono tabular-nums text-muted-foreground">
          {view.latency}
        </span>
      )}
      {lastUpdateAt !== null && (
        <span className="tabular-nums text-muted-foreground">
          Diperbarui {timeFormat.format(new Date(lastUpdateAt * 1000))}
        </span>
      )}
      {view.showRetry && reconnectFeed && (
        <button
          type="button"
          onClick={reconnectFeed}
          aria-label="Coba sambungkan ulang aliran realtime"
          className="font-medium text-primary underline hover:no-underline"
        >
          Coba lagi
        </button>
      )}
    </div>
  );
}
