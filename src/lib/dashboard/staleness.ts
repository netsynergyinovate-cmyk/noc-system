// Logika evaluasi kebaruan data trafik real-time (anti-false-RTO dan bebas clock skew).
export const TRAFFIC_STALENESS_THRESHOLD_SECONDS = 5;

export interface StalenessInput {
  isLive: boolean;
  lastDataReceivedAt: number | null; // unix timestamp detik waktu lokal saat data diterima
  routerReachable?: boolean;
  nowSec?: number;
}

export interface StalenessResult {
  isStale: boolean;
  secondsSinceLastData: number;
}

export function evaluateTrafficStaleness({
  isLive,
  lastDataReceivedAt,
  routerReachable = true,
  nowSec = Math.floor(Date.now() / 1000),
}: StalenessInput): StalenessResult {
  // Hanya aktif pada mode live dan setelah data awal pernah diterima
  if (!isLive || lastDataReceivedAt === null || lastDataReceivedAt <= 0) {
    return { isStale: false, secondsSinceLastData: 0 };
  }

  const elapsed = Math.max(0, nowSec - lastDataReceivedAt);

  // Jika router ditandai unreachable oleh backend, langsung tandai stale
  if (!routerReachable) {
    return { isStale: true, secondsSinceLastData: elapsed };
  }

  return {
    isStale: elapsed >= TRAFFIC_STALENESS_THRESHOLD_SECONDS,
    secondsSinceLastData: elapsed,
  };
}
