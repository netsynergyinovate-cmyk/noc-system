"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  DASHBOARD_AUTO_REFRESH_INTERVAL_MS,
  shouldTriggerAutoRefresh,
} from "@/lib/dashboard/dashboard-empty-state";
import { useDashboardStore } from "@/lib/dashboard/store";
import { selectClassName } from "./select-class";

// 0 = manual.
const options = [
  { value: DASHBOARD_AUTO_REFRESH_INTERVAL_MS, label: "5 dtk" },
  { value: 10_000, label: "10 dtk" },
  { value: 30_000, label: "30 dtk" },
  { value: 0, label: "Manual" },
];

export function DashboardAutoRefresh() {
  const connection = useDashboardStore((state) => state.connection);
  const reconnectFeed = useDashboardStore((state) => state.reconnectFeed);
  const [intervalMs, setIntervalMs] = useState(
    DASHBOARD_AUTO_REFRESH_INTERVAL_MS,
  );

  useEffect(() => {
    if (intervalMs === 0) return;
    const timer = setInterval(() => {
      const { connection: conn, lastUpdateAt, reconnectFeed: reconnect } =
        useDashboardStore.getState();
      if (!reconnect) return;
      const nowSec = Math.floor(Date.now() / 1000);
      // Aliran hidup dan segar: tidak perlu apa-apa.
      if (
        conn === "live" &&
        !shouldTriggerAutoRefresh(lastUpdateAt, nowSec, (intervalMs / 1000) * 2)
      )
        return;
      if (conn === "connecting") return;
      reconnect();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  const status =
    connection === "live"
      ? "Tersambung Realtime (WebSocket)"
      : intervalMs > 0
        ? `Sinkron Otomatis (Interval ${intervalMs / 1000}s)`
        : "Menunggu Pembaruan";

  return (
    <div
      data-testid="dashboard-auto-refresh-control"
      className="flex flex-wrap items-center gap-2 text-xs"
    >
      <span className="text-muted-foreground" role="status">
        {status}
      </span>
      <label className="sr-only" htmlFor="dashboard-refresh-interval">
        Interval refresh otomatis
      </label>
      <select
        id="dashboard-refresh-interval"
        className={`${selectClassName} h-7 w-auto px-2 text-xs`}
        value={intervalMs}
        onChange={(event) => setIntervalMs(Number(event.target.value))}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => reconnectFeed?.()}
        aria-disabled={!reconnectFeed}
        className="inline-flex items-center gap-1 font-medium text-primary underline hover:no-underline"
      >
        <RefreshCw className="size-3" aria-hidden="true" />
        Segarkan Sekarang
      </button>
    </div>
  );
}
