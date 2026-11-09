// Data tiruan riwayat migrasi skema Drizzle ORM PostgreSQL.
// TIRUAN SEMENTARA: wajib dialihkan ke query nyata drizzle.__drizzle_migrations saat go-live (Fase 5).

export interface SchemaMigrationItem {
  idx: number;
  tag: string;
  name: string;
  description: string;
  folderMillis: number;
  appliedAt: string;
  status: "applied" | "pending" | "failed";
  statementsCount: number;
  durationMs: number;
  hash: string;
  batch: number;
  appliedBy: string;
  statementsSummary: readonly string[];
  errorMessage?: string | null;
  failedStatement?: string | null;
  remediationHint?: string | null;
  rollbackExecuted?: boolean;
}

export interface SchemaMigrationOverview {
  totalMigrations: number;
  appliedMigrations: number;
  pendingMigrations: number;
  failedMigrations: number;
  isUpToDate: boolean;
  status: "up_to_date" | "pending" | "failed";
  lastAppliedAt: string | null;
  lastFailure: {
    tag: string;
    name: string;
    error: string;
    failedStatement?: string | null;
    at: string;
    remediationHint?: string | null;
  } | null;
  advisoryLockKey: string;
  trackerTable: string;
  timescaleStatus: "active" | "inactive" | "not_installed";
  timescaleRetentionDays: number;
}

export interface SchemaMigrationFilter {
  status: "all" | "applied" | "pending" | "failed";
  query: string;
}

export const SCHEMA_MIGRATION_MOCK_ENTRY = {
  id: "schema-migrations-history",
  module: "Riwayat Migrasi Skema",
  targetDevice: "PostgreSQL drizzle.__drizzle_migrations",
  status: "dummy" as const,
  readPath: "src/lib/dashboard/schema-migrations.ts (getMockSchemaMigrations)",
  writePath: "POST /api/migrations/run",
  envKey: "DATABASE_URL",
  notes:
    "Tiruan sementara riwayat migrasi skema database; wajib dialihkan ke tabel pelacak migrasi nyata saat go-live Fase 5",
};

// Kunci advisory lock tetap dari scripts/migrate-server.mjs
export const MIGRATION_ADVISORY_LOCK_KEY = "727274001";
export const MIGRATION_TRACKER_TABLE = 'drizzle."__drizzle_migrations"';

