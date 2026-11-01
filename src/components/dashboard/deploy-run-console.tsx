"use client";

import { useState } from "react";
import {
  Layers,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Copy,
  Check,
  Eye,
  EyeOff,
  Terminal,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DeployStep } from "@/db/schema/deploy-runs";

const DEPLOY_STEPS_META: Record<
  number,
  { name: string; activeDesc: string; defaultDesc: string }
> = {
  1: {
    name: "Pre-flight & Koneksi SSH",
    activeDesc: "Menghubungkan ke SSH server dan memverifikasi autentikasi...",
    defaultDesc: "Uji latensi jaringan dan validasi konektivitas SSH ke port 22 server.",
  },
  2: {
    name: "Backup Database Server",
    activeDesc: "Mengekstrak pg_dump di kontainer PostgreSQL server dan mengompresi arsip gzip...",
    defaultDesc: "Membuat cadangan database terkompresi di /srv/noc/backups sebelum rilis.",
  },
  3: {
    name: "Bangun Artefak Rilis & Unggah",
    activeDesc: "Mengemas bundle Next.js standalone dan biner Go, lalu mengunggah via SFTP...",
    defaultDesc: "Mempersiapkan artefak rilis terisolasi dan mengekstraknya di direktori rilis berversi.",
  },
  4: {
    name: "Migrasi Skema Database",
    activeDesc: "Mengeksekusi migrasi skema database Drizzle (scripts/migrate-server.mjs)...",
    defaultDesc: "Menerapkan pembaruan skema tabel PostgreSQL dengan aman di server.",
  },
  5: {
    name: "Pemindahan Konfigurasi Localhost -> Server",
    activeDesc: "Memindahkan konfigurasi router, OLT, dan akun dari localhost ke server native...",
    defaultDesc: "Sinkronisasi data kredensial perangkat dan pengaturan sistem secara atomik.",
  },
  6: {
    name: "Pencatatan Titik Balik Versi",
    activeDesc: "Mencatat rilis aktif saat ini sebagai titik balik aman...",
    defaultDesc: "Menyimpan target rollback jika rilis baru mengalami kendala pasca-pengalihan.",
  },
  7: {
    name: "Penukaran Symlink current (Atomik)",
    activeDesc: "Mengalihkan symlink /srv/noc/current ke rilis versi baru secara atomik...",
    defaultDesc: "Penukaran symlink instan tanpa downtime (atomic symlink swap).",
  },
  8: {
    name: "Restart Layanan systemd",
    activeDesc: "Me-restart layanan systemd noc-web (port 3000) dan noc-backend (port 8080)...",
    defaultDesc: "Memuat ulang proses aplikasi Next.js dan backend telemetri Go.",
  },
  9: {
    name: "Health Check Pasca-Deploy",
    activeDesc: "Memverifikasi respons endpoint /api/health (:3000) dan /healthz (:8080)...",
    defaultDesc: "Health check otomatis untuk memastikan kedua layanan merespons HTTP 200 OK.",
  },
};

export interface DeployAccessInfo {
  url: string;
  token: string;
  backendUrl?: string;
  host?: string;
}

interface DeployRunConsoleProps {
  steps: DeployStep[];
  running: boolean;
  finishedResult: {
    success: boolean;
    message: string;
    autoRollbackTriggered?: boolean;
  } | null;
  accessInfo: DeployAccessInfo | null;
  sshUser?: string;
  sshHost?: string;
  onOpenCliTab?: () => void;
}

