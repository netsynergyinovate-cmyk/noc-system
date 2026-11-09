import { backendGet } from "./backend-api.ts";
import { mockRouters } from "./mock-data.ts";
import type { DashboardCustomer } from "./types.ts";

// Kontrak GET /api/v1/netflow/flows?range=1h|6h|24h&router=&protocol=&app= (belum ada).
// Semua murni dan fungsi waktu saja: `now` yang sama selalu memberi daftar yang sama.

// Entri registry sumber data tiruan. TIRUAN SEMENTARA: wajib dihapus saat go-live (Fase 5).
export const NETFLOW_DATA_MOCK_ENTRY = {
  id: "netflow-collector-flows",
  module: "Papan NetFlow & Aliran Trafik",
  targetDevice: "Kolektor NetFlow v5/v9 UDP 2055",
  status: "dummy" as const,
  readPath: "src/lib/dashboard/netflow.ts (loadNetflow)",
  writePath: "-",
  envKey: "NETFLOW_PORT",
  notes:
    "Tiruan sementara data inspeksi aliran NetFlow; wajib dialihkan ke Go NetFlow collector di Fase 5",
};

export type FlowProtocol = "TCP" | "UDP" | "ICMP";
export type FlowRange = "1h" | "6h" | "24h" | "7d";

export const flowRangeSeconds: Record<FlowRange, number> = {
  "1h": 3600,
  "6h": 21_600,
  "24h": 86_400,
  "7d": 604_800,
};

export interface NetflowRecord {
  id: string;
  routerId: string;
  routerName: string;
  customerId?: string | null;
  customerName?: string | null;
  direction?: "up" | "down" | null;
  ponPort?: string | null;
  srcIp: string;
  srcPort: number;
  dstIp: string;
  dstPort: number;
  protocol: FlowProtocol;
  app: string;
  bytes: number;
  packets: number;
  // Detik epoch bulat; `endedAt = startedAt + durationSec`.
  startedAt: number;
  durationSec: number;
  endedAt: number;
}

const APPS: { app: string; protocol: FlowProtocol; port: number; weight: number }[] = [
  { app: "HTTPS", protocol: "TCP", port: 443, weight: 30 },
  { app: "YouTube", protocol: "TCP", port: 443, weight: 18 },
  { app: "TikTok", protocol: "TCP", port: 443, weight: 12 },
  { app: "DNS", protocol: "UDP", port: 53, weight: 10 },
  { app: "Steam", protocol: "UDP", port: 27015, weight: 6 },
  { app: "HTTP", protocol: "TCP", port: 80, weight: 8 },
  { app: "WhatsApp", protocol: "TCP", port: 5222, weight: 8 },
  { app: "ICMP", protocol: "ICMP", port: 0, weight: 4 },
  { app: "QUIC", protocol: "UDP", port: 443, weight: 4 },
];
const TOTAL_WEIGHT = APPS.reduce((sum, a) => sum + a.weight, 0);

const SLOT_SECONDS = 300;
const FLOWS_PER_SLOT = 2;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function flowInSlot(slot: number, n: number): NetflowRecord {
  const r = rng(slot * 7 + n * 104_729 + 1);
  let pick = r() * TOTAL_WEIGHT;
  const app = APPS.find((a) => (pick -= a.weight) < 0) ?? APPS[0];
  const router = mockRouters[Math.floor(r() * mockRouters.length)];
  const durationSec = 1 + Math.floor(r() * 240);
  const startedAt = slot * SLOT_SECONDS + Math.floor(r() * (SLOT_SECONDS - 1));
  // Ekor panjang: beberapa flow jauh lebih besar dari sisanya.
  const bytes = Math.floor(2 ** (12 + r() * 18) * (app.app === "DNS" ? 0.01 : 1));
  return {
    id: `flow-${slot}-${n}`,
    routerId: router.id,
    routerName: router.name,
    srcIp: `10.${10 + Math.floor(r() * 5)}.${Math.floor(r() * 250)}.${2 + Math.floor(r() * 250)}`,
    srcPort: 1024 + Math.floor(r() * 60_000),
    dstIp: `${[8, 13, 31, 104, 142, 172][Math.floor(r() * 6)]}.${Math.floor(r() * 250)}.${Math.floor(r() * 250)}.${1 + Math.floor(r() * 250)}`,
    dstPort: app.port,
    protocol: app.protocol,
    app: app.app,
    bytes: Math.max(64, bytes),
    packets: Math.max(1, Math.round(bytes / (500 + r() * 900))),
    startedAt,
    durationSec,
    endedAt: startedAt + durationSec,
  };
}

