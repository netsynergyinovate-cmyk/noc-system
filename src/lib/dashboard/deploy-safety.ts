// Model data & helper status pengaman deploy (health check, backup, rollback).
// TIRUAN SEMENTARA: wajib dialihkan ke backend nyata saat go-live (Fase 5).

export interface HealthCheckItem {
  id: string;
  name: string;
  category: "database" | "network" | "storage" | "service";
  status: "healthy" | "degraded" | "failing" | "pending";
  latencyMs: number;
  message: string;
  checkedAt: string;
  requiredForDeploy: boolean;
}

export interface BackupSnapshotItem {
  id: string;
  label: string;
  type: "full_snapshot" | "schema_only" | "data_only" | "pre_migration";
  sizeBytes: number;
  status: "available" | "creating" | "failed" | "restored";
  checksum: string;
  createdAt: string;
  filename: string;
  canRestore: boolean;
}

export interface PreflightCheckItem {
  id: string;
  label: string;
  description: string;
  passed: boolean;
  severity: "critical" | "warning" | "info";
  detail: string;
}

export interface MigrationRollbackEvent {
  id: string;
  migrationFile: string;
  targetVersion: string;
  reason: string;
  remediationHint: string;
  status: "success" | "partial" | "failed";
  affectedTables: string[];
  durationMs: number;
  actor: string;
  executedAt: string;
  revertStatementsCount: number;
}

export interface DeploySafetyOverview {
  overallStatus: "ready_to_deploy" | "action_required" | "blocked";
  healthScorePercent: number;
  totalChecks: number;
  passedChecks: number;
  failingChecks: number;
  activeSnapshotsCount: number;
  latestSnapshotAt: string | null;
  rollbackReady: boolean;
  lastDeploymentAt: string | null;
  targetEnvironment: "production" | "staging" | "local_test";
}

export const DEPLOY_SAFETY_MOCK_ENTRY = {
  id: "deploy-safety-status",
  module: "Pengaman Deploy & Kesiapan Produksi",
  targetDevice: "Health Check Engine & Snapshot Service",
  status: "dummy" as const,
  readPath: "src/lib/dashboard/deploy-safety.ts (getMockDeploySafetyOverview)",
  writePath: "POST /api/deploy/preflight, POST /api/deploy/backup",
  envKey: "DEPLOY_SAFETY_ENABLED",
  notes:
    "Tiruan sementara di lingkungan uji; wajib dialihkan ke backend nyata saat go-live Fase 5",
};

export const MOCK_HEALTH_CHECKS: readonly HealthCheckItem[] = [
  {
    id: "check-postgresql",
    name: "Koneksi Basis Data PostgreSQL",
    category: "database",
    status: "healthy",
    latencyMs: 4,
    message: "PostgreSQL 17 siap menerima koneksi, connection pool normal.",
    checkedAt: "2026-10-13T09:30:00.000Z",
    requiredForDeploy: true,
  },
  {
    id: "check-migrations",
    name: "Integritas Skema & Migrasi Drizzle",
    category: "database",
    status: "healthy",
    latencyMs: 12,
    message:
      "Semua 12 berkas migrasi SQL telah diaplikasikan tanpa selisih skema.",
    checkedAt: "2026-10-13T09:30:00.000Z",
    requiredForDeploy: true,
  },
  {
    id: "check-mikrotik-api",
    name: "Konektivitas Router MikroTik",
    category: "network",
    status: "healthy",
    latencyMs: 28,
    message: "REST API v7 Router OS merespons 200 OK dengan latensi stabil.",
    checkedAt: "2026-10-13T09:29:45.000Z",
    requiredForDeploy: true,
  },
  {
    id: "check-olt-snmp",
    name: "Polling OLT EPON/GPON",
    category: "network",
    status: "healthy",
    latencyMs: 45,
    message: "SNMP agent OLT online, 4 PON port aktif terbaca.",
    checkedAt: "2026-10-13T09:29:30.000Z",
    requiredForDeploy: false,
  },
  {
    id: "check-disk-volume",
    name: "Kapasitas Disk & Volume Data",
    category: "storage",
    status: "healthy",
    latencyMs: 2,
    message: "Sisa ruang penyimpanan 48.2 GB (>20% threshold aman).",
    checkedAt: "2026-10-13T09:30:00.000Z",
    requiredForDeploy: true,
  },
  {
    id: "check-seed-data",
    name: "Ketersediaan Data Awal (Seed)",
    category: "service",
    status: "healthy",
    latencyMs: 8,
    message: "Ambang batas dan konfigurasi router bawaan telah terpasang.",
    checkedAt: "2026-10-13T09:30:00.000Z",
    requiredForDeploy: true,
  },
];

