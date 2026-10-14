// Data tiruan status sinkronisasi data otomatis (seed, transfer, replikasi).
// TIRUAN SEMENTARA: wajib dialihkan ke service nyata saat go-live (Fase 5).

export interface DataSyncModuleItem {
  id: string;
  name: string;
  description: string;
  entityType:
    | "accounts"
    | "devices"
    | "customers"
    | "thresholds"
    | "billing"
    | "whatsapp";
  status: "in_sync" | "syncing" | "pending" | "failed";
  recordsCount: number;
  lastSyncedAt: string;
  checksum: string;
  direction: "local_to_server" | "server_to_local" | "bidirectional" | "seed";
  autoSyncIntervalMinutes: number;
  lastError?: string | null;
}

export interface DataSyncOverview {
  totalModules: number;
  syncedModules: number;
  pendingModules: number;
  failedModules: number;
  globalStatus: "in_sync" | "syncing" | "stale" | "failed";
  lastGlobalSyncAt: string | null;
  totalRecordsSynced: number;
  autoSyncEnabled: boolean;
  activeDirection: string;
}

export interface DataSyncFilter {
  status: "all" | "in_sync" | "syncing" | "pending" | "failed";
  query: string;
}

export const DATA_SYNC_MOCK_ENTRY = {
  id: "data-sync-status",
  module: "Sinkronisasi Data Otomatis",
  targetDevice: "Penyelarasan Data Otomatis (Seed & Transfer DB)",
  status: "dummy" as const,
  readPath: "src/lib/dashboard/data-sync.ts (getMockDataSyncStatus)",
  writePath: "POST /api/sync/run",
  envKey: "DATABASE_URL",
  notes:
    "Tiruan sementara status sinkronisasi data; wajib dialihkan ke runner transfer database nyata saat go-live Fase 5",
};

export const MOCK_DATA_SYNC_MODULES: readonly DataSyncModuleItem[] = [
  {
    id: "sync-accounts",
    name: "Akun Pengguna & Hak Akses",
    description: "Penyelarasan akun operator admin dan viewer serta role RBAC",
    entityType: "accounts",
    status: "in_sync",
    recordsCount: 2,
    lastSyncedAt: "2026-10-13T08:00:00.000Z",
    checksum: "sha256-acc01b9f71c4d28e",
    direction: "seed",
    autoSyncIntervalMinutes: 60,
  },
  {
    id: "sync-devices",
    name: "Perangkat Jaringan (Router & OLT)",
    description: "Inventaris Router MikroTik, OLT HSGQ, Port PON, dan ONU",
    entityType: "devices",
    status: "in_sync",
    recordsCount: 42,
    lastSyncedAt: "2026-10-13T08:15:00.000Z",
    checksum: "sha256-dev9921aa4b7f03c",
    direction: "local_to_server",
    autoSyncIntervalMinutes: 15,
  },
  {
    id: "sync-customers",
    name: "Data Pelanggan & Pemetaan ODP",
    description: "Database pelanggan internet, koordinat rumah, dan penomoran ODP",
    entityType: "customers",
    status: "in_sync",
    recordsCount: 156,
    lastSyncedAt: "2026-10-13T08:20:00.000Z",
    checksum: "sha256-cust55018e3fa021",
    direction: "bidirectional",
    autoSyncIntervalMinutes: 30,
  },
  {
    id: "sync-thresholds",
    name: "Konfigurasi Ambang Alert",
    description: "Nilai ambang batas CPU, antrean, optik, dan port error",
    entityType: "thresholds",
    status: "in_sync",
    recordsCount: 5,
    lastSyncedAt: "2026-10-13T08:25:00.000Z",
    checksum: "sha256-thr009a741fbd682",
    direction: "server_to_local",
    autoSyncIntervalMinutes: 60,
  },
  {
    id: "sync-billing",
    name: "Kredensial & Status Tagihan Billing",
    description: "Penyelarasan status tagihan lunas/isolir pelanggan berkala",
    entityType: "billing",
    status: "in_sync",
    recordsCount: 156,
    lastSyncedAt: "2026-10-13T08:30:00.000Z",
    checksum: "sha256-bil77a102c9de51f",
    direction: "bidirectional",
    autoSyncIntervalMinutes: 60,
  },
  {
    id: "sync-whatsapp",
    name: "Penerima Notifikasi WhatsApp",
    description: "Daftar nomor kontak teknisi darurat dan template notifikasi",
    entityType: "whatsapp",
    status: "in_sync",
    recordsCount: 3,
    lastSyncedAt: "2026-10-13T08:35:00.000Z",
    checksum: "sha256-wa883c79a405fb71",
    direction: "server_to_local",
    autoSyncIntervalMinutes: 120,
  },
];

export function getMockDataSyncModules(): readonly DataSyncModuleItem[] {
  return MOCK_DATA_SYNC_MODULES;
}

export function getMockDataSyncOverview(
  modules: readonly DataSyncModuleItem[] = MOCK_DATA_SYNC_MODULES,
): DataSyncOverview {
  const synced = modules.filter((m) => m.status === "in_sync").length;
  const syncing = modules.filter((m) => m.status === "syncing").length;
  const pending = modules.filter((m) => m.status === "pending").length;
  const failed = modules.filter((m) => m.status === "failed").length;

  const totalRecords = modules.reduce((sum, m) => sum + m.recordsCount, 0);

  const lastSync = modules
    .map((m) => m.lastSyncedAt)
    .filter(Boolean)
    .sort()
    .pop();

  const globalStatus: "in_sync" | "syncing" | "stale" | "failed" =
    failed > 0
      ? "failed"
      : syncing > 0
        ? "syncing"
        : pending > 0
          ? "stale"
          : "in_sync";

  return {
    totalModules: modules.length,
    syncedModules: synced,
    pendingModules: pending,
    failedModules: failed,
    globalStatus,
    lastGlobalSyncAt: lastSync ?? null,
    totalRecordsSynced: totalRecords,
    autoSyncEnabled: true,
    activeDirection: "Lokal ⇄ Server (Otomatis)",
  };
}

export function filterDataSyncModules(
  modules: readonly DataSyncModuleItem[],
  filter: DataSyncFilter,
): DataSyncModuleItem[] {
  const q = filter.query.trim().toLowerCase();

  return modules.filter((item) => {
    if (filter.status !== "all" && item.status !== filter.status) {
      return false;
    }
    if (!q) return true;

    return (
      item.name.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      item.entityType.toLowerCase().includes(q) ||
      item.checksum.toLowerCase().includes(q)
    );
  });
}
