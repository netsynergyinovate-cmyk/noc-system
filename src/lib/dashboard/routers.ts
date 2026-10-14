import type { DashboardCustomer, DashboardRouter } from "./types.ts";

// Rincian router tiruan; kontrak untuk REST API RouterOS v7 yang belum tersambung.
export interface MockRouterDetail {
  id: string;
  name: string;
  host: string;
  boardModel: string;
  rosVersion: string;
  role: string;
  cpuLoad: number; // 0-100 (%)
  memoryUsage: number; // 0-100 (%)
  uptime: string;
  active: boolean;
  queueCount: number; // >= 0
  temperature: number; // derajat Celsius, 0 = tidak ada sensor / offline
  pppoeCount: number; // >= 0
}

export type RouterStatusFilter = "all" | "active" | "disconnected";

export const CPU_WARNING_THRESHOLD = 80;

// ID sama dengan `mockRouters` di mock-data.ts.
export const defaultRouterDetails: readonly MockRouterDetail[] = [
  {
    id: "router-1",
    name: "RTR-Core-CCR2004",
    host: "10.10.0.1",
    boardModel: "CCR2004-1G-12S+2XS",
    rosVersion: "RouterOS v7.15.3",
    role: "Core / BGP Edge",
    cpuLoad: 34,
    memoryUsage: 41,
    uptime: "48 hari",
    active: true,
    queueCount: 128,
    temperature: 42,
    pppoeCount: 0,
  },
  {
    id: "router-2",
    name: "RTR-Distribusi-RB5009",
    host: "10.10.0.2",
    boardModel: "RB5009UG+S+IN",
    rosVersion: "RouterOS v7.16.1",
    role: "Distribusi / PPPoE BRAS",
    cpuLoad: 88,
    memoryUsage: 63,
    uptime: "21 hari",
    active: true,
    queueCount: 64,
    temperature: 51,
    pppoeCount: 0,
  },
  {
    id: "router-3",
    name: "RTR-Agg-CRS326",
    host: "10.10.0.3",
    boardModel: "CRS326-24G-2S+RM",
    rosVersion: "RouterOS v7.14.2",
    role: "Aggregasi OLT",
    cpuLoad: 22,
    memoryUsage: 37,
    uptime: "92 hari",
    active: true,
    queueCount: 16,
    temperature: 38,
    pppoeCount: 0,
  },
];

// Gabungkan router dari store dengan rincian tiruan. Router tak dikenal dapat
// nilai bawaan; router nonaktif tidak punya beban/uptime. Router dikenal
// memakai nama/host rincian tiruan; `active` mengikuti store; `pppoeCount`
// dari hitungan sesi pelanggan.
export function buildRouterDetails(
  routers: readonly DashboardRouter[],
  sessionCounts: Readonly<Record<string, number>> = {},
): MockRouterDetail[] {
  return routers.map((router) => {
    const base = defaultRouterDetails.find((d) => d.id === router.id);
    const detail: MockRouterDetail = base
      ? { ...base }
      : {
          id: router.id,
          name: router.name,
          host: router.host,
          boardModel: "MikroTik RouterBOARD",
          rosVersion: "RouterOS v7.15",
          role: "Gateway",
          cpuLoad: 28,
          memoryUsage: 35,
          uptime: "12 hari",
          active: router.active,
          queueCount: 0,
          temperature: 40,
          pppoeCount: 0,
        };
    detail.active = router.active;
    detail.pppoeCount = sessionCounts[router.id] ?? 0;
    if (!router.active) {
      detail.cpuLoad = 0;
      detail.memoryUsage = 0;
      detail.temperature = 0;
      detail.uptime = "Offline";
    }
    return detail;
  });
}

