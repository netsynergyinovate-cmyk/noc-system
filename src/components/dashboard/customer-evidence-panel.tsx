"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Info,
  RefreshCw,
  Wifi,
  WifiOff,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  evidenceRanges,
  peakWindows,
  OFF_PEAK_ID,
  OFF_PEAK_LABEL,
  type CustomerEvidence,
  type EvidenceRangeId,
  type IncidentSeriesPoint,
  type PeakWindowId,
} from "@/lib/customer-evidence-types";
import { IncidentDetailChart } from "./incident-detail-chart";
import {
  formatDurationCompact,
  formatWibDateTime,
  formatEvidenceSummary,
  getWindowLabelWithSpan,
} from "@/lib/customer-evidence-text";

async function getCustomerEvidence(
  customerId: string,
  range: EvidenceRangeId,
): Promise<CustomerEvidence> {
  const res = await fetch(
    `/api/customers/${encodeURIComponent(customerId)}/evidence?range=${range}`,
  );
  const json = (await res.json().catch(() => ({}))) as {
    data?: CustomerEvidence;
    error?: unknown;
  };
  if (!res.ok) {
    throw new Error(
      typeof json.error === "string" ? json.error : `HTTP ${res.status}`,
    );
  }
  if (!json.data) {
    throw new Error("Format data bukti keluhan tidak valid.");
  }
  return json.data;
}

function getHourWindowInfo(hour: number): {
  label: string;
  isPeak: boolean;
  peakId?: PeakWindowId;
} {
  if (hour >= 11 && hour < 12) {
    return { label: "Siang (11:00–12:30)", isPeak: true, peakId: "siang" };
  }
  if (hour >= 12 && hour < 15) {
    return {
      label: "Pulang sekolah (12:30–15:30)",
      isPeak: true,
      peakId: "pulang-sekolah",
    };
  }
  if (hour >= 15 && hour < 17) {
    return {
      label: "Sore pulang kerja (15:30–17:30)",
      isPeak: true,
      peakId: "pulang-kerja",
    };
  }
  if (hour >= 17 && hour < 23) {
    return {
      label: "Menjelang magrib – malam (17:30–23:00)",
      isPeak: true,
      peakId: "magrib-malam",
    };
  }
  return { label: "Di luar jam sibuk (23:00–11:00)", isPeak: false };
}

function formatMbpsOrDash(val: number | null | undefined): string {
  if (val === null || val === undefined) return "–";
  return `${val.toFixed(1)} Mbps`;
}

