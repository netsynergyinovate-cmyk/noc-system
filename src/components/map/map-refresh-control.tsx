"use client";

import { useEffect, useState } from "react";
import { RefreshCw, Clock, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  MAP_REFRESH_INTERVALS,
  formatRelativeTimestamp,
  formatAbsoluteTimestamp,
} from "@/lib/map-auto-refresh";

export interface MapRefreshControlProps {
  lastRefreshedAt: string | Date | null;
  isRefreshing: boolean;
  onRefresh: () => void | Promise<void>;
  selectedInterval?: number;
  onIntervalChange?: (intervalSeconds: number) => void;
  className?: string;
}

export function MapRefreshControl({
  lastRefreshedAt,
  isRefreshing,
  onRefresh,
  selectedInterval = 30,
  onIntervalChange,
  className = "",
}: MapRefreshControlProps) {
  const [internalInterval, setInternalInterval] = useState<number>(selectedInterval);
  const intervalSec = onIntervalChange !== undefined ? selectedInterval : internalInterval;
  const [countdown, setCountdown] = useState<number>(selectedInterval);
  const [relativeTime, setRelativeTime] = useState<string>(() =>
    formatRelativeTimestamp(lastRefreshedAt),
  );

  // Handler ubah interval
  const handleSelectInterval = (newVal: number) => {
    setInternalInterval(newVal);
    setCountdown(newVal);
    onIntervalChange?.(newVal);
  };

  // Handler klik segarkan manual
  const handleManualClick = () => {
    if (intervalSec > 0) {
      setCountdown(intervalSec);
    }
    onRefresh();
  };

  // Timer countdown menuju penyegaran berikutnya dan pembaruan teks relatif
  useEffect(() => {
    const timer = setInterval(() => {
      // Perbarui label relatif setiap detik
      setRelativeTime(formatRelativeTimestamp(lastRefreshedAt));

      // Jika auto-refresh aktif (interval > 0), kurangi countdown
      if (intervalSec > 0 && !isRefreshing) {
        setCountdown((prev) => {
          if (prev <= 1) {
            onRefresh();
            return intervalSec;
          }
          if (prev > intervalSec) {
            return intervalSec;
          }
          return prev - 1;
        });
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [intervalSec, isRefreshing, lastRefreshedAt, onRefresh]);

  const absoluteTime = formatAbsoluteTimestamp(lastRefreshedAt);

  return (
    <div
      className={`flex flex-wrap items-center gap-2 ${className}`}
      data-testid="map-refresh-control"
    >
      {/* Badge Penanda Waktu Terakhir Diperbarui */}
      <Badge
        variant="secondary"
        className="text-[11px] font-normal text-muted-foreground gap-1.5 py-1 px-2.5 bg-muted/70 border"
        data-testid="last-sync-time"
        title={`Sinkronisasi data PostgreSQL: ${absoluteTime}`}
      >
        <Clock className="size-3 text-primary shrink-0" />
        <span className="hidden sm:inline">Diperbarui:</span>
        <span
          className="font-medium text-foreground"
          data-testid="map-timestamp-badge"
        >
          {relativeTime}
        </span>
        <span className="text-[10px] text-muted-foreground hidden md:inline">
          ({absoluteTime})
        </span>
      </Badge>

      {/* Indikator Hitung Mundur Penyegaran Otomatis */}
      {intervalSec > 0 && (
        <Badge
          variant="outline"
          className="text-[11px] font-normal gap-1 border-primary/30 text-primary bg-primary/5 py-1 px-2 hidden sm:flex items-center"
          data-testid="refresh-countdown-indicator"
          title={`Penyegaran otomatis berkala setiap ${intervalSec} detik`}
        >
          <Timer className="size-3 animate-pulse" />
          <span>Auto:</span>
          <span className="font-semibold tabular-nums">{countdown}s</span>
        </Badge>
      )}

      {/* Dropdown Interval Penyegaran */}
      <div className="flex items-center gap-1">
        <label htmlFor="map-refresh-interval-select" className="sr-only">
          Interval Penyegaran Peta
        </label>
        <select
          id="map-refresh-interval-select"
          data-testid="refresh-interval-select"
          value={intervalSec}
          onChange={(e) => handleSelectInterval(Number(e.target.value))}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs font-medium text-foreground shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          title="Pilih frekuensi penyegaran otomatis berkala"
        >
          {MAP_REFRESH_INTERVALS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Tombol Segarkan Manual */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleManualClick}
        disabled={isRefreshing}
        className="h-8 gap-1.5 text-xs font-medium bg-background hover:bg-muted/60"
        data-testid="manual-refresh-button"
        title="Muat ulang data telemetri peta terbaru secara manual"
      >
        <RefreshCw
          className={`size-3.5 text-primary ${isRefreshing ? "animate-spin" : ""}`}
        />
        <span data-testid="refresh-map-button">
          {isRefreshing ? "Menyegarkan..." : "Segarkan"}
        </span>
      </Button>

      {/* Status Live Sinyal Indikator */}
      {intervalSec > 0 && (
        <span
          className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium ml-0.5"
          data-testid="auto-refresh-live-indicator"
          title="Polling otomatis aktif di latar belakang"
        >
          <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="hidden lg:inline">Live</span>
        </span>
      )}
    </div>
  );
}
