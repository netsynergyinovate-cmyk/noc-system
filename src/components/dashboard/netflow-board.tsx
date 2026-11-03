"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Activity,
  ArrowDownUp,
  Download,
  Filter,
  Radio,
  RefreshCw,
  Search,
  Server,
  Users,
} from "lucide-react";
import { CustomerLiveCapturePanel } from "./customer-live-capture-panel";
import { TrafficEmptyState } from "@/components/dashboard/traffic-empty-state";
import {
  formatBandwidthRate,
  formatDataVolume,
  formatPacketCount,
  formatTrafficDuration,
} from "@/lib/dashboard/traffic-format-helpers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatAlertTime } from "@/lib/dashboard/alerts";
import { formatInteger } from "@/lib/dashboard/format";
import { mockRouters } from "@/lib/dashboard/mock-data";
import { NetflowTrendChart } from "@/components/dashboard/netflow-trend-chart";
import { backendGet } from "@/lib/dashboard/backend-api";
import { useSession } from "@/components/session-provider";
import { selectPreviewEnabled } from "@/lib/session-store";
import { useDashboardStore } from "@/lib/dashboard/store";
import {
  buildCustomerFupUsage,
  buildNetflowTimeSeries,
  defaultFlowFilter,
  exportFlowsToCsv,
  exportFupToCsv,
  filterFlows,
  flowPonPort,
  getMockExporters,
  getTopTalkers,
  loadNetflow,
  mapGoExporterToView,
  resolveCustomerForIp,
  summarizeDirectionalNetflow,
  summarizeNetflow,
  type FlowFilter,
  type FlowProtocol,
  type FlowRange,
  type GoCustomerUsageRecord,
  type GoExporterStatus,
  type GoSummaryData,
  type GoTopTalkerRecord,
  type ReceiverHealth,
  type NetflowDirectionalSummary,
  type NetflowRecord,
  type TopTalker,
  type CustomerFupUsage,
  type FupStatus,
} from "@/lib/dashboard/netflow";
import {
  evaluateFlowAnomaly,
  sortFlows,
  type FlowSortOption,
} from "@/lib/dashboard/netflow-filter-sort";
import { NetflowDetailDialog } from "@/components/dashboard/netflow-detail-dialog";
import { usePolled } from "@/lib/dashboard/use-polled";

const REFRESH_MS = 30_000;
const ranges: { value: FlowRange; label: string }[] = [
  { value: "1h", label: "1 Jam" },
  { value: "6h", label: "6 Jam" },
  { value: "24h", label: "24 Jam" },
  { value: "7d", label: "7 Hari" },
];
const protocols: FlowProtocol[] = ["TCP", "UDP", "ICMP"];
const ponPorts = ["PON-1", "PON-2", "PON-3", "PON-4", "PON-5", "PON-6", "PON-7", "PON-8"];

const sortOptions: { value: string; label: string; sort: FlowSortOption }[] = [
  { value: "bytes-desc", label: "Ukuran Data (Terbesar)", sort: { field: "bytes", direction: "desc" } },
  { value: "bytes-asc", label: "Ukuran Data (Terkecil)", sort: { field: "bytes", direction: "asc" } },
  { value: "packets-desc", label: "Paket (Terbanyak)", sort: { field: "packets", direction: "desc" } },
  { value: "throughput-desc", label: "Laju Throughput (Tertinggi)", sort: { field: "throughput", direction: "desc" } },
  { value: "duration-desc", label: "Durasi (Terlama)", sort: { field: "duration", direction: "desc" } },
  { value: "startedAt-desc", label: "Waktu Terbaru", sort: { field: "startedAt", direction: "desc" } },
];

const selectClass =
  "h-9 rounded-md border bg-background px-2.5 text-xs sm:text-sm focus-visible:outline-2 focus-visible:outline-ring";

type NetflowTab = "ringkasan" | "sesi" | "fup" | "exporter" | "capture";

function Kpi({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card className="shadow-xs">
      <CardHeader className="pb-1 text-xs font-medium text-muted-foreground">
        {label}
      </CardHeader>
      <CardContent className="space-y-0.5">
        <div className="text-xl sm:text-2xl font-bold tracking-tight tabular-nums">
          {value}
        </div>
        {sub && (
          <p className="text-[11px] text-muted-foreground truncate">{sub}</p>
        )}
      </CardContent>
    </Card>
  );
}

