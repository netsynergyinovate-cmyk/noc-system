"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
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
import {
  peakWindows,
  OFF_PEAK_ID,
  OFF_PEAK_LABEL,
  type CustomerIncident,
  type IncidentSeriesPoint,
} from "@/lib/customer-evidence-types";
import {
  formatDurationCompact,
  formatWibDateTime,
} from "@/lib/customer-evidence-text";

function formatWibClock(epochSec: number): string {
  return (
    new Intl.DateTimeFormat("id-ID", {
      timeZone: "Asia/Jakarta",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(epochSec * 1000)) + " WIB"
  );
}

export function IncidentDetailChart({
  customerId,
  incident,
  cachedSeries,
  onSeriesLoaded,
}: {
  customerId: string;
  incident: CustomerIncident;
  cachedSeries?: IncidentSeriesPoint[];
  onSeriesLoaded?: (series: IncidentSeriesPoint[]) => void;
}) {
  const [localSeries, setLocalSeries] = useState<IncidentSeriesPoint[] | null>(
    null,
  );
  const [loading, setLoading] = useState<boolean>(!cachedSeries);
  const [error, setError] = useState<string | null>(null);
  const chartId = useId();

  const series = cachedSeries ?? localSeries;

  const fetchSeries = () => {
    setLoading(true);
    setError(null);
    const toParam = incident.to !== null ? String(incident.to) : "open";
    const url = `/api/customers/${encodeURIComponent(customerId)}/incident-series?from=${incident.from}&to=${toParam}`;
    fetch(url)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Gagal memuat trafik (${res.status})`);
        }
        const json = (await res.json()) as { data?: IncidentSeriesPoint[] };
        const pts = json.data ?? [];
        setLocalSeries(pts);
        onSeriesLoaded?.(pts);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(
          err instanceof Error
            ? err.message
            : "Gagal memuat grafik trafik insiden.",
        );
        setLoading(false);
      });
  };

  useEffect(() => {
    if (cachedSeries) return;
    let alive = true;
    const toParam = incident.to !== null ? String(incident.to) : "open";
    const url = `/api/customers/${encodeURIComponent(customerId)}/incident-series?from=${incident.from}&to=${toParam}`;
    fetch(url)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Gagal memuat trafik (${res.status})`);
        }
        const json = (await res.json()) as { data?: IncidentSeriesPoint[] };
        if (!alive) return;
        const pts = json.data ?? [];
        setLocalSeries(pts);
        onSeriesLoaded?.(pts);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setError(
          err instanceof Error
            ? err.message
            : "Gagal memuat grafik trafik insiden.",
        );
        setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, incident.id, cachedSeries]);

  // Waktu grafik: 1 jam sebelum mulai s.d. 1 jam setelah selesai/sekarang
  const { minT, maxT, maxMbps } = useMemo(() => {
    const endSec =
      incident.to ?? incident.from + Math.max(incident.downSeconds, 300);
    let minTime = incident.from - 3600;
    let maxTime = endSec + 3600;

    if (series && series.length > 0) {
      minTime = Math.min(minTime, series[0].t);
      maxTime = Math.max(maxTime, series[series.length - 1].t);
    }
    if (maxTime <= minTime) {
      maxTime = minTime + 3600;
    }

    let peak = 1.0;
    if (series && series.length > 0) {
      for (const p of series) {
        if (p.downMaxMbps > peak) peak = p.downMaxMbps;
        if (p.upMaxMbps > peak) peak = p.upMaxMbps;
        if (p.downMbps > peak) peak = p.downMbps;
        if (p.upMbps > peak) peak = p.upMbps;
      }
    }
    peak = Math.ceil(peak * 1.15 * 10) / 10;
    return { minT: minTime, maxT: maxTime, maxMbps: peak };
  }, [incident, series]);

  // Geometri SVG
  const width = 640;
  const height = 180;
  const padLeft = 45;
  const padRight = 20;
  const padTop = 22;
  const padBottom = 26;
  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;

  const getX = (t: number) => {
    const clamped = Math.max(minT, Math.min(maxT, t));
    return padLeft + ((clamped - minT) / (maxT - minT)) * innerW;
  };

  const getY = (mbps: number) => {
    const val = Math.max(0, Math.min(maxMbps, mbps));
    return padTop + innerH - (val / maxMbps) * innerH;
  };

  // Garis download & upload: celah queue (selisih t > 450 atau samples === 0)
  const { downSegments, upSegments } = useMemo(() => {
    if (!series || series.length === 0) {
      return { downSegments: [], upSegments: [] };
    }
    const downSegs: string[] = [];
    const upSegs: string[] = [];
    let currentDown = "";
    let currentUp = "";
    let prevT: number | null = null;

    for (const pt of series) {
      const isBreak =
        prevT !== null && (pt.t - prevT > 450 || pt.samples === 0);
      const x = getX(pt.t);
      const yDown = getY(pt.downMbps);
      const yUp = getY(pt.upMbps);

      if (isBreak || currentDown === "") {
        if (currentDown !== "") downSegs.push(currentDown);
        if (currentUp !== "") upSegs.push(currentUp);
        currentDown = `M ${x.toFixed(1)} ${yDown.toFixed(1)}`;
        currentUp = `M ${x.toFixed(1)} ${yUp.toFixed(1)}`;
      } else {
        currentDown += ` L ${x.toFixed(1)} ${yDown.toFixed(1)}`;
        currentUp += ` L ${x.toFixed(1)} ${yUp.toFixed(1)}`;
      }
      prevT = pt.t;
    }
    if (currentDown !== "") downSegs.push(currentDown);
    if (currentUp !== "") upSegs.push(currentUp);

    return { downSegments: downSegs, upSegments: upSegs };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, minT, maxT, maxMbps]);

  // Titik tabel di sekitar mulai & selesai
  const edgePoints = useMemo(() => {
    if (!series || series.length === 0) return [];
    const edgeWindowSec = 15 * 60; // 15 menit
    return series.filter((pt) => {
      const nearStart = Math.abs(pt.t - incident.from) <= edgeWindowSec;
      const nearEnd =
        incident.to !== null && Math.abs(pt.t - incident.to) <= edgeWindowSec;
      return nearStart || nearEnd;
    });
  }, [series, incident]);

  // X ticks
  const xTicks = useMemo(() => {
    const count = 5;
    const ticks: { t: number; x: number; label: string }[] = [];
    const step = (maxT - minT) / (count - 1);
    for (let i = 0; i < count; i++) {
      const t = minT + i * step;
      ticks.push({
        t,
        x: getX(t),
        label: formatWibClock(t),
      });
    }
    return ticks;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minT, maxT]);

  // Shaded outage blocks
  const outageBlocks = useMemo(() => {
    return incident.outages.map((out, idx) => {
      const startT = Math.max(minT, out.from);
      const endT = out.to !== null ? Math.min(maxT, out.to) : maxT;
      const x1 = getX(startT);
      const x2 = getX(endT);
      const w = Math.max(2, x2 - x1);
      return { id: idx, x: x1, w, from: out.from, to: out.to };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incident.outages, minT, maxT]);

  const xStartMarker = getX(incident.from);
  const xEndMarker = incident.to !== null ? getX(incident.to) : null;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/80 bg-muted/20 p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-foreground">
            Grafik Bukti Trafik & Detil Gangguan
          </span>
          <span className="text-[11px] text-muted-foreground">
            ID: {incident.id}
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-3 bg-primary" /> Unduh (Mbps)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-3 bg-emerald-500" /> Unggah
            (Mbps)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-xs border border-destructive/40 bg-destructive/15" />{" "}
            Blok Down
          </span>
        </div>
      </div>

      {loading ? (
        <div className="flex h-44 flex-col items-center justify-center gap-2 rounded-md border border-border bg-background/50 text-muted-foreground">
          <RefreshCw className="size-4 animate-spin motion-reduce:animate-none" />
          <span className="text-xs">
            Memuat data trafik di sekitar gangguan…
          </span>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-4 text-center text-xs text-destructive">
          <AlertCircle className="size-4" />
          <span>{error}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={fetchSeries}
            className="h-7 text-xs"
          >
            Coba lagi
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {/* SVG Chart */}
          <div className="relative overflow-x-auto rounded-md border border-border bg-card p-1">
            <svg
              viewBox={`0 0 ${width} ${height}`}
              className="w-full h-auto min-w-[560px] text-foreground"
              role="img"
              aria-labelledby={`${chartId}-title`}
            >
              <title id={`${chartId}-title`}>
                Grafik trafik unduh dan unggah selama periode gangguan
              </title>

              {/* Grid Horizontal */}
              {[0, 0.5, 1].map((pct) => {
                const y = padTop + innerH * (1 - pct);
                const mbps = maxMbps * pct;
                return (
                  <g key={pct}>
                    <line
                      x1={padLeft}
                      y1={y}
                      x2={width - padRight}
                      y2={y}
                      className="stroke-border/60"
                      strokeDasharray="2 3"
                    />
                    <text
                      x={padLeft - 6}
                      y={y + 3}
                      textAnchor="end"
                      className="text-[9px] font-mono fill-muted-foreground"
                    >
                      {mbps.toFixed(1)}
                    </text>
                  </g>
                );
              })}

              {/* Shaded Outage Blocks */}
              {outageBlocks.map((b) => (
                <rect
                  key={b.id}
                  x={b.x}
                  y={padTop}
                  width={b.w}
                  height={innerH}
                  className="fill-destructive/15 stroke-destructive/40"
                  strokeDasharray="3 3"
                >
                  <title>
                    Putus mentah: {formatWibClock(b.from)} s.d.{" "}
                    {b.to ? formatWibClock(b.to) : "masih down"}
                  </title>
                </rect>
              ))}

              {/* Start Marker */}
              <line
                x1={xStartMarker}
                y1={padTop}
                x2={xStartMarker}
                y2={padTop + innerH}
                className="stroke-destructive stroke-2"
                strokeDasharray="4 2"
              />
              <text
                x={xStartMarker}
                y={padTop - 6}
                textAnchor="middle"
                className="text-[9px] font-mono font-bold fill-destructive"
              >
                Mulai: {formatWibClock(incident.from)}
              </text>

              {/* End Marker */}
              {xEndMarker !== null ? (
                <>
                  <line
                    x1={xEndMarker}
                    y1={padTop}
                    x2={xEndMarker}
                    y2={padTop + innerH}
                    className="stroke-green-600 dark:stroke-green-400 stroke-2"
                    strokeDasharray="4 2"
                  />
                  <text
                    x={xEndMarker}
                    y={padTop - 6}
                    textAnchor="middle"
                    className="text-[9px] font-mono font-bold fill-green-600 dark:fill-green-400"
                  >
                    Selesai: {formatWibClock(incident.to!)}
                  </text>
                </>
              ) : (
                <text
                  x={width - padRight - 10}
                  y={padTop + 14}
                  textAnchor="end"
                  className="text-[10px] font-semibold fill-destructive"
                >
                  Masih down
                </text>
              )}

              {/* Download Series Segments (Queue Gaps Visible) */}
              {downSegments.map((dPath, i) => (
                <path
                  key={`down-${i}`}
                  d={dPath}
                  fill="none"
                  className="stroke-primary stroke-2"
                />
              ))}

              {/* Upload Series Segments */}
              {upSegments.map((uPath, i) => (
                <path
                  key={`up-${i}`}
                  d={uPath}
                  fill="none"
                  className="stroke-emerald-500 stroke-1.5"
                  strokeDasharray="2 1"
                />
              ))}

              {/* X Axis Line */}
              <line
                x1={padLeft}
                y1={padTop + innerH}
                x2={width - padRight}
                y2={padTop + innerH}
                className="stroke-border"
              />

              {/* X Axis Ticks */}
              {xTicks.map((tick, i) => (
                <g key={i}>
                  <line
                    x1={tick.x}
                    y1={padTop + innerH}
                    x2={tick.x}
                    y2={padTop + innerH + 4}
                    className="stroke-border"
                  />
                  <text
                    x={tick.x}
                    y={padTop + innerH + 16}
                    textAnchor="middle"
                    className="text-[9px] font-mono fill-muted-foreground"
                  >
                    {tick.label}
                  </text>
                </g>
              ))}
            </svg>
          </div>

          {/* Tabel sampel di sekitar awal dan akhir */}
          {edgePoints.length > 0 && (
            <div className="space-y-1">
              <span className="text-[11px] font-medium text-foreground">
                Data sampel trafik 5 menit di sekitar kejadian (±15 menit):
              </span>
              <div className="overflow-x-auto rounded-md border border-border">
                <Table className="min-w-[480px] text-[11px]">
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className="py-1">Waktu (WIB)</TableHead>
                      <TableHead className="py-1 text-right">
                        Unduh (Rata / Puncak)
                      </TableHead>
                      <TableHead className="py-1 text-right">
                        Unggah (Rata / Puncak)
                      </TableHead>
                      <TableHead className="py-1 text-right">Sampel</TableHead>
                      <TableHead className="py-1 text-right">Posisi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {edgePoints.map((pt) => {
                      const isBefore = pt.t < incident.from;
                      const isAfter =
                        incident.to !== null && pt.t >= incident.to;
                      const isDuring = !isBefore && !isAfter;
                      return (
                        <TableRow key={pt.t}>
                          <TableCell className="py-1 font-mono">
                            {formatWibClock(pt.t)}
                          </TableCell>
                          <TableCell className="py-1 text-right font-mono">
                            {pt.downMbps.toFixed(1)} /{" "}
                            {pt.downMaxMbps.toFixed(1)} Mbps
                          </TableCell>
                          <TableCell className="py-1 text-right font-mono">
                            {pt.upMbps.toFixed(1)} / {pt.upMaxMbps.toFixed(1)}{" "}
                            Mbps
                          </TableCell>
                          <TableCell className="py-1 text-right font-mono">
                            {pt.samples}
                          </TableCell>
                          <TableCell className="py-1 text-right">
                            {isBefore ? (
                              <span className="text-muted-foreground">
                                Sebelum mulai
                              </span>
                            ) : isDuring ? (
                              <span className="font-medium text-destructive">
                                Saat down
                              </span>
                            ) : (
                              <span className="text-green-700 dark:text-green-400">
                                Sesudah selesai
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Fakta Insiden */}
      <div className="grid grid-cols-1 gap-2 rounded-md border border-border bg-card p-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <span className="text-[10px] text-muted-foreground">
            Waktu kejadian (WIB)
          </span>
          <p className="mt-0.5 font-medium text-foreground">
            {formatWibDateTime(incident.from)}
            <br />
            s.d. {incident.to ? formatWibDateTime(incident.to) : "masih down"}
          </p>
        </div>
        <div>
          <span className="text-[10px] text-muted-foreground">
            Durasi & Gabungan
          </span>
          <p className="mt-0.5 font-medium text-foreground">
            {formatDurationCompact(incident.downSeconds)} (
            {incident.outageCount}x putus digabung)
          </p>
          <span className="text-[10px] text-muted-foreground">
            Sampel antrean di bucket terkait (bucket 5 menit utuh, termasuk
            waktu hidup):{" "}
            {incident.queueSecondsDuring !== null
              ? `${incident.queueSecondsDuring} detik`
              : "–"}
          </span>
        </div>
        <div>
          <span className="text-[10px] text-muted-foreground">
            Jam Sibuk & Trafik Sekitar
          </span>
          <div className="mt-0.5 flex flex-wrap gap-1">
            {incident.windows.map((wId) => {
              const pw = peakWindows.find((p) => p.id === wId);
              const label = pw
                ? pw.label
                : wId === OFF_PEAK_ID
                  ? OFF_PEAK_LABEL
                  : wId;
              const isStart = wId === incident.startWindow;
              return (
                <Badge
                  key={wId}
                  variant={isStart ? "default" : "outline"}
                  className="px-1.5 py-0 text-[10px]"
                >
                  {isStart ? `Mulai di ${label}` : label}
                </Badge>
              );
            })}
          </div>
          <span className="mt-1 block text-[10px] text-muted-foreground">
            Rata unduh:{" "}
            {incident.beforeAvgDownMbps !== null
              ? `${incident.beforeAvgDownMbps.toFixed(1)} Mbps`
              : "–"}{" "}
            →{" "}
            {incident.afterAvgDownMbps !== null
              ? `${incident.afterAvgDownMbps.toFixed(1)} Mbps`
              : "–"}
          </span>
        </div>
        <div>
          <span className="text-[10px] text-muted-foreground">
            Cakupan & Status
          </span>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <Badge
              variant={
                incident.scope.kind === "massal" ? "destructive" : "secondary"
              }
              className="text-[10px]"
            >
              {incident.scope.kind === "massal"
                ? `Massal (${incident.scope.otherDown} pelanggan lain)`
                : incident.scope.kind === "sendiri"
                  ? "Sendiri"
                  : "Tidak diketahui"}
            </Badge>
            <Badge
              variant={
                incident.verdict === "terbukti"
                  ? "default"
                  : incident.verdict === "kedipan"
                    ? "secondary"
                    : "outline"
              }
              className="text-[10px]"
            >
              {incident.verdict}
            </Badge>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground leading-snug">
            {incident.verdictReason}
          </p>
        </div>
      </div>
    </div>
  );
}