export const MOCK_SCHEMA_MIGRATIONS: readonly SchemaMigrationItem[] = [
  {
    idx: 0,
    tag: "0000_auth",
    name: "Autentikasi & Akun Pengguna",
    description:
      "Inisialisasi tabel Better Auth: user, session, account, verification",
    folderMillis: 1788829112625,
    appliedAt: "2026-09-01T08:00:00.000Z",
    status: "applied",
    statementsCount: 6,
    durationMs: 42,
    hash: "a1b2c3d4e5f60102030405060708090a1b2c3d4e5f60102030405060708090aa",
    batch: 1,
    appliedBy: "CLI db:migrate",
    statementsSummary: [
      "CREATE TABLE IF NOT EXISTS user",
      "CREATE TABLE IF NOT EXISTS session",
      "CREATE TABLE IF NOT EXISTS account",
      "CREATE TABLE IF NOT EXISTS verification",
      "CREATE INDEX session_user_id_idx",
      "CREATE INDEX account_user_id_idx",
    ],
  },
  {
    idx: 1,
    tag: "0001_notes",
    name: "Tabel Catatan & Memo",
    description: "Tabel catatan operator dan pencatatan perbaikan konfigurasi",
    folderMillis: 1788876674880,
    appliedAt: "2026-09-01T21:11:14.000Z",
    status: "applied",
    statementsCount: 2,
    durationMs: 18,
    hash: "b2c3d4e5f6a102030405060708090a1b2c3d4e5f6a102030405060708090a1bb",
    batch: 1,
    appliedBy: "CLI db:migrate",
    statementsSummary: [
      "CREATE TABLE IF NOT EXISTS notes",
      "CREATE INDEX notes_user_id_idx",
    ],
  },
  {
    idx: 2,
    tag: "0002_roles",
    name: "Peran & Hak Akses Pengguna",
    description:
      "Penambahan kolom role pada tabel user untuk RBAC admin & viewer",
    folderMillis: 1788950762062,
    appliedAt: "2026-09-02T17:46:02.000Z",
    status: "applied",
    statementsCount: 2,
    durationMs: 15,
    hash: "c3d4e5f6a1b2030405060708090a1b2c3d4e5f6a1b2030405060708090a1b2cc",
    batch: 1,
    appliedBy: "CLI db:migrate",
    statementsSummary: [
      "ALTER TABLE user ADD COLUMN role text DEFAULT 'user'",
      "CREATE INDEX user_role_idx",
    ],
  },
  {
    idx: 3,
    tag: "0003_noc_core",
    name: "Infrastruktur Inti NOC (Router, OLT, PON, ONU)",
    description:
      "Tabel inventaris perangkat jaringan: routers, olts, olt_pon_ports, olt_onus",
    folderMillis: 1791365722595,
    appliedAt: "2026-09-30T17:35:22.000Z",
    status: "applied",
    statementsCount: 9,
    durationMs: 78,
    hash: "d4e5f6a1b2c30405060708090a1b2c3d4e5f6a1b2c30405060708090a1b2c3dd",
    batch: 2,
    appliedBy: "Runner Deploy",
    statementsSummary: [
      "CREATE TABLE IF NOT EXISTS routers",
      "CREATE TABLE IF NOT EXISTS olts",
      "CREATE TABLE IF NOT EXISTS olt_pon_ports",
      "CREATE TABLE IF NOT EXISTS olt_onus",
      "CREATE INDEX olt_pon_ports_olt_id_idx",
      "CREATE INDEX olt_onus_pon_port_id_idx",
    ],
  },
  {
    idx: 4,
    tag: "0004_traffic_archive",
    name: "Partisi Arsip Trafik & TimescaleDB",
    description:
      "Tabel sampel trafik berkala traffic_samples dengan retensi 30 hari",
    folderMillis: 1791372737920,
    appliedAt: "2026-09-30T19:32:17.000Z",
    status: "applied",
    statementsCount: 4,
    durationMs: 95,
    hash: "e5f6a1b2c3d405060708090a1b2c3d4e5f6a1b2c3d405060708090a1b2c3d4ee",
    batch: 2,
    appliedBy: "Runner Deploy",
    statementsSummary: [
      "CREATE TABLE IF NOT EXISTS traffic_samples",
      "SELECT create_hypertable('traffic_samples', 'time', if_not_exists => TRUE)",
      "SELECT add_retention_policy('traffic_samples', INTERVAL '30 days')",
      "CREATE INDEX traffic_samples_time_idx",
    ],
  },
  {
    idx: 5,
    tag: "0005_customer_odp",
    name: "Pemetaan Pelanggan & Lokasi ODP",
    description:
      "Tabel pelanggan customers dan pengikatan ke titik distribusi optik ODP",
    folderMillis: 1791377323595,
    appliedAt: "2026-09-30T20:48:43.000Z",
    status: "applied",
    statementsCount: 5,
    durationMs: 34,
    hash: "f6a1b2c3d4e5060708090a1b2c3d4e5f6a1b2c3d4e5060708090a1b2c3d4e5ff",
    batch: 2,
    appliedBy: "Runner Deploy",
    statementsSummary: [
      "CREATE TABLE IF NOT EXISTS customers",
      "ALTER TABLE olt_onus ADD COLUMN customer_id uuid REFERENCES customers(id)",
      "CREATE INDEX customers_pppoe_user_idx",
      "CREATE INDEX customers_odp_idx",
    ],
  },
  {
    idx: 6,
    tag: "0006_billing_sync",
    name: "Sinkronisasi Status Tagihan Billing",
    description:
      "Tabel log sinkron billing_sync_runs dan status pembayaran billing_status",
    folderMillis: 1791536008927,
    appliedAt: "2026-10-02T16:53:28.000Z",
    status: "applied",
    statementsCount: 6,
    durationMs: 51,
    hash: "a2b3c4d5e6f10708090a1b2c3d4e5f6a2b3c4d5e6f10708090a1b2c3d4e5f601",
    batch: 3,
    appliedBy: "CLI db:migrate",
    statementsSummary: [
      "CREATE TABLE IF NOT EXISTS billing_sync_runs",
      "CREATE TABLE IF NOT EXISTS billing_status",
      "CREATE TABLE IF NOT EXISTS billing_mismatches",
      "CREATE INDEX billing_status_customer_id_idx",
    ],
  },
  {
    idx: 7,
    tag: "0007_classy_doctor_doom",
    name: "Log Insiden & Ambang Alert",
    description:
      "Pencatatan gangguan network_logs dan konfigurasi batas alert_thresholds",
    folderMillis: 1791542109811,
    appliedAt: "2026-10-02T18:35:09.000Z",
    status: "applied",
    statementsCount: 5,
    durationMs: 39,
    hash: "b3c4d5e6f1a208090a1b2c3d4e5f6a2b3c4d5e6f1a208090a1b2c3d4e5f60202",
    batch: 3,
    appliedBy: "CLI db:migrate",
    statementsSummary: [
      "CREATE TABLE IF NOT EXISTS network_logs",
      "CREATE TABLE IF NOT EXISTS alert_thresholds",
      "CREATE INDEX network_logs_status_idx",
      "CREATE INDEX alert_thresholds_kind_idx",
    ],
  },
  {
    idx: 8,
    tag: "0008_chemical_black_queen",
    name: "Jejak Aktivitas Operator & Audit Log",
    description:
      "Tabel audit_log untuk merekam tindakan operator dan perubahan data",
    folderMillis: 1791550212450,
    appliedAt: "2026-10-02T20:50:12.000Z",
    status: "applied",
    statementsCount: 4,
    durationMs: 28,
    hash: "c4d5e6f1a2b3090a1b2c3d4e5f6a2b3c4d5e6f1a2b3090a1b2c3d4e5f6030303",
    batch: 3,
    appliedBy: "CLI db:migrate",
    statementsSummary: [
      "CREATE TABLE IF NOT EXISTS audit_log",
      "CREATE INDEX audit_log_created_at_idx",
      "CREATE INDEX audit_log_action_idx",
    ],
  },
  {
    idx: 9,
    tag: "0009_opposite_starhawk",
    name: "Notifikasi Alert WhatsApp",
    description:
      "Penerima notifikasi whatsapp_recipients dan log riwayat whatsapp_logs",
    folderMillis: 1791561009123,
    appliedAt: "2026-10-02T23:50:09.000Z",
    status: "applied",
    statementsCount: 6,
    durationMs: 44,
    hash: "d5e6f1a2b3c40a1b2c3d4e5f6a2b3c4d5e6f1a2b3c40a1b2c3d4e5f604040404",
    batch: 4,
    appliedBy: "Runner Deploy",
    statementsSummary: [
      "CREATE TABLE IF NOT EXISTS whatsapp_recipients",
      "CREATE TABLE IF NOT EXISTS whatsapp_logs",
      "CREATE INDEX whatsapp_logs_status_idx",
      "CREATE INDEX whatsapp_logs_sent_at_idx",
    ],
  },
  {
    idx: 10,
    tag: "0010_naive_deathbird",
    name: "Inspeksi Aliran Trafik NetFlow",
    description:
      "Tabel netflow_samples untuk menangkap aliran paket IP dan protokol",
    folderMillis: 1791572341999,
    appliedAt: "2026-10-03T02:59:01.000Z",
    status: "applied",
    statementsCount: 5,
    durationMs: 62,
    hash: "e6f1a2b3c4d51b2c3d4e5f6a2b3c4d5e6f1a2b3c4d51b2c3d4e5f60505050505",
    batch: 4,
    appliedBy: "Runner Deploy",
    statementsSummary: [
      "CREATE TABLE IF NOT EXISTS netflow_samples",
      "CREATE INDEX netflow_samples_router_id_idx",
      "CREATE INDEX netflow_samples_started_at_idx",
    ],
  },
  {
    idx: 11,
    tag: "0011_modern_mongoose",
    name: "Kredensial Billing & Token",
    description:
      "Penyimpanan kredensial billing terenkripsi dan token sesi penyelarasan",
    folderMillis: 1791580120000,
    appliedAt: "2026-10-03T05:08:40.000Z",
    status: "applied",
    statementsCount: 3,
    durationMs: 25,
    hash: "f1a2b3c4d5e62c3d4e5f6a2b3c4d5e6f1a2b3c4d5e62c3d4e5f6060606060606",
    batch: 4,
    appliedBy: "Runner Deploy",
    statementsSummary: [
      "CREATE TABLE IF NOT EXISTS billing_credentials",
      "CREATE INDEX billing_credentials_provider_idx",
    ],
  },
  {
    idx: 12,
    tag: "0012_mean_miek",
    name: "Log Hasil Uji Koneksi Perangkat",
    description:
      "Tabel device_test_results untuk mencatat riwayat ping/preflight Router & OLT",
    folderMillis: 1791591112222,
    appliedAt: "2026-10-03T08:11:52.000Z",
    status: "applied",
    statementsCount: 4,
    durationMs: 31,
    hash: "a3b4c5d6e7f83d4e5f6a2b3c4d5e6f1a3b4c5d6e7f83d4e5f607070707070707",
    batch: 5,
    appliedBy: "Sistem (Auto-Migrate)",
    statementsSummary: [
      "CREATE TABLE IF NOT EXISTS device_test_results",
      "CREATE INDEX device_test_results_device_id_idx",
      "CREATE INDEX device_test_results_created_at_idx",
    ],
  },
  {
    idx: 13,
    tag: "0013_public_spot",
    name: "Tugas Diagnostik CPE & Riwayat",
    description:
      "Tabel cpe_tasks untuk manajemen pekerjaan teknisi lapangan & diagnostik",
    folderMillis: 1791602223333,
    appliedAt: "2026-10-03T11:17:03.000Z",
    status: "applied",
    statementsCount: 5,
    durationMs: 36,
    hash: "b4c5d6e7f8a94e5f6a2b3c4d5e6f1a2b4c5d6e7f8a94e5f60808080808080808",
    batch: 5,
    appliedBy: "Sistem (Auto-Migrate)",
    statementsSummary: [
      "CREATE TABLE IF NOT EXISTS cpe_tasks",
      "CREATE INDEX cpe_tasks_customer_id_idx",
      "CREATE INDEX cpe_tasks_status_idx",
    ],
  },
  {
    idx: 14,
    tag: "0014_rich_rhodey",
    name: "Indeks Laporan Terintegrasi & Pengarsipan",
    description:
      "Penambahan indeks gabungan untuk agregasi ekspor dan audit performa",
    folderMillis: 1791613334444,
    appliedAt: "2026-10-03T14:22:14.000Z",
    status: "applied",
    statementsCount: 4,
    durationMs: 29,
    hash: "c5d6e7f8a9b05f6a2b3c4d5e6f1a2b3c5d6e7f8a9b05f6090909090909090909",
    batch: 5,
    appliedBy: "Sistem (Auto-Migrate)",
    statementsSummary: [
      "CREATE INDEX IF NOT EXISTS traffic_samples_router_time_idx",
      "CREATE INDEX IF NOT EXISTS network_logs_type_status_idx",
    ],
  },
];

