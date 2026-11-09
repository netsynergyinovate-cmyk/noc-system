// Data model & helper riwayat dan waktu sinkronisasi terakhir.
// TIRUAN SEMENTARA: wajib dialihkan ke query log tabel database nyata saat go-live (Fase 5).

export interface SyncHistoryEntry {
  id: string;
  runAt: string;
  triggerType: "manual" | "scheduled" | "startup_seed" | "transfer_pipeline";
  scope:
    "full" | "accounts" | "devices" | "customers" | "billing" | "thresholds";
  status: "success" | "partial" | "failed";
  recordsProcessed: number;
  recordsInserted: number;
  recordsUpdated: number;
  recordsSkipped: number;
  durationMs: number;
  actor: string;
  summaryMessage: string;
  checksum: string;
  errorMessage?: string | null;
}

export interface SyncHistoryOverview {
  totalRuns: number;
  successRuns: number;
  failedRuns: number;
  lastSuccessfulSyncAt: string | null;
  lastFailedSyncAt: string | null;
  averageDurationMs: number;
  totalRecordsProcessed: number;
  successRatePercent: number;
}

export interface SyncHistoryFilter {
  status: "all" | "success" | "failed";
  triggerType:
    "all" | "manual" | "scheduled" | "startup_seed" | "transfer_pipeline";
  query: string;
}

export interface SyncHistoryFacetCounts {
  status: {
    all: number;
    success: number;
    failed: number;
  };
  triggerType: {
    all: number;
    manual: number;
    scheduled: number;
    startup_seed: number;
    transfer_pipeline: number;
  };
}

export const SYNC_HISTORY_MOCK_ENTRY = {
  id: "sync-history-log",
  module: "Riwayat Sinkronisasi Data",
  targetDevice: "Tabel Log Sinkronisasi (sync_runs / audit_log)",
  status: "dummy" as const,
  readPath: "src/lib/dashboard/sync-history.ts (getMockSyncHistoryList)",
  writePath: "POST /api/sync/history",
  envKey: "DATABASE_URL",
  notes:
    "Tiruan sementara riwayat sinkronisasi data; wajib dialihkan ke tabel database nyata saat go-live Fase 5",
};

export const MOCK_SYNC_HISTORY_ENTRIES: readonly SyncHistoryEntry[] = [
  {
    id: "run-20261013-085000",
    runAt: "2026-10-13T08:50:00.000Z",
    triggerType: "scheduled",
    scope: "full",
    status: "success",
    recordsProcessed: 361,
    recordsInserted: 0,
    recordsUpdated: 156,
    recordsSkipped: 205,
    durationMs: 820,
    actor: "Sistem (Scheduler)",
    summaryMessage:
      "Penyelarasan berkala status billing dan telemetri perangkat sukses.",
    checksum: "sha256-sync-8820c741",
  },
  {
    id: "run-20261013-083000",
    runAt: "2026-10-13T08:30:00.000Z",
    triggerType: "manual",
    scope: "billing",
    status: "success",
    recordsProcessed: 156,
    recordsInserted: 0,
    recordsUpdated: 4,
    recordsSkipped: 152,
    durationMs: 450,
    actor: "Admin NOC (admin@noc.local)",
    summaryMessage: "Pembaruan manual 4 status tagihan pelanggan lunas.",
    checksum: "sha256-sync-b99142f0",
  },
  {
    id: "run-20261013-080000",
    runAt: "2026-10-13T08:00:00.000Z",
    triggerType: "scheduled",
    scope: "customers",
    status: "success",
    recordsProcessed: 156,
    recordsInserted: 0,
    recordsUpdated: 2,
    recordsSkipped: 154,
    durationMs: 510,
    actor: "Sistem (Scheduler)",
    summaryMessage: "Verifikasi pemetaan ODP dan koordinat pelanggan.",
    checksum: "sha256-sync-c5512a88",
  },
  {
    id: "run-20261013-074500",
    runAt: "2026-10-13T07:45:00.000Z",
    triggerType: "transfer_pipeline",
    scope: "devices",
    status: "success",
    recordsProcessed: 42,
    recordsInserted: 0,
    recordsUpdated: 42,
    recordsSkipped: 0,
    durationMs: 1200,
    actor: "Pipeline Promosi (Docker → Server)",
    summaryMessage: "Sinkronisasi inventaris Router MikroTik dan OLT HSGQ.",
    checksum: "sha256-sync-d31024bc",
  },
  {
    id: "run-20261013-073000",
    runAt: "2026-10-13T07:30:00.000Z",
    triggerType: "startup_seed",
    scope: "accounts",
    status: "success",
    recordsProcessed: 2,
    recordsInserted: 2,
    recordsUpdated: 0,
    recordsSkipped: 0,
    durationMs: 340,
    actor: "Bootstrap Kontainer (Inisialisasi)",
    summaryMessage:
      "Penyemaian awal akun Admin NOC dan Petugas Viewer idempoten.",
    checksum: "sha256-sync-acc9017a",
  },
];

