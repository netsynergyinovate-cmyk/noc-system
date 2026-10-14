import {
  SETUP_DATA_SOURCE_REGISTRY,
  type DataSourceEntry,
} from "./setup-extended.ts";

export interface PageDataSourceMapping {
  pagePath: string;
  pageTitle: string;
  category: "Monitoring" | "Infrastruktur" | "Pelanggan & Billing" | "Sistem";
  primaryModuleId: string;
  secondaryModuleIds?: string[];
  status: "dummy" | "nyata";
  envKey: string;
  readPath: string;
  writePath: string;
  goLiveCriterion: string;
}

export const PAGE_DATA_SOURCES: readonly PageDataSourceMapping[] = [
  {
    pagePath: "/app",
    pageTitle: "Dashboard Utama",
    category: "Monitoring",
    primaryModuleId: "dashboard-kpi-metrics",
    status: "dummy",
    envKey: "DASHBOARD_DATA",
    readPath: "src/lib/dashboard/metric-board-data.ts",
    writePath: "-",
    goLiveCriterion: "Terkoneksi ke agregator data perangkat aktif",
  },
  {
    pagePath: "/app/alert",
    pageTitle: "Papan Alert Gangguan",
    category: "Monitoring",
    primaryModuleId: "alert-board-data",
    status: "dummy",
    envKey: "DASHBOARD_DATA",
    readPath: "src/lib/dashboard/alert-board-mock.ts",
    writePath: "POST /api/v1/alerts/{id}/handle",
    goLiveCriterion: "Terkoneksi ke Go Rule Engine / WebSocket Hub",
  },
  {
    pagePath: "/app/anomali",
    pageTitle: "Deteksi Anomali Jaringan",
    category: "Monitoring",
    primaryModuleId: "anomaly-detection-incidents",
    status: "dummy",
    envKey: "ANOMALY_DETECTION_ENABLED",
    readPath: "src/lib/dashboard/anomalies.ts",
    writePath: "-",
    goLiveCriterion: "Deteksi deviasi trafik & degradasi optik otomatis",
  },
  {
    pagePath: "/app/netflow",
    pageTitle: "Papan NetFlow & Aliran Trafik",
    category: "Monitoring",
    primaryModuleId: "netflow-traffic-flows",
    status: "dummy",
    envKey: "NETFLOW_COLLECTOR_HOST",
    readPath: "src/lib/dashboard/netflow.ts",
    writePath: "-",
    goLiveCriterion: "Menerima paket UDP NetFlow v9 dari router",
  },
  {
    pagePath: "/app/traffic",
    pageTitle: "Trafik & Tren Bandwidth",
    category: "Monitoring",
    primaryModuleId: "traffic-trend-samples",
    status: "dummy",
    envKey: "DASHBOARD_DATA",
    readPath: "src/lib/dashboard/traffic-trend-data.ts",
    writePath: "-",
    goLiveCriterion: "Time-series database PostgreSQL / TimescaleDB",
  },
  {
    pagePath: "/app/router",
    pageTitle: "Router MikroTik",
    category: "Infrastruktur",
    primaryModuleId: "mikrotik-rest",
    secondaryModuleIds: ["network-devices-overview"],
    status: "dummy",
    envKey: "MIKROTIK_REST_HOST",
    readPath: "src/lib/dashboard/devices.ts",
    writePath: "POST /api/routers",
    goLiveCriterion: "REST API RouterOS v7 terautentikasi",
  },
  {
    pagePath: "/app/cpe",
    pageTitle: "OLT HSGQ & Port Optik",
    category: "Infrastruktur",
    primaryModuleId: "olt-hsgq",
    secondaryModuleIds: ["pon-port-onu-table", "genieacs-nbi"],
    status: "dummy",
    envKey: "OLT_HSGQ_HOST",
    readPath: "src/lib/dashboard/pon-port-table-data.ts",
    writePath: "POST /api/olts",
    goLiveCriterion: "SNMP polling OLT & GenieACS TR-069 NBI aktif",
  },
  {
    pagePath: "/app/pelanggan",
    pageTitle: "Manajemen Pelanggan",
    category: "Pelanggan & Billing",
    primaryModuleId: "billing-scraper",
    status: "dummy",
    envKey: "BILLING_URL",
    readPath: "src/lib/dashboard/billing.ts",
    writePath: "POST /api/customers",
    goLiveCriterion: "Tabel PostgreSQL customers & PPPoE sync",
  },
  {
    pagePath: "/app/billing",
    pageTitle: "Status Pembayaran Billing",
    category: "Pelanggan & Billing",
    primaryModuleId: "billing-scraper",
    status: "dummy",
    envKey: "BILLING_URL",
    readPath: "src/lib/dashboard/billing.ts",
    writePath: "POST /api/billing/sync",
    goLiveCriterion: "Scraper HTML billing atau webhooks pembayaran",
  },
  {
    pagePath: "/app/pengaturan",
    pageTitle: "Pengaturan Ambang & WhatsApp",
    category: "Sistem",
    primaryModuleId: "whatsapp-notification-log",
    status: "dummy",
    envKey: "WHATSAPP_API_KEY",
    readPath: "src/lib/dashboard/whatsapp-log.ts",
    writePath: "POST /api/settings",
    goLiveCriterion: "Gateway WhatsApp aktif & tabel alert_thresholds",
  },
  {
    pagePath: "/app/migrasi",
    pageTitle: "Migrasi Skema Otomatis",
    category: "Sistem",
    primaryModuleId: "schema-migrations-history",
    status: "dummy",
    envKey: "AUTO_MIGRATE_ON_STARTUP",
    readPath: "src/lib/dashboard/schema-migrations.ts",
    writePath: "POST /api/migrations/run",
    goLiveCriterion: "Drizzle migrations runner & metadata tracking",
  },
  {
    pagePath: "/app/sinkronisasi",
    pageTitle: "Sinkronisasi & Penyelarasan Data",
    category: "Sistem",
    primaryModuleId: "data-sync-runs",
    secondaryModuleIds: [
      "seed-data-summary",
      "transfer-status-summary",
      "auto-alignment-status",
      "sync-history-log",
    ],
    status: "dummy",
    envKey: "TARGET_DATABASE_URL",
    readPath: "src/lib/dashboard/data-sync.ts",
    writePath: "POST /api/transfer/run, POST /api/alignment",
    goLiveCriterion: "Daemon sync transaksional & pg advisory locks",
  },
  {
    pagePath: "/app/pengaman-deploy",
    pageTitle: "Pengaman Deploy & Rilis",
    category: "Sistem",
    primaryModuleId: "deploy-safety-status",
    status: "dummy",
    envKey: "DEPLOY_SAFETY_ENABLED",
    readPath: "src/lib/dashboard/deploy-safety.ts",
    writePath: "POST /api/deploy/preflight",
    goLiveCriterion: "Health check suite & snapshot backup engine",
  },
  {
    pagePath: "/app/onboarding",
    pageTitle: "Pusat Onboarding & Tutorial Wajib",
    category: "Sistem",
    primaryModuleId: "onboarding-center-mock",
    secondaryModuleIds: ["page-tips-mock-content", "optional-integrations-mock"],
    status: "dummy",
    envKey: "DASHBOARD_DATA",
    readPath: "src/lib/dashboard/onboarding-data.ts",
    writePath: "POST /api/onboarding/steps/{id}/complete",
    goLiveCriterion: "Tabel PostgreSQL onboarding_steps & onboarding_progress",
  },
  {
    pagePath: "/app/jejak-aktivitas",
    pageTitle: "Jejak Aktivitas & Audit Log",
    category: "Sistem",
    primaryModuleId: "audit-log-events",
    status: "dummy",
    envKey: "DATABASE_URL",
    readPath: "src/lib/dashboard/audit.ts",
    writePath: "POST /api/audit",
    goLiveCriterion: "Tabel PostgreSQL audit_log gagal-aman",
  },
  {
    pagePath: "/app/ekspor",
    pageTitle: "Ekspor Data & Laporan",
    category: "Sistem",
    primaryModuleId: "export-reports-data",
    status: "dummy",
    envKey: "DATABASE_URL",
    readPath: "src/lib/dashboard/export.ts",
    writePath: "POST /api/export",
    goLiveCriterion: "Streaming export CSV & Excel dari tabel nyata",
  },
];

export interface PageDataSourceSummary {
  totalPages: number;
  dummyPages: number;
  nyataPages: number;
  readinessPercentage: number;
  totalModules: number;
}

export function getPageDataSourceSummary(
  items: readonly PageDataSourceMapping[] = PAGE_DATA_SOURCES,
): PageDataSourceSummary {
  const totalPages = items.length;
  const dummyPages = items.filter((p) => p.status === "dummy").length;
  const nyataPages = items.filter((p) => p.status === "nyata").length;
  const readinessPercentage =
    totalPages > 0 ? Math.round((nyataPages / totalPages) * 100) : 0;

  return {
    totalPages,
    dummyPages,
    nyataPages,
    readinessPercentage,
    totalModules: SETUP_DATA_SOURCE_REGISTRY.length,
  };
}
