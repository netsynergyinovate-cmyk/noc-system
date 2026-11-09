// Metrik ringkasan papan alert. TIRUAN SEMENTARA: wajib dialihkan ke Go
// WebSocket Hub nyata saat go-live (Fase 5). Murni, tanpa impor lain.

export interface AlertBoardKpi {
  totalActive: number;
  criticalCount: number;
  warningCount: number;
  resolvedPast24h: number;
  resolvedPast7d: number;
  unacknowledgedCount: number;
  sourceStatus: "dummy" | "nyata";
  lastSyncedAt: string;
}

export const ALERT_BOARD_MOCK_ENTRY = {
  id: "alert-board-data",
  module: "Papan Alert Gangguan",
  targetDevice: "Go Rule Engine / Alert Hub",
  status: "dummy" as const,
  readPath: "src/lib/dashboard/alert-board-mock.ts (generateMockAlertKpi)",
  writePath: "POST /api/v1/alerts/{id}/handle",
  envKey: "DASHBOARD_DATA",
  notes:
    "Tiruan sementara data alert & metrik gangguan; wajib dialihkan ke Go WebSocket Hub nyata di Fase 5",
};

interface ActiveLike {
  severity?: string;
}
interface ResolvedLike {
  endedAt?: number;
}

const DAY = 86_400;

// Deterministik: hasil hanya bergantung pada daftar dan `nowSec` (detik epoch).
// Alert aktif belum ditandai petugas = semua alert aktif (yang ditandai sudah
// pindah ke riwayat). Riwayat dihitung di (now - jendela, now].
export function computeAlertKpi(
  activeAlerts: readonly ActiveLike[] = [],
  resolvedAlerts: readonly ResolvedLike[] = [],
  nowSec: number = Math.floor(Date.now() / 1000),
): AlertBoardKpi {
  const within = (span: number) =>
    resolvedAlerts.filter(
      (a) =>
        typeof a.endedAt === "number" &&
        a.endedAt <= nowSec &&
        a.endedAt > nowSec - span,
    ).length;
  return {
    totalActive: activeAlerts.length,
    criticalCount: activeAlerts.filter((a) => a.severity === "critical").length,
    warningCount: activeAlerts.filter((a) => a.severity === "warning").length,
    resolvedPast24h: within(DAY),
    resolvedPast7d: within(7 * DAY),
    unacknowledgedCount: activeAlerts.length,
    sourceStatus: "nyata",
    lastSyncedAt: new Date(nowSec * 1000).toISOString(),
  };
}

export function generateMockAlertKpi(
  activeAlerts: readonly ActiveLike[] = [],
  resolvedAlerts: readonly ResolvedLike[] = [],
  nowSec: number = Math.floor(Date.now() / 1000),
): AlertBoardKpi {
  return {
    ...computeAlertKpi(activeAlerts, resolvedAlerts, nowSec),
    sourceStatus: "dummy",
  };
}

export function isAlertBoardMockActive(status?: "dummy" | "nyata"): boolean {
  return status === "dummy";
}
