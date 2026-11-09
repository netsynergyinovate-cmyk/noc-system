// Pure: ubah data router/OLT (bentuk longgar) jadi kartu status perangkat.
// Tanpa import, supaya bisa diuji langsung oleh node:test.

export interface DeviceHardwareStatus {
  id: string;
  name: string;
  type: "router" | "olt";
  brand: string;
  ipAddress: string;
  status: "online" | "offline" | "warning";
  uptime: string;
  cpuOrTemp: string; // "CPU 24%" untuk router, "Temp 41°C" untuk OLT
  capacitySummary: string; // "128 Pelanggan" atau "8 PON / 128 ONU"
  trafficSummary?: string; // "↓ 1.2 Gbps / ↑ 340 Mbps"
  lastSeenText: string;
}

export interface AggregateDeviceStatus {
  totalRouters: number;
  onlineRouters: number;
  totalOlts: number;
  onlineOlts: number;
  totalActivePppoe: number;
  totalActiveOnus: number;
  allHealthy: boolean;
}

export const CPU_WARN_PERCENT = 80;
export const TEMP_WARN_CELSIUS = 45;

// Ponytail: input sengaja `any`; kontrak final menunggu API perangkat nyata.
/* eslint-disable @typescript-eslint/no-explicit-any */

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

// Router/OLT dianggap hidup kecuali ditandai sebaliknya.
function isUp(d: any): boolean {
  if (d?.active === false || d?.online === false) return false;
  if (d?.status === "nonaktif" || d?.status === "offline") return false;
  return true;
}

function formatUptime(v: unknown): string {
  if (typeof v === "string" && v.trim()) return v;
  const s = num(v);
  if (s === null || s < 0) return "—";
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  if (days > 0) return `${days} hari ${hours} jam`;
  const mins = Math.floor((s % 3600) / 60);
  return `${hours} jam ${mins} menit`;
}

function formatLastSeen(d: any, up: boolean): string {
  if (up) return "Baru saja";
  const t = d?.lastSeenAt;
  if (typeof t === "string" || typeof t === "number") {
    const date = new Date(t);
    if (!Number.isNaN(date.getTime()))
      return `Terakhir terlihat ${date.toISOString()}`;
  }
  return "Tidak terjangkau";
}

export function formatRate(mbps: number): string {
  return mbps >= 1000
    ? `${(mbps / 1000).toFixed(1)} Gbps`
    : `${Math.round(mbps)} Mbps`;
}

function trafficOf(d: any): string | undefined {
  const rx = num(d?.rxMbps);
  const tx = num(d?.txMbps);
  if (rx === null || tx === null) return undefined;
  return `↓ ${formatRate(rx)} / ↑ ${formatRate(tx)}`;
}

export function transformRoutersToStatusCards(
  routers: any[],
  customers?: any[],
): DeviceHardwareStatus[] {
  return (routers ?? []).map((r) => {
    const up = isUp(r);
    const cpu = num(r.cpuLoad);
    const fromCustomers = customers
      ? customers.filter((c) => c.routerId === r.id).length
      : null;
    const sessions = fromCustomers ?? num(r.pppoeCount) ?? 0;
    const warning = up && cpu !== null && cpu > CPU_WARN_PERCENT;
    return {
      id: String(r.id),
      name: String(r.name ?? ""),
      type: "router",
      brand: String(r.brand ?? "MikroTik"),
      ipAddress: String(r.host ?? r.ipAddress ?? ""),
      status: !up ? "offline" : warning ? "warning" : "online",
      uptime: up ? formatUptime(r.uptime) : "—",
      cpuOrTemp: up && cpu !== null ? `CPU ${Math.round(cpu)}%` : "CPU —",
      capacitySummary: `${sessions} Pelanggan`,
      trafficSummary: up ? trafficOf(r) : undefined,
      lastSeenText: formatLastSeen(r, up),
    };
  });
}

export function transformOltsToStatusCards(
  olts: any[],
): DeviceHardwareStatus[] {
  return (olts ?? []).map((o) => {
    const up = isUp(o);
    const temp = num(o.temperature);
    const pons = num(o.ponPorts) ?? 0;
    const onus = num(o.activeOnus) ?? 0;
    const warning = up && temp !== null && temp > TEMP_WARN_CELSIUS;
    return {
      id: String(o.id),
      name: String(o.name ?? ""),
      type: "olt",
      brand: String(o.brand ?? "OLT"),
      ipAddress: String(o.host ?? o.ipAddress ?? ""),
      status: !up ? "offline" : warning ? "warning" : "online",
      uptime: up ? formatUptime(o.uptime) : "—",
      cpuOrTemp: up && temp !== null ? `Temp ${Math.round(temp)}°C` : "Temp —",
      capacitySummary: `${pons} PON / ${onus} ONU`,
      trafficSummary: up ? trafficOf(o) : undefined,
      lastSeenText: formatLastSeen(o, up),
    };
  });
}

export function computeAggregateDeviceStatus(
  routers: any[],
  olts: any[],
  customers?: any[],
): AggregateDeviceStatus {
  const rs = routers ?? [];
  const os = olts ?? [];
  const onlineRouters = rs.filter(isUp).length;
  const onlineOlts = os.filter(isUp).length;
  const totalActivePppoe = customers
    ? customers.filter((c) => c.isOnline !== false).length
    : rs.reduce((n, r) => n + (isUp(r) ? (num(r.pppoeCount) ?? 0) : 0), 0);
  const totalActiveOnus = os.reduce(
    (n, o) => n + (isUp(o) ? (num(o.activeOnus) ?? 0) : 0),
    0,
  );
  return {
    totalRouters: rs.length,
    onlineRouters,
    totalOlts: os.length,
    onlineOlts,
    totalActivePppoe,
    totalActiveOnus,
    allHealthy: onlineRouters === rs.length && onlineOlts === os.length,
  };
}
