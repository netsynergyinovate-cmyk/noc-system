"use client";

import { useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Database,
  Play,
  RefreshCw,
  Server,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getMockTransferJobs,
  getMockTransferOverview,
  type TransferJobItem,
} from "@/lib/dashboard/transfer-status";

export function LocalToServerTransfer() {
  const [jobs, setJobs] = useState<readonly TransferJobItem[]>(() =>
    getMockTransferJobs(),
  );
  const [isTransferring, setIsTransferring] = useState(false);
  const [isDryRun, setIsDryRun] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const overview = useMemo(() => getMockTransferOverview(jobs), [jobs]);

  const handleStartTransfer = (dryRun = false) => {
    setIsDryRun(dryRun);
    setIsTransferring(true);
    setFeedback(null);

    setTimeout(() => {
      setIsTransferring(false);
      setJobs((prev) =>
        prev.map((j) => ({
          ...j,
          status: "completed",
          recordsTransferred: j.recordsTotal,
          checksumMatch: true,
          lastTransferredAt: new Date().toISOString(),
        })),
      );
      setFeedback(
        dryRun
          ? "Simulasi (Dry-run) berhasil: 361 record terverifikasi siap dipindahkan ke server tanpa konflik."
          : "Transfer data lokal ke server produksi berhasil diselesaikan dan terverifikasi utuh.",
      );
    }, 700);
  };

  const getStatusBadge = (status: TransferJobItem["status"]) => {
    switch (status) {
      case "completed":
        return (
          <Badge
            variant="default"
            className="gap-1 bg-emerald-600 hover:bg-emerald-700"
          >
            <CheckCircle2 className="h-3 w-3" />
            Selesai
          </Badge>
        );
      case "in_progress":
        return (
          <Badge variant="secondary" className="gap-1 animate-pulse">
            <RefreshCw className="h-3 w-3 animate-spin" />
            Mentransfer
          </Badge>
        );
      case "idle":
        return (
          <Badge variant="outline" className="gap-1">
            <Clock className="h-3 w-3" />
            Siap
          </Badge>
        );
      case "failed":
        return (
          <Badge variant="destructive" className="gap-1">
            Gagal
          </Badge>
        );
    }
  };

  return (
    <div className="flex flex-col gap-6" data-testid="local-to-server-transfer">
      {/* Topology Environment Banner */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="pt-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-background p-2.5 shadow-xs border">
                <Database className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Sumber Data
                </p>
                <p className="font-mono text-sm font-medium truncate max-w-[280px] sm:max-w-md">
                  {overview.sourceEnvironment}
                </p>
              </div>
            </div>

            <div className="hidden md:flex items-center justify-center">
              <div className="rounded-full bg-primary/10 p-2 text-primary">
                <ArrowRight className="h-5 w-5" />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-background p-2.5 shadow-xs border">
                <Server className="h-5 w-5 text-emerald-500" />
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Target Server
                </p>
                <p className="font-mono text-sm font-medium truncate max-w-[280px] sm:max-w-md">
                  {overview.targetEnvironment}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Overview Metrics Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Kemajuan Transfer</CardDescription>
            <CardTitle className="text-xl font-bold">
              {overview.overallProgressPercent}% Selesai
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Simple visual progress bar */}
            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all duration-500"
                style={{ width: `${overview.overallProgressPercent}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {overview.completedJobs} dari {overview.totalJobs} job tuntas
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Record Dipindahkan</CardDescription>
            <CardTitle className="text-xl font-bold">
              {overview.totalRecordsTransferred.toLocaleString()} /{" "}
              {overview.totalRecordsTarget.toLocaleString()}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Router, OLT, pelanggan & aturan alert
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Kecepatan Rata-rata</CardDescription>
            <CardTitle className="text-xl font-bold flex items-center gap-1.5">
              <Zap className="h-5 w-5 text-amber-500" />
              {overview.transferSpeedRecordsPerSec} rec/dtk
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Streaming transaksi aman
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Waktu Transfer Terakhir</CardDescription>
            <CardTitle className="text-sm font-semibold truncate">
              {overview.lastBatchRunAt
                ? new Date(overview.lastBatchRunAt).toLocaleTimeString(
                    "id-ID",
                    {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    },
                  ) + " WIB"
                : "-"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Verifikasi integritas sha256
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Banner Feedback */}
      {feedback && (
        <div
          role="status"
          className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-300 flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span>{feedback}</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFeedback(null)}
            className="h-7 text-xs"
          >
            Tutup
          </Button>
        </div>
      )}

      {/* Action Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            Daftar Job Transfer Data
          </h2>
          <p className="text-xs text-muted-foreground">
            Status pemindahan data per tabel dari basis data lokal ke server
            produksi.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={isTransferring}
            onClick={() => handleStartTransfer(true)}
            className="text-xs"
          >
            <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
            Simulasi (Dry-run)
          </Button>

          <Button
            size="sm"
            disabled={isTransferring}
            onClick={() => handleStartTransfer(false)}
            className="text-xs gap-1.5"
          >
            <Play
              className={`h-3.5 w-3.5 ${isTransferring ? "animate-spin" : ""}`}
            />
            {isTransferring ? "Mentransfer..." : "Mulai Transfer Data"}
          </Button>
        </div>
      </div>

      {/* Jobs Table */}
      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b bg-muted/50 text-muted-foreground font-medium">
              <tr>
                <th className="p-3">Nama Job</th>
                <th className="p-3">Tabel Sumber & Target</th>
                <th className="p-3">Data Dipindahkan</th>
                <th className="p-3">Durasi</th>
                <th className="p-3">Strategi Konflik</th>
                <th className="p-3">Checksum</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {jobs.map((job) => (
                <tr key={job.id} className="hover:bg-muted/30">
                  <td className="p-3 font-semibold text-foreground">
                    {job.name}
                  </td>
                  <td className="p-3 font-mono text-muted-foreground text-[11px]">
                    {job.sourceTable} → {job.targetTable}
                  </td>
                  <td className="p-3">
                    <span className="font-semibold text-foreground">
                      {job.recordsTransferred}
                    </span>{" "}
                    / {job.recordsTotal} baris
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {job.durationSeconds} dtk
                  </td>
                  <td className="p-3">
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase">
                      {job.conflictStrategy}
                    </span>
                  </td>
                  <td className="p-3">
                    {job.checksumMatch ? (
                      <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                        <CheckCircle2 className="h-3 w-3" />
                        Cocok
                      </span>
                    ) : (
                      <span className="text-amber-500">Tertunda</span>
                    )}
                  </td>
                  <td className="p-3">{getStatusBadge(job.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