// Semua flow yang berakhir dalam `windowSeconds` terakhir (bawaan 24 jam), terbaru dulu.
export function mockNetflow(now: number, windowSeconds = 86_400): NetflowRecord[] {
  const out: NetflowRecord[] = [];
  const first = Math.floor((now - windowSeconds - 300) / SLOT_SECONDS);
  const last = Math.floor(now / SLOT_SECONDS);
  for (let slot = first; slot <= last; slot++) {
    for (let n = 0; n < FLOWS_PER_SLOT; n++) {
      const f = flowInSlot(slot, n);
      if (f.endedAt > now - windowSeconds && f.endedAt <= now) out.push(f);
    }
  }
  return out.sort((a, b) => b.endedAt - a.endedAt || (a.id < b.id ? -1 : 1));
}

export interface FlowFilter {
  range: FlowRange;
  routerId: string | null;
  protocol: FlowProtocol | null;
  // Nama aplikasi, atau angka (port tujuan / port asal).
  query: string;
  // Potongan IP pelanggan / IP asal (cocok di IP asal atau tujuan).
  clientIp: string;
  // Port tujuan persis.
  dstPort: string;
  // Port PON (opsional: PON-1 s/d PON-8).
  ponPort?: string | null;
}

export const defaultFlowFilter: FlowFilter = {
  range: "1h",
  routerId: null,
  protocol: null,
  query: "",
  clientIp: "",
  dstPort: "",
  ponPort: null,
};
export function flowPonPort(_ip: string): string | null {
  // Kejujuran data: Port PON tidak boleh ditebak dari oktet IP.
  // Nilai riil hanya diperoleh bila terpetakan dari database OLT/ONU.
  return null;
}

export function filterFlows(
  flows: NetflowRecord[],
  filter: FlowFilter,
  now: number,
): NetflowRecord[] {
  const from = now - flowRangeSeconds[filter.range];
  const q = filter.query.trim().toLowerCase();
  const cleanIp = (filter.clientIp ?? "").trim();
  const cleanPort = (filter.dstPort ?? "").trim();
  const ponPort = (filter.ponPort ?? "").trim().toLowerCase();
  return flows.filter(
    (f) =>
      f.endedAt > from &&
      f.endedAt <= now &&
      (!filter.routerId || f.routerId === filter.routerId) &&
      (!filter.protocol || f.protocol === filter.protocol) &&
      (!cleanIp || f.srcIp.includes(cleanIp) || f.dstIp.includes(cleanIp)) &&
      (!cleanPort || String(f.dstPort) === cleanPort) &&
      (!ponPort || (f.ponPort && f.ponPort.toLowerCase() === ponPort)) &&
      (!q ||
        f.app.toLowerCase().includes(q) ||
        String(f.dstPort) === q ||
        String(f.srcPort) === q),
  );
}

export function topFlows(flows: NetflowRecord[], limit = 20): NetflowRecord[] {
  return [...flows]
    .sort((a, b) => b.bytes - a.bytes || (a.id < b.id ? -1 : 1))
    .slice(0, limit);
}

export interface NetflowSummary {
  flowCount: number;
  totalBytes: number;
  // Rata-rata selama jendela, bit per detik.
  throughputBps: number;
  flowsPerSec: number;
  topProtocol: FlowProtocol | null;
  topApp: string | null;
}

