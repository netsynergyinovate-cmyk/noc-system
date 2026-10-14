// Data model & helper ringkasan seed data awal (akun, perangkat, ambang, kontak).
// TIRUAN SEMENTARA: wajib dialihkan ke database/runner nyata saat go-live Fase 5.

export interface SeedDataItem {
  id: string;
  category: "accounts" | "thresholds" | "devices" | "whatsapp" | "billing";
  name: string;
  description: string;
  targetTable: string;
  status: "seeded" | "pending" | "missing";
  recordsCount: number;
  isIdempotent: boolean;
  checksum: string;
  lastSeededAt: string | null;
  items: Array<{
    key: string;
    label: string;
    value: string;
  }>;
}

export interface SeedSummaryOverview {
  totalCategories: number;
  seededCategories: number;
  pendingCategories: number;
  totalRecords: number;
  overallStatus: "ready" | "needs_seed" | "in_progress";
  lastVerifiedAt: string | null;
}

export const SEED_DATA_MOCK_ENTRY = {
  id: "seed-data-summary",
  module: "Ringkasan Seed Data Awal",
  targetDevice: "Inisialisasi Data Database (Seed Runner)",
  status: "dummy" as const,
  readPath: "src/lib/dashboard/seed-data.ts (getMockSeedDataList)",
  writePath: "POST /api/seed/run",
  envKey: "DATABASE_URL",
  notes:
    "Tiruan sementara data ringkasan seed; wajib dialihkan ke query database riil saat go-live Fase 5",
};

export const MOCK_SEED_DATA_ITEMS: readonly SeedDataItem[] = [
  {
    id: "seed-accounts",
    category: "accounts",
    name: "Akun Pengguna Awal (RBAC)",
    description: "Akun admin NOC dan petugas view-only dengan hash Better Auth (scrypt)",
    targetTable: "user, account, session",
    status: "seeded",
    recordsCount: 2,
    isIdempotent: true,
    checksum: "sha256-acc-f9024b81c2d0",
    lastSeededAt: "2026-10-13T07:30:00.000Z",
    items: [
      { key: "admin", label: "Admin NOC", value: "admin@noc.local (Role: admin)" },
      { key: "viewer", label: "Petugas Hanya-Lihat", value: "viewer@noc.local (Role: user)" },
    ],
  },
  {
    id: "seed-thresholds",
    category: "thresholds",
    name: "Ambang Batas Anomali Bawaan",
    description: "5 aturan deteksi alert gangguan (CPU, antrean, port, optik, offline)",
    targetTable: "app_settings / network_rules",
    status: "seeded",
    recordsCount: 5,
    isIdempotent: true,
    checksum: "sha256-thr-5a39801ef042",
    lastSeededAt: "2026-10-13T07:30:00.000Z",
    items: [
      { key: "cpu", label: "CPU Router", value: "≥ 85% selama 300 dtk" },
      { key: "queue", label: "Antrean Buffer", value: "≥ 90% selama 180 dtk" },
      { key: "port", label: "Port Error", value: "≥ 50 err/menit" },
      { key: "optical", label: "Daya Optik ONU", value: "≤ -27.0 dBm" },
      { key: "offline", label: "CPE Offline", value: "≥ 60 detik" },
    ],
  },
  {
    id: "seed-devices",
    category: "devices",
    name: "Profil Perangkat Jaringan Awal",
    description: "Router MikroTik Gateway utama dan OLT HSGQ EPON/GPON",
    targetTable: "routers, olt_devices",
    status: "seeded",
    recordsCount: 2,
    isIdempotent: true,
    checksum: "sha256-dev-c7104d80a153",
    lastSeededAt: "2026-10-13T07:30:00.000Z",
    items: [
      { key: "router-core", label: "Router Core MikroTik", value: "CCR2004-16G-2S+ (192.168.88.1)" },
      { key: "olt-hsgq", label: "OLT HSGQ EPON", value: "EPON 4-Port (192.168.8.100)" },
    ],
  },
  {
    id: "seed-whatsapp",
    category: "whatsapp",
    name: "Kontak Teknis Notifikasi WhatsApp",
    description: "Nomor darurat eskalasi teknisi NOC dan template pesan alert",
    targetTable: "whatsapp_recipients, notification_templates",
    status: "seeded",
    recordsCount: 3,
    isIdempotent: true,
    checksum: "sha256-wa-88e291b0c034",
    lastSeededAt: "2026-10-13T07:30:00.000Z",
    items: [
      { key: "lead", label: "Kepala Teknisi", value: "6281200000001 (Kritis & Peringatan)" },
      { key: "noc-oncall", label: "NOC On-Call", value: "6281200000002 (Kritis)" },
      { key: "bot-group", label: "Grup Patroli Fiber", value: "group:120363040001@g.us" },
    ],
  },
  {
    id: "seed-billing",
    category: "billing",
    name: "Konfigurasi Integrasi Billing",
    description: "Parameter pencocokan akun PPPoE dan toleransi Levenshtein distance",
    targetTable: "billing_config, billing_sync_state",
    status: "seeded",
    recordsCount: 1,
    isIdempotent: true,
    checksum: "sha256-bil-3b7c0102e88a",
    lastSeededAt: "2026-10-13T07:30:00.000Z",
    items: [
      { key: "match-mode", label: "Metode Pasangan", value: "PPPoE Username & Max Distance = 2" },
      { key: "drop-threshold", label: "Batas Drop Faktur", value: "BILLING_DROP_PERCENT = 50%" },
    ],
  },
];

export function getMockSeedDataList(): readonly SeedDataItem[] {
  return MOCK_SEED_DATA_ITEMS;
}

export function getMockSeedSummaryOverview(
  items: readonly SeedDataItem[] = MOCK_SEED_DATA_ITEMS,
): SeedSummaryOverview {
  const seeded = items.filter((i) => i.status === "seeded").length;
  const pending = items.filter((i) => i.status !== "seeded").length;
  const totalRecs = items.reduce((sum, i) => sum + i.recordsCount, 0);

  const lastVerified = items
    .map((i) => i.lastSeededAt)
    .filter(Boolean)
    .sort()
    .pop();

  return {
    totalCategories: items.length,
    seededCategories: seeded,
    pendingCategories: pending,
    totalRecords: totalRecs,
    overallStatus: pending === 0 ? "ready" : "needs_seed",
    lastVerifiedAt: lastVerified ?? null,
  };
}