export const MOCK_FAILED_MIGRATION_SAMPLE: SchemaMigrationItem = {
  idx: 15,
  tag: "0015_broken_constraint",
  name: "Constraint Unik Tambahan Pelanggan",
  description:
    "Penambahan constraint unik customer_phone_unique pada tabel customers",
  folderMillis: 1791624445555,
  appliedAt: "2026-10-03T16:00:00.000Z",
  status: "failed",
  statementsCount: 2,
  durationMs: 14,
  hash: "d6e7f8a9b0c16f7a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f60",
  batch: 6,
  appliedBy: "Runner Deploy",
  statementsSummary: [
    "ALTER TABLE customers ADD CONSTRAINT customer_phone_unique UNIQUE (phone)",
  ],
  errorMessage:
    'Key (phone)=(+628123456789) is duplicated in table "customers". Violates unique constraint.',
  failedStatement:
    "ALTER TABLE customers ADD CONSTRAINT customer_phone_unique UNIQUE (phone)",
  remediationHint:
    "Bersihkan atau gabungkan duplikat nomor telepon sebelum menerapkan constraint unik.",
  rollbackExecuted: true,
};

export function getMockSchemaMigrations(
  includeFailure = false,
): readonly SchemaMigrationItem[] {
  if (includeFailure) {
    return [...MOCK_SCHEMA_MIGRATIONS, MOCK_FAILED_MIGRATION_SAMPLE];
  }
  return MOCK_SCHEMA_MIGRATIONS;
}

