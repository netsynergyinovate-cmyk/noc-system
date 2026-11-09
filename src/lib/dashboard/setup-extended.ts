// Data tiruan + helper halaman Setup Perangkat. TIRUAN SEMENTARA: wajib dihapus /
// dialihkan ke backend nyata saat go-live (Fase 5). Murni.
import { PON_ONU_DATA_MOCK_ENTRY } from "./pon-port-table-data.ts";
import { TRAFFIC_TREND_MOCK_ENTRY } from "./traffic-trend-data.ts";
import { NETFLOW_DATA_MOCK_ENTRY } from "./netflow.ts";
import { ANOMALY_DETECTION_MOCK_ENTRY } from "./anomaly-mock-entry.ts";
import { AUDIT_LOG_MOCK_ENTRY } from "./audit.ts";
import { EXPORT_DATA_MOCK_ENTRY } from "./export.ts";
import { SCHEMA_MIGRATION_MOCK_ENTRY } from "./schema-migrations.ts";
import { DATA_SYNC_MOCK_ENTRY } from "./data-sync.ts";
import { TRANSFER_STATUS_MOCK_ENTRY } from "./transfer-status.ts";
import { AUTO_ALIGNMENT_MOCK_ENTRY } from "./auto-alignment.ts";
import { SYNC_HISTORY_MOCK_ENTRY } from "./sync-history.ts";
import { DEPLOY_SAFETY_MOCK_ENTRY } from "./deploy-safety.ts";
import { ONBOARDING_CENTER_MOCK_ENTRY } from "./onboarding-data.ts";
import { ONBOARDING_MIKROTIK_MOCK_ENTRY } from "./onboarding-mikrotik.ts";
import { OPTIONAL_INTEGRATIONS_MOCK_ENTRY } from "./optional-integrations.ts";
import { PAGE_TIPS_MOCK_ENTRY } from "./page-tips-data.ts";

export {
  SCHEMA_MIGRATION_MOCK_ENTRY,
  DATA_SYNC_MOCK_ENTRY,
  TRANSFER_STATUS_MOCK_ENTRY,
  AUTO_ALIGNMENT_MOCK_ENTRY,
  SYNC_HISTORY_MOCK_ENTRY,
  DEPLOY_SAFETY_MOCK_ENTRY,
  ONBOARDING_CENTER_MOCK_ENTRY,
  ONBOARDING_MIKROTIK_MOCK_ENTRY,
  OPTIONAL_INTEGRATIONS_MOCK_ENTRY,
  PAGE_TIPS_MOCK_ENTRY,
};

export interface DataSourceEntry {
  id: string;
  module: string;
  targetDevice: string;
  status: "dummy" | "nyata";
  readPath: string;
  writePath: string;
  envKey: string;
  notes: string;
}

const GO_LIVE_NOTE =
  "Tiruan sementara di lingkungan uji; wajib dialihkan ke backend nyata saat go-live Fase 5";

export const SETUP_DATA_SOURCE_REGISTRY: readonly DataSourceEntry[] = [
  {
    id: "mikrotik-rest",
    module: "Router MikroTik",
    targetDevice: "Router MikroTik (REST API v7)",
    status: "dummy",
    readPath: "src/lib/dashboard/devices.ts (mockSetupDevices)",
    writePath: "POST /api/routers/test, POST /api/routers",
    envKey: "MIKROTIK_REST_HOST",
    notes: GO_LIVE_NOTE,
  },
  {
    id: "olt-hsgq",
    module: "OLT HSGQ",
    targetDevice: "OLT HSGQ",
    status: "dummy",
    readPath: "src/lib/dashboard/devices.ts (mockTestConnection)",
    writePath: "POST /api/olts/test, POST /api/olts",
    envKey: "OLT_HSGQ_HOST",
    notes: GO_LIVE_NOTE,
  },
  {
    id: "genieacs-nbi",
    module: "GenieACS NBI",
    targetDevice: "GenieACS NBI (CPE/ONU)",
    status: "dummy",
    readPath: "src/lib/dashboard/devices.ts (mockTestConnection)",
    writePath: "POST /api/devices/test",
    envKey: "GENIEACS_NBI_URL",
    notes: GO_LIVE_NOTE,
  },
  {
    id: "billing-scraper",
    module: "Billing Scraper",
    targetDevice: "Sistem Billing",
    status: "dummy",
    readPath: "src/lib/dashboard/billing.ts (loadBilling)",
    writePath: "POST /api/billing/test",
    envKey: "BILLING_URL",
    notes: GO_LIVE_NOTE,
  },
  {
    id: "dashboard-kpi-metrics",
    module: "Papan Metrik Dashboard",
    targetDevice: "Router & OLT & Billing Aggregator",
    status: "dummy",
    readPath: "src/lib/dashboard/metric-board-data.ts (generateMockDashboardMetrics)",
    writePath: "-",
    envKey: "DASHBOARD_DATA",
    notes:
      "Tiruan sementara metrik ringkasan NOC; wajib dialihkan ke agregator backend nyata saat go-live Fase 5",
  },
  {
    id: "alert-board-data",
    module: "Papan Alert Gangguan",
    targetDevice: "Go Rule Engine / Alert Hub",
    status: "dummy",
    readPath: "src/lib/dashboard/alert-board-mock.ts (generateMockAlertKpi)",
    writePath: "POST /api/v1/alerts/{id}/handle",
    envKey: "DASHBOARD_DATA",
    notes:
      "Tiruan sementara data alert & metrik gangguan; wajib dialihkan ke Go WebSocket Hub nyata di Fase 5",
  },
  {
    id: "whatsapp-notification-log",
    module: "Log Notifikasi WhatsApp",
    targetDevice: "Gateway WhatsApp / DB network_logs",
    status: "dummy",
    readPath: "src/lib/dashboard/whatsapp-log.ts (loadWhatsappLogs)",
    writePath: "POST /api/v1/notifications/whatsapp/resend",
    envKey: "WHATSAPP_API_KEY",
    notes:
      "Tiruan sementara log pengiriman pesan WhatsApp; wajib dialihkan ke tabel log database di Fase 5",
  },
  {
    id: "network-devices-overview",
    module: "Ringkasan Jaringan & Router",
    targetDevice: "Router MikroTik v7 REST API",
    status: "dummy",
    readPath: "src/lib/dashboard/network-mock-data.ts (getMockNetworkOverview)",
    writePath: "POST /api/routers",
    envKey: "MIKROTIK_REST_HOST",
    notes:
      "Tiruan sementara data topologi & metrik router MikroTik; wajib dialihkan ke REST API perangkat nyata di Fase 5",
  },
  PON_ONU_DATA_MOCK_ENTRY,
  TRAFFIC_TREND_MOCK_ENTRY,
  NETFLOW_DATA_MOCK_ENTRY,
  ANOMALY_DETECTION_MOCK_ENTRY,
  AUDIT_LOG_MOCK_ENTRY,
  EXPORT_DATA_MOCK_ENTRY,
  SCHEMA_MIGRATION_MOCK_ENTRY,
  DATA_SYNC_MOCK_ENTRY,
  TRANSFER_STATUS_MOCK_ENTRY,
  AUTO_ALIGNMENT_MOCK_ENTRY,
  SYNC_HISTORY_MOCK_ENTRY,
  DEPLOY_SAFETY_MOCK_ENTRY,
  ONBOARDING_CENTER_MOCK_ENTRY,
  ONBOARDING_MIKROTIK_MOCK_ENTRY,
  OPTIONAL_INTEGRATIONS_MOCK_ENTRY,
  PAGE_TIPS_MOCK_ENTRY,
];

