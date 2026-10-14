import type { DashboardCustomer } from "./types";

// Data CPE tiruan, deterministik per pelanggan. Bentuknya mengikuti parameter
// TR-069 yang nanti dibaca dari GenieACS NBI (backend menggantikan fungsi ini).

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

// Bacaan optik yang dilaporkan MODEM sendiri (lewat GenieACS), bukan dari OLT.
// Berbeda dari `CpeDevice.opticalPowerDbm` (RX, dipakai luas di aplikasi untuk status
// sinyal): field ini pelengkap untuk ditampilkan apa adanya, termasuk saat OLT
// gagal membaca ONU ini. Hanya terisi untuk merek modem yang parameternya sudah
// dikenali; `null` berarti belum/tidak bisa dibaca, bukan nol.
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

// Kesehatan modem dari parameter TR-069 baseline standar (DeviceInfo.ProcessStatus,
// MemoryStatus, TemperatureStatus). Lebih mungkin tersedia lintas merek daripada
// parameter optik vendor, tapi tetap tidak dijamin ada di semua modem.
export interface CpeHealth {
  cpuPercent: number | null;
  memoryFreeKb: number | null;
  memoryTotalKb: number | null;
  temperatures: CpeTemperatureSensor[];
}

export interface CpeDevice {
  id: string;
  // Format GenieACS: OUI-ProductClass-SerialNumber
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
  // MAC modem (ManagementServer atau antarmuka WAN); kosong bila tidak dilaporkan.
  macAddress: string;
  isOnline: boolean;
  // Detik epoch (bilangan bulat).
  lastInformAt: number;
  opticalPowerDbm: number;
  optical: CpeOptical;
  health: CpeHealth;
  wifi: CpeWifi;
  hosts: CpeHostClient[];
}

export interface CpeMetrics {
  total: number;
  online: number;
  offline: number;
  weakSignal: number;
  totalClients: number;
}

// Epoch tetap supaya HTML server dan browser sama (backend memberi nilai nyata).
export const CPE_MOCK_NOW = 1_760_000_000;
export const CPE_WEAK_SIGNAL_DBM = -27;

interface CpeModelSpec {
  model: string;
  manufacturer: string;
  oui: string;
  productClass: string;
  snPrefix: string;
  hardware: string;
  software: string;
  dualBand: boolean;
}

export const CPE_MODELS: readonly CpeModelSpec[] = [
  {
    model: "ZTE F609 v3",
    manufacturer: "ZTE",
    oui: "00259E",
    productClass: "F609",
    snPrefix: "ZTEG",
    hardware: "V3.0",
    software: "V3.0.0P2T6",
    dualBand: false,
  },
  {
    model: "Huawei HG8245H5",
    manufacturer: "Huawei",
    oui: "00E0FC",
    productClass: "HG8245H5",
    snPrefix: "HWTC",
    hardware: "VER.A",
    software: "V5R019C00S105",
    dualBand: true,
  },
  {
    model: "Fiberhome AN5506-04",
    manufacturer: "Fiberhome",
    oui: "0019C7",
    productClass: "AN5506-04",
    snPrefix: "FHTT",
    hardware: "GPON.V2",
    software: "RP2631",
    dualBand: false,
  },
  {
    model: "ZTE F670L DualBand",
    manufacturer: "ZTE",
    oui: "00259E",
    productClass: "F670L",
    snPrefix: "ZTEG",
    hardware: "V1.1",
    software: "V9.0.10P2N2",
    dualBand: true,
  },
];

const DEVICE_NAMES = [
  "iPhone",
  "Samsung-A54",
  "Redmi-Note",
  "Smart-TV-LG",
  "Laptop-Kerja",
  "Laptop-Anak",
  "iPad",
  "Xiaomi-TV-Box",
  "Printer-HP",
  "CCTV-Depan",
  "PS4",
  "Oppo-Reno",
] as const;

const FIRST_NAME_FALLBACK = "Rumah";

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function hex(n: number, width: number): string {
  return (n >>> 0).toString(16).toUpperCase().padStart(width, "0").slice(-width);
}

function firstName(name: string): string {
  const w = name.trim().split(/\s+/)[0] ?? "";
  const clean = w.replace(/[^A-Za-z0-9]/g, "");
  return clean || FIRST_NAME_FALLBACK;
}

