// Data tiruan ringkasan jaringan & router. TIRUAN SEMENTARA: wajib dialihkan ke
// REST API MikroTik nyata saat go-live (Fase 5). Murni, tanpa impor lain.

export interface NetworkTopologyOverview {
  totalRouters: number;
  activeRouters: number;
  offlineRouters: number;
  totalInterfaces: number;
  totalQueues: number;
  totalActivePppoe: number;
  networkHealthScore: number; // 0 - 100
  sourceStatus: "dummy" | "nyata";
  lastScannedAt: string;
}

export interface NetworkRouterItem {
  id: string;
  name: string;
  host: string;
  model: string;
  version: string;
  uptime: string;
  cpuPercent: number;
  memoryPercent: number;
  activePppoeCount: number;
  status: "online" | "offline" | "degraded";
  trafficInMbps: number;
  trafficOutMbps: number;
}

export const NETWORK_DATA_MOCK_ENTRY = {
  id: "network-devices-overview",
  module: "Ringkasan Jaringan & Router",
  targetDevice: "Router MikroTik v7 REST API",
  status: "dummy" as const,
  readPath: "src/lib/dashboard/network-mock-data.ts (getMockNetworkOverview)",
  writePath: "POST /api/routers",
  envKey: "MIKROTIK_REST_HOST",
  notes:
    "Tiruan sementara data topologi & metrik router MikroTik; wajib dialihkan ke REST API perangkat nyata di Fase 5",
};

// Tetap (bukan jam sekarang) supaya server dan klien merender teks yang sama.
const MOCK_SCANNED_AT = "2026-01-01T00:00:00.000Z";
const INTERFACES_PER_ROUTER = 8;

const MOCK_ROUTERS: readonly NetworkRouterItem[] = [
  { id: "rtr-core-01", name: "CORE-01", host: "10.10.0.1", model: "CCR2004-1G-12S+2XS", version: "7.15.3", uptime: "92d 4h", cpuPercent: 34, memoryPercent: 41, activePppoeCount: 412, status: "online", trafficInMbps: 1840, trafficOutMbps: 920 },
  { id: "rtr-core-02", name: "CORE-02", host: "10.10.0.2", model: "CCR2004-1G-12S+2XS", version: "7.15.3", uptime: "92d 4h", cpuPercent: 29, memoryPercent: 38, activePppoeCount: 388, status: "online", trafficInMbps: 1610, trafficOutMbps: 805 },
  { id: "rtr-pop-a", name: "POP-A", host: "10.10.1.1", model: "RB4011iGS+", version: "7.14.1", uptime: "41d 17h", cpuPercent: 46, memoryPercent: 52, activePppoeCount: 215, status: "online", trafficInMbps: 640, trafficOutMbps: 310 },
  { id: "rtr-pop-b", name: "POP-B", host: "10.10.2.1", model: "RB4011iGS+", version: "7.14.1", uptime: "12d 2h", cpuPercent: 88, memoryPercent: 71, activePppoeCount: 297, status: "degraded", trafficInMbps: 905, trafficOutMbps: 450 },
  { id: "rtr-pop-c", name: "POP-C", host: "10.10.3.1", model: "RB3011UiAS", version: "7.13.5", uptime: "63d 9h", cpuPercent: 38, memoryPercent: 44, activePppoeCount: 164, status: "online", trafficInMbps: 410, trafficOutMbps: 190 },
  { id: "rtr-pop-d", name: "POP-D", host: "10.10.4.1", model: "RB3011UiAS", version: "7.13.5", uptime: "0d 0h", cpuPercent: 0, memoryPercent: 0, activePppoeCount: 0, status: "offline", trafficInMbps: 0, trafficOutMbps: 0 },
];

export function getMockRouterItems(): NetworkRouterItem[] {
  return MOCK_ROUTERS.map((r) => ({ ...r }));
}

// Skor: online penuh, degraded setengah, offline nol (0-100, dibulatkan).
// Bila `routers` diberikan, itulah yang dihitung; selain itu daftar tiruan.
export function getMockNetworkOverview(
  routers?: readonly Partial<NetworkRouterItem>[],
): NetworkTopologyOverview {
  const items = routers ?? MOCK_ROUTERS;
  const total = items.length;
  const online = items.filter((r) => r.status === "online").length;
  const degraded = items.filter((r) => r.status === "degraded").length;
  const offline = items.filter((r) => r.status === "offline").length;
  const pppoe = items.reduce((n, r) => n + (r.activePppoeCount ?? 0), 0);
  const score = total === 0 ? 0 : Math.round(((online + degraded / 2) / total) * 100);
  return {
    totalRouters: total,
    activeRouters: online + degraded,
    offlineRouters: offline,
    totalInterfaces: total * INTERFACES_PER_ROUTER,
    totalQueues: pppoe, // satu queue per sesi PPPoE
    totalActivePppoe: pppoe,
    networkHealthScore: Math.min(100, Math.max(0, score)),
    sourceStatus: "dummy",
    lastScannedAt: MOCK_SCANNED_AT,
  };
}

export function isNetworkMockActive(status?: "dummy" | "nyata"): boolean {
  return status === "dummy";
}
