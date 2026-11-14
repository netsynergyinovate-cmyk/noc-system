"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { Layers } from "lucide-react";
import type {
  VlanPonTrafficItem,
  VlanPonTrafficSummary,
} from "@/services/vlan-traffic.service";
import { RangePicker } from "@/components/dashboard/range-picker";
import type { TrafficRangeId } from "@/lib/dashboard/ranges";
import { useDashboardStore } from "@/lib/dashboard/store";
import {
  buildLiveVlanSummary,
  seedVlanBuffer,
} from "@/lib/dashboard/vlan-live";
import { backendGet } from "@/lib/dashboard/backend-api";
import type { VlanHistory } from "@/lib/dashboard/telemetry";
import {
  evaluateTrafficStaleness,
  staleMessage,
  staleShortLabel,
} from "@/lib/dashboard/staleness";
interface VlanPonTrafficBoardProps {
  onSelectPon?: (vlan: VlanPonTrafficItem) => void;
  selectedVlanName?: string;
}

// Live: laju per detik didorong backend Go lewat telemetri (tanpa polling). Rentang
// histori: dibaca sekali dari arsip saat rentang dipilih.
export function VlanPonTrafficBoard({
  onSelectPon,
  selectedVlanName,
}: VlanPonTrafficBoardProps) {
  const [live, setLive] = useState<VlanPonTrafficSummary | null>(null);
  const [archive, setArchive] = useState<{
    range: TrafficRangeId;
    data: VlanPonTrafficSummary;
  } | null>(null);
  const [range, setRange] = useState<TrafficRangeId>("live");
  const [hoveredPointMap, setHoveredPointMap] = useState<
    Record<string, { time: string; dl: number; ul: number } | null>
  >({});
  const router = useDashboardStore((s) => s.telemetry?.routers[0]);
  const connection = useDashboardStore((s) => s.connection);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  const [lastVlanReceivedAt, setLastVlanReceivedAt] = useState<number | null>(
    null,
  );

  useEffect(() => {
    if (range !== "live") return;
    const interval = setInterval(() => {
      setNowSec(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [range]);

  const latestVlanTime =
    live?.items.reduce(
      (max, item) => Math.max(max, item.series.at(-1)?.timestamp ?? 0),
      0,
    ) ?? 0;

  useEffect(() => {
    if (latestVlanTime > 0) {
      setLastVlanReceivedAt(Math.floor(Date.now() / 1000));
    }
  }, [latestVlanTime]);

  const staleness = evaluateTrafficStaleness({
    isLive: range === "live",
    lastDataReceivedAt: lastVlanReceivedAt,
    routerReachable: router?.reachable ?? true,
    feedLive: connection === "live",
    nowSec,
  });
  const isTrafficDown = staleness.isStale;
  const downLabel = staleness.cause ? staleShortLabel[staleness.cause] : "";
  const downMessage = staleness.cause
    ? staleMessage(
        staleness.cause,
        staleness.secondsSinceLastData,
        router?.lastError,
      )
    : "";
  const secondsSinceLastSample = staleness.secondsSinceLastData;
  useEffect(() => {
    const buffer = new Map<
      string,
      VlanPonTrafficSummary["items"][number]["series"]
    >();
    const apply = (
      telemetry: ReturnType<typeof useDashboardStore.getState>["telemetry"],
    ) => {
      if (telemetry)
        setLive(buildLiveVlanSummary(telemetry, buffer, Date.now()));
    };
    let cancelled = false;
    let unsubscribe = () => {};
    // Riwayat 5 menit dibaca sekali dari backend (grafik tidak mulai dari kosong saat
    // halaman dimuat ulang); sesudahnya titik baru datang lewat telemetri, tanpa polling.
    backendGet<VlanHistory[]>("/api/v1/dashboard/vlans/history")
      .then((history) => seedVlanBuffer(buffer, history))
      .catch(() => {})
      .finally(() => {
        if (cancelled) return;
        apply(useDashboardStore.getState().telemetry);
        unsubscribe = useDashboardStore.subscribe((state, previous) => {
          if (state.telemetry !== previous.telemetry) apply(state.telemetry);
        });
      });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (range === "live") return;
    let cancelled = false;
    fetch(`/api/traffic/vlans?range=${range}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { ok?: boolean; data?: VlanPonTrafficSummary } | null) => {
        if (!cancelled && body?.ok && body.data)
          setArchive({ range, data: body.data });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [range]);

  const data =
    range === "live" ? live : archive?.range === range ? archive.data : null;
  const loading = data === null;
  const handleRangeChange = (newRange: TrafficRangeId) => setRange(newRange);

  const items = data?.items ?? [];

  return (
    <div className="mt-2.5 pt-2 border-t border-border">
      {/* HEADER SECTION: SINKRON DENGAN TEMA UTAMA DASHBOARD */}
      <div className="flex flex-col gap-2 mb-2.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          {/* Judul & Badge */}
          <div className="flex items-center gap-2">
            <Layers className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xs sm:text-sm font-bold text-foreground">
                Trafik VLAN per PON OLT (MikroTik Core CIARA)
              </h2>
              {range === "live" &&
                (isTrafficDown ? (
                  <span
                    data-testid="vlan-rto-badge"
                    className="flex items-center gap-1 px-2 py-0.5 rounded bg-rose-950/80 border border-rose-500/50 text-[9px] font-mono text-rose-300 font-semibold animate-pulse"
                    title={downMessage}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-ping" />
                    {downLabel} ({secondsSinceLastSample}s)
                  </span>
                ) : (
                  <span className="flex items-center gap-1 px-1.5 py-0.2 rounded bg-emerald-950/60 border border-emerald-500/40 text-[9px] font-mono text-emerald-400 font-semibold">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    1 DTK
                  </span>
                ))}
              <span className="px-1.5 py-0.5 rounded bg-muted border border-border text-[9px] font-mono text-muted-foreground">
                VLAN 1101–1106
              </span>
            </div>
          </div>

          {/* RangePicker & Refresh */}
          <div className="flex items-center gap-1.5 shrink-0 self-start sm:self-auto">
            <RangePicker value={range} onChange={handleRangeChange} />
          </div>
        </div>

        {/* Baris Ringkasan Status */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 rounded bg-muted/40 border border-border text-[10px] font-mono">
          {isTrafficDown ? (
            <div className="flex items-center gap-1.5 text-rose-400 font-medium">
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping shrink-0" />
              <span>Trafik terhenti: {downMessage}</span>
            </div>
          ) : (
            <p className="text-muted-foreground text-[10px]">
              {range === "live"
                ? "Laju unduh & unggah real-time per detik (MikroTik Core CIARA ↔ PON OLT HSGQ)"
                : "Histori laju unduh & unggah antarmuka VLAN per port PON OLT HSGQ"}
            </p>
          )}
          <div className="flex items-center gap-2 text-muted-foreground">
            <span>
              Aktif:{" "}
              <strong className="text-foreground">
                {data?.totalActivePon ?? 0}/{items.length} PON
              </strong>
            </span>
            <span className="text-zinc-700">•</span>
            <span>
              ONU:{" "}
              <strong className="text-foreground">
                {data?.totalOnuOnline ?? 0}
              </strong>
            </span>
            <span className="text-zinc-700">•</span>
            <span>
              Total DL:{" "}
              <strong className="text-sky-400 font-bold font-mono">
                {(data?.totalDownloadMbps ?? 0).toFixed(1).replace(".", ",")}{" "}
                Mbps
              </strong>
            </span>
            <span className="text-zinc-700">•</span>
            <span>
              UL:{" "}
              <strong className="text-orange-400 font-bold font-mono">
                {(data?.totalUploadMbps ?? 0).toFixed(1).replace(".", ",")} Mbps
              </strong>
            </span>
          </div>
        </div>
      </div>

      {/* GRID KARTU TRAFIK VLAN PER PON DENGAN PALET TENANG (SUBDUED) */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
        {!loading && items.length === 0 ? (
          <p className="col-span-full py-4 text-center font-mono text-[10px] text-muted-foreground">
            {range === "live"
              ? "Belum ada VLAN PON (vlan1101…) terbaca dari router."
              : "Belum ada histori VLAN PON untuk rentang ini."}
          </p>
        ) : loading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="min-h-[220px] rounded-lg bg-muted/40 border border-border p-2.5 animate-pulse flex flex-col justify-between"
            >
              <div className="h-4 bg-muted rounded w-1/3 mb-2" />
              <div className="h-12 bg-muted rounded w-full mb-2" />
              <div className="h-28 bg-muted rounded w-full" />
            </div>
          ))
        ) : (
          items.map((item) => {
            const isSelected = selectedVlanName === item.vlanName;
            const inspected = hoveredPointMap[item.vlanName];

            return (
              <VlanPonCard
                key={item.vlanName}
                item={item}
                range={range}
                isSelected={isSelected}
                isTrafficDown={isTrafficDown}
                downLabel={downLabel}
                inspectedPoint={inspected}
                onInspectPoint={(pt) =>
                  setHoveredPointMap((prev) => ({
                    ...prev,
                    [item.vlanName]: pt,
                  }))
                }
                onClick={() => onSelectPon?.(item)}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

interface VlanPonCardProps {
  item: VlanPonTrafficItem;
  range: TrafficRangeId;
  isSelected?: boolean;
  isTrafficDown?: boolean;
  downLabel?: string;
  inspectedPoint?: { time: string; dl: number; ul: number } | null;
  onInspectPoint?: (
    pt: { time: string; dl: number; ul: number } | null,
  ) => void;
  onClick?: () => void;
}

function VlanPonCard({
  item,
  isSelected,
  isTrafficDown = false,
  downLabel = "RTO",
  inspectedPoint,
  onInspectPoint,
  onClick,
}: VlanPonCardProps) {
  const isOnline = !isTrafficDown && item.running && item.onuCount > 0;
  const currentDl = inspectedPoint
    ? inspectedPoint.dl
    : item.currentDownloadMbps;
  const currentUl = inspectedPoint ? inspectedPoint.ul : item.currentUploadMbps;

  return (
    <div
      onClick={onClick}
      className={`rounded-lg border p-2.5 flex flex-col justify-between transition-all cursor-pointer relative overflow-hidden group ${
        isSelected
          ? "border-primary/60 bg-card ring-1 ring-primary/40 shadow-xs"
          : "border-border bg-card hover:border-border/80 hover:bg-muted/30"
      }`}
    >
      {/* HEADER CARD: PON, VLAN ID, STATUS & OLT ONU COUNT */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          {isTrafficDown ? (
            <span
              className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse shrink-0"
              title={downLabel}
            />
          ) : isOnline ? (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
          ) : (
            <span className="w-1.5 h-1.5 rounded-full bg-zinc-600 shrink-0" />
          )}
          <span className="font-bold text-foreground text-xs font-mono tracking-tight">
            {item.ponName}
          </span>
          <span className="px-1.5 py-0.5 rounded bg-muted border border-border text-[9px] font-mono text-muted-foreground">
            {item.vlanName} ({item.vlanId})
          </span>
          {isTrafficDown && (
            <span className="px-1.5 py-0.2 rounded bg-rose-950/80 border border-rose-500/50 text-[8.5px] font-mono text-rose-300 font-semibold animate-pulse">
              {downLabel}
            </span>
          )}
          {isSelected && (
            <span className="px-1.5 py-0.5 rounded bg-sky-950/70 border border-sky-500/50 text-[8.5px] font-mono text-sky-400 font-semibold">
              Fokus
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 font-mono text-[9px]">
          <span className="px-1.5 py-0.5 rounded bg-muted border border-border text-foreground">
            {item.onuCount} ONU
          </span>
          {item.rxPowerDbm !== null && (
            <span className="px-1.5 py-0.5 rounded bg-muted border border-border text-muted-foreground">
              {item.rxPowerDbm.toFixed(1).replace(".", ",")} dBm
            </span>
          )}
        </div>
      </div>

      {/* ANGKA KECEPATAN: SINKRON DENGAN STATSGRID & TRAFFICCHART (--chart-1: SKY BLUE, --chart-2: ORANGE) */}
      <div className="grid grid-cols-2 gap-1.5 mb-2">
        {/* Unduh */}
        <div
          className={`rounded p-1.5 border transition-all ${
            inspectedPoint
              ? "bg-sky-500/10 border-sky-500/50"
              : "bg-muted/40 border-border"
          }`}
        >
          <div className="flex items-center justify-between text-[9px]">
            <span className="flex items-center gap-1.5 text-muted-foreground font-medium">
              <span
                aria-hidden="true"
                className={`w-3 border-t-[2.5px] border-solid rounded-full ${isTrafficDown ? "border-rose-400" : "border-sky-400"}`}
              />
              {inspectedPoint
                ? "Unduh titik"
                : isTrafficDown
                  ? `Unduh (${downLabel})`
                  : "Unduh sekarang"}
            </span>
            <span className="font-mono text-muted-foreground text-[8.5px]">
              {inspectedPoint ? inspectedPoint.time : "WIB"}
            </span>
          </div>
          <div className="mt-0.5 text-base font-bold text-foreground font-mono tabular-nums leading-tight">
            {currentDl.toFixed(1).replace(".", ",")}{" "}
            <span className="text-[10px] text-muted-foreground font-normal">
              Mbps
            </span>
          </div>
          <div className="flex items-center justify-between text-[8.5px] font-mono text-muted-foreground mt-1 pt-0.5 border-t border-border">
            <span>
              Puncak:{" "}
              <strong className="text-foreground/90 font-mono">
                {item.peakDownloadMbps.toFixed(1).replace(".", ",")}
              </strong>
            </span>
            <span>
              Rata:{" "}
              <strong className="text-muted-foreground font-mono">
                {item.avgDownloadMbps.toFixed(1).replace(".", ",")}
              </strong>
            </span>
          </div>
        </div>

        {/* Unggah */}
        <div
          className={`rounded p-1.5 border transition-all ${
            inspectedPoint
              ? "bg-orange-500/10 border-orange-500/50"
              : "bg-muted/40 border-border"
          }`}
        >
          <div className="flex items-center justify-between text-[9px]">
            <span className="flex items-center gap-1.5 text-muted-foreground font-medium">
              <span
                aria-hidden="true"
                className={`w-3 border-t-[2.5px] border-solid rounded-full ${isTrafficDown ? "border-rose-400" : "border-orange-400"}`}
              />
              {inspectedPoint
                ? "Unggah titik"
                : isTrafficDown
                  ? `Unggah (${downLabel})`
                  : "Unggah sekarang"}
            </span>
            <span className="font-mono text-muted-foreground text-[8.5px]">
              {inspectedPoint ? inspectedPoint.time : "WIB"}
            </span>
          </div>
          <div className="mt-0.5 text-base font-bold text-foreground font-mono tabular-nums leading-tight">
            {currentUl.toFixed(1).replace(".", ",")}{" "}
            <span className="text-[10px] text-muted-foreground font-normal">
              Mbps
            </span>
          </div>
          <div className="flex items-center justify-between text-[8.5px] font-mono text-muted-foreground mt-1 pt-0.5 border-t border-border">
            <span>
              Puncak:{" "}
              <strong className="text-foreground/90 font-mono">
                {item.peakUploadMbps.toFixed(1).replace(".", ",")}
              </strong>
            </span>
            <span>
              Rata:{" "}
              <strong className="text-muted-foreground font-mono">
                {item.avgUploadMbps.toFixed(1).replace(".", ",")}
              </strong>
            </span>
          </div>
        </div>
      </div>

      {/* GRAFIK CANVAS AREA TRAFIK (BERSIH DENGAN BG #0c0e12 IDENTIK TRAFFICCHART) */}
      <div className="relative w-full h-[110px] bg-muted/20 rounded border border-border overflow-hidden">
        <VlanRichChart series={item.series} onInspect={onInspectPoint} />
        {isTrafficDown && (
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px] flex items-center justify-center pointer-events-none">
            <span className="px-2 py-0.5 rounded bg-rose-950/85 border border-rose-500/50 text-[8.5px] font-mono text-rose-300 font-semibold animate-pulse">
              {downLabel}
            </span>
          </div>
        )}
      </div>

      {/* FOOTER BAR: KETERANGAN BYTE & STATUS AKTIF */}
      <div className="mt-1.5 pt-1 border-t border-border flex items-center justify-between text-[9px] font-mono text-muted-foreground">
        <span className="truncate">
          {item.txTotalBytes + item.rxTotalBytes > 0
            ? `Total: DL ${formatBytes(item.txTotalBytes)} • UL ${formatBytes(item.rxTotalBytes)}`
            : `${item.oltName || "OLT"} • ${item.series.length} titik`}
        </span>
        <span
          className={
            isOnline
              ? "text-emerald-400 font-semibold uppercase"
              : "text-zinc-600 uppercase"
          }
        >
          {isOnline ? "Aktif" : "Standby"}
        </span>
      </div>
    </div>
  );
}

interface VlanRichChartProps {
  series: VlanPonTrafficItem["series"];
  onInspect?: (pt: { time: string; dl: number; ul: number } | null) => void;
}

function VlanRichChart({ series, onInspect }: VlanRichChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hoveredIdxRef = useRef<number | null>(null);

  // Gambar kanvas berfitur lengkap sama dengan grafik uPlot halaman utama
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || series.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr =
      typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const width = canvas.clientWidth || 280;
    const height = canvas.clientHeight || 110;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Bersihkan kanvas
    ctx.clearRect(0, 0, width, height);

    // Padding agar angka sumbu Y (kiri) dan label waktu sumbu X (bawah) terlihat jelas
    const padLeft = 28;
    const padRight = 8;
    const padTop = 8;
    const padBottom = 16;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    // Hitung batas nilai skala Y (dibatasi wajar tanpa spike)
    const maxDl = Math.max(...series.map((s) => s.downloadMbps), 0);
    const maxUl = Math.max(...series.map((s) => s.uploadMbps), 0);
    const peakVal = Math.max(maxDl, maxUl);
    const maxY = Math.max(10, Math.ceil(peakVal * 1.2));

    // 1. Grid Sumbu Y & Label Angka Mbps (Kiri) - Sinkron dengan tema uPlot
    const ySteps = [0, Math.round(maxY / 2), Math.round(maxY)];
    ctx.strokeStyle = "#1e222a";
    ctx.fillStyle = "#71717a";
    ctx.font = "8px 'JetBrains Mono', Consolas, monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 1;

    ySteps.forEach((val) => {
      const y = padTop + plotH - (val / maxY) * plotH;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(width - padRight, y);
      ctx.stroke();
      ctx.fillText(val.toString(), padLeft - 4, y);
    });

    const n = series.length;
    if (n < 2) return;

    const getX = (i: number) => padLeft + (i / (n - 1)) * plotW;
    const getY = (val: number) => padTop + plotH - (val / maxY) * plotH;

    // 2. Grid Sumbu X & Label Waktu (Bawah) - Sinkron dengan tema uPlot
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.strokeStyle = "#1e222a";

    const labelIndices = [0, Math.floor(n / 2), n - 1];
    labelIndices.forEach((idx) => {
      const pt = series[idx];
      if (!pt) return;
      const x = getX(idx);
      ctx.beginPath();
      ctx.moveTo(x, padTop);
      ctx.lineTo(x, padTop + plotH);
      ctx.stroke();

      const labelText = pt.timeLabel;
      ctx.fillText(labelText, x, padTop + plotH + 3);
    });

    // 3. Area & Garis Unduh (Sky Blue / Cyan #38bdf8 - Sinkron dengan --chart-1)
    ctx.beginPath();
    ctx.moveTo(getX(0), getY(series[0].downloadMbps));
    for (let i = 1; i < n; i++) {
      ctx.lineTo(getX(i), getY(series[i].downloadMbps));
    }
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Area fill unduh
    ctx.lineTo(getX(n - 1), padTop + plotH);
    ctx.lineTo(getX(0), padTop + plotH);
    ctx.closePath();
    const gradDl = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
    gradDl.addColorStop(0, "rgba(56, 189, 248, 0.16)");
    gradDl.addColorStop(1, "rgba(56, 189, 248, 0.005)");
    ctx.fillStyle = gradDl;
    ctx.fill();

    // 4. Area & Garis Unggah (Orange #fb923c - Sinkron dengan --chart-2 uPlot)
    ctx.beginPath();
    ctx.moveTo(getX(0), getY(series[0].uploadMbps));
    for (let i = 1; i < n; i++) {
      ctx.lineTo(getX(i), getY(series[i].uploadMbps));
    }
    ctx.strokeStyle = "#fb923c";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Area fill unggah
    ctx.lineTo(getX(n - 1), padTop + plotH);
    ctx.lineTo(getX(0), padTop + plotH);
    ctx.closePath();
    const gradUl = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
    gradUl.addColorStop(0, "rgba(251, 146, 60, 0.16)");
    gradUl.addColorStop(1, "rgba(251, 146, 60, 0.005)");
    ctx.fillStyle = gradUl;
    ctx.fill();

    // 5. Garis Crosshair & Titik Indikator saat Kursor Melayang (Hover)
    const hIdx = hoveredIdxRef.current;
    if (hIdx !== null && hIdx >= 0 && hIdx < n) {
      const hX = getX(hIdx);
      const hDlY = getY(series[hIdx].downloadMbps);
      const hUlY = getY(series[hIdx].uploadMbps);

      // Garis vertikal putus-putus
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = "#52525b";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hX, padTop);
      ctx.lineTo(hX, padTop + plotH);
      ctx.stroke();
      ctx.restore();

      // Lingkaran titik unduh
      ctx.fillStyle = "#38bdf8";
      ctx.beginPath();
      ctx.arc(hX, hDlY, 2.5, 0, Math.PI * 2);
      ctx.fill();

      // Lingkaran titik unggah
      ctx.fillStyle = "#fb923c";
      ctx.beginPath();
      ctx.arc(hX, hUlY, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [series]);

  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  // Handle interaksi hover / pointer move untuk inspeksi titik
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current || series.length < 2) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left - 28; // offset padLeft
    const plotW = rect.width - 28 - 8;
    const ratio = Math.max(0, Math.min(1, x / plotW));
    const idx = Math.round(ratio * (series.length - 1));
    hoveredIdxRef.current = idx;
    renderCanvas();

    const point = series[idx];
    if (point && onInspect) {
      onInspect({
        time: point.timeLabel,
        dl: point.downloadMbps,
        ul: point.uploadMbps,
      });
    }
  };

  const handleMouseLeave = () => {
    hoveredIdxRef.current = null;
    renderCanvas();
    if (onInspect) onInspect(null);
  };

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="relative w-full h-full cursor-crosshair"
    >
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1).replace(".", ",")} TB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1).replace(".", ",")} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1).replace(".", ",")} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1).replace(".", ",")} KB`;
  return `${bytes} B`;
}