export function NetflowBoard() {
  const isDemoMode = useSession(selectPreviewEnabled);
  const storeRouters = useDashboardStore((state) => state.routers);
  const storeCustomers = useDashboardStore((state) => state.customers);
  const [selectedCaptureCustomer, setSelectedCaptureCustomer] = useState<{ id: string; name: string; pppoeUsername: string } | null>(null);
  const routersList = isDemoMode || storeRouters.length === 0 ? mockRouters : storeRouters;

  const loadFn = useCallback((now: number) => loadNetflow(now, isDemoMode), [isDemoMode]);
  const { state, failed, retry } = usePolled(loadFn, REFRESH_MS);
  const [filter, setFilter] = useState<FlowFilter>(defaultFlowFilter);
  const [sortValue, setSortValue] = useState(sortOptions[0].value);
  const [selected, setSelected] = useState<NetflowRecord | null>(null);
  const [activeTab, setActiveTab] = useState<NetflowTab>("ringkasan");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [goSummary, setGoSummary] = useState<GoSummaryData | null>(null);
  const [goTopTalkers, setGoTopTalkers] = useState<GoTopTalkerRecord[] | null>(null);
  const [goCustomerUsage, setGoCustomerUsage] = useState<GoCustomerUsageRecord[] | null>(null);
  const [goExporters, setGoExporters] = useState<GoExporterStatus[] | null>(null);
  const [goHealth, setGoHealth] = useState<ReceiverHealth | null>(null);
  const searchParams = useSearchParams();
  const linkedAlertId = searchParams.get("alertId");
  const linkedFrom = searchParams.get("from");

  useEffect(() => {
    const rId = searchParams.get("routerId");
    if (rId) setFilter((cur) => ({ ...cur, routerId: rId }));
  }, [searchParams]);
  useEffect(() => {
    let cancelled = false;
    const fetchGoData = () => {
      const params: Record<string, string | number> = { range: filter.range };
      if (filter.routerId) params.router_id = filter.routerId;

      Promise.allSettled([
        backendGet<GoSummaryData>("/api/v1/netflow/summary", params),
        backendGet<GoTopTalkerRecord[]>("/api/v1/netflow/top-talkers", { ...params, limit: 10 }),
        backendGet<GoCustomerUsageRecord[]>("/api/v1/netflow/customers/usage", { range: "30d", limit: 50 }),
        backendGet<GoExporterStatus[]>("/api/v1/netflow/exporters"),
        backendGet<ReceiverHealth>("/api/v1/netflow/status"),
      ])
        .then(([resSum, resTalkers, resUsage, resExp, resHealth]) => {
          if (cancelled) return;
          if (resSum.status === "fulfilled" && resSum.value) setGoSummary(resSum.value);
          if (resTalkers.status === "fulfilled" && Array.isArray(resTalkers.value))
            setGoTopTalkers(resTalkers.value);
          if (resUsage.status === "fulfilled" && Array.isArray(resUsage.value))
            setGoCustomerUsage(resUsage.value);
          if (resExp.status === "fulfilled" && Array.isArray(resExp.value))
            setGoExporters(resExp.value);
          if (resHealth.status === "fulfilled" && resHealth.value)
            setGoHealth(resHealth.value);
        })
        .catch(() => {});
    };

    fetchGoData();
    const timer = setInterval(fetchGoData, REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [filter.range, filter.routerId]);
  const set = (patch: Partial<FlowFilter>) =>
    setFilter((current) => ({ ...current, ...patch }));

  const sort = (sortOptions.find((o) => o.value === sortValue) ?? sortOptions[0]).sort;

  const hasActiveFilter =
    filter.routerId !== null ||
    filter.protocol !== null ||
    filter.query !== "" ||
    filter.clientIp !== "" ||
    filter.dstPort !== "" ||
    Boolean(filter.ponPort);

  const view = useMemo(() => {
    if (!state) return null;
    const flows = filterFlows(state.data, filter, state.now);
    const sorted = sortFlows(flows, sort.field, sort.direction);
    return {
      summary: summarizeNetflow(flows, filter.range),
      directional: goSummary
        ? {
            rxBytes: goSummary.rxBytes,
            txBytes: goSummary.txBytes,
            rxBps: goSummary.rxBps,
            txBps: goSummary.txBps,
            totalBytes: goSummary.totalBytes,
            totalBps: goSummary.totalBps,
            uplinkCapacityBps: goSummary.uplinkCapacityBps,
            uplinkUsagePercent: goSummary.uplinkUsagePercent,
            uplinkRemainingBps: goSummary.uplinkRemainingBps,
            busyInterface: goSummary.busyInterfaceName
              ? {
                  name: goSummary.busyInterfaceName,
                  routerName: goSummary.busyRouterName ?? "Router",
                  bps: goSummary.busyThroughputBps ?? 0,
                }
              : null,
          }
        : isDemoMode
        ? summarizeDirectionalNetflow(flows, filter.range)
        : {
            rxBytes: 0,
            txBytes: 0,
            rxBps: 0,
            txBps: 0,
            totalBytes: 0,
            totalBps: 0,
            uplinkCapacityBps: null,
            uplinkUsagePercent: null,
            uplinkRemainingBps: null,
            busyInterface: null,
          },
      top: sorted.slice(0, 30),
      allFlows: sorted,
      count: flows.length,
      trend: buildNetflowTimeSeries(flows, filter.range, state.now),
      topTalkers:
        goTopTalkers && goTopTalkers.length > 0
          ? goTopTalkers.map((t) => ({
              ip: t.ip,
              customer: t.customerId
                ? {
                    id: t.customerId,
                    name: t.customerName ?? "Pelanggan",
                    pppoeUsername: t.pppoeUsername ?? "",
                    planMbps: t.planMbps ?? undefined,
                    odpName: t.odpName ?? undefined,
                  }
                : null,
              bytes: t.totalBytes,
              packets: t.packets,
              throughputBps: t.throughputBps,
              topApp: t.topProtocol,
              flowCount: t.flows,
            }))
          : isDemoMode
          ? getTopTalkers(flows, 10)
          : [],
      customerFup:
        goCustomerUsage && goCustomerUsage.length > 0
          ? goCustomerUsage.map((u) => {
              const statusVal: FupStatus =
                u.status === "exceeded" || u.status === "warning" || u.status === "normal"
                  ? u.status
                  : "untracked";
              return {
                customerId: u.customerId,
                customerName: u.customerName,
                pppoeUsername: u.pppoeUsername,
                planMbps: u.planMbps,
                odpName: u.odpName ?? "-",
                rxBytes: u.rxBytes,
                txBytes: u.txBytes,
                totalBytes: u.totalBytes,
                peakThroughputBps: u.peakThroughputBps,
                peakTime: u.peakTime,
                fupLimitBytes: u.fupLimitBytes,
                fupPercent: u.fupUsagePercent,
                status: statusVal,
                flowCount: u.flows,
              };
            })
          : isDemoMode
          ? buildCustomerFupUsage(flows)
          : [],
      exporters:
        goExporters && goExporters.length > 0
          ? goExporters.map((e) => mapGoExporterToView(e, routersList, state.now * 1000))
          : isDemoMode
          ? getMockExporters(flows)
          : [],
    };
  }, [state, filter, sort, goSummary, goTopTalkers, goCustomerUsage, goExporters, isDemoMode, routersList]);

  const filteredFupList = useMemo(() => {
    if (!view) return [];
    if (!customerSearch.trim()) return view.customerFup;
    const q = customerSearch.trim().toLowerCase();
    return view.customerFup.filter(
      (c) =>
        c.customerName.toLowerCase().includes(q) ||
        c.pppoeUsername.toLowerCase().includes(q) ||
        c.odpName.toLowerCase().includes(q),
    );
  }, [view, customerSearch]);

  const downloadSessionCsv = () => {
    if (!view) return;
    const csv = exportFlowsToCsv(view.allFlows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `netflow-sesi-${filter.range}-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadFupCsv = () => {
    if (!view) return;
    const csv = exportFupToCsv(view.customerFup);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rekap-fup-pelanggan-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Top Banner Notice & Receiver Status */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        {isDemoMode && (
          <Badge
            variant="outline"
            className="h-auto w-fit gap-1.5 whitespace-normal py-1 text-xs font-normal border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300"
            data-testid="netflow-mock-badge"
          >
            Data Tiruan NetFlow (Fase 2) · Wajib beralih ke Kolektor UDP 2055 nyata di Fase 5
          </Badge>
        )}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            className={`inline-flex size-2 rounded-full ${
              goHealth?.active ? "bg-emerald-500" : "bg-amber-500"
            }`}
          />
          <span>
            {goHealth?.active
              ? `Penerima UDP 2055 Aktif (v5, v9, IPFIX) · ${formatInteger(goHealth.totalPackets)} Paket`
              : "Penerima UDP 2055 Belum Terhubung / Mode Demo"}
          </span>
        </div>
      </div>

      {/* PRD §3.4 Fase 4: Banner Bukti Trafik Alert dengan Tautan Dua Arah */}
      {linkedAlertId && (
        <Card className="border-primary/40 bg-primary/5 p-3 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground">
                Bukti Trafik Jam Kejadian (Alert #{linkedAlertId.slice(0, 8)})
              </span>
              {linkedFrom && (
                <span className="text-muted-foreground">
                  · Sekitar {new Date(Number(linkedFrom) * 1000).toLocaleTimeString("id-ID")}
                </span>
              )}
            </div>
            <Button asChild variant="outline" size="sm" className="h-7 gap-1 text-xs font-medium">
              <Link href="/app/alert">
                <span>Kembali ke Alert</span>
                <span aria-hidden="true">&rarr;</span>
              </Link>
            </Button>
          </div>
        </Card>
      )}

      {failed && (
        <Card className="border-destructive/50 bg-destructive/10 p-3">
          <div className="flex items-center justify-between text-sm text-destructive" role="alert">
            <span>
              Gagal memuat NetFlow. Nilai metrik ditampilkan sebagai &quot;tidak dapat dibaca&quot;.
            </span>
            <button
              type="button"
              className="inline-flex items-center gap-1 font-medium underline hover:text-destructive/80"
              onClick={retry}
            >
              <RefreshCw className="size-3.5" />
              Coba lagi
            </button>
          </div>
        </Card>
      )}

      {/* Streamlined Modern Filter Bar */}
      <Card className="p-3 shadow-2xs">
        <form
          className="flex flex-col gap-2.5"
          onSubmit={(e) => e.preventDefault()}
          aria-label="Saring flow"
        >
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Single Smart Search Bar */}
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                className="h-9 w-full rounded-md border bg-background pl-8.5 pr-2.5 text-xs sm:text-sm focus-visible:outline-2 focus-visible:outline-ring"
                placeholder="Cari IP pelanggan, port, aplikasi (mis. YouTube, 443)..."
                value={filter.query}
                onChange={(e) => set({ query: e.target.value })}
              />
            </div>

            {/* Time Window Buttons */}
            <div
              role="group"
              aria-label="Rentang Waktu"
              className="inline-flex h-9 overflow-hidden rounded-md border bg-muted/40 p-0.5"
            >
              {ranges.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  aria-pressed={filter.range === r.value}
                  onClick={() => set({ range: r.value })}
                  className="rounded-sm px-2.5 text-xs font-medium transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-xs"
                >
                  {r.label}
                </button>
              ))}
            </div>

            {/* Router Select */}
            <select
              className={selectClass}
              value={filter.routerId ?? ""}
              onChange={(e) => set({ routerId: e.target.value || null })}
              aria-label="Saring menurut Router"
            >
              <option value="">Semua router</option>
              {routersList.map((r: { id: string; name: string }) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>

            {/* Protocol Select */}
            <select
              className={selectClass}
              value={filter.protocol ?? ""}
              onChange={(e) =>
                set({ protocol: (e.target.value || null) as FlowProtocol | null })
              }
              aria-label="Saring menurut Protokol"
            >
              <option value="">Semua protokol</option>
              {protocols.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>

            {/* Sort Select */}
            <select
              className={selectClass}
              data-testid="netflow-sort-select"
              value={sortValue}
              onChange={(e) => setSortValue(e.target.value)}
              aria-label="Urutkan aliran trafik"
            >
              {sortOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>

            {/* Advanced Filters Toggle */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 text-xs"
              onClick={() => setShowAdvanced((v) => !v)}
            >
              <Filter className="size-3.5" />
              <span>Filter Lanjut</span>
            </Button>

            {/* Reset Filter Button */}
            {hasActiveFilter && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 text-xs text-muted-foreground hover:text-foreground"
                onClick={() =>
                  setFilter((current) => ({
                    ...defaultFlowFilter,
                    range: current.range,
                  }))
                }
              >
                Reset
              </Button>
            )}
          </div>

          {/* Advanced Collapsible Row: PON Port, Client IP, Destination Port */}
          {showAdvanced && (
            <div className="flex flex-wrap items-center gap-2.5 border-t pt-2.5 text-xs">
              <label className="flex items-center gap-1.5">
                <span className="text-muted-foreground">Port PON:</span>
                <select
                  className={selectClass}
                  value={filter.ponPort ?? ""}
                  onChange={(e) => set({ ponPort: e.target.value || null })}
                >
                  <option value="">Semua PON</option>
                  {ponPorts.map((pon) => (
                    <option key={pon} value={pon}>
                      {pon}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex items-center gap-1.5">
                <span className="text-muted-foreground">IP Pelanggan:</span>
                <input
                  type="text"
                  className={selectClass}
                  placeholder="Mis. 10.10.x.x"
                  aria-label="IP Pelanggan atau IP Asal"
                  autoComplete="off"
                  value={filter.clientIp}
                  onChange={(e) => set({ clientIp: e.target.value })}
                />
              </label>

              <label className="flex items-center gap-1.5">
                <span className="text-muted-foreground">Port Tujuan:</span>
                <input
                  type="text"
                  inputMode="numeric"
                  className={selectClass}
                  placeholder="Mis. 443, 80, 53"
                  aria-label="Port Tujuan"
                  autoComplete="off"
                  value={filter.dstPort}
                  onChange={(e) => set({ dstPort: e.target.value })}
                />
              </label>
            </div>
          )}
        </form>
      </Card>

      {/* Tabs Navigation */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as NetflowTab)}
        className="w-full gap-4"
      >
        <TabsList className="grid w-full grid-cols-2 gap-1 sm:grid-cols-5 sm:w-auto h-auto p-1 bg-muted/60">
          <TabsTrigger value="ringkasan" className="flex items-center gap-1.5 py-1.5 text-xs sm:text-sm">
            <Activity className="size-4" />
            <span>Ringkasan & Tren</span>
          </TabsTrigger>
          <TabsTrigger value="sesi" className="flex items-center gap-1.5 py-1.5 text-xs sm:text-sm">
            <ArrowDownUp className="size-4" />
            <span>Sesi & Percakapan</span>
          </TabsTrigger>
          <TabsTrigger value="fup" className="flex items-center gap-1.5 py-1.5 text-xs sm:text-sm">
            <Users className="size-4" />
            <span>Pemakaian Pelanggan (FUP)</span>
          </TabsTrigger>
          <TabsTrigger value="capture" className="flex items-center gap-1.5 py-1.5 text-xs sm:text-sm">
            <Radio className="size-4" />
            <span>Tangkapan Akses (Torch)</span>
          </TabsTrigger>
          <TabsTrigger value="exporter" className="flex items-center gap-1.5 py-1.5 text-xs sm:text-sm">
            <Server className="size-4" />
            <span>Exporter & Kesehatan</span>
          </TabsTrigger>
        </TabsList>

        {!view ? (
          <p className="text-sm text-muted-foreground py-8 text-center" role="status">
            Memuat aliran NetFlow…
          </p>
        ) : state && state.data.length === 0 ? (
          <Card data-testid="netflow-empty-state">
            <CardContent className="py-2">
              <TrafficEmptyState
                variant="no_data"
                title="Belum Ada Data Aliran NetFlow"
                description="Server belum menerima paket NetFlow UDP pada port 2055 dari router. Pastikan fitur Traffic Flow di MikroTik sudah diaktifkan dan diarahkan ke port 2055."
                cliHint={
                  "/ip traffic-flow set enabled=yes\n/ip traffic-flow target add dst-address=<IP_SERVER> port=2055 version=9"
                }
                onRetry={retry}
              />
            </CardContent>
          </Card>
        ) : (
          <>
            {/* TAB 1: RINGKASAN & TREN */}
            <TabsContent
              value="ringkasan"
              forceMount
              className="data-[state=inactive]:hidden flex flex-col gap-5 outline-none"
            >
              {/* Clean Rx/Tx & Uplink KPI Row */}
              <div
                className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
                data-testid="netflow-kpi"
              >
                <Kpi
                  label="Throughput Masuk (Rx)"
                  value={
                    failed || !view
                      ? "tidak dapat dibaca"
                      : formatBandwidthRate(view.directional.rxBps)
                  }
                  sub={
                    failed || !view
                      ? "tidak dapat dibaca"
                      : `Total unduh: ${formatDataVolume(view.directional.rxBytes)}`
                  }
                />
                <Kpi
                  label="Throughput Keluar (Tx)"
                  value={
                    failed || !view
                      ? "tidak dapat dibaca"
                      : formatBandwidthRate(view.directional.txBps)
                  }
                  sub={
                    failed || !view
                      ? "tidak dapat dibaca"
                      : `Total unggah: ${formatDataVolume(view.directional.txBytes)}`
                  }
                />
                <Kpi
                  label="Pemakaian Uplink"
                  value={
                    failed || !view || view.directional.uplinkUsagePercent === null
                      ? "tidak dapat dibaca"
                      : `${view.directional.uplinkUsagePercent.toFixed(1)}% kapasitas`
                  }
                  sub={
                    failed || !view || view.directional.uplinkRemainingBps === null
                      ? "Kapasitas uplink belum diset"
                      : `Sisa ruang: ${formatBandwidthRate(view.directional.uplinkRemainingBps)}`
                  }
                />
                <Kpi
                  label="Antarmuka Tersibuk"
                  value={
                    failed || !view || !view.directional.busyInterface
                      ? "tidak dapat dibaca"
                      : view.directional.busyInterface.name
                  }
                  sub={
                    failed || !view || !view.directional.busyInterface
                      ? "tidak dapat dibaca"
                      : `${view.directional.busyInterface.routerName} · ${formatBandwidthRate(view.directional.busyInterface.bps)}`
                  }
                />
              </div>

              {/* Secondary Metric Bar */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Card className="p-3 shadow-2xs">
                  <div className="text-xs text-muted-foreground">Total Throughput Aliran</div>
                  <div className="mt-1 text-base font-semibold tabular-nums">
                    {failed || !view
                      ? "tidak dapat dibaca"
                      : formatBandwidthRate(view.summary.throughputBps)}
                  </div>
                </Card>
                <Card className="p-3 shadow-2xs">
                  <div className="text-xs text-muted-foreground">Laju Aliran (Flows/detik)</div>
                  <div className="mt-1 text-base font-semibold tabular-nums">
                    {failed || !view
                      ? "tidak dapat dibaca"
                      : `${view.summary.flowsPerSec.toFixed(3)} flow/detik`}
                  </div>
                </Card>
                <Card className="p-3 shadow-2xs">
                  <div className="text-xs text-muted-foreground">Protokol Teratas</div>
                  <div className="mt-1 text-base font-semibold">
                    {failed || !view
                      ? "tidak dapat dibaca"
                      : view.summary.topProtocol ?? "-"}
                  </div>
                </Card>
                <Card className="p-3 shadow-2xs">
                  <div className="text-xs text-muted-foreground">Aplikasi Teratas</div>
                  <div className="mt-1 text-base font-semibold">
                    {failed || !view
                      ? "tidak dapat dibaca"
                      : view.summary.topApp ?? "-"}
                  </div>
                </Card>
              </div>

              {/* Trend Chart */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2 text-sm text-muted-foreground">
                  <span className="font-semibold text-foreground">Tren Throughput Aliran Trafik</span>
                  <span className="text-xs">
                    Rentang {ranges.find((r) => r.value === filter.range)?.label}
                  </span>
                </CardHeader>
                <CardContent>
                  <NetflowTrendChart series={view.trend} range={filter.range} />
                </CardContent>
              </Card>

              {/* Top Talkers Card mapped to customers */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">
                      Top Talkers (Pemakai Trafik Terbesar)
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Daftar pengguna dengan throughput tertinggi yang dipetakan ke pelanggan
                    </p>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    10 Teratas
                  </Badge>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b text-xs text-muted-foreground uppercase">
                        <tr>
                          <th className="py-2 pr-3 font-medium">No</th>
                          <th className="py-2 pr-3 font-medium">Pelanggan / Identitas</th>
                          <th className="py-2 pr-3 font-medium">IP Klien</th>
                          <th className="py-2 pr-3 font-medium">Aplikasi Dominan</th>
                          <th className="py-2 pr-3 text-right font-medium">Volume Data</th>
                          <th className="py-2 pr-3 text-right font-medium">Throughput</th>
                          <th className="py-2 text-right font-medium">Sesi</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {view.topTalkers.map((talker, idx) => (
                          <tr key={talker.ip} className="hover:bg-muted/40 transition-colors">
                            <td className="py-2.5 pr-3 tabular-nums">{idx + 1}</td>
                            <td className="py-2.5 pr-3">
                              {talker.customer ? (
                                <div className="flex flex-col">
                                  <span className="font-medium text-foreground">
                                    {isDemoMode ? talker.customer.name : `Pelanggan #${idx + 1}`}
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    {isDemoMode
                                      ? `${talker.customer.pppoeUsername} · ${talker.customer.odpName}`
                                      : `${talker.customer.pppoeUsername.slice(0, 3)}*** · ${talker.customer.odpName}`}
                                  </span>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1.5">
                                  <span className="font-mono text-xs">{talker.ip}</span>
                                  <Badge
                                    variant="outline"
                                    className="border-dashed text-[10px] text-amber-700 dark:text-amber-300"
                                  >
                                    Belum terpetakan
                                  </Badge>
                                </div>
                              )}
                            </td>
                            <td className="py-2.5 pr-3 font-mono text-xs">{talker.ip}</td>
                            <td className="py-2.5 pr-3">
                              <span className="rounded border px-1.5 py-0.5 text-xs font-medium">
                                {talker.topApp}
                              </span>
                            </td>
                            <td className="py-2.5 pr-3 text-right font-medium tabular-nums">
                              {formatDataVolume(talker.bytes)}
                            </td>
                            <td className="py-2.5 pr-3 text-right tabular-nums">
                              {formatBandwidthRate(talker.throughputBps)}
                            </td>
                            <td className="py-2.5 text-right tabular-nums text-muted-foreground">
                              {talker.flowCount}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* TAB 2: SESI & PERCAKAPAN */}
            <TabsContent
              value="sesi"
              forceMount
              className="data-[state=inactive]:hidden flex flex-col gap-4 outline-none"
            >
              <Card>
                <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between pb-2">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">
                      Daftar Sesi & Percakapan Jaringan
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Menampilkan {view.top.length} flow dari total {formatInteger(view.count)} flow aktif
                      ({sortOptions.find((o) => o.value === sortValue)?.label})
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 text-xs"
                      onClick={downloadSessionCsv}
                    >
                      <Download className="size-3.5" />
                      <span>Ekspor CSV Sesi</span>
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {view.top.length === 0 ? (
                    <div data-testid="netflow-no-match">
                      <TrafficEmptyState
                        variant="no_match"
                        title="Tidak Ada Flow yang Cocok"
                        description="Tidak ditemukan aliran trafik dengan kriteria saringan saat ini. Periksa kembali IP, port, atau rentang waktu."
                        onResetFilter={() => setFilter(defaultFlowFilter)}
                      />
                    </div>
                  ) : (
                    <div
                      role="region"
                      aria-label="Tabel flow teratas"
                      tabIndex={0}
                      className="overflow-x-auto"
                    >
                      <table
                        className="w-full text-left text-sm"
                        data-testid="netflow-table"
                      >
                        <thead className="border-b text-xs text-muted-foreground uppercase">
                          <tr>
                            <th className="py-2 pr-3 font-medium">No</th>
                            <th className="py-2 pr-3 font-medium">Waktu Mulai</th>
                            <th className="py-2 pr-3 font-medium">Router</th>
                            <th className="py-2 pr-3 font-medium">
                              IP Asal:Port → IP Tujuan:Port
                            </th>
                            <th className="py-2 pr-3 font-medium">Protokol</th>
                            <th className="py-2 pr-3 font-medium">Aplikasi</th>
                            <th className="py-2 pr-3 text-right font-medium">
                              Bytes
                            </th>
                            <th className="py-2 pr-3 text-right font-medium">
                              Paket
                            </th>
                            <th className="py-2 pr-3 text-right font-medium">
                              Throughput
                            </th>
                            <th className="py-2 font-medium">Aksi</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {view.top.map((f, i) => {
                            const cust = resolveCustomerForIp(f.srcIp);
                            const anomaly = evaluateFlowAnomaly(f);
                            return (
                              <tr
                                key={f.id}
                                className="hover:bg-muted/30 transition-colors"
                                data-testid="netflow-row"
                              >
                                <td className="py-2 pr-3 tabular-nums">{i + 1}</td>
                                <td className="py-2 pr-3 whitespace-nowrap">
                                  {formatAlertTime(f.startedAt, state?.now ?? f.startedAt)}
                                </td>
                                <td className="py-2 pr-3 whitespace-nowrap">
                                  <div className="font-medium text-xs">{f.routerName}</div>
                                  <div className="text-[10px] text-muted-foreground">
                                    {flowPonPort(f.srcIp)}
                                  </div>
                                </td>
                                <td className="py-2 pr-3 font-mono text-xs whitespace-nowrap">
                                  <div className="text-foreground">
                                    {f.srcIp}:{f.srcPort} → {f.dstIp}:{f.dstPort}
                                  </div>
                                  {cust ? (
                                    <div className="text-[11px] font-sans text-muted-foreground truncate max-w-[200px]">
                                      {cust.name} ({cust.pppoeUsername})
                                    </div>
                                  ) : (
                                    <div className="text-[10px] font-sans text-muted-foreground/70">
                                      Belum terpetakan
                                    </div>
                                  )}
                                </td>
                                <td className="py-2 pr-3">
                                  <span className="rounded border px-1.5 py-0.5 text-xs font-medium">
                                    {f.protocol}
                                  </span>
                                </td>
                                <td className="py-2 pr-3">
                                  <div className="flex items-center gap-1.5">
                                    <span>{f.app}</span>
                                    {anomaly.isAnomaly && (
                                      <Badge
                                        variant="outline"
                                        className="border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[10px]"
                                        data-testid="flow-anomaly-badge"
                                        title={anomaly.reason}
                                      >
                                        Anomali
                                      </Badge>
                                    )}
                                  </div>
                                </td>
                                <td className="py-2 pr-3 text-right tabular-nums">
                                  {formatDataVolume(f.bytes)}
                                </td>
                                <td className="py-2 pr-3 text-right tabular-nums">
                                  {formatPacketCount(f.packets)}
                                </td>
                                <td
                                  className="py-2 pr-3 text-right tabular-nums"
                                  title={`Durasi ${formatTrafficDuration(f.durationSec)}`}
                                >
                                  {formatBandwidthRate((f.bytes * 8) / Math.max(1, f.durationSec))}
                                </td>
                                <td className="py-2">
                                  <button
                                    type="button"
                                    data-testid="view-flow-detail-btn"
                                    className="h-7 rounded-md border px-2 text-xs hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring"
                                    onClick={() => setSelected(f)}
                                  >
                                    Detail
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* TAB 3: PEMAKAIAN PELANGGAN (FUP) */}
            <TabsContent
              value="fup"
              forceMount
              className="data-[state=inactive]:hidden flex flex-col gap-4 outline-none"
            >
              <Card>
                <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pb-2">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">
                      Pemakaian Pelanggan (Bahan Penilaian FUP)
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Akumulasi kuota trafik nyata per pelanggan sesuai jendela retensi (7 hari) dengan deteksi lonjakan puncak
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                      <input
                        type="text"
                        placeholder="Filter pelanggan / PPPoE..."
                        className="h-8 rounded-md border bg-background pl-8 pr-2.5 text-xs focus-visible:outline-2 focus-visible:outline-ring"
                        value={customerSearch}
                        onChange={(e) => setCustomerSearch(e.target.value)}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 text-xs"
                      onClick={downloadFupCsv}
                    >
                      <Download className="size-3.5" />
                      <span>Ekspor Rekap FUP</span>
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b text-xs text-muted-foreground uppercase">
                        <tr>
                          <th className="py-2 pr-3 font-medium">No</th>
                          <th className="py-2 pr-3 font-medium">Nama Pelanggan</th>
                          <th className="py-2 pr-3 font-medium">Username PPPoE</th>
                          <th className="py-2 pr-3 font-medium">Paket</th>
                          <th className="py-2 pr-3 font-medium">Lokasi ODP</th>
                          <th className="py-2 pr-3 text-right font-medium">Unduh (Rx)</th>
                          <th className="py-2 pr-3 text-right font-medium">Unggah (Tx)</th>
                          <th className="py-2 pr-3 text-right font-medium">Total Pemakaian</th>
                          <th className="py-2 pr-3 text-right font-medium">Puncak Lonjakan</th>
                          <th className="py-2 text-right font-medium">Status FUP</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {filteredFupList.slice(0, 25).map((cust, i) => (
                          <tr key={cust.customerId} className="hover:bg-muted/30 transition-colors">
                            <td className="py-2.5 pr-3 tabular-nums">{i + 1}</td>
                            <td className="py-2.5 pr-3 font-medium text-foreground">
                              {isDemoMode ? cust.customerName : `Pelanggan #${i + 1}`}
                            </td>
                            <td className="py-2.5 pr-3 font-mono text-xs text-muted-foreground">
                              {isDemoMode ? cust.pppoeUsername : `${cust.pppoeUsername.slice(0, 3)}***`}
                            </td>
                            <td className="py-2.5 pr-3">
                              <Badge variant="secondary" className="text-xs">
                                {cust.planMbps} Mbps
                              </Badge>
                            </td>
                            <td className="py-2.5 pr-3 text-xs text-muted-foreground">
                              {cust.odpName}
                            </td>
                            <td className="py-2.5 pr-3 text-right tabular-nums text-xs">
                              {formatDataVolume(cust.rxBytes)}
                            </td>
                            <td className="py-2.5 pr-3 text-right tabular-nums text-xs">
                              {formatDataVolume(cust.txBytes)}
                            </td>
                            <td className="py-2.5 pr-3 text-right tabular-nums font-semibold">
                              {formatDataVolume(cust.totalBytes)}
                            </td>
                            <td className="py-2.5 pr-3 text-right tabular-nums text-xs">
                              {cust.peakThroughputBps !== null ? (
                                <>
                                  <div className="font-medium text-foreground">
                                    {formatBandwidthRate(cust.peakThroughputBps)}
                                  </div>
                                  {cust.peakTime && (
                                    <div className="text-[10px] text-muted-foreground">
                                      {formatAlertTime(cust.peakTime, state?.now ?? cust.peakTime)}
                                    </div>
                                  )}
                                </>
                              ) : (
                                <span className="text-muted-foreground">tidak dapat dibaca</span>
                              )}
                            </td>
                            <td className="py-2.5 text-right">
                              {cust.fupPercent !== null ? (
                                cust.status === "exceeded" ? (
                                  <Badge variant="destructive" className="text-[11px]">
                                    Melewati Batas ({cust.fupPercent.toFixed(0)}%)
                                  </Badge>
                                ) : cust.status === "warning" ? (
                                  <Badge
                                    variant="outline"
                                    className="border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[11px]"
                                  >
                                    Mendekati Batas ({cust.fupPercent.toFixed(0)}%)
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-[11px] text-emerald-600 dark:text-emerald-400">
                                    Aman ({cust.fupPercent.toFixed(0)}%)
                                  </Badge>
                                )
                              ) : cust.status === "untracked" ? (
                                <Badge variant="outline" className="text-[11px] text-muted-foreground">
                                  Belum dipantau
                                </Badge>
                              ) : (
                                <span className="text-xs text-muted-foreground">Tidak ditetapkan</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* TAB 4: EXPORTER & KESEHATAN */}
            <TabsContent
              value="exporter"
              forceMount
              className="data-[state=inactive]:hidden flex flex-col gap-4 outline-none"
            >
              {/* Receiver Health Overview Card */}
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">
                        Status Kesehatan Penerima NetFlow Backend Go
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        Penerima multi-format v5, v9, dan IPFIX pada port UDP 2055 dengan pelacak router aktif
                      </p>
                    </div>
                    {goHealth ? (
                      goHealth.active ? (
                        <Badge variant="outline" className="w-fit text-emerald-600 dark:text-emerald-400">
                          Penerima Aktif · Port {goHealth.addr}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="w-fit border-amber-500/50 text-amber-700 dark:text-amber-300">
                          Penerima Tidak Aktif
                        </Badge>
                      )
                    ) : (
                      <Badge variant="outline" className="w-fit text-muted-foreground">
                        Menghubungkan ke Backend...
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">Port & Multi-Format</div>
                      <div className="mt-1 text-base font-semibold">UDP 2055 (v5, v9, IPFIX)</div>
                      <div className="text-[11px] text-muted-foreground">
                        Penerimaan paket aliran UDP non-blocking
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">Pengali Sampling Rate</div>
                      <div className="mt-1 text-base font-semibold text-primary">Terapkan Otomatis</div>
                      <div className="text-[11px] text-muted-foreground">
                        Angka trafik diskalakan sebelum masuk analisis
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">Ketahanan Aliran</div>
                      <div className="mt-1 text-base font-semibold">
                        {goHealth
                          ? goHealth.totalPackets > 0
                            ? `${formatInteger(goHealth.totalPackets)} Paket Diterima`
                            : "Menunggu Paket Masuk"
                          : "Status Tidak Diketahui"}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {goHealth && goHealth.unknownTemplates > 0
                          ? `${goHealth.unknownTemplates} template belum terdaftar`
                          : "Template aliran sinkron"}
                      </div>
                    </div>
                  </div>

                  {/* Router Exporters Table */}
                  <div>
                    <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                      Router Pengirim (Exporters)
                    </h4>
                    <div className="overflow-x-auto rounded-md border">
                      <table className="w-full text-left text-sm">
                        <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                          <tr>
                            <th className="py-2 px-3 font-medium">Nama Router</th>
                            <th className="py-2 px-3 font-medium">Host IP</th>
                            <th className="py-2 px-3 font-medium">Format NetFlow</th>
                            <th className="py-2 px-3 font-medium">Sampling Rate</th>
                            <th className="py-2 px-3 text-right font-medium">Total Flow</th>
                            <th className="py-2 px-3 text-right font-medium">Total Paket</th>
                            <th className="py-2 px-3 font-medium">Terakhir Terlihat</th>
                            <th className="py-2 px-3 text-right font-medium">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {view.exporters.map((exp) => (
                            <tr key={exp.routerId} className="hover:bg-muted/20">
                              <td className="py-2.5 px-3 font-medium">{exp.routerName}</td>
                              <td className="py-2.5 px-3 font-mono text-xs">{exp.host}</td>
                              <td className="py-2.5 px-3">
                                <Badge variant="secondary" className="text-xs">
                                  {exp.version}
                                </Badge>
                              </td>
                              <td className="py-2.5 px-3">
                                <span className="font-mono text-xs font-medium">
                                  {exp.samplingRate} ({exp.multiplier}x)
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-right tabular-nums">
                                {formatInteger(exp.totalFlows)}
                              </td>
                              <td className="py-2.5 px-3 text-right tabular-nums">
                                {formatInteger(exp.totalPackets)}
                              </td>
                              <td className="py-2.5 px-3 text-xs text-muted-foreground">
                                {exp.lastSeenText}
                              </td>
                              <td className="py-2.5 px-3 text-right">
                                {exp.status === "active" ? (
                                  <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                                    <span className="size-2 rounded-full bg-emerald-500" />
                                    Aktif
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                                    <span className="size-2 rounded-full bg-muted-foreground/40" />
                                    Tidak aktif
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
            {/* TAB 5: TANGKAPAN AKSES (TORCH) */}
            <TabsContent
              value="capture"
              forceMount
              className="data-[state=inactive]:hidden flex flex-col gap-4 outline-none"
            >
              <Card className="border shadow-xs">
                <CardHeader className="pb-3">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">
                        Pilih Pelanggan untuk Perekaman Torch
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        Pilih akun pelanggan untuk menjalankan inspeksi aliran paket real-time (15s / 30s / 1m) langsung ke router
                      </p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <select
                      className={selectClass}
                      value={selectedCaptureCustomer?.id ?? ""}
                      onChange={(e) => {
                        const found = (storeCustomers || []).find((c) => c.id === e.target.value);
                        if (found) {
                          setSelectedCaptureCustomer({
                            id: found.id,
                            name: found.name,
                            pppoeUsername: found.pppoeUsername,
                          });
                        }
                      }}
                      aria-label="Pilih Pelanggan untuk Rekam Akses"
                    >
                      <option value="">-- Pilih Akun Pelanggan PPPoE --</option>
                      {(storeCustomers || []).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.isOnline ? "🟢 Online — " : "⚪ Offline — "} {c.name} ({c.pppoeUsername})
                        </option>
                      ))}
                    </select>
                    {selectedCaptureCustomer && (
                      <span className="text-xs text-muted-foreground">
                        Terpilih: <strong>{selectedCaptureCustomer.name}</strong> ({selectedCaptureCustomer.pppoeUsername})
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>

              {selectedCaptureCustomer ? (
                <CustomerLiveCapturePanel
                  customerId={selectedCaptureCustomer.id}
                  customerName={selectedCaptureCustomer.name}
                  pppoeUsername={selectedCaptureCustomer.pppoeUsername}
                />
              ) : (
                <Card className="p-8 text-center text-xs text-muted-foreground border-dashed">
                  Silakan pilih salah satu pelanggan di atas untuk memulai sesi inspeksi aliran paket (Torch).
                </Card>
              )}
            </TabsContent>
          </>
        )}
      </Tabs>

      <NetflowDetailDialog
        flow={selected}
        now={state?.now ?? 0}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
