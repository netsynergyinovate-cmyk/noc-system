import { mockRouters } from "./mock-data.ts";

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
}

export const defaultFlowFilter: FlowFilter = {
  range: "1h",
  routerId: null,
  protocol: null,
  query: "",
  clientIp: "",
  dstPort: "",
};

export function filterFlows(
  flows: NetflowRecord[],
  filter: FlowFilter,
  now: number,
): NetflowRecord[] {
  const from = now - flowRangeSeconds[filter.range];
  const q = filter.query.trim().toLowerCase();
  const cleanIp = (filter.clientIp ?? "").trim();
  const cleanPort = (filter.dstPort ?? "").trim();
  return flows.filter(
    (f) =>
      f.endedAt > from &&
      f.endedAt <= now &&
      (!filter.routerId || f.routerId === filter.routerId) &&
      (!filter.protocol || f.protocol === filter.protocol) &&
      (!cleanIp || f.srcIp.includes(cleanIp) || f.dstIp.includes(cleanIp)) &&
      (!cleanPort || String(f.dstPort) === cleanPort) &&
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

export function loadNetflow(now: number): Promise<NetflowRecord[]> {
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