export function formatUptime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} hari ${h} jam`;
  if (h > 0) return `${h} jam ${m} menit`;
  return `${m} menit`;
}

function buildHosts(customer: DashboardCustomer, h: number, spec: CpeModelSpec): CpeHostClient[] {
  const count = customer.isOnline ? 2 + (h % 4) : 1 + (h % 2); // 2..5 online, 1..2 offline
  const owner = firstName(customer.name);
  const hosts: CpeHostClient[] = [];
  for (let i = 0; i < count; i++) {
    const base = DEVICE_NAMES[(h + i * 5) % DEVICE_NAMES.length];
    const hostname = i === 0 ? `${base}-${owner}` : `${base}-${i}`;
    const hh = hashString(`${customer.id}:${i}`);
    const interfaceType: CpeInterfaceType =
      /TV|CCTV|PS4|Printer|Box/.test(base)
        ? "ethernet"
        : spec.dualBand && hh % 2 === 0
          ? "wifi_5g"
          : "wifi_2.4g";
    hosts.push({
      hostname,
      ip: `192.168.1.${i + 2}`,
      // Bit unicast + locally administered (02) agar MAC tidak bertabrakan dengan OUI nyata.
      mac: `02:${hex(h >>> 16, 2)}:${hex(h >>> 8, 2)}:${hex(h, 2)}:${hex(hh >>> 8, 2)}:${hex(i + 1, 2)}`,
      interfaceType,
      active: customer.isOnline && (i === 0 || (hh + i) % 5 !== 0),
    });
  }
  return hosts;
}

export function generateMockCpeDevices(customers: readonly DashboardCustomer[]): CpeDevice[] {
  return customers.map((customer) => {
    const h = hashString(customer.id || customer.pppoeUsername);
    const spec = CPE_MODELS[h % CPE_MODELS.length];
    const serialNumber = `${spec.snPrefix}${hex(h, 8)}`;
    const hosts = buildHosts(customer, h, spec);
    const uptimeSeconds = customer.isOnline ? 3600 + (h % 4_000_000) : 0;
    const lastInformAt = customer.isOnline
      ? CPE_MOCK_NOW - (h % 300)
      : CPE_MOCK_NOW - (3600 + (h % 172_800));
    const activeClients = hosts.filter((x) => x.active).length;
    return {
      id: `cpe-${customer.id}`,
      deviceId: `${spec.oui}-${spec.productClass}-${serialNumber}`,
      customerId: customer.id,
      customerName: customer.name,
      pppoeUsername: customer.pppoeUsername,
      address: customer.address,
      odpName: customer.odpName,
      routerId: customer.routerId,
      model: spec.model,
      manufacturer: spec.manufacturer,
      oui: spec.oui,
      productClass: spec.productClass,
      serialNumber,
      hardwareVersion: spec.hardware,
      softwareVersion: spec.software,
      uptimeSeconds,
      uptimeText: customer.isOnline ? formatUptime(uptimeSeconds) : "—",
      wanIp: customer.isOnline ? `10.${20 + (h % 40)}.${(h >>> 8) % 250}.${2 + ((h >>> 16) % 250)}` : "—",
      lanIp: "192.168.1.1",
      macAddress: `${spec.oui.slice(0, 2)}:${spec.oui.slice(2, 4)}:${spec.oui.slice(4, 6)}:${hex(h, 6).slice(0, 2)}:${hex(h, 6).slice(2, 4)}:${hex(h, 6).slice(4, 6)}`,
      isOnline: customer.isOnline,
      lastInformAt,
      opticalPowerDbm: customer.opticalPowerDbm,
      optical: customer.isOnline
        ? {
            rxDbm: customer.opticalPowerDbm,
            txDbm: Math.round((2 + (h % 10) * 0.1) * 100) / 100,
            biasMa: 5 + (h % 20),
            voltageV: Math.round((3.2 + (h % 10) * 0.01) * 100) / 100,
            temperatureC: 30 + (h % 25),
          }
        : { rxDbm: null, txDbm: null, biasMa: null, voltageV: null, temperatureC: null },
      health: customer.isOnline
        ? {
            cpuPercent: h % 60,
            memoryFreeKb: 20_000 + (h % 60_000),
            memoryTotalKb: 128_000,
            temperatures: [{ name: "SoC", celsius: 40 + (h % 35) }],
          }
        : { cpuPercent: null, memoryFreeKb: null, memoryTotalKb: null, temperatures: [] },
      wifi: {
        ssid: `WIFI_${customer.pppoeUsername}`,
        enabled: customer.isOnline,
        channel: spec.dualBand && h % 2 === 0 ? 36 + (h % 4) * 4 : [1, 6, 11][h % 3],
        security: "WPA2-PSK",
        radioFrequency: spec.dualBand && h % 2 === 0 ? "5GHz" : "2.4GHz",
        clientCount: activeClients,
      },
      hosts,
    };
  });
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
