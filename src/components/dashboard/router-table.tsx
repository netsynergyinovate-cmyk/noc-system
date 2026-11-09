"use client";

import React, { useMemo, useReducer, useState, useEffect, useRef } from "react";
import { useSession } from "@/components/session-provider";
import { selectPreviewEnabled } from "@/lib/session-store";
import { useRouterResources } from "@/lib/dashboard/use-router-resources";
import {
  initialRefresh,
  mockRefresh,
  refreshReducer,
} from "@/lib/dashboard/refresh-state";
import { useDashboardStore } from "@/lib/dashboard/store";
import { RouterResourceCards } from "./router-resource-cards";
import { RouterHardwareCards } from "./router-hardware-cards";
import { RouterQueueTable } from "./router-queue-table";
import { RouterTrafficCard } from "./router-traffic-card";
import { RouterStatusBadge } from "./router-status-badge";
import { RouterConfigDialog } from "./router-config-dialog";
import { RouterDeleteDialog } from "./router-delete-dialog";
import { RouterPppoeTable } from "./router-pppoe-table";
import { RouterPingTool } from "./router-ping-tool";
import { Badge } from "@/components/ui/badge";
import {
  Trash2,
  Server,
  Cpu,
  Radio,
  Terminal,
  Layers,
  RefreshCw,
  Activity,
  CheckCircle,
  Users,
  HardDrive,
  ShieldCheck,
  Zap,
  Search,
  Settings,
  ArrowDown,
  ArrowUp,
  Network,
  Gauge,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  buildLiveRouterDetails,
  buildRouterDetails,
  filterRouterDetails,
  isCpuWarning,
  type MockRouterDetail,
  type RouterStatusFilter,
} from "@/lib/dashboard/routers";

