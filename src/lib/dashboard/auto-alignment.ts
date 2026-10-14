// Data model & helper status penyelarasan otomatis (auto-alignment scheduler/daemon).
// TIRUAN SEMENTARA: wajib dialihkan ke background scheduler nyata saat go-live (Fase 5).

export interface AutoAlignmentJobItem {
  id: string;
  name: string;
  targetService: string;
  intervalSeconds: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
  status: "idle" | "running" | "healthy" | "degraded" | "failed";
  enabled: boolean;
  consecutiveSuccesses: number;
  consecutiveFailures: number;
  averageLatencyMs: number;
  description: string;
}

export interface AutoAlignmentOverview {
  schedulerStatus: "running" | "paused" | "degraded";
  activeWorkers: number;
  totalJobs: number;
  enabledJobs: number;
  healthyJobs: number;
  failingJobs: number;
  lastGlobalTickAt: string | null;
  backoffModeActive: boolean;
}

export const AUTO_ALIGNMENT_MOCK_ENTRY = {
  id: "auto-alignment-status",
  module: "Status Penyelarasan Otomatis",
  targetDevice: "Daemon Penyelarasan / Background Sync Engine",
  status: "dummy" as const,
  readPath: "src/lib/dashboard/auto-alignment.ts (getMockAlignmentJobs)",
  writePath: "POST /api/alignment/toggle",
  envKey: "SCHEDULER_ENABLED",
  notes:
    "Tiruan sementara scheduler penyelarasan; wajib dialihkan ke worker background Go/Node nyata saat go-live Fase 5",
};

export const MOCK_ALIGNMENT_JOBS: readonly AutoAlignmentJobItem[] = [
  {
    id: "align-mikrotik-telemetry",
    name: "Telemetri Router MikroTik",
    targetService: "Router REST API & Queue Monitor",
    intervalSeconds: 15,
    lastRunAt: "2026-10-13T08:50:00.000Z",
    nextRunAt: "2026-10-13T08:50:15.000Z",
    status: "healthy",
    enabled: true,
    consecutiveSuccesses: 1420,
    consecutiveFailures: 0,
    averageLatencyMs: 42,
    description: "Penyelarasan utilisasi CPU, memory, trafik port, dan sesi PPPoE aktif",
  },
  {
    id: "align-olt-optical",
    name: "Daya Optik & Sinyal OLT",
    targetService: "OLT HSGQ SNMP / Telnet Poller",
    intervalSeconds: 30,
    lastRunAt: "2026-10-13T08:49:50.000Z",
    nextRunAt: "2026-10-13T08:50:20.000Z",
    status: "healthy",
    enabled: true,
    consecutiveSuccesses: 710,
    consecutiveFailures: 0,
    averageLatencyMs: 85,
    description: "Penyelarasan status PON port, redaman Rx/Tx ONU, dan deteksi link loss",
  },
  {
    id: "align-billing-status",
    name: "Status Pembayaran Pelanggan",
    targetService: "Billing Scraper & API Reconciler",
    intervalSeconds: 3600,
    lastRunAt: "2026-10-13T08:00:00.000Z",
    nextRunAt: "2026-10-13T09:00:00.000Z",
    status: "healthy",
    enabled: true,
    consecutiveSuccesses: 24,
    consecutiveFailures: 0,
    averageLatencyMs: 1420,
    description: "Penyelarasan otomatis status lunas/isolir tagihan bulanan pelanggan",
  },
  {
    id: "align-anomaly-detector",
    name: "Evaluasi Rule Anomali & Alert",
    targetService: "Go Rule Engine / Alert Correlation",
    intervalSeconds: 10,
    lastRunAt: "2026-10-13T08:50:05.000Z",
    nextRunAt: "2026-10-13T08:50:15.000Z",
    status: "healthy",
    enabled: true,
    consecutiveSuccesses: 2130,
    consecutiveFailures: 0,
    averageLatencyMs: 18,
    description: "Evaluasi ambang batas CPU, antrean, port error, dan pemetaan akar masalah",
  },
  {
    id: "align-log-cleanup",
    name: "Rotasi & Pembersihan Log",
    targetService: "Database Retention Janitor",
    intervalSeconds: 86400,
    lastRunAt: "2026-10-13T00:00:00.000Z",
    nextRunAt: "2026-10-14T00:00:00.000Z",
    status: "healthy",
    enabled: true,
    consecutiveSuccesses: 7,
    consecutiveFailures: 0,
    averageLatencyMs: 310,
    description: "Pembersihan berkala log telemetri dan audit yang melewati batas retensi 30 hari",
  },
];

export function getMockAlignmentJobs(): readonly AutoAlignmentJobItem[] {
  return MOCK_ALIGNMENT_JOBS;
}

export function getMockAlignmentOverview(
  jobs: readonly AutoAlignmentJobItem[] = MOCK_ALIGNMENT_JOBS,
): AutoAlignmentOverview {
  const enabled = jobs.filter((j) => j.enabled).length;
  const healthy = jobs.filter((j) => j.status === "healthy").length;
  const failing = jobs.filter((j) => j.status === "failed" || j.status === "degraded").length;

  const lastTick = jobs
    .map((j) => j.lastRunAt)
    .filter(Boolean)
    .sort()
    .pop();

  return {
    schedulerStatus: failing > 0 ? "degraded" : "running",
    activeWorkers: 4,
    totalJobs: jobs.length,
    enabledJobs: enabled,
    healthyJobs: healthy,
    failingJobs: failing,
    lastGlobalTickAt: lastTick ?? null,
    backoffModeActive: false,
  };
}
