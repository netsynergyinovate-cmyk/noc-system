"use client";

import { AlertTriangle } from "lucide-react";
import { useDashboardStore } from "@/lib/dashboard/store";
import { streamDisconnectedView } from "@/lib/dashboard/stream-disconnected-view";

export function StreamDisconnectedBanner() {
  const connection = useDashboardStore((state) => state.connection);
  const lastUpdateAt = useDashboardStore((state) => state.lastUpdateAt);
  const reconnectFeed = useDashboardStore((state) => state.reconnectFeed);
  const view = streamDisconnectedView({
    connection,
    lastUpdateAt,
    hasReconnect: !!reconnectFeed,
  });

  if (!view.visible) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-foreground"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 font-medium text-destructive">
            <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
            <span>{view.title}</span>
          </div>
          <p className="text-xs text-muted-foreground">{view.description}</p>
          <p className="text-[11px] text-muted-foreground">
            {view.lastUpdateText} • {view.retryHint}
          </p>
        </div>
        {view.showRetryButton && reconnectFeed && (
          <button
            type="button"
            onClick={reconnectFeed}
            className="rounded border border-destructive/30 bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted"
          >
            Sambungkan ulang
          </button>
        )}
      </div>
    </div>
  );
}
