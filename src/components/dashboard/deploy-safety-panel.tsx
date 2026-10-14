"use client";

import { useState } from "react";
import {
  ShieldCheck,
  Activity,
  Database,
  Archive,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Server,
  Lock,
  HardDrive,
  FileCode,
  ArrowRight,
} from "lucide-react";
import {
  MOCK_PREFLIGHT_CHECKS,
  getMockDeploySafetyOverview,
  type PreflightCheckItem,
} from "@/lib/dashboard/deploy-safety";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HealthCheckPanel } from "./health-check-panel";
import { BackupRestorePanel } from "./backup-restore-panel";
import { RollbackHistoryPanel } from "./rollback-history-panel";
import { DataSourceDirectory } from "./data-source-directory";

export function DeploySafetyPanel() {
  const [overview] = useState(getMockDeploySafetyOverview());
  const [preflights] = useState<readonly PreflightCheckItem[]>(
    MOCK_PREFLIGHT_CHECKS,
  );
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  return (
    <div
      data-testid="deploy-safety-panel"
      className="flex flex-col gap-6"
    >
      {/* Kartu Ringkasan Kesiapan Deploy */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border bg-card p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Status Kesiapan Deploy
            </span>
            <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span
              data-testid="deploy-safety-status-badge"
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-2 py-0.5 text-sm font-semibold text-emerald-600 dark:text-emerald-400"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Siap Deploy
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Target: <strong className="capitalize">{overview.targetEnvironment}</strong>
          </p>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Skor Kesehatan Sistem
            </span>
            <Activity className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-foreground">
              {overview.healthScorePercent}%
            </span>
            <span className="text-xs text-emerald-600">
              ({overview.passedChecks}/{overview.totalChecks} lulus)
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Semua komponen inti berjalan normal
          </p>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Snapshot Cadangan
            </span>
            <Archive className="h-4 w-4 text-purple-600 dark:text-purple-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-foreground">
              {overview.activeSnapshotsCount} Titik
            </span>
            <span className="text-xs text-muted-foreground">tersedia</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground truncate">
            Terbaru: {overview.latestSnapshotAt ? new Date(overview.latestSnapshotAt).toLocaleTimeString("id-ID") : "-"}
          </p>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Proteksi Rollback
            </span>
            <RotateCcw className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-2 py-0.5 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
              Aktif & Siap
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Rollback otomatis jika migrasi gagal
          </p>
        </div>
      </div>

      {actionNotice && (
        <div
          data-testid="deploy-action-notice"
          className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300"
        >
          {actionNotice}
        </div>
      )}

      {/* Tab Konten Pengaman Deploy */}
      <Tabs defaultValue="health" className="gap-6">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="health" data-testid="tab-health-checks">
            Pemeriksaan Kesehatan ({overview.totalChecks})
          </TabsTrigger>
          <TabsTrigger value="sources" data-testid="tab-data-sources">
            Daftar Sumber Data
          </TabsTrigger>
          <TabsTrigger value="backup" data-testid="tab-backup-snapshots">
            Snapshot & Cadangan ({overview.activeSnapshotsCount})
          </TabsTrigger>
          <TabsTrigger value="preflight" data-testid="tab-preflight">
            Pre-flight Checklist ({preflights.length})
          </TabsTrigger>
          <TabsTrigger value="rollback" data-testid="tab-rollback-history">
            Riwayat Rollback
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Health Checks */}
        <TabsContent value="health" className="flex flex-col gap-4">
          <HealthCheckPanel />
        </TabsContent>

        {/* Tab Sumber Data (Dummy -> Nyata) */}
        <TabsContent value="sources" className="flex flex-col gap-4">
          <DataSourceDirectory />
        </TabsContent>

        {/* Tab 2: Snapshot & Cadangan */}
        <TabsContent value="backup" className="flex flex-col gap-4">
          <BackupRestorePanel />
        </TabsContent>

        {/* Tab 3: Pre-flight Checklist */}
        <TabsContent value="preflight" className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold">Pemeriksaan Pra-Rilis (Pre-Flight)</h2>
            <p className="text-xs text-muted-foreground">
              Daftar verifikasi otomatis sebelum rilis baru dipromosikan ke server produksi.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3">
            {preflights.map((item) => (
              <div
                key={item.id}
                className="flex items-start gap-3 rounded-lg border bg-card p-3 shadow-xs"
              >
                <div className="mt-0.5">
                  {item.passed ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-foreground">
                      {item.label}
                    </span>
                    <span
                      className={`rounded-xs px-1.5 py-0.2 text-[10px] font-medium uppercase ${
                        item.severity === "critical"
                          ? "bg-red-500/10 text-red-600"
                          : "bg-amber-500/10 text-amber-600"
                      }`}
                    >
                      {item.severity}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {item.description}
                  </p>
                  <p className="mt-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    ✓ {item.detail}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        {/* Tab 4: Riwayat Rollback */}
        <TabsContent value="rollback" className="flex flex-col gap-4">
          <RollbackHistoryPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