export function DeployRunConsole({
  steps,
  running,
  finishedResult,
  accessInfo,
  sshUser = "netsi",
  sshHost = "server",
  onOpenCliTab,
}: DeployRunConsoleProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);

  function copyText(text: string, key: string) {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  }

  if (!running && steps.length === 0 && !finishedResult) {
    return null;
  }

  return (
    <div className="mt-6 space-y-6">
      {/* 1. Progres Rantai Deploy Berurutan */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" /> Progres Rantai Deploy Berurutan
          </h4>
          {running && (
            <span className="text-[11px] text-amber-500 dark:text-amber-400 font-mono animate-pulse flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-500 animate-ping" />
              Eksekusi SSH sedang berlangsung...
            </span>
          )}
        </div>

        <div className="space-y-2.5">
          {Object.entries(DEPLOY_STEPS_META).map(([stepStr, meta]) => {
            const stepNum = Number(stepStr);
            const match = steps.find((s) => s.urutan === stepNum);
            const status = match
              ? match.status
              : running && steps.length === stepNum - 1
                ? "berjalan"
                : "menunggu";

            return (
              <div
                key={stepNum}
                className={`rounded-lg border p-3 text-xs flex flex-col gap-2 transition-all ${
                  status === "berhasil"
                    ? "bg-emerald-500/5 border-emerald-500/20"
                    : status === "berjalan"
                      ? "bg-primary/5 border-primary/40 shadow-xs"
                      : status === "gagal"
                        ? "bg-destructive/10 border-destructive/30"
                        : "bg-card/50 text-muted-foreground border-border/60"
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono text-muted-foreground w-5">{stepNum}.</span>
                    <span className="font-semibold text-foreground">{meta.name}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    {status === "berhasil" && (
                      <Badge variant="outline" className="text-emerald-600 bg-emerald-500/10 border-emerald-500/30">
                        Berhasil
                      </Badge>
                    )}
                    {status === "berjalan" && (
                      <Badge variant="outline" className="text-primary bg-primary/10 border-primary/30 animate-pulse font-semibold">
                        Sedang Berjalan...
                      </Badge>
                    )}
                    {status === "gagal" && <Badge variant="destructive">Gagal</Badge>}
                    {status === "menunggu" && <Badge variant="secondary">Menunggu</Badge>}
                  </div>
                </div>

                {/* Deskripsi status aktivitas */}
                <div className="text-[11px] text-muted-foreground pl-7">
                  {status === "berjalan" ? (
                    <span className="text-primary font-medium flex items-center gap-1.5">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary animate-ping" />
                      {meta.activeDesc}
                    </span>
                  ) : (
                    meta.defaultDesc
                  )}
                </div>

                {/* Output log individual langkah */}
                {match?.keluaran && (
                  <div className="mt-1 ml-7 font-mono text-[11px] text-zinc-300 break-all whitespace-pre-wrap bg-zinc-950 p-2.5 rounded border border-zinc-800/80 max-h-36 overflow-y-auto">
                    {match.keluaran}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 2. Kotak Konsol Terminal SSH Live */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 font-mono text-xs shadow-lg text-zinc-100">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-2 mb-3">
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              <div className="h-2.5 w-2.5 rounded-full bg-red-500/80" />
              <div className="h-2.5 w-2.5 rounded-full bg-yellow-500/80" />
              <div className="h-2.5 w-2.5 rounded-full bg-emerald-500/80" />
            </div>
            <span className="text-zinc-400 text-[11px] font-semibold ml-1">
              Terminal SSH Live: {sshUser}@{sshHost}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {running && (
              <span className="text-[10px] text-amber-400 animate-pulse flex items-center gap-1 font-sans">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400 animate-ping" />
                LIVE
              </span>
            )}
            <Badge variant="outline" className="border-zinc-800 text-[10px] text-zinc-400">
              {steps.length}/9 langkah tercatat
            </Badge>
          </div>
        </div>

        <div className="max-h-64 overflow-y-auto space-y-2 text-[11px] pr-1 select-text">
          {steps.map((s) => (
            <div key={s.id || s.urutan} className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="text-zinc-500">[{s.mulai ? new Date(s.mulai).toLocaleTimeString() : "--:--"}]</span>
                <span className="text-cyan-400 font-bold">&gt; Langkah {s.urutan}/9: {s.nama}</span>
                <span
                  className={
                    s.status === "berhasil"
                      ? "text-emerald-400 font-semibold"
                      : s.status === "gagal"
                        ? "text-red-400 font-semibold"
                        : "text-amber-300 animate-pulse"
                  }
                >
                  [{s.status.toUpperCase()}]
                </span>
              </div>
              {s.keluaran && (
                <pre className="pl-4 text-zinc-300 whitespace-pre-wrap break-all text-[11px] leading-relaxed border-l-2 border-zinc-700 ml-2 py-0.5">
                  {s.keluaran}
                </pre>
              )}
            </div>
          ))}
          {running && (
            <div className="text-zinc-500 animate-pulse flex items-center gap-1 pt-1">
              <span className="text-emerald-400">&gt;</span> Menjalankan instruksi di server VPS
              <span className="animate-ping font-bold text-emerald-400">_</span>
            </div>
          )}
        </div>
      </div>

      {/* 3. Banner & Kartu Informasi Akses Akhir */}
      {finishedResult && (
        <div className="space-y-4">
          <div
            className={`rounded-xl p-4 text-sm ${
              finishedResult.success
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30"
                : "bg-destructive/10 text-destructive border border-destructive/30"
            }`}
          >
            <div className="font-bold flex items-center gap-2">
              {finishedResult.success ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <AlertTriangle className="h-5 w-5" />
              )}
              {finishedResult.success ? "Deploy Berhasil Terpasang di Server!" : "Deploy Gagal"}
            </div>
            <p className="mt-1 text-xs opacity-90">{finishedResult.message}</p>
            {finishedResult.autoRollbackTriggered && (
              <div className="mt-2 text-xs font-semibold underline">
                Rollback otomatis ke titik balik versi sebelumnya telah dieksekusi secara otomatis oleh sistem.
              </div>
            )}
          </div>

          {/* Kartu Detail Akses Tautan Web & Token Monitor */}
          {finishedResult.success && accessInfo && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 space-y-4 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-primary/20 pb-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                  <div>
                    <h4 className="font-bold text-sm text-foreground">
                      Tautan Akses Aplikasi & Kunci Pemantau Server
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      Gunakan alamat IP dan Token Monitor di bawah ini untuk membuka aplikasi dan memantau status VPS.
                    </p>
                  </div>
                </div>
                <Badge className="bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-xs w-fit">
                  Layanan Aktif (Port 3000)
                </Badge>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                {/* Box 1: URL Web App */}
                <div className="rounded-lg border bg-background p-3.5 space-y-2">
                  <span className="font-semibold text-muted-foreground uppercase text-[10px] tracking-wider block">
                    1. Alamat Akses Aplikasi Web (Next.js)
                  </span>
                  <div className="flex items-center justify-between font-mono bg-muted/40 p-2 rounded text-xs border gap-2">
                    <code className="text-primary font-bold break-all">{accessInfo.url}</code>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => copyText(accessInfo.url, "app-url")}
                        title="Salin Tautan"
                      >
                        {copiedKey === "app-url" ? (
                          <Check className="h-3.5 w-3.5 text-emerald-500" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      <Button
                        size="sm"
                        className="h-7 text-xs gap-1 bg-primary font-sans"
                        onClick={() => window.open(accessInfo.url, "_blank")}
                      >
                        <ExternalLink className="h-3 w-3" /> Buka
                      </Button>
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Buka tautan ini di peramban untuk langsung mengakses antarmuka NOC System di server VPS Anda.
                  </p>
                </div>

                {/* Box 2: Token Monitor */}
                <div className="rounded-lg border bg-background p-3.5 space-y-2">
                  <span className="font-semibold text-muted-foreground uppercase text-[10px] tracking-wider block">
                    2. Kunci Pemantau (Token Monitor)
                  </span>
                  <div className="flex items-center justify-between font-mono bg-muted/40 p-2 rounded text-xs border gap-2">
                    <code className="text-foreground font-semibold break-all">
                      {showToken ? accessInfo.token || "-" : "••••••••••••••••••••••••••••••••"}
                    </code>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => setShowToken(!showToken)}
                        title={showToken ? "Sembunyikan Token" : "Tampilkan Token"}
                      >
                        {showToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => copyText(accessInfo.token, "monitor-token")}
                        title="Salin Token"
                      >
                        {copiedKey === "monitor-token" ? (
                          <Check className="h-3.5 w-3.5 text-emerald-500" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Kunci ini otomatis tersimpan di tab <strong>CLI noc-system</strong> untuk membaca kesehatan server secara live.
                  </p>
                </div>
              </div>

              <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-primary/20">
                <div className="text-xs text-muted-foreground">
                  Backend Go aktif di:{" "}
                  <span className="font-mono text-foreground font-semibold">
                    {accessInfo.backendUrl || `http://${accessInfo.host}:8080`}
                  </span>
                </div>
                {onOpenCliTab && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs gap-1.5 h-8 bg-background border-primary/30"
                    onClick={onOpenCliTab}
                  >
                    <Terminal className="h-3.5 w-3.5 text-primary" /> Buka Tab Pemantau Server Live
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
