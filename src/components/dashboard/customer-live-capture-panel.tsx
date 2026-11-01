"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Clock,
  Eye,
  Globe,
  Loader2,
  Lock,
  Play,
  Radio,
  ShieldAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  formatBandwidthRate,
  formatDataVolume,
  formatPacketCount,
} from "@/lib/dashboard/traffic-format-helpers";
import type { CustomerCaptureFlowItem } from "@/db/schema/customer-traffic-captures";

export interface CaptureRecordView {
  id: string;
  customerId: string;
  customerIp: string;
  durationSeconds: number;
  startedAt: string;
  endedAt: string;
  totalBytes: number;
  totalPackets: number;
  flowCount: number;
  topApp: string;
  recordedBy: string;
  flows: CustomerCaptureFlowItem[];
}

interface CustomerLiveCapturePanelProps {
  customerId: string;
  customerName: string;
  pppoeUsername: string;
}

export function CustomerLiveCapturePanel({
  customerId,
  customerName,
  pppoeUsername,
}: CustomerLiveCapturePanelProps) {
  const [duration, setDuration] = useState<15 | 30 | 60>(15);
  const [isRecording, setIsRecording] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [latestCapture, setLatestCapture] = useState<CaptureRecordView | null>(null);
  const [history, setHistory] = useState<CaptureRecordView[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [selectedCapture, setSelectedCapture] = useState<CaptureRecordView | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Ambil riwayat rekaman tersimpan
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/customers/${encodeURIComponent(customerId)}/capture`)
      .then((res) => res.json())
      .then((json) => {
        if (!cancelled && json.data) {
          setHistory(json.data);
          if (json.data.length > 0) {
            setLatestCapture(json.data[0]);
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  // Efek countdown timer saat sedang merekam
  useEffect(() => {
    if (!isRecording || countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(timer);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [isRecording, countdown]);

  const handleStartCapture = async () => {
    if (isRecording) return;
    setIsRecording(true);
    setCountdown(duration);
    setErrorMessage(null);

    try {
      const res = await fetch(
        `/api/customers/${encodeURIComponent(customerId)}/capture`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ duration }),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setErrorMessage(
          json.error?.message ||
            "Pelanggan ini sedang offline (sesi PPPoE tidak aktif di router). Perekaman Torch hanya dapat dijalankan saat pelanggan sedang online."
        );
      } else if (json.data) {
        setLatestCapture(json.data);
        setSelectedCapture(json.data);
        setHistory((prev) => [json.data, ...prev]);
      } else if (json.error?.message) {
        setErrorMessage(json.error.message);
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Gagal menghubungi server.");
    } finally {
      setIsRecording(false);
      setCountdown(0);
    }
  };

  const activeDisplay = selectedCapture || latestCapture;

  return (
    <Card className="border shadow-xs">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <Radio className="size-4.5 text-primary" />
              <span>Inspeksi Akses Langsung (Live Torch / Platform Capture)</span>
            </CardTitle>
            <CardDescription className="text-xs">
              Merekam nama domain, website, dan platform yang dibuka oleh{" "}
              <strong className="text-foreground">{customerName}</strong> ({pppoeUsername}) dalam jendela waktu pilihan.
            </CardDescription>
          </div>
          <Badge variant="outline" className="w-fit text-[11px] gap-1 text-muted-foreground">
            <Lock className="size-3" />
            <span>Bukti Berjejak Audit</span>
          </Badge>
        </div>
      </CardHeader>
        {errorMessage && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
            <AlertTriangle className="size-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

      <CardContent className="space-y-4">
        {/* Toggle Waktu & Tombol Aksi */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 p-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Durasi Rekam:</span>
            <div
              role="group"
              aria-label="Pilihan Durasi Perekaman"
              className="inline-flex h-8 overflow-hidden rounded-md border bg-background p-0.5"
            >
              {[15, 30, 60].map((sec) => (
                <button
                  key={sec}
                  type="button"
                  disabled={isRecording}
                  onClick={() => setDuration(sec as 15 | 30 | 60)}
                  className={`rounded-sm px-3 text-xs font-medium transition-colors ${
                    duration === sec
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {sec === 60 ? "1 Menit" : `${sec} Detik`}
                </button>
              ))}
            </div>
          </div>

          <Button
            type="button"
            size="sm"
            onClick={handleStartCapture}
            disabled={isRecording}
            className="h-8 gap-1.5 text-xs font-medium"
          >
            {isRecording ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                <span>Merekam Paket ({countdown}s)...</span>
              </>
            ) : (
              <>
                <Play className="size-3.5 fill-current" />
                <span>Mulai Rekam Akses ({duration === 60 ? "1 Mnt" : `${duration}s`})</span>
              </>
            )}
          </Button>
        </div>

        {/* Banner Perekaman Aktif */}
        {isRecording && (
          <div className="flex items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3 text-xs">
            <Radio className="size-4 animate-pulse text-primary" />
            <div className="flex-1">
              <p className="font-semibold text-foreground">
                Sedang menganalisis aliran trafik aktif pelanggan...
              </p>
              <p className="text-muted-foreground">
                Menangkap DNS, SNI TLS, dan koneksi aktif dari router. Sisa waktu:{" "}
                <strong className="text-foreground">{countdown} detik</strong>.
              </p>
            </div>
            <span className="font-mono text-sm font-bold text-primary">{countdown}s</span>
          </div>
        )}

        {/* Hasil Tangkapan Aktif / Terpilih */}
        {activeDisplay && (
          <div className="space-y-3 rounded-lg border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-semibold text-foreground">
                  Hasil Tangkapan ({activeDisplay.durationSeconds} Detik)
                </span>
                <span className="text-muted-foreground">
                  · IP Klien: <code className="font-mono">{activeDisplay.customerIp}</code>
                </span>
                <span className="text-muted-foreground">
                  · Waktu: {new Date(activeDisplay.startedAt).toLocaleTimeString("id-ID")}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs tabular-nums text-muted-foreground">
                <span>Total: <strong>{formatDataVolume(activeDisplay.totalBytes)}</strong></span>
                <span>Paket: <strong>{formatPacketCount(activeDisplay.totalPackets)}</strong></span>
                <span>Aliran: <strong>{activeDisplay.flowCount}</strong></span>
              </div>
            </div>

            {/* Tabel Aliran & Kategori Platform / Website */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b bg-muted/40 text-[11px] text-muted-foreground uppercase">
                  <tr>
                    <th className="py-2 px-2.5 font-medium">No</th>
                    <th className="py-2 px-2.5 font-medium">Website / Platform yang Dibuka</th>
                    <th className="py-2 px-2.5 font-medium">Klasifikasi Kategori</th>
                    <th className="py-2 px-2.5 font-medium">IP Tujuan : Port</th>
                    <th className="py-2 px-2.5 text-right font-medium">Throughput</th>
                    <th className="py-2 px-2.5 text-right font-medium">Volume Data</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {activeDisplay.flows.map((f, i) => {
                    const catLower = (f.category || "").toLowerCase();
                    const isPorn = catLower.includes("porn") || catLower.includes("dewasa");
                    const isGambling = catLower.includes("judi");
                    const isVideo = catLower.includes("video") || catLower.includes("stream");
                    const isSocial = catLower.includes("sosial") || catLower.includes("chat") || catLower.includes("komunikasi");
                    const isLocal = catLower.includes("lokal");
                    const isUnclassified = !f.category || f.category === "belum terklasifikasi";

                    return (
                      <tr key={i} className="hover:bg-muted/20">
                        <td className="py-2 px-2.5 tabular-nums text-muted-foreground">{i + 1}</td>
                        <td className="py-2 px-2.5 font-medium text-foreground">
                          <div className="flex items-center gap-1.5">
                            <Globe className="size-3 text-muted-foreground shrink-0" />
                            <div className="flex flex-col">
                              <span>{f.platform}</span>
                              {f.domain && f.domain !== f.platform && (
                                <span className="text-[10px] text-muted-foreground font-mono">{f.domain}</span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="py-2 px-2.5">
                          {isPorn ? (
                            <Badge
                              variant="destructive"
                              className="gap-1 text-[10px] font-semibold"
                              title="Indikasi Kepatuhan TrustPositif / Komdigi"
                            >
                              <ShieldAlert className="size-3" />
                              <span>Pornografi / Dewasa</span>
                            </Badge>
                          ) : isGambling ? (
                            <Badge
                              variant="outline"
                              className="gap-1 border-amber-600 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[10px] font-semibold"
                            >
                              <AlertTriangle className="size-3" />
                              <span>Judi Online</span>
                            </Badge>
                          ) : isVideo ? (
                            <Badge
                              variant="outline"
                              className="border-emerald-500/50 text-emerald-600 dark:text-emerald-400 text-[10px]"
                            >
                              Streaming Video
                            </Badge>
                          ) : isSocial ? (
                            <Badge
                              variant="outline"
                              className="border-sky-500/50 text-sky-600 dark:text-sky-400 text-[10px]"
                            >
                              Media Sosial
                            </Badge>
                          ) : isLocal ? (
                            <Badge variant="outline" className="text-[10px] text-muted-foreground">
                              Jaringan Lokal
                            </Badge>
                          ) : isUnclassified ? (
                            <Badge variant="secondary" className="text-[10px] text-muted-foreground">
                              Belum Terklasifikasi
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[10px]">
                              {f.category}
                            </Badge>
                          )}
                        </td>
                        <td className="py-2 px-2.5 font-mono text-[11px] text-muted-foreground">
                          {f.peerIp}{f.port > 0 ? `:${f.port}` : ""}{f.protocol ? ` (${f.protocol})` : ""}
                        </td>
                        <td className="py-2 px-2.5 text-right font-medium tabular-nums">
                          {formatBandwidthRate(f.throughputBps)}
                        </td>
                        <td className="py-2 px-2.5 text-right tabular-nums text-muted-foreground">
                          {formatDataVolume(f.bytes)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Catatan Batas Bukti Sesuai PRD */}
            <p className="text-[11px] text-muted-foreground">
              * Batasan bukti: Rekaman hanya mencatat nama domain/host dan laju paket. Sistem tidak membongkar isi konten maupun URL terenkripsi.
            </p>
          </div>
        )}

        {/* Riwayat Rekaman Terdahulu Pelanggan */}
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
            Riwayat Rekaman Inspeksi Pelanggan ({history.length} Catatan)
          </h4>
          {loadingHistory ? (
            <p className="text-xs text-muted-foreground py-3">Memuat riwayat rekaman...</p>
          ) : history.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2 italic">
              Belum ada riwayat rekaman inspeksi langsung untuk pelanggan ini.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-left text-xs">
                <thead className="border-b bg-muted/40 text-[11px] text-muted-foreground">
                  <tr>
                    <th className="py-2 px-2.5 font-medium">Waktu Rekam</th>
                    <th className="py-2 px-2.5 font-medium">Durasi</th>
                    <th className="py-2 px-2.5 font-medium">Operator</th>
                    <th className="py-2 px-2.5 font-medium">Aplikasi / Domain Teratas</th>
                    <th className="py-2 px-2.5 text-right font-medium">Total Volume</th>
                    <th className="py-2 px-2.5 text-right font-medium">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {history.map((h) => (
                    <tr
                      key={h.id}
                      className={`hover:bg-muted/20 ${
                        activeDisplay?.id === h.id ? "bg-muted/30" : ""
                      }`}
                    >
                      <td className="py-2 px-2.5 whitespace-nowrap">
                        {new Date(h.startedAt).toLocaleString("id-ID", {
                          dateStyle: "short",
                          timeStyle: "medium",
                        })}
                      </td>
                      <td className="py-2 px-2.5">
                        <Badge variant="outline" className="text-[10px]">
                          {h.durationSeconds}s
                        </Badge>
                      </td>
                      <td className="py-2 px-2.5 text-muted-foreground">{h.recordedBy}</td>
                      <td className="py-2 px-2.5 font-medium truncate max-w-[200px]">
                        {h.topApp}
                      </td>
                      <td className="py-2 px-2.5 text-right tabular-nums">
                        {formatDataVolume(h.totalBytes)}
                      </td>
                      <td className="py-2 px-2.5 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedCapture(h)}
                          className="h-6 gap-1 px-1.5 text-[11px]"
                        >
                          <Eye className="size-3" />
                          <span>Lihat</span>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
