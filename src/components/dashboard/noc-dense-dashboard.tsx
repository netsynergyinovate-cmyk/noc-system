"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  MapPin,
  Network,
  Server,
  Users,
  Wifi,
  WifiOff,
  XCircle,
  Zap,
} from "lucide-react";

import { useDashboardStore } from "@/lib/dashboard/store";
import { formatInteger, formatMbps } from "@/lib/dashboard/format";
import { incidentLabels } from "@/lib/dashboard/incidents";
import { classifyAlertCategory } from "@/lib/dashboard/alert-categories";
import { AlertCategoryBadge } from "./alert-category-badge";
import { Button } from "@/components/ui/button";
import {
  TrafficChart,
  type InspectedTrafficPoint,
} from "@/components/dashboard/traffic-chart";
import { RangePicker } from "@/components/dashboard/range-picker";
import { IncidentList } from "@/components/dashboard/incident-list";
import {
  describe,
  LiveStats,
  StatsGrid,
  useLiveIncidents,
  useTrafficHistory,
} from "@/components/dashboard/traffic-panel";
import {
  DEFAULT_RANGE,
  getRange,
  type TrafficRangeId,
} from "@/lib/dashboard/ranges";
import { evaluateTrafficStaleness } from "@/lib/dashboard/staleness";
import { VlanPonTrafficBoard } from "@/components/dashboard/vlan-pon-traffic-board";

// Peta Leaflet interaktif asli untuk sebaran pelanggan & ODP riil
const CustomerMap = dynamic(
  () => import("./customer-map").then((module) => module.CustomerMap),
  {
    ssr: false,
    loading: () => (
      <div
        className="h-[260px] animate-pulse rounded-lg bg-muted border border-border flex items-center justify-center text-muted-foreground font-mono text-xs"
        aria-hidden="true"
      >
        Memuat Peta Pelanggan &amp; ODP Riil...
      </div>
    ),
  },
);

const wibClock = new Intl.DateTimeFormat("id-ID", {
  hour12: false,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "Asia/Jakarta",
});

const card = "rounded-lg border border-border bg-card p-2.5 text-card-foreground shadow-xs";
const stat = "bg-muted/50 p-1 rounded border border-border text-foreground";
const dash = (value: number | null | undefined, suffix = "") =>
  value === null || value === undefined ? "—" : `${value}${suffix}`;

