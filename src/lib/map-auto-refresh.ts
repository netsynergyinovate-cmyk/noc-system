export interface RefreshIntervalOption {
  value: number;
  label: string;
  seconds: number;
}

export const MAP_REFRESH_INTERVALS: readonly RefreshIntervalOption[] = [
  { value: 0, label: "Manual (Mati)", seconds: 0 },
  { value: 15, label: "15 detik (Cepat)", seconds: 15 },
  { value: 30, label: "30 detik (Standar)", seconds: 30 },
  { value: 60, label: "1 menit (Normal)", seconds: 60 },
  { value: 300, label: "5 menit (Hemat)", seconds: 300 },
] as const;

export const DEFAULT_MAP_REFRESH_INTERVAL = 30; // 30 detik default operasional

/**
 * Memformat tanggal ke dalam bentuk teks relatif bahasa Indonesia (misal: "Baru saja", "15 detik yang lalu").
 */
export function formatRelativeTimestamp(
  dateInput: Date | string | number | null | undefined,
  nowMs: number = Date.now(),
): string {
  if (!dateInput) return "Belum pernah disinkronkan";

  const targetDate = typeof dateInput === "object" ? dateInput : new Date(dateInput);
  const targetMs = targetDate.getTime();
  if (Number.isNaN(targetMs)) return "Waktu tidak valid";

  const diffMs = Math.max(0, nowMs - targetMs);
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 5) {
    return "Baru saja";
  }
  if (diffSec < 60) {
    return `${diffSec} detik yang lalu`;
  }
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return `${diffMin} menit yang lalu`;
  }
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) {
    return `${diffHour} jam yang lalu`;
  }

  return targetDate.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Memformat tanggal ke dalam jam absolut (HH:mm:ss).
 */
export function formatAbsoluteTimestamp(
  dateInput: Date | string | number | null | undefined,
): string {
  if (!dateInput) return "-";

  const targetDate = typeof dateInput === "object" ? dateInput : new Date(dateInput);
  if (Number.isNaN(targetDate.getTime())) return "-";

  return targetDate.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
