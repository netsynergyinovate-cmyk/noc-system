// Data tiruan trafik & tren bandwidth. TIRUAN SEMENTARA: wajib dialihkan ke Go
// collector / SNMP saat go-live (Fase 5). Murni, deterministik terhadap waktu.

export type TrafficTimeRange = "1h" | "6h" | "24h" | "7d";

export interface TrafficTrendPoint {
  timestamp: number; // epoch detik
  timeLabel: string;
  downloadMbps: number;
  uploadMbps: number;
  totalMbps: number;
  peakMbps: number;
}

export interface TrafficInterfaceSample {
  id: string;
  routerId: string;
  routerName: string;
  interfaceName: string;
  role: "wan" | "lan" | "uplink" | "hotspot";
  rxMbps: number;
  txMbps: number;
  rxErrorsPerMin: number;
  txErrorsPerMin: number;
  status: "up" | "down";
  speedLimitMbps?: number;
}

export interface TrafficOverviewStats {
  currentDownloadMbps: number;
  currentUploadMbps: number;
  peakMbps: number;
  avgMbps: number;
  totalVolumeGb: number;
  activeInterfacesCount: number;
  range: TrafficTimeRange;
  sourceStatus: "dummy" | "nyata";
  lastSampledAt: string;
}

export const TRAFFIC_TREND_MOCK_ENTRY = {
  id: "traffic-bandwidth-samples",
  module: "Sampel Trafik & Tren Bandwidth",
  targetDevice: "Router MikroTik SNMP / REST API v7",
  status: "dummy" as const,
  readPath: "src/lib/dashboard/traffic-trend-data.ts (loadTrafficTrendOverview)",
  writePath: "-",
  envKey: "MIKROTIK_REST_HOST",
  notes:
    "Tiruan sementara data trafik & tren bandwidth; wajib dialihkan ke Go collector / SNMP di Fase 5",
};

// Jumlah titik dan jarak antar titik (detik) per rentang.
export const TRAFFIC_RANGE_CONFIG: Readonly<
  Record<TrafficTimeRange, { points: number; stepSec: number; label: string }>
> = {
  "1h": { points: 12, stepSec: 300, label: "1 jam" },
  "6h": { points: 24, stepSec: 900, label: "6 jam" },
  "24h": { points: 24, stepSec: 3600, label: "24 jam" },
  "7d": { points: 28, stepSec: 21600, label: "7 hari" },
};

export const TRAFFIC_RANGES: readonly TrafficTimeRange[] = ["1h", "6h", "24h", "7d"];