// RouterOS menulis uptime seperti "3w2d4h5m6s". Diubah menjadi teks Indonesia
// yang ringkas: dua satuan terbesar yang tidak nol ("23 hari 4 jam").
export function formatRouterOsUptime(raw: string): string {
  const units: Record<string, [number, string]> = {
    w: [604800, "minggu"],
    d: [86400, "hari"],
    h: [3600, "jam"],
    m: [60, "menit"],
    s: [1, "detik"],
  };
  let seconds = 0;
  let matched = false;
  for (const m of raw.matchAll(/(\d+)([wdhms])/g)) {
    seconds += Number(m[1]) * units[m[2]][0];
    matched = true;
  }
  if (!matched) return raw || "-";
  const parts: string[] = [];
  let rest = seconds;
  // Minggu dipecah ke hari supaya "23 hari" lebih mudah dibaca daripada "3 minggu 2 hari".
  for (const [size, label] of [
    [86400, "hari"],
    [3600, "jam"],
    [60, "menit"],
    [1, "detik"],
  ] as const) {
    const n = Math.floor(rest / size);
    rest -= n * size;
    if (n > 0) parts.push(`${n} ${label}`);
    if (parts.length === 2) break;
  }
  return parts.length > 0 ? parts.join(" ") : "0 detik";
}

// Mode live: rincian router HANYA dari yang dibaca server dari router
// (/api/routers/resources). Router yang belum terbaca (jawaban belum datang atau
// router tidak menjawab) ditampilkan apa adanya dengan nilai kosong, tidak diisi
// angka karangan. `active` mengikuti store (status dari polling backend Go) dan
// `pppoeCount` dari hitungan pelanggan.
export function buildLiveRouterDetails(
  routers: readonly DashboardRouter[],
  items: readonly MockRouterDetail[] | null,
  sessionCounts: Readonly<Record<string, number>> = {},
): MockRouterDetail[] {
  const byId = new Map((items ?? []).map((item) => [item.id, item]));
  return routers.map((router) => {
    const item = byId.get(router.id);
    const detail: MockRouterDetail = item
      ? { ...item }
      : {
          id: router.id,
          name: router.name,
          host: router.host,
          boardModel: "-",
          rosVersion: "-",
          role: "Gateway",
          cpuLoad: 0,
          memoryUsage: 0,
          uptime: "-",
          active: router.active,
          queueCount: 0,
          temperature: 0,
          pppoeCount: 0,
        };
    detail.name = router.name;
    detail.host = router.host;
    detail.active = router.active && (item ? item.active : true);
    detail.pppoeCount = sessionCounts[router.id] ?? 0;
    if (!detail.active) {
      detail.cpuLoad = 0;
      detail.memoryUsage = 0;
      detail.temperature = 0;
      detail.uptime = "Offline";
    }
    return detail;
  });
}

export function isCpuWarning(router: Pick<MockRouterDetail, "cpuLoad" | "active">): boolean {
  return router.active && router.cpuLoad > CPU_WARNING_THRESHOLD;
}

export interface RouterResourceSummary {
  totalRouters: number;
  activeRouters: number;
  offlineRouters: number;
  warningRouters: number; // router aktif dengan CPU > CPU_WARNING_THRESHOLD
  avgCpuLoad: number; // rata-rata router aktif, dibulatkan; 0 jika tak ada
  peakCpuLoad: { routerName: string; value: number } | null;
  avgMemoryUsage: number;
  totalQueues: number;
  totalPppoe: number;
}

// Ringkasan resource. Router offline tidak ikut rata-rata/puncak CPU & RAM.
export function summarizeRouterResources(
  routers: readonly MockRouterDetail[],
): RouterResourceSummary {
  const active = routers.filter((r) => r.active);
  let peak: RouterResourceSummary["peakCpuLoad"] = null;
  let cpu = 0;
  let mem = 0;
  for (const r of active) {
    cpu += r.cpuLoad;
    mem += r.memoryUsage;
    if (!peak || r.cpuLoad > peak.value) peak = { routerName: r.name, value: r.cpuLoad };
  }
  const n = active.length;
  return {
    totalRouters: routers.length,
    activeRouters: n,
    offlineRouters: routers.length - n,
    warningRouters: routers.filter(isCpuWarning).length,
    avgCpuLoad: n ? Math.round(cpu / n) : 0,
    peakCpuLoad: peak,
    avgMemoryUsage: n ? Math.round(mem / n) : 0,
    totalQueues: routers.reduce((s, r) => s + r.queueCount, 0),
    totalPppoe: routers.reduce((s, r) => s + r.pppoeCount, 0),
  };
}

