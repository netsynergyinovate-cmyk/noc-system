"use client";

import { useState } from "react";
import { usePolled } from "@/lib/dashboard/use-polled";
import {
  AlertCircle,
  Cpu,
  ExternalLink,
  HelpCircle,
  Inbox,
  Lightbulb,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { layerIcons } from "@/components/dashboard/diagnostic-layer-meta";
import type {
  DiagnosticLayer,
  DiagnosticRunDto,
  VerdictScope,
} from "@/lib/diagnostics";
import {
  aggregateConclusions,
  type AnomalyConclusionSummary,
} from "@/lib/dashboard/anomaly-conclusion";

const scopeBadgeStyles: Record<
  VerdictScope,
  { border: string; bg: string; text: string }
> = {
  shared: {
    border: "border-destructive/30",
    bg: "bg-destructive/10",
    text: "text-destructive",
  },
  own: {
    border: "border-warning/30",
    bg: "bg-warning/10",
    text: "text-warning",
  },
  unknown: {
    border: "border-border",
    bg: "bg-muted",
    text: "text-muted-foreground",
  },
};

interface DiagnosticApiResponse {
  data?: DiagnosticRunDto[];
}
// Fungsi modul (bukan dibuat ulang tiap render), seperti yang diminta usePolled.
async function loadRuns(): Promise<DiagnosticRunDto[]> {
  const res = await fetch("/api/anomalies/diagnostics?limit=50", {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Gagal memuat diagnosa (HTTP ${res.status}).`);
  const json = (await res.json()) as DiagnosticApiResponse;
  return json.data ?? [];
}

export function AnomalyConclusion({ className }: { className?: string } = {}) {
  const { state, failed, retry } = usePolled(loadRuns, 30_000);
  const runs = state?.data ?? null;
  const loading = !state && !failed;
  // Data terakhir yang berhasil tetap tampil; galat hanya diberitahukan.
  const error = failed
    ? "Gagal memuat diagnosa. Data terakhir tetap ditampilkan."
    : null;
  const [openInfoRuns, setOpenInfoRuns] = useState<Record<string, boolean>>({});

  const toggleInfo = (runId: string) => {
    setOpenInfoRuns((prev) => ({
      ...prev,
      [runId]: !prev[runId],
    }));
  };

  const summary: AnomalyConclusionSummary = aggregateConclusions(
    runs ?? [],
    new Date(),
  );

  const handleOpenDiagnostic = (runId: string) => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("noc:open-diagnostic", { detail: { runId } }),
    );
  };

  return (
    <section
      data-testid="anomaly-conclusion"
      aria-labelledby="conclusion-panel-title"
      className={cn(
        "rounded-lg border border-border bg-card p-2.5 sm:p-3 shadow-xs space-y-2.5",
        className,
      )}
    >
      {/* Header Panel */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-2 border-b border-border gap-2">
        <div className="flex items-center gap-2">
          <div className="flex size-6 shrink-0 items-center justify-center rounded border border-border bg-muted text-primary">
            <Cpu className="size-3.5" aria-hidden="true" />
          </div>
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <h2
              id="conclusion-panel-title"
              className="text-xs font-semibold uppercase tracking-wider text-foreground"
            >
              Root Cause &amp; Inferensi Deteksi Anomali
            </h2>
            <span className="text-[11px] text-muted-foreground">
              • Saran memakai aturan tetap berdasarkan lapisan, bukan
              probabilitas
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={retry}
          disabled={loading}
          className="inline-flex items-center gap-1 self-start sm:self-auto rounded border border-border bg-card px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          aria-label="Segarkan kesimpulan diagnosa"
        >
          <RefreshCw
            className={cn(
              "size-3",
              loading && "animate-spin motion-reduce:animate-none",
            )}
            aria-hidden="true"
          />
          <span>Segarkan</span>
        </button>
      </div>

      {/* State: Error */}
      {error && (
        <div
          className="rounded border border-destructive/30 bg-destructive/10 p-3 text-center space-y-2"
          role="alert"
        >
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-destructive">
            <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
            <span>Gagal memuat kesimpulan diagnosa</span>
          </div>
          <p className="text-[11px] text-destructive/90">{error}</p>
          <button
            type="button"
            onClick={retry}
            className="inline-flex items-center gap-1 rounded border border-destructive/30 bg-card px-2.5 py-1 text-[11px] font-medium text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <RefreshCw className="size-3" aria-hidden="true" />
            <span>Coba lagi</span>
          </button>
        </div>
      )}

      {/* State: Loading Awal */}
      {loading && !runs && (
        <div
          className="space-y-2 py-3"
          aria-label="Memuat kesimpulan analisis"
          role="status"
        >
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2
              className="size-3.5 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            <span>Memuat data kesimpulan diagnosa…</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-28 rounded-md border border-border bg-muted/40 animate-pulse motion-reduce:animate-none"
              />
            ))}
          </div>
        </div>
      )}

      {/* State: Kosong */}
      {!loading && runs && summary.totalDiagnosed === 0 && (
        <div className="rounded border border-dashed border-border p-4 text-center space-y-2">
          <div className="inline-flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Inbox className="size-4" aria-hidden="true" />
          </div>
          <p className="text-xs font-medium text-foreground">
            Belum ada hasil diagnosa yang selesai
          </p>
          <p className="max-w-md mx-auto text-[11px] text-muted-foreground leading-normal">
            Diagnosa pelanggan dimulai secara manual melalui tombol{" "}
            <strong className="text-foreground">Diagnosa</strong> pada kartu
            pelanggan atau baris anomali, atau secara otomatis saat terdeteksi
            anomali LOS optik, PPPoE timeout, antrean penuh, atau isolir
            billing.
          </p>
        </div>
      )}

      {/* State: Berisi Data */}
      {runs && summary.totalDiagnosed > 0 && (
        <>
          {/* Headline & Distribusi Lapisan */}
          <div className="space-y-2 rounded border border-border bg-muted/30 p-2 sm:p-2.5">
            <p
              data-testid="conclusion-headline"
              className="text-xs font-medium text-foreground leading-normal"
            >
              {summary.headline}
              {summary.failedCount > 0 && (
                <span className="ml-2 text-[11px] text-muted-foreground">
                  ({summary.failedCount} diagnosa gagal dievaluasi)
                </span>
              )}
            </p>

            {/* Distribusi per lapisan */}
            <div
              data-testid="conclusion-layer-dist"
              className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-border/60"
            >
              <span className="text-[11px] font-medium text-muted-foreground">
                Distribusi lapisan:
              </span>
              {summary.layerDistribution.length > 0 ? (
                summary.layerDistribution.map((item) => {
                  const LayerIcon =
                    layerIcons[item.layer as DiagnosticLayer] ?? Cpu;
                  return (
                    <span
                      key={item.layer}
                      className="inline-flex items-center gap-1 rounded border border-border bg-card px-2 py-0.5 text-[11px] font-medium text-foreground shadow-2xs"
                    >
                      <LayerIcon
                        className="size-3 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span>{item.label}:</span>
                      <span className="font-mono font-semibold text-primary">
                        {item.count}
                      </span>
                    </span>
                  );
                })
              ) : (
                <span className="text-[11px] text-muted-foreground italic">
                  Belum ada lapisan yang bermasalah
                </span>
              )}
            </div>

            {/* Catatan cara menghitung */}
            <p className="text-[11px] text-muted-foreground pt-1 border-t border-border/50">
              Catatan: Dihitung dari diagnosa terakhir tiap pelanggan (
              {runs?.length ?? 0} run dievaluasi, maks 50 data terbaru).
            </p>
          </div>
          {/* Kartu Inferensi Teratas (Maksimal 3) */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {summary.topCards.map((card) => {
              const LayerIcon = card.layer
                ? (layerIcons[card.layer] ?? Cpu)
                : Cpu;
              const scopeStyle = scopeBadgeStyles[card.scope];

              return (
                <div
                  key={card.runId}
                  data-testid="conclusion-card"
                  className="rounded-md border border-border bg-card p-2.5 flex flex-col justify-between hover:border-border/80 transition-colors shadow-2xs space-y-2"
                >
                  <div className="space-y-2">
                    {/* Header Kartu: Judul (Pelanggan/Root) & Badge Cakupan */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span className="block font-mono text-xs font-semibold text-foreground truncate">
                          {card.title}
                        </span>
                        {card.rootName &&
                          card.customerName &&
                          card.rootName !== card.customerName && (
                            <span className="block text-[11px] text-muted-foreground truncate">
                              Sumber: {card.rootName}
                              {card.affectedCount != null &&
                                ` (${card.affectedCount} pelanggan)`}
                            </span>
                          )}
                        {!card.customerName &&
                          card.affectedCount != null &&
                          card.affectedCount > 0 && (
                            <span className="block text-[11px] text-muted-foreground">
                              {card.affectedCount} pelanggan terganggu
                            </span>
                          )}
                      </div>

                      <span
                        className={cn(
                          "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                          scopeStyle.border,
                          scopeStyle.bg,
                          scopeStyle.text,
                        )}
                      >
                        {card.scopeLabel}
                      </span>
                    </div>
                    {/* Baris Lapisan & Waktu Selesai */}
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      {card.layer ? (
                        <span className="inline-flex items-center gap-1 text-foreground font-medium">
                          <LayerIcon
                            className="size-3 text-primary"
                            aria-hidden="true"
                          />
                          <span>{card.layerLabel}</span>
                        </span>
                      ) : (
                        <span />
                      )}
                      <span>{card.age}</span>
                    </div>

                    {/* Kotak Temuan Detail */}
                    <div className="rounded border border-border bg-muted/50 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
                      <strong className="text-foreground font-medium">
                        Kesimpulan:{" "}
                      </strong>
                      <span>{card.detail}</span>
                    </div>

                    {/* Kotak Saran Tindak Lanjut (Aturan tetap) */}
                    <div className="rounded border border-border bg-card p-2 text-[11px] space-y-1">
                      <span className="font-semibold text-foreground flex items-center gap-1">
                        <Lightbulb
                          className="size-3 text-warning"
                          aria-hidden="true"
                        />
                        <span>Saran tindak lanjut</span>
                      </span>
                      <p className="text-muted-foreground leading-normal">
                        {card.recommendation}
                      </p>
                    </div>

                    {/* Panel Disclosure Penjelasan & Sumber Lengkap */}
                    {openInfoRuns[card.runId] && (
                      <div
                        id={`conclusion-info-${card.runId}`}
                        className="rounded border border-border bg-muted/60 p-2 text-[11px] space-y-2 animate-in fade-in-50 motion-reduce:animate-none"
                      >
                        <div>
                          <span className="font-semibold text-foreground">
                            Penjelasan Analisis:
                          </span>
                          <p className="mt-0.5 text-muted-foreground leading-normal">
                            {card.explain}
                          </p>
                        </div>
                        {card.sources && card.sources.length > 0 && (
                          <div className="space-y-1">
                            <span className="font-semibold text-foreground">
                              Sumber Informasi Lengkap:
                            </span>
                            <ul className="space-y-1">
                              {card.sources.map((src, idx) => (
                                <li
                                  key={idx}
                                  className="rounded border border-border/70 bg-card p-1.5 space-y-0.5"
                                >
                                  <div className="flex items-center justify-between text-[11px]">
                                    <span className="font-semibold text-foreground">
                                      {src.system}
                                    </span>
                                    <span className="text-muted-foreground">
                                      {src.via}
                                    </span>
                                  </div>
                                  <div className="font-mono text-[11px] text-primary break-all">
                                    {src.path}
                                  </div>
                                  {src.fields && src.fields.length > 0 && (
                                    <div className="text-[11px] text-muted-foreground">
                                      Field:{" "}
                                      <span className="font-mono">
                                        {src.fields.join(", ")}
                                      </span>
                                    </div>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Footer Kartu: Tombol Apa ini? dan Buka Diagnosa */}
                  <div className="pt-2 border-t border-border flex items-center justify-between">
                    <button
                      type="button"
                      data-testid="conclusion-info"
                      aria-expanded={!!openInfoRuns[card.runId]}
                      aria-controls={`conclusion-info-${card.runId}`}
                      onClick={() => toggleInfo(card.runId)}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <HelpCircle className="size-3" aria-hidden="true" />
                      <span>Apa ini?</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleOpenDiagnostic(card.runId)}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      aria-label={`Buka diagnosa untuk ${card.title}`}
                    >
                      <span>Buka diagnosa</span>
                      <ExternalLink className="size-3" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
