// Logika evaluasi kebaruan data trafik real-time (anti-false-RTO dan bebas clock skew).
export const TRAFFIC_STALENESS_THRESHOLD_SECONDS = 5;

// Sumber data terhenti: "feed" = WebSocket aplikasi ke backend putus (BUKAN MikroTik), "router" = backend
// melaporkan MikroTik tidak terjangkau (RTO sungguhan), "nodata" = tersambung tetapi sampel baru belum datang.
export type StaleCause = "feed" | "router" | "nodata";

export interface StalenessInput {
  isLive: boolean;
  lastDataReceivedAt: number | null; // unix timestamp detik waktu lokal saat data diterima
  routerReachable?: boolean;
  feedLive?: boolean; // WebSocket aplikasi ke backend Go tersambung
  nowSec?: number;
}

export interface StalenessResult {
  isStale: boolean;
  secondsSinceLastData: number;
  cause: StaleCause | null;
}

export function evaluateTrafficStaleness({
  isLive,
  lastDataReceivedAt,
  routerReachable = true,
  feedLive = true,
  nowSec = Math.floor(Date.now() / 1000),
}: StalenessInput): StalenessResult {
  // Hanya aktif pada mode live dan setelah data awal pernah diterima
  if (!isLive || lastDataReceivedAt === null || lastDataReceivedAt <= 0) {
    return { isStale: false, secondsSinceLastData: 0, cause: null };
  }

  const elapsed = Math.max(0, nowSec - lastDataReceivedAt);

  // Koneksi aplikasi putus: status router dari backend sudah basi, jadi jangan menyalahkan MikroTik.
  if (!feedLive) {
    return { isStale: true, secondsSinceLastData: elapsed, cause: "feed" };
  }

  // Jika router ditandai unreachable oleh backend, langsung tandai stale
  if (!routerReachable) {
    return { isStale: true, secondsSinceLastData: elapsed, cause: "router" };
  }

  const isStale = elapsed >= TRAFFIC_STALENESS_THRESHOLD_SECONDS;
  return {
    isStale,
    secondsSinceLastData: elapsed,
    cause: isStale ? "nodata" : null,
  };
}

// Label pendek (badge) dan kalimat lengkap untuk tiap penyebab.
export const staleShortLabel: Record<StaleCause, string> = {
  feed: "APLIKASI TERPUTUS",
  router: "RTO",
  nodata: "DATA TERTUNDA",
};

export function staleMessage(
  cause: StaleCause,
  seconds: number,
  routerError?: string | null,
): string {
  if (cause === "feed")
    return `Aplikasi terputus dari backend realtime (${seconds}s); bukan MikroTik. Menyambung ulang otomatis.`;
  if (cause === "router")
    return `MikroTik tidak merespons ke backend (RTO ${seconds}s)${routerError ? `: ${routerError}` : ""}.`;
  return `Belum ada sampel trafik baru (${seconds}s); MikroTik masih terhubung ke backend.`;
}