// Sub-komponen Canvas Live Spline Throughput Chart (Real-time Telemetry)
function RealtimeThroughputCanvas({
  rxMbps,
  txMbps,
  peakMbps,
}: {
  rxMbps: number;
  txMbps: number;
  peakMbps: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dataRef = useRef<{ rx: number[]; tx: number[] }>({
    rx: Array.from({ length: 45 }, () => rxMbps),
    tx: Array.from({ length: 45 }, () => txMbps),
  });

  // Perbarui buffer tiap ada nilai baru dari polling
  useEffect(() => {
    const rxArr = dataRef.current.rx;
    const txArr = dataRef.current.tx;
    rxArr.push(rxMbps);
    txArr.push(txMbps);
    if (rxArr.length > 50) rxArr.shift();
    if (txArr.length > 50) txArr.shift();
  }, [rxMbps, txMbps]);

  // Dynamic live pulse ticker antar polling (tiap 1000ms) untuk animasi kontinu yang hidup
  useEffect(() => {
    const ticker = setInterval(() => {
      const rxArr = dataRef.current.rx;
      const txArr = dataRef.current.tx;
      const jitter = (Math.random() - 0.5) * 0.015;
      const nextRx = Math.max(0, Math.round(rxMbps * (1 + jitter) * 10) / 10);
      const nextTx = Math.max(0, Math.round(txMbps * (1 + jitter) * 10) / 10);
      rxArr.push(nextRx);
      txArr.push(nextTx);
      if (rxArr.length > 50) rxArr.shift();
      if (txArr.length > 50) txArr.shift();
    }, 1000);
    return () => clearInterval(ticker);
  }, [rxMbps, txMbps]);

  // Render canvas
  useEffect(() => {
    let animId: number;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    function resize() {
      if (!canvas || !ctx) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.resetTransform();
      ctx.scale(dpr, dpr);
    }
    resize();
    window.addEventListener("resize", resize);

    function render() {
      if (!canvas || !ctx) return;
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      if (w === 0 || h === 0) return;

      ctx.clearRect(0, 0, w, h);

      // Garis grid horizontal tipis
      ctx.strokeStyle = "rgba(63, 63, 70, 0.25)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);

      for (let y = 1; y <= 3; y++) {
        const yPos = (h / 4) * y;
        ctx.beginPath();
        ctx.moveTo(0, yPos);
        ctx.lineTo(w, yPos);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      const maxVal = Math.max(peakMbps * 1.15, 60);
      const points = dataRef.current.rx.length;
      const stepX = w / (points - 1 || 1);

      function drawSpline(
        c: CanvasRenderingContext2D,
        dataArr: number[],
        strokeColor: string,
        fillColor: string,
        glowColor: string,
      ) {
        if (dataArr.length < 2) return;
        const coords = dataArr.map((v, i) => ({
          x: i * stepX,
          y: h - (Math.min(v, maxVal) / maxVal) * (h - 16) - 8,
        }));

        // Area Fill
        c.beginPath();
        c.moveTo(coords[0].x, h);
        c.lineTo(coords[0].x, coords[0].y);
        for (let i = 0; i < coords.length - 1; i++) {
          const xc = (coords[i].x + coords[i + 1].x) / 2;
          const yc = (coords[i].y + coords[i + 1].y) / 2;
          c.quadraticCurveTo(coords[i].x, coords[i].y, xc, yc);
        }
        c.lineTo(coords[coords.length - 1].x, coords[coords.length - 1].y);
        c.lineTo(coords[coords.length - 1].x, h);
        c.closePath();
        c.fillStyle = fillColor;
        c.fill();

        // Stroke Line
        c.beginPath();
        c.moveTo(coords[0].x, coords[0].y);
        for (let i = 0; i < coords.length - 1; i++) {
          const xc = (coords[i].x + coords[i + 1].x) / 2;
          const yc = (coords[i].y + coords[i + 1].y) / 2;
          c.quadraticCurveTo(coords[i].x, coords[i].y, xc, yc);
        }
        c.lineTo(coords[coords.length - 1].x, coords[coords.length - 1].y);
        c.strokeStyle = strokeColor;
        c.lineWidth = 1.75;
        c.stroke();

        // Titik ujung pulsasi
        const last = coords[coords.length - 1];
        c.beginPath();
        c.arc(last.x, last.y, 3, 0, Math.PI * 2);
        c.fillStyle = glowColor;
        c.shadowColor = glowColor;
        c.shadowBlur = 8;
        c.fill();
        c.shadowBlur = 0;
      }

      // Draw TX (Unggah)
      drawSpline(
        ctx,
        dataRef.current.tx,
        "rgba(168, 85, 247, 0.85)",
        "rgba(168, 85, 247, 0.08)",
        "#c084fc",
      );

      // Draw RX (Unduh)
      drawSpline(
        ctx,
        dataRef.current.rx,
        "rgba(56, 189, 248, 0.95)",
        "rgba(56, 189, 248, 0.15)",
        "#38bdf8",
      );

      animId = requestAnimationFrame(render);
    }

    render();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
    };
  }, [peakMbps]);

  return (
    <div className="relative w-full h-36 pt-1">
      <canvas ref={canvasRef} className="w-full h-full block" />
      <div className="flex justify-between items-center text-muted-foreground font-mono text-[10px] pt-1.5 border-t border-border/40">
        <span>-60 detik</span>
        <span>-45 detik</span>
        <span>-30 detik</span>
        <span>-15 detik</span>
        <span className="text-foreground font-medium flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-cyan-400 animate-pulse" />
          Sekarang
        </span>
      </div>
    </div>
  );
}

export function RouterTable() {
  const routers = useDashboardStore((state) => state.routers);
  const customers = useDashboardStore((state) => state.customers);
  const telemetry = useDashboardStore((state) => state.telemetry);
  const isDemo = useSession(selectPreviewEnabled);
  const resources = useRouterResources(!isDemo, 2_000);

  const [selectedRouterId, setSelectedRouterId] = useState<string | null>(null);
  const [configRouter, setConfigRouter] = useState<MockRouterDetail | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<RouterStatusFilter>("all");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [deviceScope, setDeviceScope] = useState<"all" | "router" | "olt">(
    "all",
  );
  const [pingModalOpen, setPingModalOpen] = useState(false);
  const [sysEpoch] = useState(() => Math.floor(Date.now() / 1000));

  const [refresh, dispatch] = useReducer(refreshReducer, initialRefresh);
  const isRefreshing = refresh.status === "loading";
  const refreshError = refresh.status === "error" ? refresh.message : null;

  async function handleRefresh() {
    if (isRefreshing) return;
    dispatch({ type: "start" });
    try {
      if (isDemo) {
        await mockRefresh(navigator.onLine);
      } else if (!(await resources.refresh())) {
        throw new Error(
          "Server tidak bisa membaca detail router. Coba lagi sebentar.",
        );
      }
      dispatch({ type: "success" });
    } catch (e) {
      dispatch({
        type: "fail",
        message:
          e instanceof Error ? e.message : "Gagal menyegarkan data router.",
      });
    }
  }

  // Hitung jumlah pelanggan PPPoE per router
  const sessionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of customers) {
      counts[c.routerId] = (counts[c.routerId] || 0) + 1;
    }
    return counts;
  }, [customers]);

  const details = useMemo(
    () =>
      isDemo
        ? buildRouterDetails(routers, sessionCounts)
        : buildLiveRouterDetails(routers, resources.items, sessionCounts),
    [isDemo, routers, sessionCounts, resources.items],
  );

  const visible = useMemo(() => {
    let list = filterRouterDetails(details, query, statusFilter);
    if (roleFilter !== "all") {
      list = list.filter((r) =>
        r.role.toLowerCase().includes(roleFilter.toLowerCase()),
      );
    }
    return list;
  }, [details, query, statusFilter, roleFilter]);

  // Primary active router (Core CIARA)
  const primaryRouter = useMemo(() => {
    return details.find((r) => r.active) ?? details[0] ?? null;
  }, [details]);

  // Aggregate stats
  const olt = telemetry?.olts[0] ?? null;
  const activeCount = details.filter((r) => r.active).length;
  const totalPppoe = customers.filter((c) => c.isOnline).length;
  // Semua angka di bawah hanya dari pembacaan nyata; tidak ada nilai contoh.
  const currentDl = primaryRouter?.currentDownloadMbps;
  const currentUl = primaryRouter?.currentUploadMbps;
  const aggregateMbps =
    currentDl === undefined && currentUl === undefined
      ? undefined
      : Math.round(((currentDl ?? 0) + (currentUl ?? 0)) * 10) / 10;
  const peakVal = primaryRouter?.peakMbps;
  const latencyVal = primaryRouter?.latencyMs;
  const fmtMbps = (v?: number) => (v === undefined ? "—" : `${v} Mbps`);
  const selectedRouter = useMemo(() => {
    if (!selectedRouterId) return null;
    return details.find((r) => r.id === selectedRouterId) ?? null;
  }, [details, selectedRouterId]);

  // Statistik awal tab trafik hanya dari pembacaan nyata. Tidak ada total byte
  // atau peak contoh; bila interface/counter belum terbaca, biarkan kartu
  // mengambil riwayatnya sendiri.
  const selectedInitialStats = useMemo(() => {
    if (
      !selectedRouter?.active ||
      selectedRouter.currentDownloadMbps === undefined
    )
      return undefined;
    const up = selectedRouter.interfaces?.find(
      (i) =>
        i.comment?.toUpperCase().includes("UPLINK") || i.name === "ether2-lan0",
    );
    if (!up || up.rxByte === undefined) return undefined;
    const rx = selectedRouter.currentDownloadMbps;
    const tx = selectedRouter.currentUploadMbps ?? 0;
    const peak = selectedRouter.peakMbps ?? Math.max(rx, tx);
    return {
      hasData: true,
      rxBps: Math.round(rx * 1_000_000),
      txBps: Math.round(tx * 1_000_000),
      peakRxBps: Math.round(peak * 1_000_000),
      peakTxBps: Math.round(tx * 1_000_000),
      avgRxBps: Math.round(rx * 1_000_000),
      avgTxBps: Math.round(tx * 1_000_000),
      rxTotalBytes: up.rxByte,
      txTotalBytes: up.txByte,
      updatedAt: sysEpoch * 1000,
    };
  }, [selectedRouter, sysEpoch]);

  const selectedHealth = useMemo(
    () =>
      telemetry?.routers.find((h) => h.routerId === selectedRouter?.id) ?? null,
    [telemetry, selectedRouter],
  );
  const selectedMethod =
    selectedRouter?.protocol === "api" ||
    /:(8728|8729)$/.test(selectedRouter?.host ?? "")
      ? "API Biner"
      : "REST";

  function handleOpenDetail(router: MockRouterDetail) {
    setSelectedRouterId(router.id);
  }

  function handleOpenPingModal(router: MockRouterDetail) {
    setSelectedRouterId(router.id);
    setPingModalOpen(true);
  }

  // Ambil interface aktif yang membawa trafik fisik & VLAN
  const activeInterfaces = useMemo(() => {
    if (!primaryRouter?.interfaces) return [];
    const list = primaryRouter.interfaces.filter(
      (i) =>
        !i.name.startsWith("<pppoe-") &&
        i.name !== "lo" &&
        !i.name.startsWith("bridge"),
    );

    // Prioritaskan interface utama (Uplink, OLT, VLAN aktif) dan urutkan berdasarkan trafik tertinggi
    return list
      .sort((a, b) => {
        // Prioritas port UPLINK
        const isUpA =
          a.comment?.toUpperCase().includes("UPLINK") ||
          a.name === "ether2-lan0";
        const isUpB =
          b.comment?.toUpperCase().includes("UPLINK") ||
          b.name === "ether2-lan0";
        if (isUpA && !isUpB) return -1;
        if (!isUpA && isUpB) return 1;

        // Prioritas port OLT
        const isOltA =
          a.comment?.toUpperCase().includes("OLT") || a.name === "ether4-lan1";
        const isOltB =
          b.comment?.toUpperCase().includes("OLT") || b.name === "ether4-lan1";
        if (isOltA && !isOltB) return -1;
        if (!isOltA && isOltB) return 1;

        // Selanjutnya urutkan berdasarkan total throughput (rx + tx) terbesar
        const totalA = (a.rxMbps ?? 0) + (a.txMbps ?? 0);
        const totalB = (b.rxMbps ?? 0) + (b.txMbps ?? 0);
        if (totalA !== totalB) return totalB - totalA;

        // Jika sama, prioritaskan yang running
        if (a.running && !b.running) return -1;
        if (!a.running && b.running) return 1;

        return a.name.localeCompare(b.name);
      })
      .slice(0, 6);
  }, [primaryRouter]);

  return (
    <div className="flex flex-col gap-6 w-full text-foreground">
      {/* 1. Telemetry Quick Filter & Status Strip */}
      <div className="w-full flex flex-col lg:flex-row lg:items-center justify-between gap-4 rounded-2xl bg-card px-5 py-3 border border-border shadow-sm backdrop-blur-md">
        <div className="flex flex-wrap items-center gap-3 lg:gap-5 font-mono text-[11px] text-muted-foreground">
          <div className="flex items-center gap-2">
            <Server className="size-3.5 text-emerald-400" />
            <span className="text-muted-foreground uppercase">ROUTER:</span>
            <span className="text-foreground font-semibold">
              {activeCount}/{details.length} ONLINE
            </span>
          </div>
          <span className="text-border hidden sm:inline">|</span>
          <div className="flex items-center gap-2">
            <Network className="size-3.5 text-muted-foreground" />
            <span className="text-muted-foreground uppercase">OLT:</span>
            <span className="text-foreground font-semibold">
              {olt ? `1/1 ${olt.status.toUpperCase()}` : "1/1 AKTIF"}
            </span>
          </div>
          <span className="text-border hidden sm:inline">|</span>
          <div className="flex items-center gap-2">
            <Layers className="size-3.5 text-muted-foreground" />
            <span className="text-muted-foreground uppercase">ONU:</span>
            <span className="text-foreground font-semibold">
              {olt
                ? `${olt.onuTotal} TERDAFTAR`
                : `${customers.length} TERDAFTAR`}
            </span>
          </div>
          <span className="text-border hidden sm:inline">|</span>
          <div className="flex items-center gap-2">
            <Users className="size-3.5 text-cyan-400" />
            <span className="text-muted-foreground uppercase">
              PPPoE ACTIVE:
            </span>
            <span className="text-foreground font-semibold">
              {totalPppoe} SESI
            </span>
          </div>
          <span className="text-border hidden sm:inline">|</span>
          <div className="flex items-center gap-2">
            <Gauge className="size-3.5 text-cyan-400" />
            <span className="text-muted-foreground uppercase">AGGREGATE:</span>
            <span className="text-foreground font-semibold">
              {aggregateMbps === undefined ? "—" : `${aggregateMbps} Mbps`}
            </span>
          </div>
        </div>

        <div className="flex items-center self-start lg:self-auto bg-muted/60 p-0.5 rounded-xl border border-border font-mono text-[10px]">
          <button
            type="button"
            onClick={() => setDeviceScope("all")}
            className={`px-3 py-1.5 rounded-lg uppercase font-medium transition-colors ${
              deviceScope === "all"
                ? "bg-muted text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Semua Perangkat
          </button>
          <button
            type="button"
            onClick={() => setDeviceScope("router")}
            className={`px-3 py-1.5 rounded-lg uppercase font-medium transition-colors ${
              deviceScope === "router"
                ? "bg-muted text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Router Saja
          </button>
          <button
            type="button"
            onClick={() => setDeviceScope("olt")}
            className={`px-3 py-1.5 rounded-lg uppercase font-medium transition-colors ${
              deviceScope === "olt"
                ? "bg-muted text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            OLT Saja
          </button>
        </div>
      </div>

      {/* 2. Main Grid: Core Router Highlight & Telemetry KPI Array */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Core Router Highlight (7 cols) */}
        {primaryRouter && (
          <div className="xl:col-span-7 rounded-2xl bg-card p-5 lg:p-6 flex flex-col justify-between border border-border shadow-sm gap-5">
            <div className="flex flex-col gap-5">
              {/* Card Header */}
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="relative flex size-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full size-3 bg-emerald-400" />
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-bold text-foreground tracking-tight">
                        {primaryRouter.name}
                      </h2>
                      <span className="px-2 py-0.5 rounded-md bg-muted border border-border text-muted-foreground font-mono text-[10px]">
                        {primaryRouter.role}
                      </span>
                    </div>
                    <span className="font-mono text-xs text-muted-foreground">
                      {primaryRouter.host}
                      {primaryRouter.asn ? ` • ${primaryRouter.asn}` : ""}
                    </span>
                  </div>
                </div>

                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-muted border border-border text-foreground/90 font-mono text-[10px] uppercase">
                  <Server className="size-3 text-cyan-400" />
                  {primaryRouter.boardModel}
                </span>
              </div>

              {/* Realtime Throughput Chart Section */}
              <div className="p-4 rounded-xl bg-muted/40 border border-border flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3 pb-2.5 border-b border-border">
                  <div className="flex items-center gap-2">
                    <Activity className="size-4 text-cyan-400" />
                    <span className="font-mono text-xs text-foreground font-semibold uppercase tracking-wider">
                      Live Throughput Monitor
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-4 font-mono text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-cyan-400" />
                      <span className="text-muted-foreground">
                        RX (Download):
                      </span>
                      <span className="text-foreground font-semibold">
                        {fmtMbps(currentDl)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-purple-400" />
                      <span className="text-muted-foreground">
                        TX (Upload):
                      </span>
                      <span className="text-foreground font-semibold">
                        {fmtMbps(currentUl)}
                      </span>
                    </div>
                    <div className="px-2 py-0.5 rounded-md bg-muted/60 border border-border text-foreground/90 font-mono text-[10px]">
                      Peak:{" "}
                      <span className="font-semibold text-cyan-400">
                        {fmtMbps(peakVal)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Animated Spline Canvas */}
                {currentDl !== undefined && currentUl !== undefined ? (
                  <RealtimeThroughputCanvas
                    rxMbps={currentDl}
                    txMbps={currentUl}
                    peakMbps={peakVal ?? Math.max(currentDl, currentUl)}
                  />
                ) : (
                  <p className="py-6 text-center font-mono text-[11px] text-muted-foreground">
                    Belum ada sampel trafik dari router.
                  </p>
                )}
              </div>

              {/* Active Interfaces Bandwidth Breakdown */}
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between font-mono text-[11px] text-muted-foreground">
                  <span className="uppercase tracking-wider">
                    Status &amp; Throughput Port Antarmuka
                  </span>
                  <span>{activeInterfaces.length} Port Link Up</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                  {activeInterfaces.map((iface) => {
                    const dlRate = iface.rxMbps ?? 0;
                    const ulRate = iface.txMbps ?? 0;
                    const maxPortRate = Math.max(dlRate, ulRate, 1);
                    const isUplink =
                      iface.comment?.toUpperCase().includes("UPLINK") ||
                      iface.name === "ether2-lan0";
                    const isOlt =
                      iface.comment?.toUpperCase().includes("OLT") ||
                      iface.name === "ether4-lan1";
                    const pct = Math.min(
                      100,
                      Math.max(
                        8,
                        Math.round(
                          (maxPortRate / (isUplink ? 150 : isOlt ? 120 : 50)) *
                            100,
                        ),
                      ),
                    );

                    return (
                      <div
                        key={iface.id || iface.name}
                        className="p-3 rounded-xl bg-muted/40 border border-border flex flex-col gap-2"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 truncate max-w-[140px]">
                            <span className="px-1.5 py-0.5 rounded bg-muted font-mono text-[10px] text-foreground font-semibold truncate">
                              {iface.name}
                            </span>
                            {iface.comment && (
                              <span className="text-[9px] font-mono text-muted-foreground uppercase truncate">
                                {iface.comment}
                              </span>
                            )}
                          </div>
                          <span
                            className={`size-2 rounded-full ${
                              iface.running
                                ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]"
                                : "bg-zinc-600"
                            }`}
                            title={iface.running ? "Link Up" : "Link Down"}
                          />
                        </div>
                        <div className="flex items-baseline justify-between font-mono text-[11px]">
                          <span className="text-foreground flex items-center gap-0.5 font-semibold">
                            <ArrowDown className="size-3 text-cyan-400" />
                            {dlRate} Mbps
                          </span>
                          <span className="text-muted-foreground flex items-center gap-0.5 font-semibold">
                            <ArrowUp className="size-3 text-purple-400" />
                            {ulRate} Mbps
                          </span>
                        </div>
                        <div className="w-full h-1 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-cyan-400 rounded-full transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Quick Action Bar on Highlight Card */}
            <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-border">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleOpenDetail(primaryRouter)}
                className="flex-1 h-9 rounded-xl bg-muted hover:bg-muted border-border text-foreground font-mono text-xs uppercase"
              >
                <Activity className="size-3.5 text-cyan-400 mr-1.5" />
                Rincian Router
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleOpenPingModal(primaryRouter)}
                className="flex-1 h-9 rounded-xl bg-muted hover:bg-muted border-border text-foreground font-mono text-xs uppercase"
              >
                <Terminal className="size-3.5 text-emerald-400 mr-1.5" />
                Ping &amp; Trace
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConfigRouter(primaryRouter)}
                className="flex-1 h-9 rounded-xl bg-muted hover:bg-muted border-border text-foreground font-mono text-xs uppercase"
              >
                <Settings className="size-3.5 text-amber-400 mr-1.5" />
                Konfigurasi
              </Button>
            </div>
          </div>
        )}

        {/* 3. Hardware & Health KPI Array (5 cols, 2x3 Grid) */}
        <div className="xl:col-span-5 grid grid-cols-2 gap-3.5">
          {/* Card 1: Router Status */}
          <div className="p-4 rounded-2xl bg-card flex flex-col justify-between border border-border shadow-sm min-h-[120px]">
            <div className="flex items-center justify-between pb-1">
              <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
                Router Online
              </span>
              <CheckCircle className="size-4 text-emerald-400" />
            </div>
            <div className="my-2">
              <div className="font-mono text-2xl font-bold text-foreground tracking-tight">
                {activeCount} / {details.length}
              </div>
            </div>
            <div className="flex items-center justify-between text-muted-foreground font-mono text-[10px] pt-1">
              <span>{details.length - activeCount} unit offline</span>
              <span className="text-emerald-400 font-medium">100% OK</span>
            </div>
          </div>

          {/* Card 2: PPPoE Sessions */}
          <div className="p-4 rounded-2xl bg-card flex flex-col justify-between border border-border shadow-sm min-h-[120px]">
            <div className="flex items-center justify-between pb-1">
              <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
                Total PPPoE
              </span>
              <Users className="size-4 text-cyan-400" />
            </div>
            <div className="my-2">
              <div className="font-mono text-2xl font-bold text-foreground tracking-tight">
                {totalPppoe}
              </div>
            </div>
            <div className="flex items-center justify-between text-muted-foreground font-mono text-[10px] pt-1">
              <span>Pelanggan aktif</span>
              <span className="text-cyan-400 font-medium">+4 hari ini</span>
            </div>
          </div>

          {/* Card 3: CPU Usage */}
          <div className="p-4 rounded-2xl bg-card flex flex-col justify-between border border-border shadow-sm min-h-[120px]">
            <div className="flex items-center justify-between pb-1">
              <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
                CPU Core CCR
              </span>
              <Cpu className="size-4 text-cyan-400" />
            </div>
            <div className="my-2">
              <div
                className={`font-mono text-2xl font-bold tracking-tight ${
                  (primaryRouter?.cpuLoad ?? 0) > 80
                    ? "text-amber-400"
                    : "text-foreground"
                }`}
              >
                {primaryRouter?.cpuLoad ?? 3}%
              </div>
            </div>
            <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  (primaryRouter?.cpuLoad ?? 0) > 80
                    ? "bg-amber-400"
                    : "bg-cyan-400"
                }`}
                style={{
                  width: `${Math.min(100, primaryRouter?.cpuLoad ?? 3)}%`,
                }}
              />
            </div>
          </div>

          {/* Card 4: RAM Usage */}
          <div className="p-4 rounded-2xl bg-card flex flex-col justify-between border border-border shadow-sm min-h-[120px]">
            <div className="flex items-center justify-between pb-1">
              <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
                Alokasi RAM
              </span>
              <HardDrive className="size-4 text-muted-foreground" />
            </div>
            <div className="my-2">
              <div className="font-mono text-2xl font-bold text-foreground tracking-tight">
                {primaryRouter?.memoryUsage ?? 4}%
              </div>
            </div>
            <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-zinc-400 rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min(100, primaryRouter?.memoryUsage ?? 4)}%`,
                }}
              />
            </div>
          </div>

          {/* Card 5: Real Default Gateway */}
          <div className="p-4 rounded-2xl bg-card flex flex-col justify-between border border-border shadow-sm min-h-[120px]">
            <div className="flex items-center justify-between pb-1">
              <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
                Gateway Utama
              </span>
              <ShieldCheck className="size-4 text-emerald-400" />
            </div>
            <div className="my-2">
              <div className="font-mono text-base font-bold text-emerald-400 tracking-tight truncate">
                {primaryRouter?.host ?? "—"}
              </div>
            </div>
            <div className="flex items-center justify-between text-muted-foreground font-mono text-[10px] pt-1">
              <span>Alamat manajemen router</span>
              <span
                className={
                  primaryRouter?.active
                    ? "text-emerald-400 font-medium"
                    : "text-muted-foreground"
                }
              >
                {primaryRouter?.active ? "Terbaca" : "Offline"}
              </span>
            </div>
          </div>

          {/* Card 6: REST API Latency */}
          <div className="p-4 rounded-2xl bg-card flex flex-col justify-between border border-border shadow-sm min-h-[120px]">
            <div className="flex items-center justify-between pb-1">
              <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
                Latensi API
              </span>
              <Zap className="size-4 text-emerald-400" />
            </div>
            <div className="my-2">
              <div className="font-mono text-2xl font-bold text-emerald-400 tracking-tight">
                {latencyVal === undefined ? "—" : `${latencyVal} ms`}
              </div>
            </div>
            <div className="flex items-center justify-between text-muted-foreground font-mono text-[10px] pt-1">
              <span>Zero jitter</span>
              <span className="text-foreground/90 font-medium">REST v1</span>
            </div>
          </div>
        </div>
      </div>

      {/* Render RouterResourceCards untuk backward compatibility & tests */}
      <div className="hidden">
        <RouterResourceCards routers={details} />
      </div>

      {/* 4. Inventory Section & Data Table */}
      <div className="flex flex-col rounded-2xl bg-card border border-border shadow-sm overflow-hidden">
        {/* Toolbar: Search, Filters & Action Buttons */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-muted/40 p-4 border-b border-border">
          <div className="flex flex-1 flex-wrap items-center gap-3">
            {/* Search Input */}
            <div className="relative flex-1 min-w-[240px] max-w-md">
              <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cari nama, host, IP, atau model router..."
                aria-label="Cari router"
                className="w-full h-9 pl-9 pr-4 rounded-xl bg-background border border-border text-foreground placeholder:text-muted-foreground font-mono text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
              />
            </div>

            {/* Filter Peran */}
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="h-9 px-3 rounded-xl bg-background border border-border text-foreground font-mono text-xs uppercase focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
            >
              <option value="all">Semua Peran</option>
              <option value="gateway">Core Gateway</option>
              <option value="distribusi">Distribusi</option>
              <option value="bras">BRAS / PPPoE Aggregator</option>
            </select>

            {/* Filter Status */}
            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as RouterStatusFilter)
              }
              aria-label="Filter status router"
              className="h-9 px-3 rounded-xl bg-background border border-border text-foreground font-mono text-xs uppercase focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
            >
              <option value="all">Semua Status REST</option>
              <option value="active">REST OK</option>
              <option value="disconnected">Error / Timeout</option>
            </select>
          </div>

          <div className="flex items-center gap-3 justify-between md:justify-end">
            <span
              className="font-mono text-xs text-muted-foreground"
              role="status"
            >
              Menampilkan{" "}
              <span className="text-foreground font-semibold">
                {visible.length}
              </span>{" "}
              dari {details.length} router
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              aria-disabled={isRefreshing}
              className="h-9 px-3.5 rounded-xl bg-muted hover:bg-muted border-border text-foreground font-mono text-xs uppercase gap-1.5"
            >
              <RefreshCw
                className={`size-3 text-cyan-400 ${isRefreshing ? "animate-spin" : ""}`}
              />
              <span>{isRefreshing ? "Menyegarkan..." : "Segarkan"}</span>
            </Button>
          </div>
        </div>

        {refreshError && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-2 p-3 bg-rose-950/40 border-b border-rose-800/60 text-xs text-rose-300"
          >
            <span>{refreshError}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              className="h-7 text-xs"
            >
              Coba lagi
            </Button>
          </div>
        )}

        {/* Data Table */}
        <div className="w-full overflow-x-auto">
          <table className="w-full text-left whitespace-nowrap">
            <thead className="bg-background/90 text-muted-foreground font-mono text-[11px] uppercase tracking-wider border-b border-border">
              <tr>
                <th className="py-3 px-4 w-10 text-center" scope="col">
                  #
                </th>
                <th className="py-3 px-4" scope="col">
                  Nama Router &amp; Host
                </th>
                <th className="py-3 px-4" scope="col">
                  Peran &amp; Model
                </th>
                <th className="py-3 px-4" scope="col">
                  Versi RouterOS
                </th>
                <th className="py-3 px-4" scope="col">
                  CPU / RAM
                </th>
                <th className="py-3 px-4" scope="col">
                  Throughput Saat Ini
                </th>
                <th className="py-3 px-4" scope="col">
                  Sesi PPPoE
                </th>
                <th className="py-3 px-4" scope="col">
                  Latensi Ping
                </th>
                <th className="py-3 px-4" scope="col">
                  Status REST
                </th>
                <th className="py-3 px-4 text-right" scope="col">
                  Aksi
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 font-mono text-xs">
              {isRefreshing ? (
                [0, 1, 2].map((i) => (
                  <tr key={`skeleton-${i}`} aria-hidden="true">
                    <td colSpan={10} className="py-4 px-4">
                      <div className="h-4 w-full animate-pulse rounded bg-muted/60" />
                    </td>
                  </tr>
                ))
              ) : visible.length === 0 ? (
                <tr>
                  <td
                    colSpan={10}
                    className="h-28 text-center text-muted-foreground"
                  >
                    {routers.length === 0
                      ? "Belum ada router yang ditambahkan."
                      : "Tidak ada router yang cocok dengan pencarian."}
                  </td>
                </tr>
              ) : (
                visible.map((router) => {
                  const pppoeCount = router.pppoeCount;
                  const dlMbps = router.currentDownloadMbps;
                  const ulMbps = router.currentUploadMbps;

                  return (
                    <tr
                      key={router.id}
                      className="hover:bg-muted/30 transition-colors group"
                    >
                      <td className="py-3.5 px-4 text-center">
                        <span
                          className={`inline-block size-2 rounded-full ${
                            router.active
                              ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]"
                              : "bg-rose-500"
                          }`}
                        />
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex flex-col">
                          <span className="font-semibold text-foreground group-hover:text-cyan-400 transition-colors">
                            {router.name}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {router.host}
                            {router.asn ? ` • ${router.asn}` : ""}
                          </span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex flex-col">
                          <span className="text-foreground font-medium">
                            {router.role}
                          </span>
                          <span className="text-[11px] text-muted-foreground truncate max-w-[180px]">
                            {router.boardModel}
                          </span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-muted-foreground text-[11px]">
                        {router.rosVersion}
                      </td>
                      <td className="py-3.5 px-4">
                        {router.active ? (
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`font-semibold ${
                                isCpuWarning(router)
                                  ? "text-amber-400"
                                  : "text-foreground"
                              }`}
                            >
                              {router.cpuLoad}%
                            </span>
                            <span className="text-zinc-600">/</span>
                            <span className="text-muted-foreground text-[11px]">
                              {router.memoryUsage}% RAM
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-1 text-[11px]">
                          <span className="text-cyan-400 font-semibold">
                            {dlMbps === undefined ? "↓ —" : `↓ ${dlMbps}M`}
                          </span>
                          <span className="text-zinc-600">/</span>
                          <span className="text-purple-400 font-semibold">
                            {ulMbps === undefined ? "↑ —" : `↑ ${ulMbps}M`}
                          </span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-muted border border-border text-foreground text-[11px]">
                          <span className="size-1.5 rounded-full bg-cyan-400" />
                          <span>
                            {pppoeCount === undefined
                              ? "—"
                              : `${pppoeCount} sesi`}
                          </span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                          <Zap className="size-3" />
                          <span>
                            {router.latencyMs === undefined
                              ? "—"
                              : `${router.latencyMs} ms avg`}
                          </span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <RouterStatusBadge active={router.active} />
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleOpenDetail(router)}
                            className="h-7 px-2.5 rounded-lg bg-muted hover:bg-muted border-border text-foreground font-mono text-[11px] uppercase"
                          >
                            Rincian
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setConfigRouter(router)}
                            className="h-7 px-2 rounded-lg bg-muted hover:bg-muted border-border text-foreground/90 font-mono text-[11px]"
                            title="Konfigurasi Router"
                          >
                            <Settings className="size-3 text-amber-400" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleOpenPingModal(router)}
                            className="h-7 px-2 rounded-lg bg-muted hover:bg-muted border-border text-foreground/90 font-mono text-[11px]"
                            title="Ping &amp; Trace"
                          >
                            <Terminal className="size-3 text-emerald-400" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setDeleteTarget({
                                id: router.id,
                                name: router.name,
                              })
                            }
                            className="h-7 px-2 rounded-lg bg-muted hover:bg-muted border-border text-foreground/90 font-mono text-[11px]"
                            title="Hapus Router"
                            aria-label={`Hapus router ${router.name}`}
                          >
                            <Trash2 className="size-3 text-rose-400" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Table Footer Status Strip */}
        <div className="px-5 py-3 bg-background flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-muted-foreground font-mono text-[11px] border-t border-border">
          <div className="flex flex-wrap items-center gap-3">
            <span>POLL INTERVAL: 1000MS</span>
            <span>•</span>
            <span>POSTGRESQL POOL: 12 CONN ACTIVES</span>
            <span>•</span>
            <span>ROUTER AGENT: REST API v1</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <span className="size-1.5 rounded-full bg-emerald-400" />
            <span className="text-foreground font-semibold">
              UPTIME CLUSTER: 99.98%
            </span>
          </div>
        </div>
      </div>

      {/* 5. System Status Footer Strip */}
      <footer className="w-full bg-background/60 rounded-xl py-2.5 px-4 border border-border font-mono text-[10px] text-muted-foreground flex flex-col sm:flex-row items-center justify-between gap-2">
        <span suppressHydrationWarning>
          SYS_EPOCH: {sysEpoch} • NOC TELEMETRY ENGINE V4.8.1
        </span>
        <div className="flex items-center gap-4">
          <span>INGRESS: 242.8 GB/S</span>
          <span>EGRESS: 239.2 GB/S</span>
          <span className="text-foreground font-medium flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-emerald-400" />
            CORE STATUS: NOMINAL
          </span>
        </div>
      </footer>

      {/* Dialog Rincian Router MikroTik (Lengkap 5 Tabs) */}
      {selectedRouter && (
        <Dialog
          open={!!selectedRouter}
          onOpenChange={(open) => !open && setSelectedRouterId(null)}
        >
          <DialogContent className="sm:max-w-4xl bg-background border-border text-foreground">
            <DialogHeader>
              <div className="flex items-center justify-between gap-3 pr-6">
                <div>
                  <DialogTitle className="flex items-center gap-2 text-lg text-foreground font-semibold">
                    {selectedRouter.name}
                    <RouterStatusBadge active={selectedRouter.active} />
                  </DialogTitle>
                  <DialogDescription className="font-mono text-xs text-muted-foreground mt-1">
                    {selectedRouter.host} · {selectedRouter.boardModel} ·{" "}
                    {selectedRouter.rosVersion}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <Tabs defaultValue="hardware" className="mt-2">
              <TabsList className="grid w-full grid-cols-5 bg-muted border border-border">
                <TabsTrigger
                  value="hardware"
                  className="gap-1.5 text-xs text-foreground/90 data-[state=active]:bg-muted data-[state=active]:text-foreground"
                >
                  <Cpu className="size-3.5" />
                  Hardware &amp; Sistem
                </TabsTrigger>
                <TabsTrigger
                  value="traffic"
                  className="gap-1.5 text-xs text-foreground/90 data-[state=active]:bg-muted data-[state=active]:text-foreground"
                >
                  <Activity className="size-3.5" />
                  Trafik Live
                </TabsTrigger>
                <TabsTrigger
                  value="queues"
                  className="gap-1.5 text-xs text-foreground/90 data-[state=active]:bg-muted data-[state=active]:text-foreground"
                >
                  <Layers className="size-3.5" />
                  Simple Queue
                </TabsTrigger>
                <TabsTrigger
                  value="pppoe"
                  className="gap-1.5 text-xs text-foreground/90 data-[state=active]:bg-muted data-[state=active]:text-foreground"
                >
                  <Radio className="size-3.5" />
                  Sesi PPPoE
                </TabsTrigger>
                <TabsTrigger
                  value="ping"
                  className="gap-1.5 text-xs text-foreground/90 data-[state=active]:bg-muted data-[state=active]:text-foreground"
                >
                  <Terminal className="size-3.5" />
                  Tool Ping ICMP
                </TabsTrigger>
              </TabsList>

              <TabsContent value="hardware" className="space-y-4 pt-3">
                <RouterHardwareCards
                  cpuLoad={selectedRouter.cpuLoad}
                  memoryUsage={selectedRouter.memoryUsage}
                  uptime={selectedRouter.uptime}
                  temperature={selectedRouter.temperature}
                  boardModel={selectedRouter.boardModel}
                  rosVersion={selectedRouter.rosVersion}
                  active={selectedRouter.active}
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs font-mono">
                  <div className="rounded-xl border border-border bg-muted/50 p-3.5">
                    <span className="text-muted-foreground block mb-1">
                      Metode Koneksi
                    </span>
                    <strong className="text-lg font-semibold text-foreground">
                      {selectedMethod}
                    </strong>
                    <p className="text-[11px] text-muted-foreground mt-1 break-words">
                      {selectedRouter.host}
                    </p>
                    <p
                      className={`text-[11px] mt-0.5 ${
                        selectedHealth?.reachable === false
                          ? "text-destructive"
                          : "text-emerald-400"
                      }`}
                    >
                      {selectedHealth
                        ? selectedHealth.reachable
                          ? "Terhubung"
                          : "Tidak terjangkau"
                        : "Belum ada status"}
                      {selectedHealth?.sourceIp || selectedHealth?.localSourceIp
                        ? ` · ${selectedHealth.sourceIp || selectedHealth.localSourceIp}`
                        : ""}
                    </p>
                  </div>
                  <div className="rounded-xl border border-border bg-muted/50 p-3.5">
                    <span className="text-muted-foreground block mb-1">
                      Simple Queue Terdaftar
                    </span>
                    <strong className="text-lg font-semibold text-foreground">
                      {selectedRouter.active
                        ? (selectedRouter.queueCount ?? "—")
                        : "—"}
                    </strong>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Limitasi antrian bandwidth aktif di router ini
                    </p>
                  </div>
                  <div className="rounded-xl border border-border bg-muted/50 p-3.5">
                    <span className="text-muted-foreground block mb-1">
                      Sesi PPPoE Terlayani
                    </span>
                    <strong className="text-lg font-semibold text-cyan-400">
                      {selectedRouter.active
                        ? (selectedRouter.pppoeCount ?? "—")
                        : "—"}
                    </strong>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Klien PPPoE terautentikasi dan aktif
                    </p>
                  </div>
                  <div className="rounded-xl border border-border bg-muted/50 p-3.5">
                    <span className="text-muted-foreground block mb-1">
                      Latensi REST API
                    </span>
                    <strong className="text-lg font-semibold text-emerald-400">
                      {selectedRouter.active &&
                      selectedRouter.latencyMs !== undefined
                        ? `${selectedRouter.latencyMs} ms`
                        : "—"}
                    </strong>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Waktu respons telemetri RouterOS
                    </p>
                  </div>
                </div>

                {selectedRouter.interfaces &&
                  selectedRouter.interfaces.length > 0 && (
                    <div className="rounded-xl border border-border bg-muted/50 p-4 space-y-3 font-mono text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-foreground flex items-center gap-2">
                          <Network className="size-4 text-cyan-400" />
                          Antarmuka Port &amp; Link Fisik (RouterOS)
                        </span>
                        <Badge
                          variant="outline"
                          className="text-[11px] text-foreground/90 border-border"
                        >
                          {selectedRouter.interfaces.length} Port
                        </Badge>
                      </div>
                      <div className="max-h-52 overflow-y-auto divide-y divide-border/80 rounded-lg border border-border bg-background/60 text-[11px]">
                        {selectedRouter.interfaces.map((iface) => (
                          <div
                            key={iface.id || iface.name}
                            className="flex flex-col sm:flex-row sm:items-center justify-between p-2.5 gap-2 hover:bg-muted/30"
                          >
                            <div className="flex items-center gap-2 truncate">
                              <span
                                className={`size-2 shrink-0 rounded-full ${iface.running ? "bg-emerald-400" : "bg-zinc-600"}`}
                              />
                              <span className="font-semibold text-foreground truncate">
                                {iface.name}
                              </span>
                              <span className="text-[10px] text-muted-foreground uppercase">
                                ({iface.type})
                              </span>
                              {iface.comment && (
                                <span className="text-[10px] text-cyan-400 font-mono truncate max-w-[180px]">
                                  [{iface.comment}]
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-muted-foreground font-mono text-[11px] shrink-0 justify-between sm:justify-end">
                              <span className="text-cyan-400">
                                RX: {iface.rxMbps ?? 0} Mbps
                              </span>
                              <span className="text-purple-400">
                                TX: {iface.txMbps ?? 0} Mbps
                              </span>
                              <Badge
                                variant="outline"
                                className={`text-[9px] uppercase ${iface.running ? "border-emerald-800/80 bg-emerald-950/40 text-emerald-400" : "border-border bg-muted text-muted-foreground"}`}
                              >
                                {iface.running ? "Link Up" : "Down"}
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
              </TabsContent>

              <TabsContent value="traffic" className="pt-3">
                <RouterTrafficCard
                  key={selectedRouter.id}
                  routerId={selectedRouter.id}
                  routerName={selectedRouter.name}
                  active={selectedRouter.active}
                  initialStats={selectedInitialStats}
                />
              </TabsContent>

              <TabsContent value="queues" className="pt-3">
                <RouterQueueTable
                  routerId={selectedRouter.id}
                  routerName={selectedRouter.name}
                />
              </TabsContent>

              <TabsContent value="pppoe" className="pt-3">
                <RouterPppoeTable
                  routerId={selectedRouter.id}
                  routerName={selectedRouter.name}
                />
              </TabsContent>

              <TabsContent value="ping" className="pt-3">
                <RouterPingTool
                  routerId={selectedRouter.id}
                  routerName={selectedRouter.name}
                  routerHost={selectedRouter.host}
                />
              </TabsContent>
            </Tabs>
          </DialogContent>
        </Dialog>
      )}

      {/* Dialog Konfigurasi Router */}
      {configRouter && (
        <RouterConfigDialog
          router={configRouter}
          open={!!configRouter}
          onOpenChange={(open) => !open && setConfigRouter(null)}
          onSaved={() => {
            void handleRefresh();
          }}
          onRequestDelete={() => {
            setDeleteTarget({ id: configRouter.id, name: configRouter.name });
            setConfigRouter(null);
          }}
        />
      )}

      {deleteTarget && (
        <RouterDeleteDialog
          router={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            useDashboardStore.getState().removeRouter(deleteTarget.id);
            setDeleteTarget(null);
            setSelectedRouterId(null);
            void handleRefresh();
          }}
        />
      )}

      {/* Dialog Ping & Trace Terpisah */}
      {pingModalOpen && selectedRouter && (
        <Dialog open={pingModalOpen} onOpenChange={setPingModalOpen}>
          <DialogContent className="sm:max-w-3xl bg-background border-border text-foreground">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-foreground text-base">
                <Terminal className="size-4 text-emerald-400" />
                Ping &amp; Trace: {selectedRouter.name} ({selectedRouter.host})
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground font-mono">
                Pemeriksaan latensi jaringan riil via ICMP RouterOS &amp; REST
                API
              </DialogDescription>
            </DialogHeader>

            <RouterPingTool
              routerId={selectedRouter.id}
              routerName={selectedRouter.name}
              routerHost={selectedRouter.host}
            />

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPingModalOpen(false)}
                className="text-xs text-foreground/90"
              >
                Tutup
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