// Semua angka datang dari backend Go lewat WebSocket (snapshot, delta, telemetri);
// tidak ada polling dan tidak ada nilai bawaan yang tampil sebagai data: yang belum
// diterima ditulis "—". Daftar pelanggan lengkap ada di /app/pelanggan.
export function NocDenseDashboard() {
  const customers = useDashboardStore((s) => s.customers);
  const routers = useDashboardStore((s) => s.routers);
  const traffic = useDashboardStore((s) => s.traffic);
  const onlineCount = useDashboardStore((s) => s.onlineCount);
  const offlineCount = useDashboardStore((s) => s.offlineCount);
  const weakSignalCount = useDashboardStore((s) => s.weakSignalCount);
  const activeRouterCount = useDashboardStore((s) => s.activeRouterCount);
  const telemetry = useDashboardStore((s) => s.telemetry);
  const lastUpdateAt = useDashboardStore((s) => s.lastUpdateAt);
  // Sebelum pesan pertama backend, store masih kosong.
  const hasData = lastUpdateAt !== null;

  const [range, setRange] = useState<TrafficRangeId>(DEFAULT_RANGE);
  const [inspectedTraffic, setInspectedTraffic] =
    useState<InspectedTrafficPoint | null>(null);
  // Histori dimuat sekali per rentang; ujung grafik digerakkan titik live WebSocket.
  const history = useTrafficHistory(range, false, false);
  const live = useLiveIncidents(range === DEFAULT_RANGE, false);

  const historyWindow = useMemo(
    () =>
      history.data && {
        series: history.data.series,
        from: history.data.from,
        to: history.data.to,
      },
    [history.data],
  );

  const isLive = range === DEFAULT_RANGE;
  const incidents = isLive ? live.incidents : (history.data?.incidents ?? []);
  const now = isLive ? live.now : (history.data?.to ?? 0);
  const lastTrafficTime = useDashboardStore((s) => s.traffic.times.at(-1));
  const [lastTrafficReceivedAt, setLastTrafficReceivedAt] = useState<number | null>(null);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!isLive) return;
    const timer = setInterval(() => {
      setNowSec(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [isLive]);

  useEffect(() => {
    if (lastTrafficTime !== undefined && lastTrafficTime > 0) {
      setLastTrafficReceivedAt(Math.floor(Date.now() / 1000));
    }
  }, [lastTrafficTime]);
  const handleRangeChange = (newRange: TrafficRangeId) => {
    setRange(newRange);
    setInspectedTraffic(null);
  };

  const t = telemetry;
  const router = t?.routers[0];
  const olt = t?.olts[0];
  const optics = t?.criticalOptics ?? [];
  const latencyItems = t?.latency.items ?? [];
  const staleness = evaluateTrafficStaleness({
    isLive,
    lastDataReceivedAt: lastTrafficReceivedAt,
    routerReachable: router?.reachable ?? true,
    nowSec,
  });
  const isTrafficStale = staleness.isStale;
  const secondsSinceTraffic = staleness.secondsSinceLastData;
  const displayAlerts = useMemo(
    () =>
      (t?.alerts.items ?? []).map((a) => {
        const title =
          a.title ||
          incidentLabels[a.type as keyof typeof incidentLabels] ||
          a.type;
        const category = classifyAlertCategory({
          type: a.type,
          title,
        });
        return {
          id: a.id,
          title,
          category,
          location: a.location,
          timeWib: wibClock.format(new Date(a.detectedAt * 1000)),
        };
      }),
    [t?.alerts.items],
  );

  const totalCust = customers.length;
  const onlinePct =
    totalCust > 0 ? ((onlineCount / totalCust) * 100).toFixed(1) : "0.0";
  const offlinePct =
    totalCust > 0 ? ((offlineCount / totalCust) * 100).toFixed(1) : "0.0";
  const normalCount = Math.max(0, onlineCount - weakSignalCount);

  // Beban: rata-rata terhadap puncak dari titik live (5 menit) di store; kosong = belum ada data.
  const traffic5 = useMemo(() => {
    const rx = traffic?.rx ?? [];
    if (rx.length === 0) return null;
    const peak = Math.max(...rx);
    if (peak <= 0) return null;
    const avg = rx.reduce((a, b) => a + b, 0) / rx.length;
    return {
      peak,
      load: Math.min(100, Math.max(1, Math.round((avg / peak) * 100))),
    };
  }, [traffic?.rx]);

  const kpi = (value: number) => (hasData ? formatInteger(value) : "—");

  return (
    <div className="w-full space-y-2 font-sans text-[11px] selection:bg-primary/20 selection:text-foreground">
      {/* 1. KPI PELANGGAN + TELEMETRI HARDWARE MIKROTIK & OLT */}
      <section className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
        <div
          className={`${card} flex flex-col justify-between`}
          data-testid="kpi-online"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
              Pelanggan online
            </span>
            <Wifi className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          </div>
          <div className="my-1.5 flex items-baseline justify-between">
            <div className="text-lg font-bold text-foreground tracking-tight">
              {kpi(onlineCount)}
            </div>
            <div className="text-[10px] text-muted-foreground font-mono">
              {hasData ? `${onlinePct}% / ${formatInteger(totalCust)}` : ""}
            </div>
          </div>
          <div className="w-full bg-muted h-1 rounded-full overflow-hidden">
            <div
              className="bg-emerald-500 h-1 rounded-full"
              style={{ width: `${onlinePct}%` }}
            ></div>
          </div>
        </div>

        <div className={`${card} flex flex-col justify-between`}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
              Pelanggan offline
            </span>
            <WifiOff className="w-3.5 h-3.5 text-rose-500 shrink-0" />
          </div>
          <div className="my-1.5 flex items-baseline justify-between">
            <div className="text-lg font-bold text-foreground tracking-tight">
              {kpi(offlineCount)}
            </div>
            <div className="text-[10px] text-muted-foreground font-mono">
              {hasData ? `${offlinePct}% total` : ""}
            </div>
          </div>
          <div className="w-full bg-muted h-1 rounded-full overflow-hidden">
            <div
              className="bg-rose-500 h-1 rounded-full"
              style={{ width: `${Math.min(100, Number(offlinePct) * 10)}%` }}
            ></div>
          </div>
        </div>

        <div className={`${card} flex flex-col justify-between`}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
              Sinyal Lemah
            </span>
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
          </div>
          <div className="my-1.5 flex items-baseline justify-between">
            <div className="text-lg font-bold text-foreground tracking-tight">
              {kpi(weakSignalCount)}
            </div>
            <div className="text-[10px] text-muted-foreground font-mono">
              Rx &lt; -25 dBm
            </div>
          </div>
          <div className="w-full bg-muted h-1 rounded-full overflow-hidden">
            <div
              className="bg-amber-500 h-1 rounded-full"
              style={{ width: `${Math.min(100, weakSignalCount * 5)}%` }}
            ></div>
          </div>
        </div>

        <div className={`${card} flex flex-col justify-between`}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
              Router aktif
            </span>
            <Server className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          </div>
          <div className="my-1.5 flex items-baseline justify-between">
            <div className="text-lg font-bold text-foreground tracking-tight">
              {hasData ? `${activeRouterCount} / ${routers.length}` : "—"}
            </div>
            <div className="text-[10px] text-muted-foreground font-mono">
              {hasData && routers.length > 0
                ? `${Math.round((activeRouterCount / routers.length) * 100)}% UP`
                : ""}
            </div>
          </div>
          <div className="w-full bg-muted h-1 rounded-full overflow-hidden">
            <div
              className="bg-emerald-500 h-1 rounded-full"
              style={{
                width: `${routers.length > 0 ? (activeRouterCount / routers.length) * 100 : 0}%`,
              }}
            ></div>
          </div>
        </div>

        {/* MikroTik: CPU/RAM/uptime dari /system/resource, didorong backend Go */}
        <div
          className={`${card} flex flex-col justify-between`}
          data-testid="router-status"
        >
          <div className="flex items-center justify-between pb-1 border-b border-border">
            <span
              className={`text-[10px] font-bold font-mono truncate ${router && !router.reachable ? "text-rose-500" : "text-foreground"}`}
            >
              {router?.name ?? "—"}
            </span>
            <Cpu className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          </div>
          <div className="grid grid-cols-3 gap-1 mt-1 text-center font-mono">
            <div className={stat}>
              <span className="text-[8px] text-muted-foreground block">CPU</span>
              <span className="text-[10px] font-bold text-foreground">
                {dash(router?.cpuLoad, "%")}
              </span>
            </div>
            <div className={stat}>
              <span className="text-[8px] text-muted-foreground block">RAM</span>
              <span className="text-[10px] font-bold text-foreground">
                {dash(router?.memoryUsage, "%")}
              </span>
            </div>
            <div className={stat}>
              <span className="text-[8px] text-muted-foreground block">Status</span>
              <span
                className={`text-[10px] font-bold ${router?.reachable ? "text-emerald-500" : "text-rose-500"}`}
              >
                {router ? (router.reachable ? "UP" : "DOWN") : "—"}
              </span>
            </div>
          </div>
        </div>

        {/* OLT: status, port PON, ONU dari polling backend (olt_pon_ports, olt_onus) */}
        <div
          className={`${card} flex flex-col justify-between`}
          data-testid="olt-status"
        >
          <div className="flex items-center justify-between pb-1 border-b border-border">
            <span className="text-[10px] font-bold text-foreground font-mono truncate">
              {olt?.name ?? "—"}
            </span>
            <Network className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          </div>
          <div className="grid grid-cols-3 gap-1 mt-1 text-center font-mono">
            <div className={stat}>
              <span className="text-[8px] text-muted-foreground block">PON</span>
              <span className="text-[10px] font-bold text-foreground">
                {olt ? `${olt.ponPortCount} Port` : "—"}
              </span>
            </div>
            <div className={stat}>
              <span className="text-[8px] text-muted-foreground block">Status</span>
              <span className="text-[10px] font-bold text-emerald-500 uppercase">
                {olt?.status ?? "—"}
              </span>
            </div>
            <div className={stat}>
              <span className="text-[8px] text-muted-foreground block">ONT</span>
              <span className="text-[10px] font-bold text-foreground">
                {olt ? `${olt.onuOnline}/${olt.onuTotal}` : "—"}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* 2. KONTEN UTAMA (8 kolom kiri, 4 kolom kanan) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-2">
        <section className="lg:col-span-8 space-y-2">
          <div className={card}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 mb-2">
              <div className="flex items-center gap-2">
                <Activity className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-xs sm:text-sm font-bold text-foreground">
                      Traffic Jaringan Real-Time
                    </h2>
                    {isLive && (
                      <span className="flex items-center gap-1 px-1.5 rounded bg-emerald-950/60 border border-emerald-500/40 text-[9px] font-mono text-emerald-400 font-semibold">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        1 DTK
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground">{describe(range)}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {inspectedTraffic ? (
                  <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-muted/60 border border-border text-[10px] font-mono text-foreground/90">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping shrink-0" />
                    <span className="font-bold text-foreground">
                      Titik:{" "}
                      {wibClock.format(new Date(inspectedTraffic.time * 1000))}{" "}
                      WIB
                    </span>
                    <span className="text-zinc-600">•</span>
                    <span className="text-sky-400 font-bold">
                      Unduh {formatMbps(inspectedTraffic.rx)}
                    </span>
                    <span className="text-zinc-600">•</span>
                    <span className="text-orange-400 font-bold">
                      Unggah {formatMbps(inspectedTraffic.tx)}
                    </span>
                  </div>
                ) : null}
                <RangePicker value={range} onChange={handleRangeChange} />
              </div>
            </div>

            <div className="mb-2">
              {isLive ? (
                <LiveStats inspectedPoint={inspectedTraffic} />
              ) : (
                <StatsGrid
                  rx={history.data?.series.rx ?? []}
                  tx={history.data?.series.tx ?? []}
                  times={history.data?.series.times}
                  latestLabel="terakhir"
                  inspectedPoint={inspectedTraffic}
                />
              )}
            </div>

            <div className="relative w-full min-h-[220px] bg-muted/20 rounded p-1 border border-border overflow-hidden flex flex-col justify-center">
              {isTrafficStale && (
                <div
                  data-testid="traffic-rto-alert"
                  className="absolute top-2 right-2 z-20 flex items-center gap-1.5 px-2.5 py-1 rounded bg-rose-950/90 border border-rose-500/60 text-[10px] text-rose-200 font-mono shadow-md backdrop-blur-sm animate-pulse"
                >
                  <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0 animate-ping" />
                  <span className="font-semibold">
                    MikroTik Tidak Merespons (RTO • {secondsSinceTraffic}s)
                  </span>
                </div>
              )}
              {history.failed ? (
                <div
                  role="alert"
                  className="flex min-h-[200px] flex-col items-center justify-center gap-2 p-4 text-center"
                >
                  <p className="text-xs text-muted-foreground">
                    Histori traffic belum bisa dimuat.
                  </p>
                  <Button variant="outline" size="sm" onClick={history.retry}>
                    Coba lagi
                  </Button>
                </div>
              ) : history.loading ? (
                <div
                  role="status"
                  aria-label="Memuat histori traffic"
                  className="min-h-[200px] animate-pulse rounded bg-muted motion-reduce:animate-none flex items-center justify-center text-muted-foreground font-mono text-xs"
                >
                  Memuat histori traffic dari database...
                </div>
              ) : !isLive &&
                history.data &&
                history.data.series.times.length === 0 ? (
                <div
                  role="status"
                  data-testid="traffic-history-empty"
                  className="flex min-h-[200px] flex-col items-center justify-center gap-1 p-4 text-center"
                >
                  <p className="text-xs font-medium text-foreground">
                    Belum ada histori untuk rentang ini
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    Backend merekam traffic setiap detik sejak router terhubung.
                    Grafik terisi bertahap; coba rentang yang lebih pendek.
                  </p>
                </div>
              ) : (
                <TrafficChart
                  rangeId={range}
                  history={historyWindow ?? undefined}
                  incidents={incidents}
                  onInspect={setInspectedTraffic}
                />
              )}
            </div>

            {incidents.length > 0 && (
              <div className="mt-2 pt-2 border-t border-border">
                <IncidentList
                  incidents={incidents}
                  now={now}
                  multiDay={getRange(range).seconds > 24 * 3600}
                />
              </div>
            )}

            {/* TRAFIK VLAN PER PON OLT: live dari telemetri backend Go */}
            <VlanPonTrafficBoard />
          </div>

          {/* Ringkasan kondisi pelanggan & trafik (hitungan riil dari backend) */}
          <div className={`${card} flex flex-col justify-between`}>
            <div className="flex items-center justify-between pb-1.5 border-b border-border">
              <div className="flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <h3 className="text-[10.5px] font-bold uppercase tracking-wider text-foreground">
                  Ringkasan Telemetri &amp; Distribusi
                </h3>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-1.5 mt-1 pt-0.5">
              {/* Donut 1: Distribusi Redaman */}
              <div className="bg-muted/50 p-1.5 rounded border border-border flex flex-col items-center justify-between">
                <span className="text-[9px] font-semibold text-foreground/90 uppercase tracking-wider text-center">
                  Distribusi Redaman
                </span>
                <div className="relative w-14 h-14 my-1 flex items-center justify-center">
                  <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                    <circle
                      cx="18"
                      cy="18"
                      r="14"
                      fill="none"
                      stroke="#27272a"
                      strokeWidth="3.5"
                    />
                    <circle
                      cx="18"
                      cy="18"
                      r="14"
                      fill="none"
                      stroke="#10b981"
                      strokeWidth="3.5"
                      strokeDasharray={`${totalCust > 0 ? (normalCount / totalCust) * 88 : 0} 88`}
                    />
                    <circle
                      cx="18"
                      cy="18"
                      r="14"
                      fill="none"
                      stroke="#f59e0b"
                      strokeWidth="3.5"
                      strokeDasharray={`${totalCust > 0 ? (weakSignalCount / totalCust) * 88 : 0} 88`}
                      strokeDashoffset={`-${totalCust > 0 ? (normalCount / totalCust) * 88 : 0}`}
                    />
                  </svg>
                  <div className="absolute flex flex-col items-center justify-center text-center">
                    <span className="text-[9px] font-bold font-mono text-foreground">
                      {hasData ? onlineCount : "—"}
                    </span>
                    <span className="text-[7.5px] text-muted-foreground font-mono">
                      ONT
                    </span>
                  </div>
                </div>
                <div className="w-full space-y-0.5 text-[8px] font-mono border-t border-border pt-1">
                  <div className="flex items-center justify-between text-foreground/90">
                    <span>Normal</span>
                    <span className="font-bold text-foreground">
                      {hasData ? normalCount : "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Lemah</span>
                    <span className="font-semibold text-amber-400">
                      {hasData ? weakSignalCount : "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Offline</span>
                    <span className="text-muted-foreground">
                      {hasData ? offlineCount : "—"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Donut 2: Koneksi ONT */}
              <div className="bg-muted/50 p-1.5 rounded border border-border flex flex-col items-center justify-between">
                <span className="text-[9px] font-semibold text-foreground/90 uppercase tracking-wider text-center">
                  Koneksi ONT
                </span>
                <div className="relative w-14 h-14 my-1 flex items-center justify-center">
                  <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                    <circle
                      cx="18"
                      cy="18"
                      r="14"
                      fill="none"
                      stroke="#27272a"
                      strokeWidth="3.5"
                    />
                    <circle
                      cx="18"
                      cy="18"
                      r="14"
                      fill="none"
                      stroke="#38bdf8"
                      strokeWidth="3.5"
                      strokeDasharray={`${(Number(onlinePct) / 100) * 88} 88`}
                    />
                  </svg>
                  <div className="absolute flex flex-col items-center justify-center text-center">
                    <span className="text-[9px] font-bold font-mono text-foreground">
                      {hasData ? `${onlinePct}%` : "—"}
                    </span>
                    <span className="text-[7.5px] text-muted-foreground font-mono">
                      ONLINE
                    </span>
                  </div>
                </div>
                <div className="w-full space-y-0.5 text-[8px] font-mono border-t border-border pt-1">
                  <div className="flex items-center justify-between text-foreground/90">
                    <span>Online</span>
                    <span className="font-bold text-foreground">
                      {hasData ? onlineCount : "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-foreground/90">
                    <span>Offline</span>
                    <span className="font-bold text-foreground">
                      {hasData ? offlineCount : "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Total</span>
                    <span className="text-foreground/90">
                      {hasData ? totalCust : "—"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Donut 3: Trafik Load (rata-rata terhadap puncak, 5 menit terakhir) */}
              <div className="bg-muted/50 p-1.5 rounded border border-border flex flex-col items-center justify-between">
                <span className="text-[9px] font-semibold text-foreground/90 uppercase tracking-wider text-center">
                  Trafik Load
                </span>
                <div className="relative w-14 h-14 my-1 flex items-center justify-center">
                  <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                    <circle
                      cx="18"
                      cy="18"
                      r="14"
                      fill="none"
                      stroke="#27272a"
                      strokeWidth="3.5"
                    />
                    <circle
                      cx="18"
                      cy="18"
                      r="14"
                      fill="none"
                      stroke="#38bdf8"
                      strokeWidth="3.5"
                      strokeDasharray={`${((traffic5?.load ?? 0) / 100) * 88} 88`}
                    />
                  </svg>
                  <div className="absolute flex flex-col items-center justify-center text-center">
                    <span className="text-[9px] font-bold font-mono text-foreground">
                      {traffic5 ? `${traffic5.load}%` : "—"}
                    </span>
                  </div>
                </div>
                <div className="w-full space-y-0.5 text-[8px] font-mono border-t border-border pt-1">
                  <div className="flex items-center justify-between text-foreground/90">
                    <span>Utilisasi</span>
                    <span className="font-bold text-foreground">
                      {traffic5 ? `${traffic5.load}%` : "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Puncak 5 mnt</span>
                    <span className="text-foreground/90">
                      {traffic5 ? formatMbps(traffic5.peak) : "—"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* KOLOM KANAN */}
        <section className="lg:col-span-4 space-y-2">
          <div className={`${card} flex flex-col justify-between`}>
            <div className="flex items-center justify-between mb-1.5">
              <h2 className="text-xs font-bold text-foreground flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                Sebaran Pelanggan &amp; ODP Riil
              </h2>
            </div>

            <div className="relative w-full h-[260px] rounded overflow-hidden border border-border bg-muted/20">
              <CustomerMap />
            </div>

            <div className="mt-1.5 pt-1.5 border-t border-border flex items-center justify-between text-[10px] text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                <span>Normal</span>
                <span className="font-mono font-bold text-foreground">
                  {hasData ? normalCount : "—"}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />
                <span>Lemah (-25~-28)</span>
                <span className="font-mono font-bold text-foreground">
                  {hasData ? weakSignalCount : "—"}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <XCircle className="w-3 h-3 text-rose-500 shrink-0" />
                <span>Offline / LOS</span>
                <span className="font-mono font-bold text-foreground">
                  {hasData ? offlineCount : "—"}
                </span>
              </div>
            </div>
          </div>

          {/* Latensi TCP round-trip nyata dari backend ke router, OLT, dan DNS publik */}
          <div className={card} data-testid="latency-panel">
            <div className="flex items-center justify-between mb-1.5">
              <h3 className="text-[10.5px] font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                Latensi Gateway &amp; Perangkat
              </h3>
              <span className="text-[9px] text-muted-foreground font-mono">
                {t?.latency.avgLatencyMs != null
                  ? `Rata-rata: ${t.latency.avgLatencyMs} ms`
                  : t?.latency.measuredAt
                    ? "Tidak terjangkau"
                    : "Mengukur..."}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1.5 font-mono">
              {latencyItems.map((gw) => (
                <div
                  key={`${gw.name}-${gw.port}`}
                  className="flex items-center justify-between p-1 px-1.5 rounded bg-muted/50 border border-border"
                  title={`${gw.host}:${gw.port}`}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    {gw.status === "online" ? (
                      <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                    )}
                    <span className="text-[9.5px] text-foreground/90 truncate">
                      {gw.name}
                    </span>
                  </div>
                  <span className="text-[10px] text-foreground font-semibold shrink-0 ml-1.5">
                    {dash(gw.latencyMs, " ms")}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Redaman optik kritis dari database OLT (olt_onus + customers) */}
          <div className={card} data-testid="optics-panel">
            <div className="flex items-center justify-between mb-1.5">
              <h3 className="text-[10.5px] font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                Redaman Optik Kritis
              </h3>
              <span className="text-[9px] px-1.5 rounded bg-muted text-foreground border border-border font-mono">
                {t ? `Batas: ${t.criticalOpticalDbm} dBm` : "—"}
              </span>
            </div>
            <div className="space-y-1">
              {optics.length > 0 ? (
                optics.map((onu) => (
                  <div
                    key={onu.id}
                    className="p-1.5 rounded bg-muted/50 border border-border flex items-center justify-between"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-foreground text-[10.5px] flex items-center gap-1.5">
                        <AlertOctagon className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                        <span className="truncate max-w-[150px]">
                          {onu.user}
                        </span>
                        <span className="text-[9px] text-muted-foreground font-mono font-normal">
                          {onu.pon}
                        </span>
                      </div>
                      <div className="text-[9px] text-muted-foreground mt-0.5 truncate max-w-[200px]">
                        {onu.odp}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-foreground font-bold font-mono text-[10.5px]">
                        {onu.rx.toFixed(1)} dBm
                      </div>
                      <span
                        className={`text-[8px] px-1 rounded border ${
                          onu.badge === "Critical"
                            ? "bg-rose-950/60 text-rose-300 border-rose-800"
                            : "bg-amber-950/60 text-amber-300 border-amber-800"
                        }`}
                      >
                        {onu.badge}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-2.5 text-center text-muted-foreground font-mono text-[10px]">
                  {t
                    ? `Semua sinyal optik ONT dalam batas normal (> ${t.criticalOpticalDbm} dBm).`
                    : "—"}
                </div>
              )}
            </div>
          </div>

          {/* Alert aktif dari tabel alerts (rule engine Go) */}
          <div className={card} data-testid="alerts-panel">
            <div className="flex items-center justify-between mb-1.5">
              <h3 className="text-[10.5px] font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5">
                <AlertOctagon className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                Daftar Anomali &amp; Alarm Aktif
              </h3>
              <Link
                href="/app/alert"
                className="text-[9px] text-foreground bg-muted border border-border px-1.5 rounded font-mono font-medium hover:bg-muted/80"
              >
                {t ? `${t.alerts.total} Aktif` : "—"}
              </Link>
            </div>
            <div className="space-y-1">
              {displayAlerts.length > 0 ? (
                displayAlerts.map((alert) => (
                  <div
                    key={alert.id}
                    className="p-1.5 rounded bg-muted/50 border border-border text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-foreground text-[10.5px] flex items-center gap-1.5 flex-wrap">
                        <AlertCategoryBadge category={alert.category} size="sm" />
                        {alert.title}
                      </span>
                      <span className="text-[9px] text-muted-foreground font-mono">
                        Aktif
                      </span>
                    </div>
                    <p className="text-[9.5px] text-muted-foreground mt-0.5">
                      {alert.location ? `${alert.location} • ` : ""}
                      Terdeteksi pada pukul {alert.timeWib} WIB
                    </p>
                  </div>
                ))
              ) : (
                <div className="p-2.5 text-center text-muted-foreground font-mono text-[10px]">
                  {t ? "Tidak ada anomali atau alarm aktif (Normal)." : "—"}
                </div>
              )}
            </div>
          </div>

          {/* Status pelanggan, minimal (tabel lengkap ada di /app/pelanggan) */}
          <div className={card} data-testid="customer-status">
            <div className="flex items-center justify-between mb-1.5">
              <h3 className="text-[10.5px] font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                Status Pelanggan
              </h3>
              <Link
                href="/app/pelanggan"
                className="text-[10px] text-sky-400 hover:underline"
              >
                Daftar pelanggan →
              </Link>
            </div>
            <div className="flex items-baseline gap-4 font-mono">
              <span className="text-emerald-400">
                <b className="text-base text-foreground">{kpi(onlineCount)}</b>{" "}
                online
              </span>
              <span className="text-rose-400">
                <b className="text-base text-foreground">{kpi(offlineCount)}</b>{" "}
                offline
              </span>
              <span className="text-amber-400">
                <b className="text-base text-foreground">{kpi(weakSignalCount)}</b>{" "}
                lemah
              </span>
              <span className="ml-auto text-[10px] text-muted-foreground">
                {hasData
                  ? `${onlinePct}% dari ${formatInteger(totalCust)}`
                  : ""}
              </span>
            </div>
            <div className="mt-1.5 flex h-1 overflow-hidden rounded-full bg-muted">
              <div
                className="bg-emerald-400"
                style={{ width: `${onlinePct}%` }}
              />
              <div
                className="bg-rose-500"
                style={{ width: `${offlinePct}%` }}
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