export function CustomerEvidencePanel({
  customerId,
  customerName,
  pppoeUsername,
}: {
  customerId: string;
  customerName?: string;
  pppoeUsername?: string;
}) {
  const searchParams = useSearchParams();
  const queryRange = searchParams.get("range");
  const validParamRange =
    queryRange && evidenceRanges.some((r) => r.id === queryRange)
      ? (queryRange as EvidenceRangeId)
      : null;

  const [range, setRange] = useState<EvidenceRangeId>(validParamRange ?? "3d");
  const [syncedParamRange, setSyncedParamRange] = useState(validParamRange);

  if (validParamRange && validParamRange !== syncedParamRange) {
    setSyncedParamRange(validParamRange);
    setRange(validParamRange);
  }

  const [evidenceState, setEvidenceState] = useState<{
    range: EvidenceRangeId;
    data: CustomerEvidence;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadCount, setReloadCount] = useState(0);
  const [expandedIncidentId, setExpandedIncidentId] = useState<string | null>(
    null,
  );
  const [filterVerdict, setFilterVerdict] = useState<
    "terbukti" | "belum-terverifikasi" | "tidak-terbukti" | "kedipan" | "semua"
  >("terbukti");
  const [showAllIncidents, setShowAllIncidents] = useState(false);
  const [seriesCache, setSeriesCache] = useState<
    Record<string, IncidentSeriesPoint[]>
  >({});
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    getCustomerEvidence(customerId, range)
      .then((data) => {
        if (!alive) return;
        setEvidenceState({ range, data });
        setError(null);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setError(
          err instanceof Error
            ? err.message
            : "Gagal memuat bukti keluhan pelanggan.",
        );
      });

    return () => {
      alive = false;
    };
  }, [customerId, range, reloadCount]);

  const evidence = evidenceState?.range === range ? evidenceState.data : null;
  const loading = !error && !evidence;

  const handleCopy = async () => {
    if (!evidence) return;
    try {
      const text = formatEvidenceSummary(evidence, {
        name: customerName,
        pppoeUsername,
      });
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  // Sort windows: off-peak row last
  const sortedWindows = useMemo(() => {
    if (!evidence) return [];
    return [...evidence.windows].sort((a, b) => {
      if (a.id === OFF_PEAK_ID) return 1;
      if (b.id === OFF_PEAK_ID) return -1;
      return 0;
    });
  }, [evidence]);

  // Sort daily: most recent first
  const sortedDaily = useMemo(() => {
    if (!evidence) return [];
    return [...evidence.daily].sort((a, b) => b.date.localeCompare(a.date));
  }, [evidence]);

  // Max hourly download Mbps for relative bar height
  const maxHourlyDown = useMemo(() => {
    if (!evidence?.hourly.length) return 1;
    const max = Math.max(...evidence.hourly.map((h) => h.avgDownMbps ?? 0));
    return max > 0 ? max : 1;
  }, [evidence]);

  const incidentCounts = useMemo(() => {
    if (!evidence?.incidents) {
      return {
        terbukti: 0,
        belumTerverifikasi: 0,
        tidakTerbukti: 0,
        kedipan: 0,
        total: 0,
      };
    }
    let terbukti = 0;
    let belumTerverifikasi = 0;
    let tidakTerbukti = 0;
    let kedipan = 0;
    for (const inc of evidence.incidents) {
      if (inc.verdict === "terbukti") terbukti++;
      else if (inc.verdict === "belum-terverifikasi") belumTerverifikasi++;
      else if (inc.verdict === "tidak-terbukti") tidakTerbukti++;
      else if (inc.verdict === "kedipan") kedipan++;
    }
    return {
      terbukti,
      belumTerverifikasi,
      tidakTerbukti,
      kedipan,
      total: evidence.incidents.length,
    };
  }, [evidence]);

  const filteredIncidents = useMemo(() => {
    if (!evidence?.incidents) return [];
    if (filterVerdict === "semua") return evidence.incidents;
    return evidence.incidents.filter((inc) => inc.verdict === filterVerdict);
  }, [evidence, filterVerdict]);

  const displayedIncidents = useMemo(() => {
    if (showAllIncidents) return filteredIncidents;
    return filteredIncidents.slice(0, 10);
  }, [filteredIncidents, showAllIncidents]);
  return (
    <Card id="bukti" className="scroll-mt-6">
      <CardHeader className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <CardTitle className="text-base font-semibold">
            Bukti keluhan pelanggan
          </CardTitle>
          <CardDescription>
            Riwayat putus-nyambung dan analisis trafik jam sibuk (WIB) untuk
            verifikasi keluhan &ldquo;ngelag&rdquo; atau
            &ldquo;putus-putus&rdquo;.
          </CardDescription>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!evidence || loading}
            onClick={() => void handleCopy()}
            className="h-8 gap-1.5 text-xs font-medium"
            aria-label="Salin ringkasan bukti ke clipboard"
          >
            {copied ? (
              <>
                <Check
                  className="size-3.5 text-green-600 dark:text-green-400"
                  aria-hidden="true"
                />
                <span>Tersalin!</span>
              </>
            ) : (
              <>
                <Copy className="size-3.5" aria-hidden="true" />
                <span>Salin ringkasan</span>
              </>
            )}
          </Button>

          <Tabs
            value={range}
            onValueChange={(v) => {
              setRange(v as EvidenceRangeId);
              setShowAllIncidents(false);
              setExpandedIncidentId(null);
            }}
          >
            <TabsList className="grid grid-cols-5 h-8 p-0.5">
              {evidenceRanges.map((r) => (
                <TabsTrigger
                  key={r.id}
                  value={r.id}
                  className="px-2 py-1 text-xs"
                >
                  {r.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {loading ? (
          <div
            role="status"
            aria-label="Memuat bukti keluhan pelanggan"
            className="flex h-64 flex-col items-center justify-center gap-2 rounded-lg border border-border bg-muted/20 text-muted-foreground"
          >
            <RefreshCw className="size-5 animate-spin motion-reduce:animate-none" />
            <span className="text-xs">Memuat bukti keluhan pelanggan…</span>
          </div>
        ) : error ? (
          <div
            role="alert"
            className="flex flex-col items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-center text-xs text-destructive"
          >
            <AlertCircle className="size-5" />
            <p className="font-medium">{error}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setError(null);
                setReloadCount((c) => c + 1);
              }}
              className="mt-2 h-7 gap-1 text-xs"
            >
              <RefreshCw className="size-3" />
              Coba lagi
            </Button>
          </div>
        ) : evidence ? (
          <>
            {/* (a) Status Strip */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {/* Status saat ini */}
              <div className="flex flex-col justify-between rounded-lg border border-border bg-muted/30 p-2.5">
                <span className="text-[11px] text-muted-foreground">
                  Status saat ini
                </span>
                <div className="mt-1 flex items-center gap-1.5 font-medium">
                  {evidence.connection.state === "up" ? (
                    <>
                      <Wifi className="size-3.5 text-green-600 dark:text-green-400" />
                      <span className="text-sm font-semibold text-green-700 dark:text-green-300">
                        Online
                      </span>
                    </>
                  ) : evidence.connection.state === "down" ? (
                    <>
                      <WifiOff className="size-3.5 text-destructive" />
                      <span className="text-sm font-semibold text-destructive">
                        Offline
                      </span>
                    </>
                  ) : (
                    <span className="text-sm font-semibold text-muted-foreground">
                      Belum diketahui
                    </span>
                  )}
                </div>
                <span className="mt-1 text-[10px] text-muted-foreground truncate">
                  {evidence.connection.since
                    ? `Sejak ${formatWibDateTime(evidence.connection.since)}`
                    : "Waktu tidak tercatat"}
                </span>
              </div>

              {/* Gangguan nyata (Headline) */}
              <div
                className="flex flex-col justify-between rounded-lg border border-border bg-muted/30 p-2.5"
                title="Gangguan = putus-nyambung digabung jika jaraknya &le; 15 menit; terbukti = trafik berhenti selama down."
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-foreground">
                    Gangguan nyata
                  </span>
                  <Info
                    className="size-3 text-muted-foreground"
                    aria-hidden="true"
                  />
                </div>
                <div className="mt-1 font-mono text-xl font-bold tabular-nums text-destructive">
                  {evidence.incidentSummary.real}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    kali
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground border-t border-border/50 pt-1">
                  <span title="Data trafik sekitar belum ada atau insiden masih berjalan/baru selesai">
                    Belum terverifikasi:{" "}
                    <strong className="text-foreground">
                      {evidence.incidentSummary.belumTerverifikasi}
                    </strong>
                  </span>
                  <span title="Trafik tetap mengalir saat tercatat down">
                    Tidak terbukti:{" "}
                    <strong className="text-foreground">
                      {evidence.incidentSummary.tidakTerbukti}
                    </strong>
                  </span>
                  <span title="Putus &lt; 5 menit tunggal tanpa flap berulang (diabaikan)">
                    Kedipan:{" "}
                    <strong className="text-foreground">
                      {evidence.incidentSummary.kedipan}
                    </strong>
                  </span>
                </div>
                <span className="mt-1 text-[10px] text-muted-foreground">
                  Kejadian putus tercatat:{" "}
                  {evidence.connection.summary.outageCount} kali
                </span>
              </div>

              {/* Total Durasi Down Nyata */}
              <div className="flex flex-col justify-between rounded-lg border border-border bg-muted/30 p-2.5">
                <span className="text-[11px] text-muted-foreground">
                  Total durasi down
                </span>
                <div className="mt-1 font-mono text-base font-semibold tabular-nums text-foreground">
                  {formatDurationCompact(
                    evidence.incidentSummary.realDownSeconds,
                  )}
                </div>
                <span className="mt-1 text-[10px] text-muted-foreground">
                  Akumulasi gangguan nyata
                </span>
              </div>

              {/* Uptime */}
              <div className="flex flex-col justify-between rounded-lg border border-border bg-muted/30 p-2.5">
                <span className="text-[11px] text-muted-foreground">
                  Uptime
                </span>
                <div className="mt-1 font-mono text-base font-semibold tabular-nums text-foreground">
                  {evidence.connection.summary.uptimePct !== null
                    ? `${evidence.connection.summary.uptimePct.toFixed(1)}%`
                    : "–"}
                </div>
                <span className="mt-1 text-[10px] text-muted-foreground">
                  Pada cakupan riwayat
                </span>
              </div>

              {/* Gangguan Massal */}
              <div className="flex flex-col justify-between rounded-lg border border-border bg-muted/30 p-2.5">
                <span className="text-[11px] text-muted-foreground">
                  Gangguan massal
                </span>
                <div className="mt-1 font-mono text-base font-semibold tabular-nums text-foreground">
                  {evidence.incidentSummary.realMassal}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    kali
                  </span>
                </div>
                <span className="mt-1 text-[10px] text-muted-foreground">
                  &ge; 3 pelanggan router sama
                </span>
              </div>
            </div>

            {/* (b) Coverage notes & batasan */}
            <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/20 p-3 text-xs leading-relaxed">
              <div className="flex items-center gap-1.5 font-medium text-foreground">
                <Clock
                  className="size-3.5 text-muted-foreground"
                  aria-hidden="true"
                />
                <span>
                  Bukti dihitung dari {formatWibDateTime(evidence.from)} sampai{" "}
                  {formatWibDateTime(evidence.to)}
                </span>
              </div>
              {evidence.coverage.notes.length > 0 && (
                <ul className="list-disc pl-5 text-muted-foreground space-y-0.5">
                  {evidence.coverage.notes.map((note, idx) => (
                    <li key={idx}>{note}</li>
                  ))}
                </ul>
              )}
            </div>

            {/* (c) Findings List */}
            {evidence.findings.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="text-xs font-semibold text-foreground">
                  Temuan otomatis
                </span>
                <div className="grid gap-2 sm:grid-cols-2">
                  {evidence.findings.map((f, idx) => (
                    <div
                      key={idx}
                      className={cn(
                        "flex items-start gap-2 rounded-lg border p-2.5 text-xs",
                        f.severity === "warn"
                          ? "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200"
                          : "border-blue-500/30 bg-blue-500/10 text-blue-900 dark:text-blue-200",
                      )}
                    >
                      {f.severity === "warn" ? (
                        <AlertTriangle
                          className="size-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400"
                          aria-hidden="true"
                        />
                      ) : (
                        <Info
                          className="size-4 shrink-0 mt-0.5 text-blue-600 dark:text-blue-400"
                          aria-hidden="true"
                        />
                      )}
                      <span className="leading-normal">{f.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* (g) 24-hour bar strip from hourly */}
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-1">
                <span className="text-xs font-semibold text-foreground">
                  Pola 24 jam rata-rata (WIB)
                </span>
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <span className="size-2 rounded-xs bg-[var(--chart-1)]" />
                    Unduh rata-rata
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="size-2 rounded-full bg-destructive" />
                    Pernah down
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="size-2 rounded-xs border border-primary/40 bg-primary/10" />
                    Jam sibuk
                  </span>
                </div>
              </div>

              <div
                role="img"
                aria-label="Grafik batang profil trafik unduh 24 jam dan tanda down dalam WIB"
                className="rounded-lg border border-border bg-card p-3"
              >
                <div className="grid grid-cols-24 gap-0.5 sm:gap-1 h-32 items-end">
                  {evidence.hourly.map((h) => {
                    const info = getHourWindowInfo(h.hour);
                    const pct =
                      h.avgDownMbps !== null
                        ? Math.max(
                            8,
                            Math.min(
                              100,
                              Math.round((h.avgDownMbps / maxHourlyDown) * 100),
                            ),
                          )
                        : 0;
                    const tooltip = `Jam ${String(h.hour).padStart(2, "0")}:00 WIB (${info.label}): ${formatMbpsOrDash(h.avgDownMbps)} unduh${h.downSeconds > 0 ? `, down ${formatDurationCompact(h.downSeconds)}` : ""}`;

                    return (
                      <div
                        key={h.hour}
                        title={tooltip}
                        className={cn(
                          "relative flex h-full flex-col items-center justify-end rounded-xs pb-1 transition-colors motion-reduce:transition-none",
                          info.isPeak
                            ? "bg-primary/10 border-b border-primary"
                            : "bg-muted/30",
                        )}
                      >
                        {h.downSeconds > 0 && (
                          <span
                            className="mb-1 size-1.5 rounded-full bg-destructive shrink-0"
                            aria-label={`Down ${formatDurationCompact(h.downSeconds)}`}
                          />
                        )}
                        <div
                          style={{ height: `${pct}%` }}
                          className={cn(
                            "w-full rounded-t-xs transition-all motion-reduce:transition-none",
                            pct > 0
                              ? info.isPeak
                                ? "bg-[var(--chart-1)] hover:bg-[var(--chart-1)]/90"
                                : "bg-[var(--chart-1)]/70 hover:bg-[var(--chart-1)]"
                              : "bg-transparent",
                          )}
                        />
                      </div>
                    );
                  })}
                </div>

                {/* X-axis ticks (WIB) */}
                <div className="mt-1.5 flex justify-between text-[10px] font-mono text-muted-foreground px-0.5">
                  <span>00</span>
                  <span>03</span>
                  <span>06</span>
                  <span>09</span>
                  <span>12</span>
                  <span>15</span>
                  <span>18</span>
                  <span>21</span>
                  <span>23</span>
                </div>
              </div>
            </div>

            {/* (e) 'Analisis jam sibuk' table */}
            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-foreground">
                Analisis jam sibuk
              </span>
              <div className="overflow-x-auto rounded-lg border border-border">
                <Table className="min-w-[640px] text-xs">
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className="font-medium">Jam sibuk</TableHead>
                      <TableHead className="font-medium text-right">
                        Rata-rata unduh
                      </TableHead>
                      <TableHead className="font-medium text-right">
                        Rata-rata unggah
                      </TableHead>
                      <TableHead className="font-medium text-right">
                        P95 unduh
                      </TableHead>
                      <TableHead className="font-medium text-right">
                        Puncak unduh
                      </TableHead>
                      <TableHead className="font-medium text-right">
                        Durasi down
                      </TableHead>
                      <TableHead className="font-medium text-right">
                        Gangguan nyata
                      </TableHead>
                      <TableHead className="font-medium text-right">
                        Mulai gangguan
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedWindows.map((win) => {
                      const isOffPeak = win.id === OFF_PEAK_ID;
                      return (
                        <TableRow
                          key={win.id}
                          className={cn(isOffPeak && "bg-muted/15 font-normal")}
                        >
                          <TableCell className="font-medium">
                            {getWindowLabelWithSpan(win)}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {formatMbpsOrDash(win.avgDownMbps)}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {formatMbpsOrDash(win.avgUpMbps)}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {formatMbpsOrDash(win.p95DownMbps)}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {formatMbpsOrDash(win.maxDownMbps)}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {win.downSeconds > 0 ? (
                              <span className="font-semibold text-destructive">
                                {formatDurationCompact(win.downSeconds)}
                              </span>
                            ) : (
                              "0 m"
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {(evidence.incidentSummary?.realByWindow?.[
                              win.id as PeakWindowId
                            ] ?? 0) > 0 ? (
                              <span className="font-semibold text-destructive">
                                {evidence.incidentSummary?.realByWindow?.[
                                  win.id as PeakWindowId
                                ] ?? 0}
                                x
                              </span>
                            ) : (
                              "0x"
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {win.outageStarts > 0 ? (
                              <span className="font-semibold text-destructive">
                                {win.outageStarts}x
                              </span>
                            ) : (
                              "0x"
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>

            {/* (d) Table 'Gangguan' atas incidents */}
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <span className="text-xs font-semibold text-foreground">
                    Gangguan
                  </span>
                  <span className="ml-2 text-[11px] text-muted-foreground">
                    {evidence.incidents.length} insiden dikelompokkan
                  </span>
                </div>

                {/* Filter chips */}
                <div
                  className="flex flex-wrap items-center gap-1.5"
                  role="toolbar"
                  aria-label="Filter status gangguan"
                >
                  {[
                    {
                      id: "terbukti",
                      label: "Terbukti",
                      count: incidentCounts.terbukti,
                    },
                    {
                      id: "belum-terverifikasi",
                      label: "Belum terverifikasi",
                      count: incidentCounts.belumTerverifikasi,
                    },
                    {
                      id: "tidak-terbukti",
                      label: "Tidak terbukti",
                      count: incidentCounts.tidakTerbukti,
                    },
                    {
                      id: "kedipan",
                      label: "Kedipan",
                      count: incidentCounts.kedipan,
                    },
                    {
                      id: "semua",
                      label: "Semua",
                      count: incidentCounts.total,
                    },
                  ].map((chip) => {
                    const active = filterVerdict === chip.id;
                    return (
                      <Button
                        key={chip.id}
                        type="button"
                        variant={active ? "default" : "outline"}
                        size="sm"
                        onClick={() => {
                          setFilterVerdict(chip.id as typeof filterVerdict);
                          setShowAllIncidents(false);
                        }}
                        className={cn(
                          "h-6 px-2 text-[11px] gap-1 font-medium",
                          active
                            ? "shadow-2xs"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                        aria-pressed={active}
                      >
                        <span>{chip.label}</span>
                        <span className="font-mono text-[10px] opacity-80">
                          ({chip.count})
                        </span>
                      </Button>
                    );
                  })}
                </div>
              </div>

              {filteredIncidents.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                  Tidak ada gangguan dengan status &ldquo;{filterVerdict}&rdquo;
                  pada rentang ini.
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <Table className="min-w-[800px] text-xs">
                      <TableHeader>
                        <TableRow className="bg-muted/40 hover:bg-muted/40">
                          <TableHead className="w-8" />
                          <TableHead className="font-medium">
                            Mulai (WIB)
                          </TableHead>
                          <TableHead className="font-medium">
                            Selesai (WIB)
                          </TableHead>
                          <TableHead className="font-medium text-right">
                            Durasi down
                          </TableHead>
                          <TableHead className="font-medium text-center">
                            Putus digabung
                          </TableHead>
                          <TableHead className="font-medium">
                            Jam sibuk
                          </TableHead>
                          <TableHead className="font-medium text-center">
                            Status
                          </TableHead>
                          <TableHead className="font-medium text-center">
                            Cakupan
                          </TableHead>
                          <TableHead className="font-medium text-right">
                            Trafik sebelum &rarr; sesudah
                          </TableHead>
                          <TableHead className="font-medium text-center">
                            Sumber
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {displayedIncidents.map((inc) => {
                          const isExpanded = expandedIncidentId === inc.id;
                          const hasAlertOnly =
                            inc.sources.includes("alert") &&
                            !inc.sources.includes("live");

                          return (
                            <Fragment key={inc.id}>
                              <TableRow
                                className={cn(
                                  "hover:bg-muted/30 cursor-pointer transition-colors",
                                  isExpanded && "bg-muted/20",
                                )}
                                onClick={() =>
                                  setExpandedIncidentId(
                                    isExpanded ? null : inc.id,
                                  )
                                }
                              >
                                <TableCell className="p-2">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="size-6 p-0"
                                    aria-expanded={isExpanded}
                                    aria-label={
                                      isExpanded
                                        ? "Tutup rincian grafik gangguan"
                                        : "Buka rincian grafik gangguan"
                                    }
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setExpandedIncidentId(
                                        isExpanded ? null : inc.id,
                                      );
                                    }}
                                  >
                                    {isExpanded ? (
                                      <ChevronUp className="size-3.5" />
                                    ) : (
                                      <ChevronDown className="size-3.5" />
                                    )}
                                  </Button>
                                </TableCell>
                                <TableCell className="font-mono tabular-nums">
                                  {formatWibDateTime(inc.from)}
                                </TableCell>
                                <TableCell className="font-mono tabular-nums">
                                  {inc.to ? (
                                    formatWibDateTime(inc.to)
                                  ) : (
                                    <Badge
                                      variant="destructive"
                                      className="px-1.5 py-0 text-[10px]"
                                    >
                                      masih down
                                    </Badge>
                                  )}
                                </TableCell>
                                <TableCell className="text-right font-mono tabular-nums font-semibold text-destructive">
                                  {formatDurationCompact(inc.downSeconds)}
                                </TableCell>
                                <TableCell className="text-center font-mono tabular-nums">
                                  {inc.outageCount}x
                                </TableCell>
                                <TableCell>
                                  <div className="flex flex-wrap gap-1">
                                    {inc.windows.map((wId) => {
                                      const pw = peakWindows.find(
                                        (p) => p.id === wId,
                                      );
                                      const label = pw
                                        ? pw.label
                                        : wId === OFF_PEAK_ID
                                          ? OFF_PEAK_LABEL
                                          : wId;
                                      const isStart = wId === inc.startWindow;
                                      return (
                                        <Badge
                                          key={wId}
                                          variant={
                                            isStart ? "default" : "outline"
                                          }
                                          className={cn(
                                            "px-1 py-0 text-[9px]",
                                            isStart && "ring-1 ring-primary/40",
                                          )}
                                          title={
                                            isStart
                                              ? `Mulai di jam ${label}`
                                              : label
                                          }
                                        >
                                          {label.split(" ")[0]}
                                        </Badge>
                                      );
                                    })}
                                  </div>
                                </TableCell>
                                <TableCell className="text-center">
                                  <Badge
                                    variant={
                                      inc.verdict === "terbukti"
                                        ? "default"
                                        : inc.verdict === "kedipan"
                                          ? "secondary"
                                          : "outline"
                                    }
                                    title={inc.verdictReason}
                                    className="px-1.5 py-0 text-[10px] cursor-help"
                                  >
                                    {inc.verdict}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-center">
                                  <Badge
                                    variant={
                                      inc.scope.kind === "massal"
                                        ? "destructive"
                                        : "secondary"
                                    }
                                    className="px-1.5 py-0 text-[10px]"
                                  >
                                    {inc.scope.kind === "massal"
                                      ? `Massal (${inc.scope.otherDown} lain)`
                                      : inc.scope.kind === "sendiri"
                                        ? "Sendiri"
                                        : "Tidak diketahui"}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right font-mono tabular-nums text-[11px]">
                                  {inc.beforeAvgDownMbps !== null
                                    ? `${inc.beforeAvgDownMbps.toFixed(1)}`
                                    : "–"}{" "}
                                  &rarr;{" "}
                                  {inc.afterAvgDownMbps !== null
                                    ? `${inc.afterAvgDownMbps.toFixed(1)}`
                                    : "–"}{" "}
                                  <span className="text-[10px] text-muted-foreground">
                                    Mbps
                                  </span>
                                </TableCell>
                                <TableCell className="text-center">
                                  {hasAlertOnly ? (
                                    <Badge
                                      variant="outline"
                                      className="border-amber-500/40 text-[10px] text-amber-600 dark:text-amber-400 py-0 px-1"
                                    >
                                      dari alert
                                    </Badge>
                                  ) : (
                                    <span className="text-muted-foreground text-[11px]">
                                      live
                                    </span>
                                  )}
                                </TableCell>
                              </TableRow>
                              {isExpanded && (
                                <TableRow className="bg-muted/10 hover:bg-muted/10">
                                  <TableCell colSpan={10} className="p-3">
                                    <IncidentDetailChart
                                      customerId={customerId}
                                      incident={inc}
                                      cachedSeries={seriesCache[inc.id]}
                                      onSeriesLoaded={(pts) =>
                                        setSeriesCache((prev) => ({
                                          ...prev,
                                          [inc.id]: pts,
                                        }))
                                      }
                                    />
                                  </TableCell>
                                </TableRow>
                              )}
                            </Fragment>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>

                  {filteredIncidents.length > 10 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowAllIncidents((prev) => !prev)}
                      className="self-center h-7 gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      {showAllIncidents ? (
                        <>
                          <ChevronUp className="size-3.5" />
                          <span>Tampilkan lebih sedikit (10)</span>
                        </>
                      ) : (
                        <>
                          <ChevronDown className="size-3.5" />
                          <span>
                            Tampilkan semua ({filteredIncidents.length})
                          </span>
                        </>
                      )}
                    </Button>
                  )}
                </>
              )}
            </div>

            {/* (f) Per-day table from daily */}
            {sortedDaily.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="text-xs font-semibold text-foreground">
                  Rincian harian (WIB)
                </span>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <Table className="min-w-[700px] text-xs">
                    <TableHeader>
                      <TableRow className="bg-muted/40 hover:bg-muted/40">
                        <TableHead className="font-medium">Tanggal</TableHead>
                        <TableHead className="font-medium text-right">
                          Down
                        </TableHead>
                        <TableHead className="font-medium text-right">
                          Gangguan
                        </TableHead>
                        {peakWindows.map((pw) => (
                          <TableHead
                            key={pw.id}
                            className="font-medium text-right"
                          >
                            {pw.label}
                          </TableHead>
                        ))}
                        <TableHead className="font-medium text-right">
                          Luar jam sibuk
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedDaily.map((day) => (
                        <TableRow key={day.date}>
                          <TableCell className="font-medium font-mono tabular-nums">
                            {day.date}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {day.downSeconds > 0 ? (
                              <span className="font-semibold text-destructive">
                                {formatDurationCompact(day.downSeconds)}
                              </span>
                            ) : (
                              "0 m"
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {day.outageStarts > 0 ? (
                              <span className="font-semibold text-destructive">
                                {day.outageStarts}x
                              </span>
                            ) : (
                              "0x"
                            )}
                          </TableCell>
                          {peakWindows.map((pw) => {
                            const wStat = day.windows[pw.id];
                            return (
                              <TableCell
                                key={pw.id}
                                className="text-right font-mono tabular-nums"
                              >
                                {formatMbpsOrDash(wStat?.avgDownMbps)}
                              </TableCell>
                            );
                          })}
                          <TableCell className="text-right font-mono tabular-nums">
                            {formatMbpsOrDash(
                              day.windows[OFF_PEAK_ID]?.avgDownMbps,
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
