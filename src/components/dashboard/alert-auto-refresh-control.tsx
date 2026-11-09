"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ALERT_REFRESH_INTERVALS,
  computeNextRefreshEpoch,
  describeAlertRefreshMode,
  resolveAlertRefreshMode,
  type AlertAutoRefreshInterval,
} from "@/lib/dashboard/alert-auto-refresh";
import { useAlertStore } from "@/lib/dashboard/alert-store";
import { loadAlertLists } from "@/lib/dashboard/alerts";
import { ALERT_EVENTS_SIGNAL } from "@/lib/dashboard/realtime-ws";
import { useSession } from "@/components/session-provider";
import { selectPreviewEnabled } from "@/lib/session-store";
import { useDashboardStore } from "@/lib/dashboard/store";
import { cn } from "@/lib/utils";

function formatClock(epochSec: number): string {
  return new Date(epochSec * 1000).toLocaleTimeString("id-ID", {
    hour12: false,
  });
}

function intervalLabel(ms: AlertAutoRefreshInterval): string {
  return ms === 0 ? "Manual" : `Otomatis ${ms / 1000} detik`;
}

// Kontrol pembaruan papan alert. Saat hub tersambung, alert datang lewat hub;
// bila putus, timer polling lokal menarik daftar dengan interval pilihan operator.
export function AlertAutoRefreshControl() {
  const connection = useDashboardStore((state) => state.connection);
  const applySnapshot = useAlertStore((state) => state.applySnapshot);
  const [intervalMs, setIntervalMs] = useState<AlertAutoRefreshInterval>(5000);
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const isDemo = useSession(selectPreviewEnabled);

  const mode = resolveAlertRefreshMode(intervalMs, connection);

  const refresh = useCallback(async () => {
    if (busy.current) return; // satu permintaan sekali jalan
    busy.current = true;
    setIsRefreshing(true);
    try {
      const nowSec = Math.floor(Date.now() / 1000);
      if (isDemo) {
        applySnapshot(await loadAlertLists(nowSec), nowSec);
      } else {
        // Mode live: LiveAlertSync yang membaca tabel alerts; di sini hanya
        // memintanya memuat sekarang. loadAlertLists itu data tiruan.
        window.dispatchEvent(new Event(ALERT_EVENTS_SIGNAL));
      }
      setLastRefreshAt(nowSec);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyegarkan alert");
    } finally {
      busy.current = false;
      setIsRefreshing(false);
    }
  }, [applySnapshot, isDemo]);

  // Polling lokal hanya saat hub tidak tersambung dan operator memilih interval.
  useEffect(() => {
    if (mode !== "polling_fallback" || !isDemo) return;
    const timer = setInterval(() => void refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [mode, intervalMs, refresh, isDemo]);

  const next = computeNextRefreshEpoch(lastRefreshAt, intervalMs);

  return (
    <div
      data-testid="alert-auto-refresh-control"
      data-mode={mode}
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded border bg-card px-3 py-1.5 text-xs"
    >
      <button
        type="button"
        onClick={() => void refresh()}
        aria-disabled={isRefreshing}
        className="inline-flex items-center gap-1.5 rounded border px-2 py-1 font-medium hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 aria-disabled:opacity-60"
      >
        <RefreshCw
          aria-hidden="true"
          className={cn(
            "size-4",
            isRefreshing && "animate-spin motion-reduce:animate-none",
          )}
        />
        {isRefreshing ? "Menyegarkan…" : "Segarkan Alert"}
      </button>

      <label className="flex items-center gap-2">
        <span className="text-muted-foreground">Pembaruan</span>
        <select
          value={intervalMs}
          onChange={(e) =>
            setIntervalMs(Number(e.target.value) as AlertAutoRefreshInterval)
          }
          className="rounded border bg-background px-1.5 py-1"
        >
          {ALERT_REFRESH_INTERVALS.map((ms) => (
            <option key={ms} value={ms}>
              {intervalLabel(ms)}
            </option>
          ))}
        </select>
      </label>

      <div
        role="status"
        className="flex flex-col text-xs text-muted-foreground"
      >
        <span>
          {describeAlertRefreshMode(mode, intervalMs)}
          {mode === "polling_fallback" && connection === "disconnected"
            ? " — hub terputus"
            : ""}
        </span>
        <span>
          {lastRefreshAt === null
            ? "Pembaruan terakhir: belum ada"
            : `Pembaruan terakhir: ${formatClock(lastRefreshAt)}`}
          {mode === "polling_fallback" && next !== null
            ? ` · berikutnya ${formatClock(next)}`
            : ""}
        </span>
        {error && <span className="text-destructive">{error}</span>}
      </div>
    </div>
  );
}