// Pencarian: setiap kata harus cocok (tanpa beda huruf besar) dengan nama,
// host atau model board. Query kosong tidak menyaring.
export function filterRouterDetails(
  routers: readonly MockRouterDetail[],
  query: string,
  statusFilter: RouterStatusFilter = "all",
): MockRouterDetail[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return routers.filter((r) => {
    if (statusFilter === "active" && !r.active) return false;
    if (statusFilter === "disconnected" && r.active) return false;
    const haystack = `${r.name} ${r.host} ${r.boardModel}`.toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
}

// ---- Simple Queue tiruan (kontrak untuk GET /rest/queue/simple) ----

export interface MockSimpleQueue {
  id: string;
  routerId: string;
  name: string;
  target: string; // mis. "10.20.1.3/32"
  maxLimit: { upload: number; download: number }; // bit/detik
  rate: { upload: number; download: number }; // bit/detik
  bytes: { upload: number; download: number };
  dropped: number;
  disabled: boolean;
  comment?: string;
}

export type QueueStatusFilter = "all" | "active" | "disabled";

export function formatBitrate(bps: number): string {
  if (!Number.isFinite(bps) || bps <= 0) return "0 bps";
  const units = ["bps", "kbps", "Mbps", "Gbps"];
  let i = 0;
  let v = bps;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${i === 0 ? v : Number(v.toFixed(v >= 100 ? 0 : 1))} ${units[i]}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? v : Number(v.toFixed(v >= 100 ? 0 : 1))} ${units[i]}`;
}

// Hash string -> 0..1, deterministik supaya data tiruan stabil antar render.
function unit(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

// Satu queue per pelanggan router tersebut. Pelanggan offline/isolir: rate 0.
// ponytail: data tiruan; ganti dengan hasil GET /rest/queue/simple saat REST tersambung.
export function generateMockSimpleQueues(
  routerId: string,
  customers: readonly DashboardCustomer[] = [],
): MockSimpleQueue[] {
  const own = customers.filter((c) => c.routerId === routerId);
  const m = /(\d+)$/.exec(routerId);
  const rIdx = m ? Number(m[1]) % 256 : Math.floor(unit(routerId) * 255);
  return own.map((c, i) => {
    const plan = Math.max(1, c.planMbps);
    const maxLimit = { upload: Math.round((plan / 2) * 1e6), download: plan * 1e6 };
    const isolir = c.billingStatus === "isolir";
    const live = c.isOnline && !isolir;
    const fu = 0.15 + unit(`${c.id}:u`) * 0.7;
    const fd = 0.15 + unit(`${c.id}:d`) * 0.7;
    return {
      id: `q-${routerId}-${c.id}`,
      routerId,
      name: c.pppoeUsername || c.name,
      target: `10.20.${rIdx}.${(i % 254) + 1}/32`,
      maxLimit,
      rate: live
        ? {
            upload: Math.round(maxLimit.upload * fu),
            download: Math.round(maxLimit.download * fd),
          }
        : { upload: 0, download: 0 },
      bytes: {
        upload: Math.round(unit(`${c.id}:bu`) * 40e9),
        download: Math.round(unit(`${c.id}:bd`) * 400e9),
      },
      dropped: Math.floor(unit(`${c.id}:x`) * (live ? 500 : 50)),
      disabled: isolir,
      comment: c.name,
    };
  });
}

// Pencarian: setiap kata cocok dengan nama/target/komentar; status active = tidak disabled.
export function filterSimpleQueues(
  queues: readonly MockSimpleQueue[],
  query: string,
  statusFilter: QueueStatusFilter = "all",
): MockSimpleQueue[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return queues.filter((q) => {
    if (statusFilter === "active" && q.disabled) return false;
    if (statusFilter === "disabled" && !q.disabled) return false;
    const haystack = `${q.name} ${q.target} ${q.comment ?? ""}`.toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
}

export interface SimpleQueueSummary {
  total: number;
  active: number;
  disabled: number;
  rateUpload: number; // bit/detik, hanya queue aktif
  rateDownload: number;
}

export function summarizeSimpleQueues(queues: readonly MockSimpleQueue[]): SimpleQueueSummary {
  const s: SimpleQueueSummary = { total: queues.length, active: 0, disabled: 0, rateUpload: 0, rateDownload: 0 };
  for (const q of queues) {
    if (q.disabled) {
      s.disabled++;
      continue;
    }
    s.active++;
    s.rateUpload += q.rate.upload;
    s.rateDownload += q.rate.download;
  }
  return s;
}
