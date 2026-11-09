export type CpeInterfaceType = "wifi_2.4g" | "wifi_5g" | "ethernet";

export interface CpeHostClient {
  hostname: string;
  ip: string;
  mac: string;
  interfaceType: CpeInterfaceType;
  active: boolean;
}

export interface CpeWifi {
  ssid: string;
  enabled: boolean;
  channel: number;
  security: string;
  radioFrequency: "2.4GHz" | "5GHz";
  clientCount: number;
}

export interface CpeOptical {
  rxDbm: number | null;
  txDbm: number | null;
  biasMa: number | null;
  voltageV: number | null;
  temperatureC: number | null;
}

export interface CpeTemperatureSensor {
  name: string;
  celsius: number;
}

export interface CpeHealth {
  cpuPercent: number | null;
  memoryFreeKb: number | null;
  memoryTotalKb: number | null;
  temperatures: CpeTemperatureSensor[];
}

export interface CpeDevice {
  id: string;
  deviceId: string;
  customerId: string;
  customerName: string;
  pppoeUsername: string;
  address: string;
  odpName: string;
  routerId: string;
  model: string;
  manufacturer: string;
  oui: string;
  productClass: string;
  serialNumber: string;
  hardwareVersion: string;
  softwareVersion: string;
  uptimeSeconds: number;
  uptimeText: string;
  wanIp: string;
  lanIp: string;
  macAddress: string;
  isOnline: boolean;
  lastInformAt: number;
  opticalPowerDbm: number;
  optical: CpeOptical;
  health: CpeHealth;
  wifi: CpeWifi;
  hosts: CpeHostClient[];
  acs?: {
    url: string;
    informEnabled: boolean;
    informIntervalSec: number | null;
    connectionRequestUrl: string;
  };
}

export interface CpeMetrics {
  total: number;
  online: number;
  offline: number;
  weakSignal: number;
  totalClients: number;
}

export const CPE_WEAK_SIGNAL_DBM = -27;

export function formatUptime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} hari ${h} jam`;
  if (h > 0) return `${h} jam ${m} menit`;
  return `${m} menit`;
}

export function summarizeCpeMetrics(devices: readonly CpeDevice[]): CpeMetrics {
  let online = 0;
  let weakSignal = 0;
  let totalClients = 0;
  for (const d of devices) {
    if (d.isOnline) online++;
    if (d.opticalPowerDbm < CPE_WEAK_SIGNAL_DBM) weakSignal++;
    totalClients += d.wifi.clientCount;
  }
  return {
    total: devices.length,
    online,
    offline: devices.length - online,
    weakSignal,
    totalClients,
  };
}