export function getMockMigrationOverview(
  migrations: readonly SchemaMigrationItem[] = MOCK_SCHEMA_MIGRATIONS,
): SchemaMigrationOverview {
  const all = migrations;
  const applied = all.filter((m) => m.status === "applied").length;
  const pending = all.filter((m) => m.status === "pending").length;
  const failed = all.filter((m) => m.status === "failed").length;
  const failedItem = all.find((m) => m.status === "failed");

  const lastApplied = all
    .filter((m) => m.status === "applied")
    .map((m) => m.appliedAt)
    .sort()
    .pop();

  const status: "up_to_date" | "pending" | "failed" =
    failed > 0 ? "failed" : pending > 0 ? "pending" : "up_to_date";

  return {
    totalMigrations: all.length,
    appliedMigrations: applied,
    pendingMigrations: pending,
    failedMigrations: failed,
    isUpToDate: pending === 0 && failed === 0,
    status,
    lastAppliedAt: lastApplied ?? null,
    lastFailure: failedItem
      ? {
          tag: failedItem.tag,
          name: failedItem.name,
          error:
            failedItem.errorMessage || "Eksekusi SQL gagal dan di-rollback.",
          failedStatement: failedItem.failedStatement,
          at: failedItem.appliedAt,
          remediationHint: failedItem.remediationHint,
        }
      : null,
    advisoryLockKey: MIGRATION_ADVISORY_LOCK_KEY,
    trackerTable: MIGRATION_TRACKER_TABLE,
    timescaleStatus: "active",
    timescaleRetentionDays: 30,
  };
}

export function filterSchemaMigrations(
  migrations: readonly SchemaMigrationItem[],
  filter: SchemaMigrationFilter,
): readonly SchemaMigrationItem[] {
  const q = filter.query.trim().toLowerCase();

  return migrations.filter((m) => {
    if (filter.status !== "all" && m.status !== filter.status) {
      return false;
    }
    if (!q) return true;

    return (
      m.tag.toLowerCase().includes(q) ||
      m.name.toLowerCase().includes(q) ||
      m.description.toLowerCase().includes(q) ||
      m.appliedBy.toLowerCase().includes(q) ||
      (m.errorMessage && m.errorMessage.toLowerCase().includes(q)) ||
      m.statementsSummary.some((s) => s.toLowerCase().includes(q))
    );
  });
}