export function getMockSyncHistoryList(): readonly SyncHistoryEntry[] {
  return MOCK_SYNC_HISTORY_ENTRIES;
}

export function createRefreshedSyncHistoryEntry(
  actor = "Admin NOC (admin@noc.local)",
  scope: SyncHistoryEntry["scope"] = "full",
): SyncHistoryEntry {
  const now = new Date();
  const timeStr = now
    .toISOString()
    .replace(/[-:T.]/g, "")
    .slice(0, 14);

  return {
    id: `run-${timeStr}`,
    runAt: now.toISOString(),
    triggerType: "manual",
    scope,
    status: "success",
    recordsProcessed: 361,
    recordsInserted: 0,
    recordsUpdated: 12,
    recordsSkipped: 349,
    durationMs: 410,
    actor,
    summaryMessage: `Penyelarasan data ${scope} berhasil diperbarui secara instan.`,
    checksum: `sha256-sync-${Math.random().toString(16).slice(2, 10)}`,
  };
}

export function getMockSyncHistoryOverview(
  entries: readonly SyncHistoryEntry[] = MOCK_SYNC_HISTORY_ENTRIES,
): SyncHistoryOverview {
  const success = entries.filter((e) => e.status === "success").length;
  const failed = entries.filter((e) => e.status === "failed").length;

  const lastSuccess = entries
    .filter((e) => e.status === "success")
    .map((e) => e.runAt)
    .sort()
    .pop();

  const lastFailed = entries
    .filter((e) => e.status === "failed")
    .map((e) => e.runAt)
    .sort()
    .pop();

  const totalProcessed = entries.reduce(
    (sum, e) => sum + e.recordsProcessed,
    0,
  );
  const totalDuration = entries.reduce((sum, e) => sum + e.durationMs, 0);
  const avgDuration =
    entries.length > 0 ? Math.round(totalDuration / entries.length) : 0;
  const rate =
    entries.length > 0 ? Math.round((success / entries.length) * 100) : 100;

  return {
    totalRuns: entries.length,
    successRuns: success,
    failedRuns: failed,
    lastSuccessfulSyncAt: lastSuccess ?? null,
    lastFailedSyncAt: lastFailed ?? null,
    averageDurationMs: avgDuration,
    totalRecordsProcessed: totalProcessed,
    successRatePercent: rate,
  };
}

export function getSyncHistoryFacetCounts(
  entries: readonly SyncHistoryEntry[],
  currentFilter: SyncHistoryFilter,
): SyncHistoryFacetCounts {
  const queryMatched = entries.filter((item) => {
    const q = currentFilter.query.trim().toLowerCase();
    if (!q) return true;
    return (
      item.id.toLowerCase().includes(q) ||
      item.actor.toLowerCase().includes(q) ||
      item.summaryMessage.toLowerCase().includes(q) ||
      item.scope.toLowerCase().includes(q) ||
      item.checksum.toLowerCase().includes(q)
    );
  });

  return {
    status: {
      all: queryMatched.length,
      success: queryMatched.filter((e) => e.status === "success").length,
      failed: queryMatched.filter((e) => e.status === "failed").length,
    },
    triggerType: {
      all: queryMatched.length,
      manual: queryMatched.filter((e) => e.triggerType === "manual").length,
      scheduled: queryMatched.filter((e) => e.triggerType === "scheduled")
        .length,
      startup_seed: queryMatched.filter((e) => e.triggerType === "startup_seed")
        .length,
      transfer_pipeline: queryMatched.filter(
        (e) => e.triggerType === "transfer_pipeline",
      ).length,
    },
  };
}

export function filterSyncHistoryEntries(
  entries: readonly SyncHistoryEntry[],
  filter: SyncHistoryFilter,
): SyncHistoryEntry[] {
  const q = filter.query.trim().toLowerCase();

  return entries.filter((item) => {
    if (filter.status !== "all" && item.status !== filter.status) {
      return false;
    }
    if (
      filter.triggerType !== "all" &&
      item.triggerType !== filter.triggerType
    ) {
      return false;
    }
    if (!q) return true;

    return (
      item.id.toLowerCase().includes(q) ||
      item.actor.toLowerCase().includes(q) ||
      item.summaryMessage.toLowerCase().includes(q) ||
      item.scope.toLowerCase().includes(q) ||
      item.checksum.toLowerCase().includes(q)
    );
  });
}
