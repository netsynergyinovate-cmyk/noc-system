// Logika murni pembaruan otomatis papan alert. Tanpa React, tanpa store.

export type AlertAutoRefreshInterval = 0 | 3000 | 5000 | 10000 | 30000; // 0 = manual

export type AlertRefreshMode = "realtime_hub" | "polling_fallback" | "manual";

export interface AlertRefreshPolicy {
  intervalMs: AlertAutoRefreshInterval;
  lastRefreshAt: number | null; // epoch detik
  isRefreshing: boolean;
  mode: AlertRefreshMode;
  statusText: string;
}

export interface AlertRefreshResult {
  success: boolean;
  activeCount: number;
  resolvedCount: number;
  refreshedAt: number;
  latencyMs: number;
  error?: string;
}

export const ALERT_REFRESH_INTERVALS: readonly AlertAutoRefreshInterval[] = [
  3000, 5000, 10000, 30000, 0,
];

// Perlu menyegarkan? Interval <= 0 (manual) atau tidak valid: tidak pernah.
// Belum pernah menyegarkan: ya. Jam mundur (selisih negatif): ya, supaya tidak
// menunggu tak terbatas.
export function shouldRefreshAlerts(
  lastRefreshSec: number | null,
  nowSec: number,
  intervalSec: number,
): boolean {
  if (!Number.isFinite(intervalSec) || intervalSec <= 0) return false;
  if (lastRefreshSec === null) return true;
  const elapsed = nowSec - lastRefreshSec;
  return elapsed < 0 || elapsed >= intervalSec;
}

export function describeAlertRefreshMode(
  mode: AlertRefreshMode,
  intervalMs: number,
): string {
  if (mode === "realtime_hub") return "Tersambung Realtime (Hub)";
  if (mode === "polling_fallback") {
    return `Polling Otomatis (tiap ${Math.round(intervalMs / 1000)} detik)`;
  }
  return "Pembaruan Manual";
}

// Epoch detik pembaruan berikutnya; null bila manual atau belum pernah menyegarkan.
export function computeNextRefreshEpoch(
  lastRefreshSec: number | null,
  intervalMs: number,
): number | null {
  if (lastRefreshSec === null || !(intervalMs > 0)) return null;
  return lastRefreshSec + Math.ceil(intervalMs / 1000);
}

// Mode efektif dari pilihan operator dan status koneksi hub.
export function resolveAlertRefreshMode(
  intervalMs: number,
  connection: "connecting" | "live" | "disconnected",
): AlertRefreshMode {
  if (!(intervalMs > 0)) return "manual";
  return connection === "live" ? "realtime_hub" : "polling_fallback";
}