export interface SetupTipGroup {
  id: "cara-kerja" | "masalah-umum" | "solusi";
  title: string;
  items: readonly { title: string; body: string }[];
}

export const SETUP_PAGE_TIPS: readonly SetupTipGroup[] = [
  {
    id: "cara-kerja",
    title: "Cara Kerja Setup",
    items: [
      {
        title: "Gerbang konfigurasi router",
        body: "Dashboard NOC hanya terbuka setelah minimal satu router MikroTik aktif dan lolos uji koneksi. OLT, GenieACS, dan Billing bersifat opsional.",
      },
    ],
  },
  {
    id: "masalah-umum",
    title: "Masalah Umum",
    items: [
      {
        title: "Timeout koneksi",
        body: "IP/host salah atau port 443 (REST API) tertutup oleh firewall.",
      },
      {
        title: "Ditolak autentikasi",
        body: "Username atau password salah (HTTP 401).",
      },
      {
        title: "Mode simulator aktif",
        body: "Perangkat memakai data tiruan, bukan jaringan nyata. Pilih Perangkat Asli untuk koneksi sebenarnya.",
      },
    ],
  },
  {
    id: "solusi",
    title: "Solusi & Tindakan",
    items: [
      {
        title: "Verifikasi rute jaringan",
        body: "Pastikan server NOC dapat menjangkau IP perangkat (ping, traceroute) dan port 443 terbuka.",
      },
      {
        title: "Periksa variabel env",
        body: "Cek MIKROTIK_REST_HOST/USER/PASSWORD dan variabel perangkat lain sudah terisi.",
      },
      {
        title: "Uji koneksi ulang",
        body: "Perbaiki isian lalu jalankan Uji Koneksi & Simpan Perangkat lagi.",
      },
    ],
  },
];

export const DEVICE_KIND_OPTIONS = [
  { value: "router", label: "Router MikroTik (Wajib)" },
  { value: "olt", label: "OLT HSGQ (Opsional)" },
  { value: "genieacs", label: "GenieACS NBI (Opsional)" },
  { value: "billing", label: "Sistem Billing (Opsional)" },
] as const;

export const DEVICE_KIND_SHORT: Readonly<Record<string, string>> = {
  router: "Router",
  olt: "OLT",
  genieacs: "GenieACS",
  billing: "Billing",
};

export interface SetupProgress {
  routerConfigured: boolean;
  oltConfigured: boolean;
  optionalCount: number;
  isGatePassed: boolean;
  pendingNotice: string | null;
}

export function evaluateSetupProgress(
  devices: readonly { kind: string; status: string }[],
): SetupProgress {
  const active = devices.filter((d) => d.status === "aktif");
  const routerConfigured = active.some((d) => d.kind === "router");
  return {
    routerConfigured,
    oltConfigured: active.some((d) => d.kind === "olt"),
    optionalCount: active.filter((d) => d.kind !== "router").length,
    isGatePassed: routerConfigured,
    pendingNotice: routerConfigured
      ? null
      : "Gerbang belum lulus: tambahkan dan aktifkan minimal satu Router MikroTik sebelum dashboard terbuka.",
  };
}
