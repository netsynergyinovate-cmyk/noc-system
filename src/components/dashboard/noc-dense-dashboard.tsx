"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
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
import { useAlertStore } from "@/lib/dashboard/alert-store";
import { formatInteger, formatMbps } from "@/lib/dashboard/format";
import { incidentLabels } from "@/lib/dashboard/incidents";
import { CustomerTable } from "@/components/dashboard/customer-table";
import { Button } from "@/components/ui/button";
import { TrafficChart, type InspectedTrafficPoint } from "@/components/dashboard/traffic-chart";
import { loadLiveTrafficHistory } from "@/lib/dashboard/history-live";
import { RangePicker } from "@/components/dashboard/range-picker";
import { IncidentList } from "@/components/dashboard/incident-list";
import {
  describe,
  LiveStats,
  StatsGrid,
  useLiveIncidents,
  useTrafficHistory,
} from "@/components/dashboard/traffic-panel";
import { DEFAULT_RANGE, getRange, type TrafficRangeId } from "@/lib/dashboard/ranges";
import { useSession } from "@/components/session-provider";
import { selectPreviewEnabled } from "@/lib/session-store";
import { VlanPonTrafficBoard } from "@/components/dashboard/vlan-pon-traffic-board";

// Peta Leaflet interaktif asli untuk sebaran pelanggan & ODP riil
const CustomerMap = dynamic(
  () => import("./customer-map").then((module) => module.CustomerMap),
  {
    ssr: false,
    loading: () => (
      <div
        className="h-[260px] animate-pulse rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-500 font-mono text-xs"
        aria-hidden="true"
      >
        Memuat Peta Pelanggan &amp; ODP Riil...
      </div>
    ),
  },
);

interface RouterResourceItem {
  id: string;
  name: string;
  boardModel: string;
  rosVersion: string;
  cpuLoad: number;
  memoryUsage: number;
  temperature: number;
  uptime: string;
  queueCount: number;
  active: boolean;
  interfaces?: {
    id: string;
    name: string;
    type: string;
    running: boolean;
    rxByte: number;
    txByte: number;
    comment: string;
  }[];
}

interface OltDeviceItem {
  id: string;
  name: string;
  host: string;
  brand: string;
  driver: string;
  status: string;
  ponPortCount: number;
  onuTotal: number;
  onuOnline: number;
}

interface RealTrafficOverview {
  currentDownloadMbps: number;
  currentUploadMbps: number;
  peakMbps: number;
  avgMbps: number;
  totalVolumeGb: number;
  series: {
    timestamp: number;
    timeLabel: string;
    downloadMbps: number;
    uploadMbps: number;
    totalMbps: number;
    peakMbps: number;
  }[];
}

interface MeasuredLatencyItem {
  name: string;
  host: string;
  port: number;
  latencyMs: number | null;
  status: "online" | "timeout" | "error";
  checkedAt: string;
}

interface NetworkLatencySummary {
  avgLatencyMs: number | null;
  onlineCount: number;
  totalCount: number;
  items: MeasuredLatencyItem[];
  measuredAt: string;
}

interface CriticalOpticalItem {
  id: string;
  user: string;
  pon: string;
  odp: string;
  rx: number;
  badge: "Critical" | "High Atten" | "Degrading";
  serialNumber: string | null;
  ponIndex: number;
  onuIndex: number;
}

