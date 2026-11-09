"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Download, FileJson, FileSpreadsheet, CheckCircle2, Info, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  EXPORT_DATASETS,
  EXPORT_TIME_RANGES,
  type ExportDataset,
  type ExportFormat,
  type ExportTimeRange,
} from "@/lib/dashboard/export";

// Dataset yang disaring menurut rentang waktu (lainnya selalu snapshot penuh).
const TIME_BASED: readonly ExportDataset[] = ["alerts-history", "anomalies", "audit-log"];

// Unduh file langsung di browser
function triggerDownload(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ExportBoard() {
  const [selectedDataset, setSelectedDataset] = useState<ExportDataset>("alerts-history");
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>("csv");
  const [selectedRange, setSelectedRange] = useState<ExportTimeRange>("7d");
  const [lastDownloaded, setLastDownloaded] = useState<{
    filename: string;
    rowCount: number;
    at: Date;
    format: ExportFormat;
    sizeKb: number;
  } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const statusId = useId();
  const nowSec = Math.floor(Date.now() / 1000);

  const [realPreview, setRealPreview] = useState<{
    headers: string[];
    sampleRows: (string | number)[][];
    totalRows: number;
    isEmpty: boolean;
    estimatedSizeKb: number;
  } | null>(null);
  useEffect(() => {
    let active = true;
    setRealPreview(null);
    const params = new URLSearchParams({
      dataset: selectedDataset,
      format: "json",
      range: selectedRange,
      download: "false",
      allowEmpty: "true",
    });
    fetch(`/api/export?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { ok?: boolean; data?: { content: string; rowCount: number }; meta?: { rowCount: number; isEmpty: boolean } }) => {
        if (!active || !json?.ok || !json.data) return;
        try {
          const list = JSON.parse(json.data.content);
          if (Array.isArray(list)) {
            const headers = list.length > 0 && typeof list[0] === "object" ? Object.keys(list[0]) : [];
            const sampleRows = list.slice(0, 3).map((item) => headers.map((h) => item[h] ?? "-"));
            setRealPreview({
              headers,
              sampleRows,
              totalRows: json.meta?.rowCount ?? list.length,
              isEmpty: list.length === 0,
              estimatedSizeKb: Math.max(0.1, Math.round((new Blob([json.data.content]).size / 1024) * 10) / 10),
            });
          }
        } catch {}
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [selectedDataset, selectedRange]);

  const preview = realPreview ?? {
    headers: [],
    sampleRows: [],
    totalRows: 0,
    isEmpty: true,
    estimatedSizeKb: 0,
  };

  const handleDownload = async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    try {
      const params = new URLSearchParams({
        dataset: selectedDataset,
        format: selectedFormat,
        range: selectedRange,
      });
      const res = await fetch(`/api/export?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`Gagal mengunduh laporan (HTTP ${res.status})`);
      }
      const content = await res.text();
      const disposition = res.headers.get("Content-Disposition");
      const filenameMatch = disposition?.match(/filename="?([^";]+)"?/);
      const filename = filenameMatch?.[1] ?? `laporan-${selectedDataset}.${selectedFormat}`;
      const mimeType = selectedFormat === "json" ? "application/json" : "text/csv;charset=utf-8";
      triggerDownload(content, filename, mimeType);
      const headerCount = res.headers.get("X-Row-Count");
      const rowCount = headerCount !== null
        ? parseInt(headerCount, 10)
        : selectedFormat === "json"
          ? (JSON.parse(content) as unknown[]).length
          : Math.max(0, content.trim().split("\n").length - 1);
      setLastDownloaded({
        filename,
        rowCount,
        at: new Date(),
        format: selectedFormat,
        sizeKb: Math.max(0.1, Math.round((new Blob([content]).size / 1024) * 10) / 10),
      });
    } catch (err) {
      console.error("Gagal ekspor laporan:", err);
    } finally {
      setIsGenerating(false);
    }
  };

  const activeOption = EXPORT_DATASETS.find((d) => d.id === selectedDataset)!;
  const rangeApplies = TIME_BASED.includes(selectedDataset);

  return (
    <div className="flex flex-col gap-6" data-testid="export-board">
      <div className="grid gap-6 md:grid-cols-2">
        {/* Kolom 1: Pilih Dataset */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base sm:text-lg">1. Pilih Data Laporan</CardTitle>
            <CardDescription>
              Tentukan kumpulan data jaringan yang ingin diunduh.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3" role="radiogroup" aria-label="Pilihan dataset">
              {EXPORT_DATASETS.map((dataset) => {
                const count = dataset.recordCount(nowSec, selectedRange);
                const isSelected = selectedDataset === dataset.id;
                return (
                  <button
                    key={dataset.id}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => setSelectedDataset(dataset.id)}
                    className={`flex flex-col gap-1 rounded-lg border p-3.5 text-left transition-colors ${
                      isSelected
                        ? "border-primary bg-primary/5 text-foreground ring-1 ring-primary"
                        : "border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-foreground">{dataset.label}</span>
                      <span className="rounded bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                        {count.toLocaleString("id-ID")} baris
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">{dataset.description}</p>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Kolom 2: Format & Tombol Unduh */}
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base sm:text-lg">2. Format Berkas</CardTitle>
              <CardDescription>
                Pilih format data tabular untuk analisis lebih lanjut.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Pilihan format berkas">
                <button
                  type="button"
                  role="radio"
                  aria-checked={selectedFormat === "csv"}
                  onClick={() => setSelectedFormat("csv")}
                  className={`flex flex-col items-center gap-2 rounded-lg border p-4 text-center transition-colors ${
                    selectedFormat === "csv"
                      ? "border-primary bg-primary/5 text-foreground ring-1 ring-primary"
                      : "border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  }`}
                >
                  <FileSpreadsheet className="size-6 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  <div>
                    <div className="font-medium text-foreground">CSV</div>
                    <div className="text-xs text-muted-foreground">Untuk Excel / Spreadsheet</div>
                  </div>
                </button>

                <button
                  type="button"
                  role="radio"
                  aria-checked={selectedFormat === "json"}
                  onClick={() => setSelectedFormat("json")}
                  className={`flex flex-col items-center gap-2 rounded-lg border p-4 text-center transition-colors ${
                    selectedFormat === "json"
                      ? "border-primary bg-primary/5 text-foreground ring-1 ring-primary"
                      : "border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  }`}
                >
                  <FileJson className="size-6 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                  <div>
                    <div className="font-medium text-foreground">JSON</div>
                    <div className="text-xs text-muted-foreground">Struktur data lengkap</div>
                  </div>
                </button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base sm:text-lg">3. Rentang Waktu</CardTitle>
              <CardDescription>
                {rangeApplies
                  ? "Batasi data berdasarkan waktu kejadian."
                  : "Dataset ini berupa snapshot; rentang tidak berpengaruh."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div
                className="grid grid-cols-2 gap-3"
                role="radiogroup"
                aria-label="Pilihan rentang waktu"
                data-testid="export-range-select"
              >
                {EXPORT_TIME_RANGES.map((r) => {
                  const on = selectedRange === r.id;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-disabled={!rangeApplies}
                      onClick={() => setSelectedRange(r.id)}
                      className={`rounded-lg border p-3 text-center text-sm transition-colors ${
                        on
                          ? "border-primary bg-primary/5 font-medium text-foreground ring-1 ring-primary"
                          : "border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                      } ${rangeApplies ? "" : "opacity-60"}`}
                    >
                      {r.label}
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base sm:text-lg">4. Ringkasan & Unduh</CardTitle>
              <CardDescription>
                Unduh berkas ke perangkat Anda sekarang.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="rounded-lg bg-muted/60 p-4 text-sm">
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Dataset:</span>
                  <span className="font-medium text-foreground">{activeOption.label}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Format:</span>
                  <span className="font-medium uppercase text-foreground">{selectedFormat}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Estimasi baris:</span>
                  <span className="font-medium text-foreground">
                    {preview.totalRows.toLocaleString("id-ID")}
                  </span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Rentang:</span>
                  <span className="font-medium text-foreground">
                    {rangeApplies
                      ? EXPORT_TIME_RANGES.find((r) => r.id === selectedRange)!.label
                      : "Snapshot saat ini"}
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <div className="text-sm font-medium text-foreground">Pratinjau data</div>
                {preview.isEmpty ? (
                  <div
                    role="status"
                    data-testid="export-empty-state"
                    className="flex flex-col gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200"
                  >
                    <span className="flex items-center gap-2">
                      <Info className="size-4 shrink-0" aria-hidden="true" />
                      Tidak ada data dalam rentang waktu yang dipilih.
                    </span>
                    {selectedRange !== "all" && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedRange("all")}
                        className="self-start"
                      >
                        Pilih Rentang Lebih Luas
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-md border" tabIndex={0} role="region" aria-label="Pratinjau data">
                    <table className="w-full text-left text-xs" data-testid="export-preview-table">
                      <thead className="bg-muted/60">
                        <tr>
                          {preview.headers.map((h) => (
                            <th key={h} scope="col" className="whitespace-nowrap px-2 py-1.5 font-medium">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.sampleRows.map((row, i) => (
                          <tr key={i} className="border-t">
                            {row.map((cell, j) => (
                              <td key={j} className="whitespace-nowrap px-2 py-1.5 text-muted-foreground">
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  {preview.totalRows.toLocaleString("id-ID")} baris · perkiraan ±{preview.estimatedSizeKb} KB
                </p>
              </div>

              <Button
                type="button"
                size="lg"
                onClick={handleDownload}
                aria-disabled={isGenerating || preview.isEmpty}
                data-testid="download-export-btn"
                className="w-full gap-2 font-medium aria-disabled:opacity-60"
              >
                {isGenerating ? (
                  <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                ) : (
                  <Download className="size-4" aria-hidden="true" />
                )}
                {isGenerating ? "Menyiapkan data laporan..." : `Unduh Berkas ${selectedFormat.toUpperCase()}`}
              </Button>

              {lastDownloaded && (
                <div
                  id={statusId}
                  role="status"
                  data-testid="export-success-notice"
                  className="flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-800 dark:text-emerald-300"
                >
                  <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  <span>
                    Berhasil mengunduh <strong>{lastDownloaded.filename}</strong> · format{" "}
                    {lastDownloaded.format.toUpperCase()} · {lastDownloaded.rowCount.toLocaleString("id-ID")} baris · ±
                    {lastDownloaded.sizeKb} KB · {lastDownloaded.at.toLocaleTimeString("id-ID")}.
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