// Hash bilangan bulat -> [0, 1). Deterministik.
function unit(n: number): number {
  let x = (Math.floor(n) ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x / 4294967296;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function labelFor(ts: number, range: TrafficTimeRange): string {
  // WIB (UTC+7) tetap, supaya label server dan browser sama (tanpa mismatch hidrasi).
  const d = new Date((ts + 7 * 3600) * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  const hm = `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  return range === "7d" ? `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${hm}` : hm;
}

// Kurva harian: puncak malam (~20:00 WIB = 13:00 UTC), lembah dini hari.
function dailyFactor(ts: number): number {
  const hourUtc = (ts % 86400) / 3600;
  return 0.55 + 0.35 * Math.cos(((hourUtc - 13) / 24) * 2 * Math.PI);
}

export function generateTrafficTrendSeries(
  range: TrafficTimeRange,
  nowSec: number = Math.floor(Date.now() / 1000),
): TrafficTrendPoint[] {
  const { points, stepSec } = TRAFFIC_RANGE_CONFIG[range];
  const end = Math.floor(nowSec / stepSec) * stepSec;
  const out: TrafficTrendPoint[] = [];
  for (let i = points - 1; i >= 0; i--) {
    const ts = end - i * stepSec;
    const f = dailyFactor(ts);
    const noise = 0.9 + unit(ts) * 0.2;
    const download = round2(Math.max(0, 900 * f * noise));
    const upload = round2(Math.max(0, 180 * f * (0.9 + unit(ts + 7) * 0.2)));
    const total = round2(download + upload);
    out.push({
      timestamp: ts,
      timeLabel: labelFor(ts, range),
      downloadMbps: download,
      uploadMbps: upload,
      totalMbps: total,
      peakMbps: round2(total * (1.05 + unit(ts + 13) * 0.15)),
    });
  }
  return out;
}

export function getMockInterfaceSamples(): TrafficInterfaceSample[] {
  return [
    {
      id: "if-1", routerId: "rtr-core-1", routerName: "RTR-CORE-01",
      interfaceName: "ether1-WAN-Indosat", role: "wan",
      rxMbps: 412.6, txMbps: 88.4, rxErrorsPerMin: 0, txErrorsPerMin: 0,
      status: "up", speedLimitMbps: 1000,
    },
    {
      id: "if-2", routerId: "rtr-core-1", routerName: "RTR-CORE-01",
      interfaceName: "ether2-WAN-Telkom", role: "wan",
      rxMbps: 356.1, txMbps: 71.9, rxErrorsPerMin: 2, txErrorsPerMin: 0,
      status: "up", speedLimitMbps: 1000,
    },
    {
      id: "if-3", routerId: "rtr-core-1", routerName: "RTR-CORE-01",
      interfaceName: "sfp-plus1-CORE", role: "uplink",
      rxMbps: 1840.3, txMbps: 702.8, rxErrorsPerMin: 0, txErrorsPerMin: 0,
      status: "up", speedLimitMbps: 10000,
    },
    {
      id: "if-4", routerId: "rtr-dist-1", routerName: "RTR-DIST-01",
      interfaceName: "ether3-LAN-OLT1", role: "lan",
      rxMbps: 523.7, txMbps: 109.2, rxErrorsPerMin: 1, txErrorsPerMin: 0,
      status: "up", speedLimitMbps: 1000,
    },
    {
      id: "if-5", routerId: "rtr-dist-1", routerName: "RTR-DIST-01",
      interfaceName: "ether4-LAN-OLT2", role: "lan",
      rxMbps: 468.9, txMbps: 95.5, rxErrorsPerMin: 0, txErrorsPerMin: 1,
      status: "up", speedLimitMbps: 1000,
    },
    {
      id: "if-6", routerId: "rtr-dist-1", routerName: "RTR-DIST-01",
      interfaceName: "ether5-LAN-OLT3", role: "lan",
      rxMbps: 0, txMbps: 0, rxErrorsPerMin: 0, txErrorsPerMin: 0,
      status: "down", speedLimitMbps: 1000,
    },
    {
      id: "if-7", routerId: "rtr-hotspot-1", routerName: "RTR-HOTSPOT-01",
      interfaceName: "bridge-hotspot", role: "hotspot",
      rxMbps: 64.2, txMbps: 12.7, rxErrorsPerMin: 0, txErrorsPerMin: 0,
      status: "up", speedLimitMbps: 200,
    },
  ];
}

export function loadTrafficTrendOverview(
  range: TrafficTimeRange,
  nowSec: number = Math.floor(Date.now() / 1000),
): TrafficOverviewStats {
  const series = generateTrafficTrendSeries(range, nowSec);
  const last = series[series.length - 1];
  const { stepSec } = TRAFFIC_RANGE_CONFIG[range];
  const sumTotal = series.reduce((s, p) => s + p.totalMbps, 0);
  // Mbps x detik / 8 = MB; / 1000 = GB.
  const volumeGb = (sumTotal * stepSec) / 8 / 1000;
  return {
    currentDownloadMbps: last.downloadMbps,
    currentUploadMbps: last.uploadMbps,
    peakMbps: Math.max(...series.map((p) => p.peakMbps)),
    avgMbps: round2(sumTotal / series.length),
    totalVolumeGb: round2(volumeGb),
    activeInterfacesCount: getMockInterfaceSamples().filter((i) => i.status === "up")
      .length,
    range,
    sourceStatus: "dummy",
    lastSampledAt: new Date(last.timestamp * 1000).toISOString(),
  };
}
