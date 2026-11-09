"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Database,
  FlaskConical,
  Radio,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { cn } from "cn";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrafficEmptyState } from "@/components/dashboard/traffic-empty-state";
import { useSession } from "@/components/session-provider";
import { selectPreviewEnabled } from "@/lib/session-store";
import {
  formatBandwidthRate,
  formatDataVolume,
} from "@/lib/dashboard/traffic-format-helpers";
import {
  TRAFFIC_RANGES,
  TRAFFIC_RANGE_CONFIG,
  generateTrafficTrendSeries,
  getMockInterfaceSamples,
  loadTrafficTrendOverview,
  type TrafficInterfaceSample,
  type TrafficOverviewStats,
  type TrafficTimeRange,
  type TrafficTrendPoint,
} from "@/lib/dashboard/traffic-trend-data";

const ROLE_LABEL: Record<TrafficInterfaceSample["role"], string> = {
  wan: "WAN",
  lan: "LAN",
  uplink: "Uplink",
  hotspot: "Hotspot",
};

const fmt = (n: number) =>
  n.toLocaleString("id-ID", { maximumFractionDigits: 1, minimumFractionDigits: 0 });

function Kpi({
  title,
  value,
  Icon,
  tone,
  testId,
}: {
  title: string;
  value: string;
  Icon: LucideIcon;
  tone: "success" | "default" | "warning";
  testId: string;
}) {
  return (
    <Card data-testid={testId}>
      <CardHeader className="flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon
          className={cn(
            "size-4",
            tone === "success" && "text-success",
            tone === "warning" && "text-warning",
            tone === "default" && "text-muted-foreground",
          )}
          aria-hidden="true"
        />
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tabular-nums">
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

const W = 720;
const H = 240;
const PAD = { l: 44, r: 12, t: 12, b: 24 };

function TrendChart({ series }: { series: TrafficTrendPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...series.map((p) => p.totalMbps)) * 1.1;
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (series.length === 1 ? 0 : (i / (series.length - 1)) * iw);
  const y = (v: number) => PAD.t + ih - (v / max) * ih;
  const line = (pick: (p: TrafficTrendPoint) => number) =>
    series.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(pick(p)).toFixed(1)}`).join(" ");
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const labelEvery = Math.max(1, Math.ceil(series.length / 6));
  const hp = hover === null ? null : series[hover];

  return (
    <div className="relative" data-testid="traffic-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label="Grafik tren bandwidth unduh dan unggah dalam Mbps"
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
            <text x={PAD.l - 6} y={y(t) + 3} textAnchor="end" className="fill-muted-foreground text-[10px]">
              {Math.round(t)}
            </text>
          </g>
        ))}
        <path d={line((p) => p.downloadMbps)} fill="none" className="stroke-success" strokeWidth={2} />
        <path d={line((p) => p.uploadMbps)} fill="none" className="stroke-primary" strokeWidth={2} />
        {series.map((p, i) =>
          i % labelEvery === 0 ? (
            <text key={p.timestamp} x={x(i)} y={H - 6} textAnchor="middle" className="fill-muted-foreground text-[10px]">
              {p.timeLabel}
            </text>
          ) : null,
        )}
        {series.map((p, i) => (
          <rect
            key={p.timestamp}
            x={x(i) - iw / series.length / 2}
            y={PAD.t}
            width={iw / series.length}
            height={ih}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
        {hover !== null && (
          <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + ih} className="stroke-muted-foreground" strokeDasharray="3 3" />
        )}
      </svg>
      <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-success" aria-hidden="true" /> Unduh (RX)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-primary" aria-hidden="true" /> Unggah (TX)
        </span>
        <span data-testid="traffic-tooltip" aria-live="polite" className="ml-auto tabular-nums">
          {hp
            ? `${hp.timeLabel} · RX ${fmt(hp.downloadMbps)} · TX ${fmt(hp.uploadMbps)} Mbps`
            : "Arahkan kursor ke grafik untuk detail"}
        </span>
      </div>
    </div>
  );
}

interface LiveTrend {
  overview: TrafficOverviewStats;
  series: TrafficTrendPoint[];
  interfaces: TrafficInterfaceSample[];
  sourceStatus: "nyata" | "dummy" | "kosong";
}

type LiveState =
  | { range: TrafficTimeRange; status: "ready"; data: LiveTrend }
  | { range: TrafficTimeRange; status: "error" };

const emptyStats = (range: TrafficTimeRange): TrafficOverviewStats => ({
  currentDownloadMbps: 0,
  currentUploadMbps: 0,
  peakMbps: 0,
  avgMbps: 0,
  totalVolumeGb: 0,
  activeInterfacesCount: 0,
  range,
  sourceStatus: "kosong",
  lastSampledAt: "",
});

// Mode live: arsip traffic_samples dan sampel interface router lewat
// /api/traffic/trend. Hasil untuk rentang yang sudah ditinggalkan dibuang.
function useLiveTrend(range: TrafficTimeRange, enabled: boolean) {
  const [state, setState] = useState<LiveState | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();
    fetch(`/api/traffic/trend?range=${range}`, { signal: ctrl.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((json: { data: LiveTrend }) => setState({ range, status: "ready", data: json.data }))
      .catch(() => {
        if (!ctrl.signal.aborted) setState({ range, status: "error" });
      });
    return () => ctrl.abort();
  }, [range, enabled]);
  const current = state?.range === range ? state : null;
  return {
    loading: enabled && current === null,
    failed: current?.status === "error",
    data: current?.status === "ready" ? current.data : null,
  };
}

export function TrafficTrendBoard({ nowSec }: { nowSec?: number }) {
  const [range, setRange] = useState<TrafficTimeRange>("24h");
  // nowSec dari server dipakai agar render server dan klien identik.
  const [now] = useState(() => nowSec ?? Math.floor(Date.now() / 1000));
  const isDemo = useSession(selectPreviewEnabled);
  const live = useLiveTrend(range, !isDemo);
  const series = live.data?.series ?? [];
  const stats = live.data?.overview ?? emptyStats(range);
  const interfaces = live.data?.interfaces ?? [];
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return interfaces;
    return interfaces.filter((i) => {
      const hay = `${i.routerName} ${i.interfaceName} ${ROLE_LABEL[i.role]}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [interfaces, query]);

  return (
    <section data-testid="traffic-trend-board" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {isDemo ? (
          <p
            data-testid="traffic-mock-badge"
            className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-3 py-1 text-xs font-medium text-warning"
          >
            <FlaskConical className="size-3.5" aria-hidden="true" />
            Data Tiruan Trafik (mode demo)
          </p>
        ) : (
          <p
            data-testid="traffic-live-badge"
            data-state={live.failed ? "error" : live.loading ? "loading" : (live.data?.sourceStatus ?? "kosong")}
            className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400"
          >
            <Radio className="size-3.5" aria-hidden="true" />
            {live.failed
              ? "Gagal memuat data dari server"
              : live.loading
                ? "Memuat data nyata…"
                : live.data?.sourceStatus === "nyata"
                  ? "Data nyata dari router (arsip traffic)"
                  : "Belum ada histori traffic; backend baru mulai merekam"}
          </p>
        )}
        <div
          role="group"
          aria-label="Rentang waktu"
          data-testid="traffic-range-select"
          className="inline-flex rounded-md border p-0.5"
        >
          {TRAFFIC_RANGES.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={range === r}
              onClick={() => setRange(r)}
              className={cn(
                "rounded px-3 py-1 text-sm",
                range === r ? "bg-secondary font-medium" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi testId="traffic-kpi-rx" title="Trafik Unduh (RX)" value={formatBandwidthRate(stats.currentDownloadMbps * 1e6)} Icon={ArrowDownRight} tone="success" />
        <Kpi testId="traffic-kpi-tx" title="Trafik Unggah (TX)" value={formatBandwidthRate(stats.currentUploadMbps * 1e6)} Icon={ArrowUpRight} tone="default" />
        <Kpi testId="traffic-kpi-peak" title="Puncak Trafik (Peak)" value={formatBandwidthRate(stats.peakMbps * 1e6)} Icon={TrendingUp} tone="warning" />
        <Kpi testId="traffic-kpi-volume" title="Total Volume Ditransfer" value={formatDataVolume(stats.totalVolumeGb * 1024 ** 3)} Icon={Database} tone="default" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Tren Bandwidth · {TRAFFIC_RANGE_CONFIG[range].label} terakhir
          </CardTitle>
        </CardHeader>
        <CardContent>
          {series.length === 0 ? (
            <TrafficEmptyState variant="no_data" />
          ) : (
            <TrendChart series={series} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sampel Trafik per Interface</CardTitle>
        </CardHeader>
        <CardContent>
          <label className="mb-3 flex flex-col gap-1 text-sm">
            Cari router atau interface
            <input
              type="text"
              data-testid="traffic-interface-filter"
              className="h-9 max-w-xs rounded-md border bg-background px-2 text-sm focus-visible:outline-2 focus-visible:outline-ring"
              placeholder="Mis. ether1, WAN"
              autoComplete="off"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {interfaces.length === 0 ? (
            <TrafficEmptyState variant="no_data" title="Belum Ada Data Interface" />
          ) : visible.length === 0 ? (
            <TrafficEmptyState variant="no_match" onResetFilter={() => setQuery("")} />
          ) : (
          <div className="overflow-x-auto">
            <table data-testid="traffic-interface-table" className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Router</th>
                  <th className="py-2 pr-4 font-medium">Interface</th>
                  <th className="py-2 pr-4 font-medium">Peran</th>
                  <th className="py-2 pr-4 text-right font-medium">RX</th>
                  <th className="py-2 pr-4 text-right font-medium">TX</th>
                  <th className="py-2 pr-4 text-right font-medium">Error/menit</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((i) => (
                  <tr key={i.id} className="border-b last:border-0">
                    <td className="py-2 pr-4">{i.routerName}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{i.interfaceName}</td>
                    <td className="py-2 pr-4">{ROLE_LABEL[i.role]}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatBandwidthRate(i.rxMbps * 1e6)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatBandwidthRate(i.txMbps * 1e6)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{i.rxErrorsPerMin + i.txErrorsPerMin}</td>
                    <td className="py-2">
                      <span
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-xs font-medium",
                          i.status === "up" ? "border-success/40 text-success" : "border-destructive/40 text-destructive",
                        )}
                      >
                        {i.status === "up" ? "UP" : "DOWN"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