function maxByBytes(map: Map<string, number>): string | null {
  let best: string | null = null;
  let bestBytes = -1;
  for (const [k, v] of map) {
    if (v > bestBytes || (v === bestBytes && best !== null && k < best)) {
      best = k;
      bestBytes = v;
    }
  }
  return best;
}

export function summarizeNetflow(
  flows: NetflowRecord[],
  range: FlowRange,
): NetflowSummary {
  const seconds = flowRangeSeconds[range];
  const protocols = new Map<string, number>();
  const apps = new Map<string, number>();
  let totalBytes = 0;
  for (const f of flows) {
    totalBytes += f.bytes;
    protocols.set(f.protocol, (protocols.get(f.protocol) ?? 0) + f.bytes);
    apps.set(f.app, (apps.get(f.app) ?? 0) + f.bytes);
  }
  return {
    flowCount: flows.length,
    totalBytes,
    throughputBps: (totalBytes * 8) / seconds,
    flowsPerSec: flows.length / seconds,
    topProtocol: maxByBytes(protocols) as FlowProtocol | null,
    topApp: maxByBytes(apps),
  };
}

export const TREND_POINTS = 48;

export interface NetflowTimeSeries {
  // Akhir tiap interval (detik epoch), naik; titik terakhir = now.
  times: number[];
  bps: number[];
  flows: number[];
}

// Flow dihitung ke interval tempat ia berakhir: (from + i*step, from + (i+1)*step].
export function buildNetflowTimeSeries(
  flows: NetflowRecord[],
  range: FlowRange,
  now: number,
): NetflowTimeSeries {
  const seconds = flowRangeSeconds[range];
  const step = seconds / TREND_POINTS;
  const from = now - seconds;
  const bytes = new Array<number>(TREND_POINTS).fill(0);
  const counts = new Array<number>(TREND_POINTS).fill(0);
  for (const f of flows) {
    if (f.endedAt <= from || f.endedAt > now) continue;
    const i = Math.min(TREND_POINTS - 1, Math.ceil((f.endedAt - from) / step) - 1);
    bytes[i] += f.bytes;
    counts[i] += 1;
  }
  return {
    times: bytes.map((_, i) => from + (i + 1) * step),
    bps: bytes.map((b) => (b * 8) / step),
    flows: counts,
  };
}

// Lebar interval (detik) tiap titik riwayat tren menurut rentang.
export const flowHistoryStepSeconds: Record<FlowRange, number> = {
  "1h": 60,
  "6h": 300,
  "24h": 900,
  "7d": 7200,
};

export interface FlowHistoryPoint {
  // Akhir interval (detik epoch).
  at: number;
  bytesPerSec: number;
  packetsPerSec: number;
  topApp?: string;
}

export interface FlowHistory {
  range: FlowRange;
  points: FlowHistoryPoint[];
}

export interface FlowHistoryItem {
  endedAt: number;
  bytes: number;
  packets: number;
  app: string;
}

// Murni: kelompokkan ke interval (from + i*step, from + (i+1)*step]; titik terakhir = now.
export function buildFlowHistory(
  items: FlowHistoryItem[],
  range: FlowRange,
  now: number,
): FlowHistory {
  const seconds = flowRangeSeconds[range];
  const step = flowHistoryStepSeconds[range];
  const n = seconds / step;
  const from = now - seconds;
  const bytes = new Array<number>(n).fill(0);
  const packets = new Array<number>(n).fill(0);
  const apps = Array.from({ length: n }, () => new Map<string, number>());
  for (const f of items) {
    if (f.endedAt <= from || f.endedAt > now) continue;
    const i = Math.min(n - 1, Math.ceil((f.endedAt - from) / step) - 1);
    bytes[i] += f.bytes;
    packets[i] += f.packets;
    apps[i].set(f.app, (apps[i].get(f.app) ?? 0) + f.bytes);
  }
  return {
    range,
    points: bytes.map((b, i) => {
      const point: FlowHistoryPoint = {
        at: from + (i + 1) * step,
        bytesPerSec: b / step,
        packetsPerSec: packets[i] / step,
      };
      const top = maxByBytes(apps[i]);
      if (top) point.topApp = top;
      return point;
    }),
  };
}

