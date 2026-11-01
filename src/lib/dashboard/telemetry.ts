// Telemetri dashboard dari backend Go (pesan WebSocket "telemetry" dan
// GET /api/v1/dashboard/telemetry). Bentuknya cermin backend/internal/wire/telemetry.go.
import type { RouterHealth } from "./router-health";

export interface RouterTelemetry extends RouterHealth {
  cpuLoad: number | null;
  memoryUsage: number | null;
  uptimeSeconds: number | null;
  version: string;
  board: string;
}

export interface OltTelemetry {
  id: string;
  name: string;
  host: string;
  status: string;
  ponPortCount: number;
  onuOnline: number;
  onuTotal: number;
}

export interface LatencyItem {
  name: string;
  host: string;
  port: number;
  latencyMs: number | null;
  status: "online" | "timeout" | "error";
}

export interface CriticalOptic {
  id: string;
  user: string;
  pon: string;
  odp: string;
  rx: number;
  badge: "Critical" | "High Atten" | "Degrading";
}

export interface ActiveAlertTelemetry {
  id: string;
  type: string;
  severity: string;
  title: string;
  location: string;
  detectedAt: number;
}

export interface VlanTraffic {
  routerId: string;
  name: string;
  running: boolean;
  disabled: boolean;
  // null sampai laju pertama bisa dihitung.
  downMbps: number | null;
  upMbps: number | null;
  // Detik unix pembacaan counter; null bersama laju.
  at: number | null;
}

export interface VlanHistory {
  routerId: string;
  name: string;
  samples: { at: number; downMbps: number; upMbps: number }[];
}

export interface PonPort {
  oltName: string;
  ponIndex: number;
  onuOnline: number;
  rxPowerDbm: number | null;
}

export interface Telemetry {
  routers: RouterTelemetry[];
  olts: OltTelemetry[];
  latency: {
    avgLatencyMs: number | null;
    onlineCount: number;
    totalCount: number;
    items: LatencyItem[];
    measuredAt: number | null;
  };
  criticalOptics: CriticalOptic[];
  criticalOpticalDbm: number;
  vlans: VlanTraffic[];
  pons: PonPort[];
  alerts: { total: number; items: ActiveAlertTelemetry[] };
  databaseOk: boolean;
}

// Tanda daftar alert aktif; berubah bila alert aktif bertambah/berkurang/berganti.
export const alertSignature = (t: Telemetry) =>
  `${t.alerts.total}:${t.alerts.items.map((a) => a.id).join(",")}`;