export const MOCK_BACKUP_SNAPSHOTS: readonly BackupSnapshotItem[] = [
  {
    id: "snap-pre-deploy-v1-2",
    label: "Snapshot Otomatis Pra-Migrasi v1.2",
    type: "pre_migration",
    sizeBytes: 15420000,
    status: "available",
    checksum: "sha256-a9f24e91823bc842",
    createdAt: "2026-10-13T09:25:00.000Z",
    filename: "noc_backup_pre_deploy_20261013_0925.sql.gz",
    canRestore: true,
  },
  {
    id: "snap-daily-golden",
    label: "Snapshot Harian Basis Data Penuh",
    type: "full_snapshot",
    sizeBytes: 42100000,
    status: "available",
    checksum: "sha256-78bc210f94821ca3",
    createdAt: "2026-10-13T00:00:00.000Z",
    filename: "noc_full_backup_20261013_0000.sql.gz",
    canRestore: true,
  },
  {
    id: "snap-schema-only",
    label: "Skema DDL Tanpa Data",
    type: "schema_only",
    sizeBytes: 840000,
    status: "available",
    checksum: "sha256-e8124a919248fca1",
    createdAt: "2026-10-12T18:00:00.000Z",
    filename: "noc_schema_ddl_20261012.sql",
    canRestore: true,
  },
];

export const MOCK_PREFLIGHT_CHECKS: readonly PreflightCheckItem[] = [
  {
    id: "pf-env-vars",
    label: "Variabel Lingkungan Wajib",
    description:
      "Memastikan DATABASE_URL, BETTER_AUTH_SECRET, dan kredensial perangkat terisi",
    passed: true,
    severity: "critical",
    detail:
      "Semua 8 variabel lingkungan wajib tervalidasi dengan format benar.",
  },
  {
    id: "pf-no-secret-leaks",
    label: "Pencegahan Kebocoran Kredensial",
    description:
      "Memastikan kata sandi & token terenkripsi AES-256-GCM dan tidak bocor ke log",
    passed: true,
    severity: "critical",
    detail: "Kredensial router & OLT tersimpan dalam bentuk terenkripsi.",
  },
  {
    id: "pf-schema-applied",
    label: "Status Migrasi Drizzle Terkini",
    description:
      "Memastikan target database memiliki tabel skema terbaru sebelum lalu lintas masuk",
    passed: true,
    severity: "critical",
    detail: "Tabel aplikasi telah terinisialisasi dan konsisten.",
  },
  {
    id: "pf-backup-ready",
    label: "Snapshot Pemulihan Tersedia",
    description:
      "Memastikan titik pemulihan instan tersedia sebelum perintah rilis dijalankan",
    passed: true,
    severity: "warning",
    detail: "Snapshot terbaru dibuat 10 menit yang lalu.",
  },
  {
    id: "pf-disk-space",
    label: "Batas Minimum Ruang Penyimpanan",
    description: "Memeriksa sisa kapasitas hard drive kontainer / server VPS",
    passed: true,
    severity: "warning",
    detail: "Ruang kosong di atas 10 GB (48.2 GB tersedia).",
  },
];

export const MOCK_ROLLBACK_HISTORY: readonly MigrationRollbackEvent[] = [
  {
    id: "rb-20261011-001",
    migrationFile: "0011_failing_column_type.sql",
    targetVersion: "0010_whatsapp_recipients",
    reason: "Konflik tipe data bigint ke integer pada kolom pppoe_session_id",
    remediationHint:
      "Perbaiki definisi skema Drizzle di src/db/schema/customers.ts agar menggunakan bigint() sebelum rilis ulang.",
    status: "success",
    affectedTables: ["customers", "audit_log"],
    durationMs: 340,
    actor: "system_safeguard",
    executedAt: "2026-10-11T16:45:10.000Z",
    revertStatementsCount: 3,
  },
  {
    id: "rb-20261008-002",
    migrationFile: "0007_redundant_index_drop.sql",
    targetVersion: "0006_billing_sync",
    reason:
      "Index unik terhapus secara tidak sengaja menyebabkan performa query menurun",
    remediationHint:
      "Pertahankan index pppoe_username_idx pada tabel billing_status untuk menjaga integritas pencarian.",
    status: "success",
    affectedTables: ["billing_status"],
    durationMs: 180,
    actor: "operator_admin",
    executedAt: "2026-10-08T09:12:00.000Z",
    revertStatementsCount: 2,
  },
  {
    id: "rb-20261002-003",
    migrationFile: "0003_broken_foreign_key.sql",
    targetVersion: "0002_devices_and_credentials",
    reason:
      "Foreign key router_id mereferensikan tabel yang belum terbentuk pada kontainer server",
    remediationHint:
      "Pastikan urutan dependensi tabel routers didefinisikan sebelum tabel customers.",
    status: "success",
    affectedTables: ["customers", "routers"],
    durationMs: 420,
    actor: "system_safeguard",
    executedAt: "2026-10-02T11:20:15.000Z",
    revertStatementsCount: 4,
  },
];

export function getMockDeploySafetyOverview(): DeploySafetyOverview {
  return {
    overallStatus: "ready_to_deploy",
    healthScorePercent: 100,
    totalChecks: MOCK_HEALTH_CHECKS.length,
    passedChecks: MOCK_HEALTH_CHECKS.filter((c) => c.status === "healthy")
      .length,
    failingChecks: MOCK_HEALTH_CHECKS.filter((c) => c.status === "failing")
      .length,
    activeSnapshotsCount: MOCK_BACKUP_SNAPSHOTS.length,
    latestSnapshotAt: MOCK_BACKUP_SNAPSHOTS[0]?.createdAt ?? null,
    rollbackReady: true,
    lastDeploymentAt: "2026-10-12T14:20:00.000Z",
    targetEnvironment: "production",
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