// Sumber mock: flow tersaring router/protokol -> riwayat tren.
export function getNetflowTimeline(
  now: number,
  range: FlowRange,
  filter: { routerId?: string; protocol?: string } = {},
): FlowHistory {
  const flows = filterFlows(
    getNetflowFlows(now, range),
    {
      ...defaultFlowFilter,
      range,
      routerId: filter.routerId ?? null,
      protocol:
        filter.protocol && filter.protocol !== "ALL"
          ? (filter.protocol as FlowProtocol)
          : null,
    },
    now,
  );
  return buildFlowHistory(flows, range, now);
}

export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function formatBps(bps: number): string {
  if (bps >= 1e9) return `${(bps / 1e9).toFixed(2)} Gbps`;
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(2)} Mbps`;
  if (bps >= 1e3) return `${(bps / 1e3).toFixed(1)} Kbps`;
  return `${Math.round(bps)} bps`;
}

export interface GoSummaryData {
  rxBytes: number;
  txBytes: number;
  totalBytes: number;
  rxBps: number;
  txBps: number;
  totalBps: number;
  packets: number;
  flows: number;
  uplinkCapacityBps: number | null;
  uplinkUsagePercent: number | null;
  uplinkRemainingBps: number | null;
  busyInterfaceName: string | null;
  busyRouterName: string | null;
  busyThroughputBps: number | null;
}

export interface GoTopTalkerRecord {
  ip: string;
  customerId: string | null;
  customerName: string | null;
  pppoeUsername: string | null;
  planMbps: number | null;
  odpName: string | null;
  rxBytes: number;
  txBytes: number;
  totalBytes: number;
  packets: number;
  flows: number;
  throughputBps: number;
  topProtocol: string;
  isMapped: boolean;
}

export interface GoCustomerUsageRecord {
  customerId: string;
  customerName: string;
  pppoeUsername: string;
  planMbps: number;
  odpName: string | null;
  rxBytes: number;
  txBytes: number;
  totalBytes: number;
  packets: number;
  flows: number;
  peakThroughputBps: number | null;
  peakTime: number | null;
  fupLimitBytes: number | null;
  fupUsagePercent: number | null;
  status: string;
}

interface RawBackendNetflowSession {
  id: string;
  routerId?: string | null;
  routerName?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  direction?: string | null;
  ponPort?: string | null;
  srcIp: string;
  srcPort: number;
  dstIp: string;
  dstPort: number;
  protocol?: string | null;
  bytes?: number | string | null;
  packets?: number | string | null;
  capturedAt?: number | null;
}

export async function loadNetflow(now: number, isDemo = false): Promise<NetflowRecord[]> {
  if (!isDemo) {
    try {
      const rawSessions = await backendGet<RawBackendNetflowSession[]>("/api/v1/netflow/sessions", {
        range: "7d",
        limit: 200,
      });
      if (Array.isArray(rawSessions)) {
        return rawSessions.map((s) => ({
          id: s.id,
          routerId: s.routerId ?? "",
          routerName: s.routerName ?? "Router tidak dikenal",
          customerId: s.customerId ?? null,
          customerName: s.customerName ?? null,
          direction: s.direction === "up" || s.direction === "down" ? s.direction : null,
          ponPort: s.ponPort ?? null,
          srcIp: s.srcIp,
          srcPort: s.srcPort,
          dstIp: s.dstIp,
          dstPort: s.dstPort,
          protocol: (s.protocol?.toUpperCase() as FlowProtocol) || "TCP",
          app: appForPort(s.protocol || "TCP", s.dstPort),
          bytes: Number(s.bytes) || 0,
          packets: Number(s.packets) || 0,
          startedAt: s.capturedAt || now,
          durationSec: 0,
          endedAt: s.capturedAt || now,
        }));
      }
    } catch {
      // Jaringan backend terputus: kembalikan daftar kosong
    }
    return [];
  }
  return Promise.resolve(mockNetflow(now, flowRangeSeconds["7d"]));
}
// Nama aplikasi dari protokol + port tujuan (DB tidak menyimpan kolom app).
export function appForPort(protocol: string, dstPort: number): string {
  return (
    APPS.find((a) => a.protocol === protocol && a.port === dstPort)?.app ??
    (protocol === "ICMP" ? "ICMP" : "Lainnya")
  );
}

// Flow dalam rentang `range` sampai `now`, terbaru dulu (sumber mock untuk API).
export function getNetflowFlows(now: number, range: FlowRange): NetflowRecord[] {
  return mockNetflow(now, flowRangeSeconds[range]);
}

export interface TopFlowsParams {
  range?: FlowRange;
  routerId?: string;
  protocol?: string;
  app?: string;
  q?: string;
  limit?: number;
}

export interface TopFlowsResult {
  flows: NetflowRecord[];
  totalBytes: number;
  totalPackets: number;
}

// Murni: saring + urutkan menurut bytes. Total dihitung dari flow yang dikembalikan.
export function selectTopFlows(
  flows: NetflowRecord[],
  params: TopFlowsParams,
  now: number,
): TopFlowsResult {
  const protocol =
    params.protocol && params.protocol !== "ALL"
      ? (params.protocol as FlowProtocol)
      : null;
  const app = params.app?.trim().toLowerCase();
  const filtered = filterFlows(
    flows,
    {
      ...defaultFlowFilter,
      range: params.range ?? "1h",
      routerId: params.routerId ?? null,
      protocol,
    },
    now,
  ).filter((f) => !app || f.app.toLowerCase() === app);
  const q = params.q?.trim().toLowerCase();
  const matched = q
    ? filtered.filter(
        (f) =>
          f.srcIp.includes(q) ||
          f.dstIp.includes(q) ||
          String(f.srcPort) === q ||
          String(f.dstPort) === q,
      )
    : filtered;
  const top = topFlows(matched, params.limit ?? 50);
  return {
    flows: top,
    totalBytes: top.reduce((s, f) => s + f.bytes, 0),
    totalPackets: top.reduce((s, f) => s + f.packets, 0),
  };
}

export function resolveCustomerForIp(
  _ip: string,
  _customers?: readonly DashboardCustomer[],
): DashboardCustomer | null {
  return null;
}

export interface NetflowDirectionalSummary {
  rxBytes: number;
  txBytes: number;
  rxBps: number;
  txBps: number;
  totalBytes: number;
  totalBps: number;
  uplinkCapacityBps: number | null;
  uplinkUsagePercent: number | null;
  uplinkRemainingBps: number | null;
  busyInterface: {
    name: string;
    routerName: string;
    bps: number;
  } | null;
}

export function summarizeDirectionalNetflow(
  flows: NetflowRecord[],
  range: FlowRange,
  uplinkCapacityBps: number | null = null,
): NetflowDirectionalSummary {
  const seconds = flowRangeSeconds[range];
  let rxBytes = 0;
  let txBytes = 0;
  const routerBytes = new Map<string, number>();

  for (const f of flows) {
    if (f.direction === "down") {
      rxBytes += f.bytes;
    } else if (f.direction === "up") {
      txBytes += f.bytes;
    } else {
      rxBytes += Math.round(f.bytes / 2);
      txBytes += f.bytes - Math.round(f.bytes / 2);
    }
    routerBytes.set(f.routerName, (routerBytes.get(f.routerName) ?? 0) + f.bytes);
  }

  const totalBytes = rxBytes + txBytes;
  const totalBps = (totalBytes * 8) / seconds;
  const rxBps = (rxBytes * 8) / seconds;
  const txBps = (txBytes * 8) / seconds;

  let topRouterName: string | null = null;
  let maxRtrBytes = 0;
  for (const [rName, b] of routerBytes) {
    if (b > maxRtrBytes) {
      maxRtrBytes = b;
      topRouterName = rName;
    }
  }

  const busyInterface = topRouterName
    ? {
        name: `${topRouterName}-uplink`,
        routerName: topRouterName,
        bps: (maxRtrBytes * 8) / seconds,
      }
    : null;

  const uplinkUsagePercent =
    uplinkCapacityBps && uplinkCapacityBps > 0
      ? Math.min(100, (totalBps / uplinkCapacityBps) * 100)
      : null;
  const uplinkRemainingBps =
    uplinkCapacityBps && uplinkCapacityBps > 0
      ? Math.max(0, uplinkCapacityBps - totalBps)
      : null;

  return {
    rxBytes,
    txBytes,
    rxBps,
    txBps,
    totalBytes,
    totalBps,
    uplinkCapacityBps,
    uplinkUsagePercent,
    uplinkRemainingBps,
    busyInterface,
  };
}

export interface TopTalkerCustomer {
  id: string;
  name: string;
  pppoeUsername: string;
  planMbps?: number;
  odpName?: string;
}

export interface TopTalker {
  ip: string;
  customer: TopTalkerCustomer | null;
  bytes: number;
  packets: number;
  throughputBps: number;
  topApp: string;
  flowCount: number;
}

export function getTopTalkers(
  flows: NetflowRecord[],
  limit = 10,
  customers?: readonly DashboardCustomer[],
): TopTalker[] {
  const map = new Map<
    string,
    { bytes: number; packets: number; duration: number; apps: Map<string, number>; count: number }
  >();

  for (const f of flows) {
    const clientIp = f.srcIp.startsWith("10.")
      ? f.srcIp
      : f.dstIp.startsWith("10.")
      ? f.dstIp
      : f.srcIp;
    let entry = map.get(clientIp);
    if (!entry) {
      entry = { bytes: 0, packets: 0, duration: 0, apps: new Map(), count: 0 };
      map.set(clientIp, entry);
    }
    entry.bytes += f.bytes;
    entry.packets += f.packets;
    entry.duration = Math.max(entry.duration, f.durationSec);
    entry.apps.set(f.app, (entry.apps.get(f.app) ?? 0) + f.bytes);
    entry.count += 1;
  }

  const items: TopTalker[] = [];
  for (const [ip, data] of map) {
    const customer = resolveCustomerForIp(ip, customers);
    const topApp = maxByBytes(data.apps) ?? "Lainnya";
    const throughputBps = (data.bytes * 8) / Math.max(1, data.duration);
    items.push({
      ip,
      customer,
      bytes: data.bytes,
      packets: data.packets,
      throughputBps,
      topApp,
      flowCount: data.count,
    });
  }

  return items.sort((a, b) => b.bytes - a.bytes).slice(0, limit);
}

export type FupStatus = "normal" | "warning" | "exceeded" | "untracked";

export interface CustomerFupUsage {
  customerId: string;
  customerName: string;
  pppoeUsername: string;
  planMbps: number;
  odpName: string;
  rxBytes: number;
  txBytes: number;
  totalBytes: number;
  peakThroughputBps: number | null;
  peakTime: number | null;
  fupLimitBytes: number | null;
  fupPercent: number | null;
  status: FupStatus;
  flowCount: number;
}

export function buildCustomerFupUsage(
  flows: NetflowRecord[],
  customers?: readonly DashboardCustomer[],
): CustomerFupUsage[] {
  const map = new Map<
    string,
    { rx: number; tx: number; total: number; peakBps: number; peakTime: number; count: number }
  >();

  for (const f of flows) {
    const custId = f.customerId;
    if (!custId) continue;

    let rec = map.get(custId);
    if (!rec) {
      rec = { rx: 0, tx: 0, total: 0, peakBps: 0, peakTime: f.startedAt, count: 0 };
      map.set(custId, rec);
    }

    const rx = f.direction === "down" ? f.bytes : f.direction === "up" ? 0 : Math.round(f.bytes / 2);
    const tx = f.direction === "up" ? f.bytes : f.direction === "down" ? 0 : f.bytes - rx;
    const flowBps = (f.bytes * 8) / Math.max(1, f.durationSec);

    rec.rx += rx;
    rec.tx += tx;
    rec.total += f.bytes;
    rec.count += 1;
    if (flowBps > rec.peakBps) {
      rec.peakBps = flowBps;
      rec.peakTime = f.startedAt;
    }
  }

  const usages: CustomerFupUsage[] = [];
  if (customers) {
    for (const cust of customers) {
      const rec = map.get(cust.id);
      if (!rec) continue;
      usages.push({
        customerId: cust.id,
        customerName: cust.name,
        pppoeUsername: cust.pppoeUsername,
        planMbps: cust.planMbps,
        odpName: cust.odpName,
        rxBytes: rec.rx,
        txBytes: rec.tx,
        totalBytes: rec.total,
        peakThroughputBps: rec.peakBps > 0 ? rec.peakBps : null,
        peakTime: rec.peakTime,
        fupLimitBytes: null,
        fupPercent: null,
        status: "normal",
        flowCount: rec.count,
      });
    }
  }

  return usages.sort((a, b) => b.totalBytes - a.totalBytes);
}

export interface ReceiverHealth {
  active: boolean;
  addr: string;
  uptimeSeconds: number;
  totalPackets: number;
  totalFlows: number;
  totalBytes: number;
  unknownSources: number;
  unknownTemplates: number;
  lastReceivedAt?: string;
  exporters: GoExporterStatus[];
}

export interface GoExporterStatus {
  ip: string;
  routerId: string;
  version: number;
  packets: number;
  flows: number;
  samplingRate: number;
  lastSeen: string;
}

export interface NetflowExporterStatus {
  routerId: string;
  routerName: string;
  host: string;
  version: "NetFlow v5" | "NetFlow v9" | "IPFIX";
  samplingRate: string;
  multiplier: number;
  totalPackets: number;
  totalFlows: number;
  lastSeenText: string;
  status: "active" | "idle";
}

export function mapGoExporterToView(
  exp: GoExporterStatus,
  routers: readonly { id: string; name: string; host?: string }[] = mockRouters,
  nowMs = Date.now(),
): NetflowExporterStatus {
  const router = routers.find((r) => r.id === exp.routerId);
  const routerName = router?.name ?? (exp.routerId ? `Router-${exp.routerId.slice(0, 8)}` : "Router tidak terdaftar");
  const host = exp.ip || router?.host || "-";
  const version = (
    exp.version === 9
      ? "NetFlow v9"
      : exp.version === 10
      ? "IPFIX"
      : "NetFlow v5"
  ) as "NetFlow v5" | "NetFlow v9" | "IPFIX";
  const lastSeenDate = new Date(exp.lastSeen);
  const diffMs = nowMs - (isNaN(lastSeenDate.getTime()) ? nowMs : lastSeenDate.getTime());
  const isActive = diffMs < 15 * 60 * 1000;
  const multiplier = exp.samplingRate > 0 ? exp.samplingRate : 1;
  const samplingRate = multiplier > 1 ? `1:${multiplier}` : "1:1 (Penuh)";

  return {
    routerId: exp.routerId,
    routerName,
    host,
    version,
    samplingRate,
    multiplier,
    totalPackets: exp.packets,
    totalFlows: exp.flows,
    lastSeenText: isActive
      ? `${Math.max(1, Math.round(diffMs / 60000))} mnt lalu`
      : isNaN(lastSeenDate.getTime())
      ? "-"
      : lastSeenDate.toLocaleDateString("id-ID"),
    status: isActive ? "active" : "idle",
  };
}

export function getMockExporters(flows: NetflowRecord[]): NetflowExporterStatus[] {
  const routerFlowCount = new Map<string, number>();
  const routerPacketCount = new Map<string, number>();
  for (const f of flows) {
    routerFlowCount.set(f.routerId, (routerFlowCount.get(f.routerId) ?? 0) + 1);
    routerPacketCount.set(f.routerId, (routerPacketCount.get(f.routerId) ?? 0) + f.packets);
  }

  return mockRouters.map((r, i) => {
    const version = (
      i === 0 ? "NetFlow v9" : i === 1 ? "IPFIX" : "NetFlow v5"
    ) as "NetFlow v5" | "NetFlow v9" | "IPFIX";
    const samplingRate = i === 0 ? "1:100" : i === 1 ? "1:500" : "1:1";
    const multiplier = i === 0 ? 100 : i === 1 ? 500 : 1;
    const rawFlows = routerFlowCount.get(r.id) ?? 120 + i * 45;
    const packets = (routerPacketCount.get(r.id) ?? rawFlows * 850) * multiplier;
    return {
      routerId: r.id,
      routerName: r.name,
      host: `10.10.0.${i + 1}`,
      version,
      samplingRate,
      multiplier,
      totalPackets: packets,
      totalFlows: rawFlows * multiplier,
      lastSeenText: i === 0 ? "Baru saja (3 dtk)" : i === 1 ? "12 dtk lalu" : "45 dtk lalu",
      status: "active" as const,
    };
  });
}

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '""';
  let str = String(v).replace(/"/g, '""');
  if (/^[=+\-@]/.test(str)) {
    str = "'" + str;
  }
  return `"${str}"`;
}

export function exportFlowsToCsv(
  flows: NetflowRecord[],
  customers?: readonly DashboardCustomer[],
): string {
  const header = [
    "No",
    "Waktu Mulai",
    "Router",
    "Pelanggan",
    "IP Asal",
    "Port Asal",
    "IP Tujuan",
    "Port Tujuan",
    "Protokol",
    "Aplikasi",
    "Bytes",
    "Paket",
    "Throughput (bps)",
  ];

  const lines = [header.join(",")];
  flows.forEach((f, index) => {
    const cust = resolveCustomerForIp(f.srcIp, customers);
    const custName = cust ? cust.name : (f.customerName ?? "Belum terpetakan");
    const bps = Math.round((f.bytes * 8) / Math.max(1, f.durationSec));
    const timeStr = new Date(f.startedAt * 1000).toISOString();
    lines.push(
      [
        index + 1,
        csvCell(timeStr),
        csvCell(f.routerName),
        csvCell(custName),
        f.srcIp,
        f.srcPort,
        f.dstIp,
        f.dstPort,
        f.protocol,
        csvCell(f.app),
        f.bytes,
        f.packets,
        bps,
      ].join(","),
    );
  });
  return lines.join("\n");
}

export function exportFupToCsv(usages: CustomerFupUsage[]): string {
  const header = [
    "No",
    "ID Pelanggan",
    "Nama Pelanggan",
    "Username PPPoE",
    "Paket (Mbps)",
    "Lokasi ODP",
    "Total Unduh (Bytes)",
    "Total Unggah (Bytes)",
    "Total Pemakaian (Bytes)",
    "Puncak Throughput (bps)",
    "Batas Kuota FUP (Bytes)",
    "Persentase FUP (%)",
    "Status FUP",
  ];

  const lines = [header.join(",")];
  usages.forEach((u, index) => {
    lines.push(
      [
        index + 1,
        csvCell(u.customerId),
        csvCell(u.customerName),
        csvCell(u.pppoeUsername),
        u.planMbps,
        csvCell(u.odpName),
        u.rxBytes,
        u.txBytes,
        u.totalBytes,
        u.peakThroughputBps !== null ? Math.round(u.peakThroughputBps) : "tidak dapat dibaca",
        u.fupLimitBytes !== null ? u.fupLimitBytes : "Tidak ditetapkan",
        u.fupPercent !== null ? u.fupPercent.toFixed(1) : "-",
        csvCell(
          u.status === "exceeded"
            ? "Melewati Batas"
            : u.status === "warning"
            ? "Mendekati Batas"
            : u.status === "untracked"
            ? "Belum dipantau"
            : "Normal",
        ),
      ].join(","),
    );
  });
  return lines.join("\n");
}

