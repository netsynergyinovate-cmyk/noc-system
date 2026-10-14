// Data model & helper status transfer lokal ke server.
// TIRUAN SEMENTARA: wajib dialihkan ke runner database / stream transfer nyata saat go-live (Fase 5).

export interface TransferJobItem {
  id: string;
  name: string;
  entityName: string;
  sourceTable: string;
  targetTable: string;
  recordsTotal: number;
  recordsTransferred: number;
  status: "idle" | "in_progress" | "completed" | "failed";
  durationSeconds: number;
  checksumMatch: boolean;
  conflictStrategy: "upsert" | "skip_existing" | "overwrite";
  lastTransferredAt: string | null;
  errorMessage?: string | null;
}

export interface TransferStatusOverview {
  sourceEnvironment: string;
  targetEnvironment: string;
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  overallProgressPercent: number;
  totalRecordsTransferred: number;
  totalRecordsTarget: number;
  transferSpeedRecordsPerSec: number;
  isDryRun: boolean;
  status: "ready" | "transferring" | "success" | "error";
  lastBatchRunAt: string | null;
}

export const TRANSFER_STATUS_MOCK_ENTRY = {
  id: "local-to-server-transfer",
  module: "Transfer Data Lokal ke Server",
  targetDevice: "ETL / Replikasi Database Lokal → Server",
  status: "dummy" as const,
  readPath: "src/lib/dashboard/transfer-status.ts (getMockTransferJobs)",
  writePath: "POST /api/transfer/run",
  envKey: "TARGET_DATABASE_URL",
  notes:
    "Tiruan sementara transfer lokal ke server; wajib dialihkan ke pipeline streaming nyata saat go-live Fase 5",
};

export const MOCK_TRANSFER_JOBS: readonly TransferJobItem[] = [
  {
    id: "job-routers",
    name: "Router Gateway MikroTik",
    entityName: "routers",
    sourceTable: "public.routers",
    targetTable: "public.routers",
    recordsTotal: 2,
    recordsTransferred: 2,
    status: "completed",
    durationSeconds: 1.2,
    checksumMatch: true,
    conflictStrategy: "upsert",
    lastTransferredAt: "2026-10-13T08:40:00.000Z",
  },
  {
    id: "job-olt-pon",
    name: "OLT & Port PON",
    entityName: "olt_devices",
    sourceTable: "public.olt_devices",
    targetTable: "public.olt_devices",
    recordsTotal: 4,
    recordsTransferred: 4,
    status: "completed",
    durationSeconds: 1.8,
    checksumMatch: true,
    conflictStrategy: "upsert",
    lastTransferredAt: "2026-10-13T08:40:02.000Z",
  },
  {
    id: "job-customers",
    name: "Database Pelanggan & ODP",
    entityName: "customers",
    sourceTable: "public.customers",
    targetTable: "public.customers",
    recordsTotal: 156,
    recordsTransferred: 156,
    status: "completed",
    durationSeconds: 4.5,
    checksumMatch: true,
    conflictStrategy: "upsert",
    lastTransferredAt: "2026-10-13T08:40:07.000Z",
  },
  {
    id: "job-onu-mappings",
    name: "Pemetaan CPE / ONU",
    entityName: "onu_mappings",
    sourceTable: "public.onu_mappings",
    targetTable: "public.onu_mappings",
    recordsTotal: 38,
    recordsTransferred: 38,
    status: "completed",
    durationSeconds: 2.1,
    checksumMatch: true,
    conflictStrategy: "upsert",
    lastTransferredAt: "2026-10-13T08:40:09.000Z",
  },
  {
    id: "job-anomaly-rules",
    name: "Ambang Batas & Rule Gangguan",
    entityName: "network_rules",
    sourceTable: "public.app_settings",
    targetTable: "public.app_settings",
    recordsTotal: 5,
    recordsTransferred: 5,
    status: "completed",
    durationSeconds: 0.8,
    checksumMatch: true,
    conflictStrategy: "overwrite",
    lastTransferredAt: "2026-10-13T08:40:10.000Z",
  },
  {
    id: "job-billing-cache",
    name: "Profil & Riwayat Billing",
    entityName: "billing_invoices",
    sourceTable: "public.billing_invoices",
    targetTable: "public.billing_invoices",
    recordsTotal: 156,
    recordsTransferred: 156,
    status: "completed",
    durationSeconds: 3.9,
    checksumMatch: true,
    conflictStrategy: "upsert",
    lastTransferredAt: "2026-10-13T08:40:14.000Z",
  },
];

export function getMockTransferJobs(): readonly TransferJobItem[] {
  return MOCK_TRANSFER_JOBS;
}

export function getMockTransferOverview(
  jobs: readonly TransferJobItem[] = MOCK_TRANSFER_JOBS,
): TransferStatusOverview {
  const completed = jobs.filter((j) => j.status === "completed").length;
  const failed = jobs.filter((j) => j.status === "failed").length;
  const inProgress = jobs.some((j) => j.status === "in_progress");

  const totalTransferred = jobs.reduce((sum, j) => sum + j.recordsTransferred, 0);
  const totalTarget = jobs.reduce((sum, j) => sum + j.recordsTotal, 0);

  const percent =
    totalTarget > 0 ? Math.min(100, Math.round((totalTransferred / totalTarget) * 100)) : 100;

  const totalDuration = jobs.reduce((sum, j) => sum + j.durationSeconds, 0);
  const speed =
    totalDuration > 0 ? Math.round(totalTransferred / totalDuration) : 35;

  const lastBatch = jobs
    .map((j) => j.lastTransferredAt)
    .filter(Boolean)
    .sort()
    .pop();

  return {
    sourceEnvironment: "Docker Lokal (postgres://postgres@localhost:5432/noc_dev)",
    targetEnvironment: "Server Produksi (postgres://noc_admin@noc-srv.isp.net:5432/noc_prod)",
    totalJobs: jobs.length,
    completedJobs: completed,
    failedJobs: failed,
    overallProgressPercent: percent,
    totalRecordsTransferred: totalTransferred,
    totalRecordsTarget: totalTarget,
    transferSpeedRecordsPerSec: speed,
    isDryRun: false,
    status: inProgress ? "transferring" : failed > 0 ? "error" : "success",
    lastBatchRunAt: lastBatch ?? null,
  };
}