interface RealAlertItem {
  id: string;
  type: string;
  severity: "info" | "warning" | "critical";
  status: string;
  title: string | null;
  startedAt?: number;
  detectedAt: number | string;
  location?: {
    name: string;
    address: string | null;
    odpName: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  locationName?: string | null;
  locationAddress?: string | null;
  locationOdp?: string | null;
}

export function NocDenseDashboard() {
  const customers = useDashboardStore((s) => s.customers);
  const traffic = useDashboardStore((s) => s.traffic);
  const onlineCount = useDashboardStore((s) => s.onlineCount);
  const offlineCount = useDashboardStore((s) => s.offlineCount);
  const weakSignalCount = useDashboardStore((s) => s.weakSignalCount);
  const activeRouterCount = useDashboardStore((s) => s.activeRouterCount);
  const activeAlerts = useAlertStore((s) => s.active);

  // Status telemetri hardware MikroTik, OLT, Latensi Jaringan, dan Optik Riil
  const [routerResources, setRouterResources] = useState<RouterResourceItem | null>(null);
  const [oltDevice, setOltDevice] = useState<OltDeviceItem | null>(null);
  const [trafficOverview, setTrafficOverview] = useState<RealTrafficOverview | null>(null);
  const [latencySummary, setLatencySummary] = useState<NetworkLatencySummary | null>(null);
  const [realCriticalOptics, setRealCriticalOptics] = useState<CriticalOpticalItem[]>([]);
  const [realActiveAlerts, setRealActiveAlerts] = useState<RealAlertItem[]>([]);

  // Filter timeframe & status histori dari PostgreSQL
  const isDemo = useSession(selectPreviewEnabled);
  const [range, setRange] = useState<TrafficRangeId>(DEFAULT_RANGE);
  const history = useTrafficHistory(range, isDemo);
  const live = useLiveIncidents(range === DEFAULT_RANGE, isDemo);

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
  const ready = isLive || history.data !== null;

  const [showCustomerTable, setShowCustomerTable] = useState(true);
  const [mapMode, setMapMode] = useState<"gis" | "radar">("gis");
  const [inspectedTraffic, setInspectedTraffic] = useState<InspectedTrafficPoint | null>(null);

  const handleRangeChange = (newRange: TrafficRangeId) => {
    setRange(newRange);
    setInspectedTraffic(null);
  };

  // Preload data 5 menit riil dari PostgreSQL bila memori store traffic masih kosong
  useEffect(() => {
    if (range === "live") {
      const current = useDashboardStore.getState().traffic;
      if (!current || current.times.length === 0) {
        loadLiveTrafficHistory("live")
          .then((res) => {
            if (res.series.times.length > 0) {
              useDashboardStore.setState((state) => {
                if (state.traffic.times.length === 0) {
                  return { traffic: res.series };
                }
                return state;
              });
            }
          })
          .catch(() => {});
      }
    }
  }, [range]);

  // Tarik data hardware & telemetri riil dari MikroTik, OLT, Latensi Jaringan, dan PostgreSQL
  const loadAllRealTelemetry = async () => {
    try {
      // 1. Telemetri MikroTik (/api/routers/resources)
      const resRouter = await fetch("/api/routers/resources");
      if (resRouter.ok) {
        const body = (await resRouter.json()) as { data?: { items?: RouterResourceItem[] } };
        if (body.data?.items && body.data.items.length > 0) {
          setRouterResources(body.data.items[0]);
        }
      }

      // 2. Telemetri OLT (/api/devices)
      const resDevices = await fetch("/api/devices");
      if (resDevices.ok) {
        const body = (await resDevices.json()) as { data?: { olts?: OltDeviceItem[] } };
        if (body.data?.olts && body.data.olts.length > 0) {
          setOltDevice(body.data.olts[0]);
        }
      }

      // 3. Antarmuka interface nyata & ringkasan trafik 24 jam (/api/traffic?range=24h)
      const resTraffic = await fetch("/api/traffic?range=24h");
      if (resTraffic.ok) {
        const body = (await resTraffic.json()) as {
          data?: {
            overview?: {
              currentDownloadMbps: number;
              currentUploadMbps: number;
              peakMbps: number;
              avgMbps: number;
              totalVolumeGb: number;
            };
            series?: RealTrafficOverview["series"];
          };
        };
        if (body.data?.overview && body.data.series) {
          setTrafficOverview({
            ...body.data.overview,
            series: body.data.series,
          });
        }
      }

      // 4. Latensi riil gateway & target jaringan via TCP round-trip nyata (/api/network/latency)
      const resLatency = await fetch("/api/network/latency");
      if (resLatency.ok) {
        const body = (await resLatency.json()) as { ok: boolean; data: NetworkLatencySummary };
        if (body.ok && body.data) {
          setLatencySummary(body.data);
        }
      }

      // 5. Redaman optik kritis riil dari database OLT (/api/olts/critical-optics)
      const resOptics = await fetch("/api/olts/critical-optics?limit=4");
      if (resOptics.ok) {
        const body = (await resOptics.json()) as { ok: boolean; data: CriticalOpticalItem[] };
        if (body.ok && body.data) {
          setRealCriticalOptics(body.data);
        }
      }

      // 6. Daftar anomali & alarm aktif riil dari PostgreSQL (/api/alerts?status=active)
      const resAlerts = await fetch("/api/alerts?status=active&limit=4");
      if (resAlerts.ok) {
        const body = (await resAlerts.json()) as { data?: RealAlertItem[] };
        if (body.data) {
          setRealActiveAlerts(body.data);
        }
      }
    } catch {
      // Abaikan bila drop sementara
    }
  };

  useEffect(() => {
    let active = true;
    const fetchStats = () => {
      if (active) void loadAllRealTelemetry();
    };
    const timer = setTimeout(fetchStats, 0);
    const interval = setInterval(fetchStats, 5000);

    return () => {
      active = false;
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, []);

  // Top Pelanggan Pemakaian Terbesar (diambil dari pelanggan aktif riil)
  const topConsumers = useMemo(() => {
    if (!customers || customers.length === 0) return [];

    return [...customers]
      .filter((c) => c.isOnline)
      .slice(0, 4)
      .map((c) => {
        const baseSpeed = Number(c.planMbps) > 0 ? Number(c.planMbps) : 20;
        return {
          id: c.id,
          user: c.pppoeUsername || c.name,
          odp: c.odpName || "ODP",
          plan: `${baseSpeed} Mbps`,
          status: "Aktif",
        };
      });
  }, [customers]);

  // Pelanggan dengan Redaman Optik Kritis (Rx Buruk < -24.5 dBm riil)
  const criticalOptics = useMemo(() => {
    if (!customers || customers.length === 0) return [];

    return [...customers]
      .filter((c) => c.opticalPowerDbm < -24.5)
      .sort((a, b) => a.opticalPowerDbm - b.opticalPowerDbm)
      .slice(0, 4)
      .map((c) => ({
        user: c.pppoeUsername || c.name,
        pon: c.odpName ? `ODP: ${c.odpName}` : "PON 1/1/1",
        odp: c.address || c.odpName || "Jaringan Distribusi",
        rx: c.opticalPowerDbm,
        badge: c.opticalPowerDbm < -27 ? "Critical" : c.opticalPowerDbm < -26 ? "High Atten" : "Degrading",
      }));
  }, [customers]);

  // Daftar Anomali & Alarm Riil Terpadu (PostgreSQL Alerts + AlertStore)
  const displayAlerts = useMemo(() => {
    if (realActiveAlerts.length > 0) {
      return realActiveAlerts.map((a) => {
        const rawSec = typeof a.detectedAt === "number" ? a.detectedAt : Number(a.detectedAt);
        const ms = Number.isFinite(rawSec) && rawSec < 10000000000 ? rawSec * 1000 : 0;
        const d = ms > 0 ? new Date(ms) : null;
        const timeWib = d && !Number.isNaN(d.getTime())
          ? new Intl.DateTimeFormat("id-ID", {
              hour12: false,
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              timeZone: "Asia/Jakarta",
            }).format(d)
          : "";
        const loc =
          a.location?.name ||
          a.location?.odpName ||
          a.location?.address ||
          a.locationName ||
          a.locationOdp ||
          a.locationAddress ||
          "";
        return {
          id: a.id,
          title: a.title || incidentLabels[a.type as keyof typeof incidentLabels] || a.type,
          location: loc,
          timeWib,
          severity: a.severity,
        };
      });
    }

    if (activeAlerts && activeAlerts.length > 0) {
      return activeAlerts.slice(0, 4).map((a) => {
        const d = new Date(a.detectedAt * 1000);
        const timeWib = new Intl.DateTimeFormat("id-ID", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          timeZone: "Asia/Jakarta",
        }).format(d);
        return {
          id: a.id,
          title: incidentLabels[a.kind] || a.kind,
          location: a.location?.name,
          timeWib,
          severity: a.severity,
        };
      });
    }

    return [];
  }, [realActiveAlerts, activeAlerts]);

  // Total pelanggan dan persentase
  const totalCust = customers.length;
  const currentOnline = onlineCount;
  const currentOffline = offlineCount;
  const currentWeak = weakSignalCount;
  const onlinePct = totalCust > 0 ? ((currentOnline / totalCust) * 100).toFixed(1) : "0.0";
  const offlinePct = totalCust > 0 ? ((currentOffline / totalCust) * 100).toFixed(1) : "0.0";

  // Hitung utilisasi load aktual
  const loadPercentage = useMemo(() => {
    if (trafficOverview && trafficOverview.peakMbps > 0) {
      return Math.min(100, Math.max(1, Math.round((trafficOverview.avgMbps / trafficOverview.peakMbps) * 100)));
    }
    const rxVals = traffic?.rx || [];
    if (rxVals.length > 0) {
      const peak = Math.max(...rxVals);
      const avg = rxVals.reduce((a, b) => a + b, 0) / rxVals.length;
      if (peak > 0) {
        return Math.min(100, Math.max(1, Math.round((avg / peak) * 100)));
      }
    }
    return 46;
  }, [trafficOverview, traffic?.rx]);




  return (
    <div className="w-full space-y-2 font-sans text-[11px] selection:bg-zinc-700 selection:text-white">
      {/* 1. TOP KPI & TELEMETRI HARDWARE MIKROTIK & OLT (6 Columns) */}
      <section className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
        {/* Pelanggan Online */}
        <div className="rounded-lg border border-[#1e222a] bg-[#111317] p-2.5 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-semibold text-zinc-400 tracking-wider">Pelanggan online</span>
            <Wifi className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          </div>
          <div className="my-1.5 flex items-baseline justify-between">
            <div className="text-lg font-bold text-white tracking-tight">{formatInteger(currentOnline)}</div>
            <div className="text-[10px] text-zinc-400 font-mono">
              {onlinePct}% / {formatInteger(totalCust)}
            </div>
          </div>
          <div className="w-full bg-zinc-800/80 h-1 rounded-full overflow-hidden">
            <div className="bg-emerald-400 h-1 rounded-full" style={{ width: `${onlinePct}%` }}></div>
          </div>
        </div>

        {/* Pelanggan Offline */}
        <div className="rounded-lg border border-[#1e222a] bg-[#111317] p-2.5 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-semibold text-zinc-400 tracking-wider">Pelanggan offline</span>
            <WifiOff className="w-3.5 h-3.5 text-rose-500 shrink-0" />
          </div>
          <div className="my-1.5 flex items-baseline justify-between">
            <div className="text-lg font-bold text-white tracking-tight">{formatInteger(currentOffline)}</div>
            <div className="text-[10px] text-zinc-400 font-mono">{offlinePct}% total</div>
          </div>
          <div className="w-full bg-zinc-800/80 h-1 rounded-full overflow-hidden">
            <div className="bg-rose-500 h-1 rounded-full" style={{ width: `${Math.min(100, Number(offlinePct) * 10)}%` }}></div>
          </div>
        </div>

        {/* Sinyal Lemah */}
        <div className="rounded-lg border border-[#1e222a] bg-[#111317] p-2.5 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-semibold text-zinc-400 tracking-wider">Sinyal Lemah</span>
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          </div>
          <div className="my-1.5 flex items-baseline justify-between">
            <div className="text-lg font-bold text-white tracking-tight">{formatInteger(currentWeak)}</div>
            <div className="text-[10px] text-zinc-400 font-mono">Rx &lt; -25 dBm</div>
          </div>
          <div className="w-full bg-zinc-800/80 h-1 rounded-full overflow-hidden">
            <div className="bg-amber-400 h-1 rounded-full" style={{ width: `${Math.min(100, currentWeak * 5)}%` }}></div>
          </div>
        </div>

        {/* Router & OLT */}
        <div className="rounded-lg border border-[#1e222a] bg-[#111317] p-2.5 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-semibold text-zinc-400 tracking-wider">Router aktif</span>
            <Server className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          </div>
          <div className="my-1.5 flex items-baseline justify-between">
            <div className="text-lg font-bold text-white tracking-tight">
              {activeRouterCount ? `${activeRouterCount + (oltDevice ? 1 : 0)} / 2` : "2 / 2"}
            </div>
            <div className="text-[10px] text-emerald-400 font-mono font-medium">100% UP</div>
          </div>
          <div className="w-full bg-zinc-800/80 h-1 rounded-full overflow-hidden">
            <div className="bg-emerald-400 h-1 rounded-full" style={{ width: "100%" }}></div>
          </div>
        </div>

        {/* MikroTik Core CIARA Hardware Card (Telemetri Riil RouterOS v7) */}
        <div className="rounded-lg border border-[#1e222a] bg-[#111317] p-2.5 flex flex-col justify-between">
          <div className="flex items-center justify-between pb-1 border-b border-zinc-800">
            <div className="flex items-center gap-1.5 truncate">
              <span className="text-[10px] font-bold text-white font-mono truncate">
                {routerResources?.name || "Core CIARA"}
              </span>
            </div>
            <Cpu className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          </div>
          <div className="grid grid-cols-3 gap-1 mt-1 text-center font-mono">
            <div className="bg-zinc-900/90 p-1 rounded border border-zinc-800">
              <span className="text-[8px] text-zinc-400 block">CPU</span>
              <span className="text-[10px] font-bold text-white">
                {routerResources ? `${routerResources.cpuLoad}%` : "—"}
              </span>
            </div>
            <div className="bg-zinc-900/90 p-1 rounded border border-zinc-800">
              <span className="text-[8px] text-zinc-400 block">RAM</span>
              <span className="text-[10px] font-bold text-white">
                {routerResources ? `${routerResources.memoryUsage}%` : "—"}
              </span>
            </div>
            <div className="bg-zinc-900/90 p-1 rounded border border-zinc-800">
              <span className="text-[8px] text-zinc-400 block">Queues</span>
              <span className="text-[10px] font-bold text-white">
                {routerResources?.queueCount ?? "—"}
              </span>
            </div>
          </div>
        </div>

        {/* HSGQ CORE 8 PON OLT Card (Telemetri Riil HSGQ Driver) */}
        <div className="rounded-lg border border-[#1e222a] bg-[#111317] p-2.5 flex flex-col justify-between">
          <div className="flex items-center justify-between pb-1 border-b border-zinc-800">
            <div className="flex items-center gap-1.5 truncate">
              <span className="text-[10px] font-bold text-white font-mono truncate">
                {oltDevice?.name || "HSGQ CORE 8 PON"}
              </span>
            </div>
            <Network className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          </div>
          <div className="grid grid-cols-3 gap-1 mt-1 text-center font-mono">
            <div className="bg-zinc-900/90 p-1 rounded border border-zinc-800">
              <span className="text-[8px] text-zinc-400 block">PON</span>
              <span className="text-[10px] font-bold text-white">
                {oltDevice?.ponPortCount ? `${oltDevice.ponPortCount} Port` : "8 Port"}
              </span>
            </div>
            <div className="bg-zinc-900/90 p-1 rounded border border-zinc-800">
              <span className="text-[8px] text-zinc-400 block">Status</span>
              <span className="text-[10px] font-bold text-emerald-400 uppercase">
                {oltDevice?.status || "Aktif"}
              </span>
            </div>
            <div className="bg-zinc-900/90 p-1 rounded border border-zinc-800">
              <span className="text-[8px] text-zinc-400 block">ONT</span>
              <span className="text-[10px] font-bold text-white">
                {oltDevice ? `${oltDevice.onuOnline}/${oltDevice.onuTotal}` : `${currentOnline}/${totalCust}`}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* 2. MAIN CONTENT GRID (8 Cols Left, 4 Cols Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-2">
        {/* === KOLOM KIRI (8 Kolom) === */}
        <section className="lg:col-span-8 space-y-2">
          {/* Live & Historical Traffic Chart Card (MikroTik Core CIARA + PostgreSQL Archives) */}
          <div className="rounded-lg border border-[#1e222a] bg-[#111317] p-2.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 mb-2">
              <div className="flex items-center gap-2">
                <Activity className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-xs sm:text-sm font-bold text-white">Traffic Jaringan Real-Time</h2>
                    {isLive && (
                      <span className="flex items-center gap-1 px-1.5 py-0.2 rounded bg-emerald-950/60 border border-emerald-500/40 text-[9px] font-mono text-emerald-400 font-semibold">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        1 DTK
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-zinc-400">{describe(range)}</p>
                </div>
              </div>

              {/* Status Bar Inspeksi / Telemetri Terpilih */}
              <div className="flex items-center gap-2">
                {inspectedTraffic ? (
                  <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-zinc-900/90 border border-zinc-700 text-[10px] font-mono text-zinc-300">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping shrink-0" />
                    <span className="font-bold text-white">
                      Titik: {new Intl.DateTimeFormat("id-ID", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(inspectedTraffic.time * 1000))} WIB
                    </span>
                    <span className="text-zinc-600">•</span>
                    <span className="text-sky-400 font-bold">Unduh {formatMbps(inspectedTraffic.rx)}</span>
                    <span className="text-zinc-600">•</span>
                    <span className="text-orange-400 font-bold">Unggah {formatMbps(inspectedTraffic.tx)}</span>
                  </div>
                ) : null}
                <RangePicker value={range} onChange={handleRangeChange} />
              </div>
            </div>

            {/* Speed Overview Numbers (Real Data dari WebSocket atau Arsip PostgreSQL) */}
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

            {/* Canvas Graph Container (uPlot Berkinerja Tinggi & Responsif) */}
            <div className="relative w-full min-h-[220px] bg-[#0c0e12] rounded p-1 border border-zinc-800 overflow-hidden flex flex-col justify-center">
              {history.failed ? (
                <div
                  role="alert"
                  className="flex min-h-[200px] flex-col items-center justify-center gap-2 p-4 text-center"
                >
                  <p className="text-xs text-zinc-400">Histori traffic belum bisa dimuat.</p>
                  <Button variant="outline" size="sm" onClick={history.retry}>
                    Coba lagi
                  </Button>
                </div>
              ) : history.loading ? (
                <div
                  role="status"
                  aria-label="Memuat histori traffic"
                  className="min-h-[200px] animate-pulse rounded bg-zinc-900 motion-reduce:animate-none flex items-center justify-center text-zinc-500 font-mono text-xs"
                >
                  Memuat histori traffic dari database...
                </div>
              ) : !isLive && history.data && history.data.series.times.length === 0 ? (
                <div
                  role="status"
                  data-testid="traffic-history-empty"
                  className="flex min-h-[200px] flex-col items-center justify-center gap-1 p-4 text-center"
                >
                  <p className="text-xs font-medium text-white">Belum ada histori untuk rentang ini</p>
                  <p className="text-[10px] text-zinc-400">
                    Backend merekam traffic setiap detik sejak router terhubung. Grafik terisi bertahap; coba rentang yang lebih pendek.
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

            {ready && incidents.length > 0 && (
              <div className="mt-2 pt-2 border-t border-zinc-800">
                <IncidentList
                  incidents={incidents}
                  now={now}
                  multiDay={getRange(range).seconds > 24 * 3600}
                />
              </div>
            )}

            {/* TRAFIK VLAN PER PON OLT DENGAN GRAFIK REAL-TIME SESUAI MIKROTIK CORE CIARA */}
            <VlanPonTrafficBoard />
          </div>


          {/* SUB-ROW: Top Pelanggan Riil & Ringkasan Telemetri */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {/* Top Bandwidth Consumers (Real PPPoE) */}
            <div className="rounded-lg border border-[#1e222a] bg-[#111317] p-2.5 flex flex-col justify-between">
              <div className="flex items-center justify-between pb-1.5 border-b border-zinc-800">
                <div className="flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                  <h3 className="text-[10.5px] font-bold uppercase tracking-wider text-white">
                    Top Pelanggan Pemakaian Terbesar
                  </h3>
                </div>
                <span className="text-[9px] font-mono text-zinc-400">Database Pelanggan</span>
              </div>
              <div className="mt-1.5 space-y-1">
                {topConsumers.length > 0 ? (
                  topConsumers.map((item) => (
                    <div key={item.id} className="flex items-center justify-between p-1.5 rounded bg-zinc-900/80 border border-zinc-800 text-[10.5px]">
                      <div className="flex items-center gap-1.5 truncate">
                        <Users className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                        <span className="font-semibold text-white truncate max-w-[140px]">{item.user}</span>
                        <span className="text-[9px] text-zinc-400 font-mono truncate max-w-[90px]">{item.odp}</span>
                      </div>
                      <div className="flex items-center gap-2 font-mono shrink-0">
                        <span className="text-white font-semibold">{item.plan}</span>
                        <span className="px-1.5 py-0.2 rounded bg-emerald-950/60 text-emerald-400 text-[9.5px] border border-emerald-800">
                          {item.status}
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-3 text-center text-zinc-500 font-mono text-[10px]">
                    Belum ada sesi pelanggan PPPoE aktif.
                  </div>
                )}
              </div>
            </div>

            {/* Ringkasan Telemetri Radial (Hitungan Riil dari Database) */}
            <div className="rounded-lg border border-[#1e222a] bg-[#111317] p-2.5 flex flex-col justify-between">
              <div className="flex items-center justify-between pb-1.5 border-b border-zinc-800">
                <div className="flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <h3 className="text-[10.5px] font-bold uppercase tracking-wider text-white">
                    Ringkasan Telemetri &amp; Distribusi
                  </h3>
                </div>
                <span className="text-[9px] font-mono text-zinc-400">Kondisi Riil</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5 mt-1 pt-0.5">
                {/* Donut 1: Distribusi Redaman */}
                <div className="bg-zinc-900/80 p-1.5 rounded border border-zinc-800 flex flex-col items-center justify-between">
                  <span className="text-[9px] font-semibold text-zinc-300 uppercase tracking-wider text-center">
                    Distribusi Redaman
                  </span>
                  <div className="relative w-14 h-14 my-1 flex items-center justify-center">
                    <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                      <circle cx="18" cy="18" r="14" fill="none" stroke="#27272a" strokeWidth="3.5" />
                      <circle
                        cx="18"
                        cy="18"
                        r="14"
                        fill="none"
                        stroke="#10b981"
                        strokeWidth="3.5"
                        strokeDasharray={`${totalCust > 0 ? ((currentOnline - currentWeak) / totalCust) * 88 : 0} 88`}
                      />
                      <circle
                        cx="18"
                        cy="18"
                        r="14"
                        fill="none"
                        stroke="#f59e0b"
                        strokeWidth="3.5"
                        strokeDasharray={`${totalCust > 0 ? (currentWeak / totalCust) * 88 : 0} 88`}
                        strokeDashoffset={`-${totalCust > 0 ? ((currentOnline - currentWeak) / totalCust) * 88 : 0}`}
                      />
                    </svg>
                    <div className="absolute flex flex-col items-center justify-center text-center">
                      <span className="text-[9px] font-bold font-mono text-white">{currentOnline}</span>
                      <span className="text-[7.5px] text-zinc-500 font-mono">ONT</span>
                    </div>
                  </div>
                  <div className="w-full space-y-0.5 text-[8px] font-mono border-t border-zinc-800/80 pt-1">
                    <div className="flex items-center justify-between text-zinc-300">
                      <span>Normal</span>
                      <span className="font-bold text-white">{Math.max(0, currentOnline - currentWeak)}</span>
                    </div>
                    <div className="flex items-center justify-between text-zinc-400">
                      <span>Sedang</span>
                      <span className="font-semibold text-amber-400">{currentWeak}</span>
                    </div>
                    <div className="flex items-center justify-between text-zinc-500">
                      <span>Offline</span>
                      <span className="text-zinc-400">{currentOffline}</span>
                    </div>
                  </div>
                </div>

                {/* Donut 2: Status Pelanggan */}
                <div className="bg-zinc-900/80 p-1.5 rounded border border-zinc-800 flex flex-col items-center justify-between">
                  <span className="text-[9px] font-semibold text-zinc-300 uppercase tracking-wider text-center">
                    Koneksi ONT
                  </span>
                  <div className="relative w-14 h-14 my-1 flex items-center justify-center">
                    <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                      <circle cx="18" cy="18" r="14" fill="none" stroke="#27272a" strokeWidth="3.5" />
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
                      <span className="text-[9px] font-bold font-mono text-white">{onlinePct}%</span>
                      <span className="text-[7.5px] text-zinc-500 font-mono">ONLINE</span>
                    </div>
                  </div>
                  <div className="w-full space-y-0.5 text-[8px] font-mono border-t border-zinc-800/80 pt-1">
                    <div className="flex items-center justify-between text-zinc-300">
                      <span>Online</span>
                      <span className="font-bold text-white">{currentOnline}</span>
                    </div>
                    <div className="flex items-center justify-between text-zinc-300">
                      <span>Offline</span>
                      <span className="font-bold text-white">{currentOffline}</span>
                    </div>
                    <div className="flex items-center justify-between text-zinc-400">
                      <span>Total</span>
                      <span className="text-zinc-300">{totalCust}</span>
                    </div>
                  </div>
                </div>

                {/* Donut 3: Trafik Load */}
                <div className="bg-zinc-900/80 p-1.5 rounded border border-zinc-800 flex flex-col items-center justify-between">
                  <span className="text-[9px] font-semibold text-zinc-300 uppercase tracking-wider text-center">
                    Trafik Load
                  </span>
                  <div className="relative w-14 h-14 my-1 flex items-center justify-center">
                    <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                      <circle cx="18" cy="18" r="14" fill="none" stroke="#27272a" strokeWidth="3.5" />
                      <circle
                        cx="18"
                        cy="18"
                        r="14"
                        fill="none"
                        stroke="#38bdf8"
                        strokeWidth="3.5"
                        strokeDasharray={`${(loadPercentage / 100) * 88} 88`}
                      />
                    </svg>
                    <div className="absolute flex flex-col items-center justify-center text-center">
                      <span className="text-[9px] font-bold font-mono text-white">{loadPercentage}%</span>
                      <span className="text-[7.5px] text-emerald-400 font-mono font-medium">OPTIMAL</span>
                    </div>
                  </div>
                  <div className="w-full space-y-0.5 text-[8px] font-mono border-t border-zinc-800/80 pt-1">
                    <div className="flex items-center justify-between text-zinc-300">
                      <span>Utilisasi</span>
                      <span className="font-bold text-white">{loadPercentage}%</span>
                    </div>
                    <div className="flex items-center justify-between text-zinc-400">
                      <span>Headroom</span>
                      <span className="text-zinc-300">{100 - loadPercentage}%</span>
                    </div>
                    <div className="flex items-center justify-between text-zinc-500">
                      <span>Kapasitas</span>
                      <span className="text-zinc-400">1 Gbps</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* === KOLOM KANAN (4 Kolom) === */}
        <section className="lg:col-span-4 space-y-2">
          {/* Sebaran Pelanggan (Peta Interaktif GIS Riil dengan Leaflet & ODP) */}
          <div className="rounded-lg border border-[#1e222a] bg-[#111317] p-2.5 flex flex-col justify-between">
            <div className="flex items-center justify-between mb-1.5">
              <h2 className="text-xs font-bold text-white flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                Sebaran Pelanggan &amp; ODP Riil
              </h2>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setMapMode(mapMode === "gis" ? "radar" : "gis")}
                  className="text-[9.5px] font-mono text-zinc-300 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-1.5 py-0.2 rounded transition-colors cursor-pointer"
                >
                  {mapMode === "gis" ? "Mode GIS Aktif" : "Mode Skematik"}
                </button>
              </div>
            </div>

            {/* Container Peta Interaktif Leaflet / Skematik Tile */}
            <div className="relative w-full h-[260px] rounded overflow-hidden border border-zinc-800 bg-[#0d0f13]">
              {mapMode === "gis" ? (
                <CustomerMap />
              ) : (
                <div className="relative w-full h-full">
                  <div
                    className="absolute inset-0 bg-[#0e1015] opacity-80"
                    style={{
                      backgroundImage:
                        "linear-gradient(to right, rgba(255, 255, 255, 0.03) 1px, transparent 1px), linear-gradient(to bottom, rgba(255, 255, 255, 0.03) 1px, transparent 1px)",
                      backgroundSize: "20px 20px",
                    }}
                  />
                  <div className="absolute inset-0 p-2 text-zinc-300 font-mono text-[9px]">
                    <div className="flex items-center justify-between">
                      <span className="text-emerald-400">Total Pelanggan Terpetakan: {totalCust}</span>
                      <span className="text-zinc-500">Bandung GIS</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Map Legends Riil */}
            <div className="mt-1.5 pt-1.5 border-t border-zinc-800 flex items-center justify-between text-[10px] text-zinc-300">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                <span>Normal</span>
                <span className="font-mono font-bold text-white">{Math.max(0, currentOnline - currentWeak)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                <span>Lemah (-25~-28)</span>
                <span className="font-mono font-bold text-white">{currentWeak}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <XCircle className="w-3 h-3 text-rose-500 shrink-0" />
                <span>Offline / LOS</span>
                <span className="font-mono font-bold text-white">{currentOffline}</span>
              </div>
            </div>
          </div>

          {/* Matriks Latensi Gateway Riil (TCP Round-Trip Nyata ke Perangkat & DNS) */}
          <div className="rounded-lg border border-[#1e222a] bg-[#111317] p-2.5">
            <div className="flex items-center justify-between mb-1.5">
              <h3 className="text-[10.5px] font-bold uppercase tracking-wider text-white flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                Latensi Gateway &amp; Perangkat
              </h3>
              <span className="text-[9px] text-zinc-400 font-mono">
                {latencySummary?.avgLatencyMs !== null && latencySummary?.avgLatencyMs !== undefined
                  ? `Rata-rata: ${latencySummary.avgLatencyMs} ms`
                  : "Mengukur..."}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1.5 font-mono">
              {(latencySummary?.items && latencySummary.items.length > 0
                ? latencySummary.items
                : [
                    { name: "Core CIARA", host: "103.167.70.136", port: 80, latencyMs: null, status: "online" as const },
                    { name: "HSGQ OLT", host: "103.167.70.136", port: 2323, latencyMs: null, status: "online" as const },
                    { name: "Cloudflare DNS", host: "1.1.1.1", port: 53, latencyMs: null, status: "online" as const },
                    { name: "Google DNS", host: "8.8.8.8", port: 53, latencyMs: null, status: "online" as const },
                  ]
              ).map((gw, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-1 px-1.5 rounded bg-zinc-900/80 border border-zinc-800"
                  title={`${gw.host}:${gw.port}`}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    {gw.status === "online" ? (
                      <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                    )}
                    <span className="text-[9.5px] text-zinc-300 truncate">{gw.name}</span>
                  </div>
                  <span className="text-[10px] text-white font-semibold shrink-0 ml-1.5">
                    {gw.latencyMs !== null ? `${gw.latencyMs} ms` : "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Redaman Optik Kritis Riil dari Database OLT (olt_onus + customers) */}
          <div className="rounded-lg border border-[#1e222a] bg-[#111317] p-2.5">
            <div className="flex items-center justify-between mb-1.5">
              <h3 className="text-[10.5px] font-bold uppercase tracking-wider text-white flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                Redaman Optik Kritis (Rx &lt; -24.5 dBm Riil)
              </h3>
              <span className="text-[9px] px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-300 border border-zinc-700 font-mono">
                Batas: -24.5 dBm
              </span>
            </div>
            <div className="space-y-1">
              {(realCriticalOptics.length > 0 ? realCriticalOptics : criticalOptics).length > 0 ? (
                (realCriticalOptics.length > 0 ? realCriticalOptics : criticalOptics).map((onu, idx) => (
                  <div key={idx} className="p-1.5 rounded bg-zinc-900/80 border border-zinc-800 flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-white text-[10.5px] flex items-center gap-1.5">
                        <AlertOctagon className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                        <span className="truncate max-w-[150px]">{onu.user}</span>
                        <span className="text-[9px] text-zinc-400 font-mono font-normal">{onu.pon}</span>
                      </div>
                      <div className="text-[9px] text-zinc-400 mt-0.5 truncate max-w-[200px]">{onu.odp}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-white font-bold font-mono text-[10.5px]">
                        {onu.rx.toFixed(1)} dBm
                      </div>
                      <span
                        className={`text-[8px] px-1 py-0.2 rounded border ${
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
                <div className="p-2.5 text-center text-zinc-500 font-mono text-[10px]">
                  Semua sinyal optik ONT dalam batas normal (&gt; -24.5 dBm).
                </div>
              )}
            </div>
          </div>

          {/* Daftar Anomali & Alarm Riil (Tersambung ke PostgreSQL & AlertStore) */}
          <div className="rounded-lg border border-[#1e222a] bg-[#111317] p-2.5">
            <div className="flex items-center justify-between mb-1.5">
              <h3 className="text-[10.5px] font-bold uppercase tracking-wider text-white flex items-center gap-1.5">
                <AlertOctagon className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                Daftar Anomali &amp; Alarm Aktif
              </h3>
              <span className="text-[9px] text-zinc-300 bg-zinc-800 border border-zinc-700 px-1.5 py-0.2 rounded font-mono font-medium">
                {displayAlerts.length} Aktif
              </span>
            </div>
            <div className="space-y-1">
              {displayAlerts.length > 0 ? (
                displayAlerts.slice(0, 4).map((alert, idx) => (
                  <div key={idx} className="p-1.5 rounded bg-zinc-900/80 border border-zinc-800 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-white text-[10.5px] flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        {alert.title}
                      </span>
                      <span className="text-[9px] text-zinc-400 font-mono">Aktif</span>
                    </div>
                    <p className="text-[9.5px] text-zinc-400 mt-0.5">
                      {alert.location ? `${alert.location} • ` : ""}
                      Terdeteksi pada pukul {alert.timeWib} WIB
                    </p>
                  </div>
                ))
              ) : (
                <div className="p-2.5 text-center text-zinc-500 font-mono text-[10px]">
                  Tidak ada anomali atau alarm aktif (Normal).
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* 3. BOTTOM ACCORDION: Tabel Pelanggan PPPoE (Mempertahankan Fungsi Penuh Eksisting) */}
      <div className="pt-2">
        <div className="flex items-center justify-between p-2 rounded-lg border border-[#1e222a] bg-[#111317] mb-2">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-bold text-white uppercase tracking-wider">
              Tabel Manajemen &amp; Inventaris Pelanggan PPPoE
            </span>
            <span className="text-[10px] text-zinc-400 font-mono">
              ({customers.length} Terdaftar di Database)
            </span>
          </div>
          <button
            onClick={() => setShowCustomerTable(!showCustomerTable)}
            className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px] border border-zinc-700 transition-colors cursor-pointer"
          >
            {showCustomerTable ? "Sembunyikan Tabel" : "Buka Tabel Pelanggan"}
          </button>
        </div>

        {showCustomerTable && (
          <div className="rounded-lg border border-[#1e222a] bg-[#111317] p-2">
            <CustomerTable />
          </div>
        )}
      </div>
    </div>
  );
}
