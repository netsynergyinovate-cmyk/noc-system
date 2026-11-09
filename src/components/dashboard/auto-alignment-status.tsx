"use client";

import { useMemo, useState } from "react";
import { Activity, CheckCircle2, Play, Power, ShieldCheck } from "lucide-react";
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
  getMockAlignmentJobs,
  getMockAlignmentOverview,
  type AutoAlignmentJobItem,
} from "@/lib/dashboard/auto-alignment";

export function AutoAlignmentStatus() {
  const [jobs, setJobs] = useState<readonly AutoAlignmentJobItem[]>(() =>
    getMockAlignmentJobs(),
  );
  const [runningJobId, setRunningJobId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const overview = useMemo(() => getMockAlignmentOverview(jobs), [jobs]);

  const handleTriggerJob = (id: string) => {
    setRunningJobId(id);
    setFeedback(null);

    setTimeout(() => {
      setRunningJobId(null);
      setJobs((prev) =>
        prev.map((j) =>
          j.id === id
            ? {
                ...j,
                status: "healthy",
                lastRunAt: new Date().toISOString(),
                consecutiveSuccesses: j.consecutiveSuccesses + 1,
              }
            : j,
        ),
      );
      setFeedback(`Job penyelarasan ${id} berhasil dieksekusi secara instan.`);
    }, 500);
  };

  const handleToggleJob = (id: string) => {
    setJobs((prev) =>
      prev.map((j) => (j.id === id ? { ...j, enabled: !j.enabled } : j)),
    );
  };

  const formatInterval = (sec: number) => {
    if (sec < 60) return `${sec} dtk`;
    if (sec < 3600) return `${Math.floor(sec / 60)} mnt`;
    return `${Math.floor(sec / 3600)} jam`;
  };

  return (
    <div className="flex flex-col gap-6" data-testid="auto-alignment-status">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Status Daemon Scheduler</CardDescription>
            <CardTitle className="text-xl font-bold flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded-full bg-emerald-500 animate-pulse" />
              {overview.schedulerStatus === "running"
                ? "Berjalan Normal"
                : overview.schedulerStatus}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {overview.activeWorkers} Background Worker Threads
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Tugas Penyelarasan Aktif</CardDescription>
            <CardTitle className="text-xl font-bold">
              {overview.enabledJobs} / {overview.totalJobs} Tugas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {overview.healthyJobs} sehat · {overview.failingJobs} gagal
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Mode Proteksi Backoff</CardDescription>
            <CardTitle className="text-xl font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
              <ShieldCheck className="h-5 w-5" />
              Standby Normal
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Mencegah overload perangkat saat jaringan sibuk
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Detak Penyelarasan Terakhir</CardDescription>
            <CardTitle className="text-sm font-semibold truncate">
              {overview.lastGlobalTickAt
                ? new Date(overview.lastGlobalTickAt).toLocaleTimeString(
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
              Interval adaptif 10 dtk - 24 jam
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

      {/* Header Description */}
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">
          Jadwal Penyelarasan Otomatis (Periodic Background Jobs)
        </h2>
        <p className="text-xs text-muted-foreground">
          Konfigurasi dan pemantauan tugas polling telemetri, penarikan data
          optik OLT, rekonsiliasi billing, dan evaluasi rule mesin anomali.
        </p>
      </div>

      {/* Alignment Jobs Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {jobs.map((job) => (
          <Card key={job.id} className="flex flex-col justify-between">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="rounded-md bg-muted p-2">
                    <Activity className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      {job.name}
                      <Badge
                        variant="outline"
                        className="text-[10px] font-mono"
                      >
                        {formatInterval(job.intervalSeconds)}
                      </Badge>
                    </CardTitle>
                    <CardDescription className="text-xs mt-0.5">
                      Target: {job.targetService}
                    </CardDescription>
                  </div>
                </div>

                <Badge
                  variant={
                    !job.enabled
                      ? "secondary"
                      : job.status === "healthy"
                        ? "default"
                        : "destructive"
                  }
                  className="text-xs capitalize"
                >
                  {!job.enabled ? "Nonaktif" : job.status}
                </Badge>
              </div>
            </CardHeader>

            <CardContent className="space-y-3 pt-0">
              <p className="text-xs text-muted-foreground">{job.description}</p>

              <div className="grid grid-cols-3 gap-2 rounded-md bg-muted/40 p-2.5 text-xs">
                <div>
                  <span className="block font-semibold text-foreground">
                    {job.averageLatencyMs} ms
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    Rata-rata Latensi
                  </span>
                </div>
                <div>
                  <span className="block font-semibold text-foreground">
                    {job.consecutiveSuccesses.toLocaleString()}x
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    Sukses Beruntun
                  </span>
                </div>
                <div>
                  <span className="block font-semibold text-foreground">
                    {job.consecutiveFailures}x
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    Kegagalan
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-muted-foreground">
                  Terakhir:{" "}
                  {job.lastRunAt
                    ? new Date(job.lastRunAt).toLocaleTimeString("id-ID", {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      }) + " WIB"
                    : "-"}
                </span>

                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleToggleJob(job.id)}
                    className="h-8 text-xs gap-1"
                  >
                    <Power className="h-3 w-3" />
                    {job.enabled ? "Matikan" : "Aktifkan"}
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!job.enabled || runningJobId === job.id}
                    onClick={() => handleTriggerJob(job.id)}
                    className="h-8 text-xs gap-1.5"
                  >
                    <Play
                      className={`h-3 w-3 ${
                        runningJobId === job.id ? "animate-spin" : ""
                      }`}
                    />
                    {runningJobId === job.id ? "Berjalan..." : "Jalankan"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
