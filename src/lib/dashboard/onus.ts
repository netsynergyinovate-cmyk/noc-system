// Data tiruan inventaris ONU. Pengganti sementara untuk GET /api/v1/onus.
import { getOpticalSignalStatus } from "./optical.ts";

export interface DashboardOnu {
  id: string;
  serialNumber: string;
  oltId: string;
  oltName: string;
  ponPort: string;
  // Nomor PON/ONU mentah (dipakai tombol "Daftarkan ke GenieACS"); null di mode
  // demo (OLT tiruan tidak punya nomor nyata untuk ditulis ke perangkat).
  ponIndex: number | null;
  onuIndex: number | null;
  model: string;
  customerId: string | null;
  customerName: string;
  pppoeUsername: string;
  // null = OLT tidak melaporkannya (ONU offline atau LOS), bukan 0.
  rxPowerDbm: number | null;
  txPowerDbm: number | null;
  // OLT HSGQ belum melaporkan jarak ke database; null = tidak diketahui.
  distanceMeters: number | null;
  status: "online" | "offline" | "los";
  /** Epoch detik. */
  lastSeenAt: number;
}

export type OnuStatusFilter =
  "all" | "online" | "offline" | "los" | "weak" | "out";

/** Batas redaman lemah (dBm); sama dengan tab ONT. */
export const WEAK_RX_DBM = -27;

// Epoch tetap (bukan Date.now) supaya HTML server dan klien sama.
const BASE_EPOCH = 1_760_000_000;

const OLTS = [
  {
    id: "olt-gpon-core-01",
    name: "OLT-GPON-CORE-01",
    prefixes: ["ZTEGC", "HWTC"],
    models: ["Huawei HG8245H5", "ZTE F609 v3", "Huawei HG8145V5"],
  },
  {
    id: "olt-epon-timur-02",
    name: "OLT-EPON-TIMUR-02",
    prefixes: ["FHTT", "ZTEGC"],
    models: ["ZTE F670L DualBand", "Fiberhome AN5506-04"],
  },
] as const;

const NAMES = [
  "Budi Santoso",
  "Dewi Lestari",
  "Agus Pratama",
  "Siti Rahma",
  "Rudi Hartono",
  "Ani Wijaya",
  "Joko Susilo",
  "Maya Putri",
  "Hendra Gunawan",
  "Rina Marlina",
  "Dedi Kurniawan",
  "Lina Kusuma",
];

// [status, rx, tx, jarak] per indeks; deterministik.
const STATUS_CYCLE: readonly DashboardOnu["status"][] = [
  "online",
  "online",
  "online",
  "offline",
  "online",
  "los",
  "online",
  "online",
  "online",
  "offline",
  "online",
  "online",
];

function pad(n: number, len: number): string {
  return String(n).padStart(len, "0");
}

function build(i: number): DashboardOnu {
  const olt = OLTS[i % 2];
  const status = STATUS_CYCLE[i % STATUS_CYCLE.length];
  const port = (i % 8) + 1;
  const slot = Math.floor(i / 2) + 1;
  const distanceMeters = 300 + ((i * 137) % 29) * 100; // 300..3100
  const rx = status === "los" ? -40 : -(17 + ((i * 7) % 13) + (i % 3) * 0.5); // -17..-30.5
  const prefix = olt.prefixes[i % olt.prefixes.length];
  const hasCustomer = i % 11 !== 10;
  const name = NAMES[i % NAMES.length];
  return {
    id: `onu-${pad(i + 1, 3)}`,
    serialNumber: `${prefix}${pad(8_129_034 + i * 1_337_011, 8).slice(-8)}`,
    oltId: olt.id,
    oltName: olt.name,
    ponPort: `PON 1/1/${port}:${slot}`,
    ponIndex: null,
    onuIndex: null,
    model: olt.models[i % olt.models.length],
    customerId: hasCustomer ? `cust-${pad(i + 1, 3)}` : null,
    customerName: hasCustomer ? name : "Belum dipasangkan",
    pppoeUsername: hasCustomer
      ? `${name.split(" ")[0].toLowerCase()}${pad(i + 1, 2)}@noc`
      : "-",
    rxPowerDbm: Math.round(rx * 10) / 10,
    txPowerDbm: Math.round((2 + (i % 4) * 0.3) * 10) / 10,
    distanceMeters,
    status,
    lastSeenAt: BASE_EPOCH - (status === "online" ? 0 : (i + 1) * 3600),
  };
}

export const mockOnus: readonly DashboardOnu[] = Array.from(
  { length: 24 },
  (_, i) => build(i),
);

export interface CustomerOpticalInfo {
  rxPowerDbm: number | null;
  txPowerDbm: number | null;
  attenuationDb: number | null;
  oltName: string;
  ponPort: string;
  distanceMeters: number | null;
  model: string;
  serialNumber: string;
  isOnline: boolean;
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Data optik satu pelanggan: dari inventaris ONU bila ada, kalau tidak dibuat deterministik. */
export function getCustomerOpticalInfo(customer: {
  id: string;
  pppoeUsername: string;
  opticalPowerDbm: number;
  isOnline: boolean;
}): CustomerOpticalInfo {
  const onu = mockOnus.find(
    (o) =>
      o.customerId === customer.id ||
      (o.pppoeUsername !== "-" && o.pppoeUsername === customer.pppoeUsername),
  );
  const isOnline = customer.isOnline;
  if (onu) {
    const rx = !isOnline || onu.status === "los" ? null : onu.rxPowerDbm;
    return {
      rxPowerDbm: rx,
      txPowerDbm: onu.txPowerDbm,
      attenuationDb:
        rx == null || onu.txPowerDbm == null
          ? null
          : round1(onu.txPowerDbm - rx),
      oltName: onu.oltName,
      ponPort: onu.ponPort,
      distanceMeters: onu.distanceMeters,
      model: onu.model,
      serialNumber: onu.serialNumber,
      isOnline,
    };
  }
  const h = hashString(customer.id || customer.pppoeUsername);
  const olt = OLTS[h % 2];
  const tx = round1(2.2 + (h % 5) * 0.1); // ~2.2..2.6
  const rx = isOnline ? round1(customer.opticalPowerDbm) : null;
  return {
    rxPowerDbm: rx,
    txPowerDbm: tx,
    attenuationDb: rx == null ? null : round1(tx - rx),
    oltName: olt.name,
    ponPort: `PON 1/1/${(h % 8) + 1}:${(h % 64) + 1}`,
    distanceMeters: 800 + (h % 18) * 100, // 800..2500
    model: olt.models[h % olt.models.length],
    serialNumber: `${olt.prefixes[h % olt.prefixes.length]}${pad(h % 100_000_000, 8)}`,
    isOnline,
  };
}

/** Pasangkan ONU ke pelanggan (atau lepas bila customer null). Tidak mengubah input. */
export function mapOnuToCustomer(
  onu: DashboardOnu,
  customer: { id: string; name: string; pppoeUsername: string } | null,
): DashboardOnu {
  return customer
    ? {
        ...onu,
        customerId: customer.id,
        customerName: customer.name,
        pppoeUsername: customer.pppoeUsername,
      }
    : {
        ...onu,
        customerId: null,
        customerName: "Belum dipasangkan",
        pppoeUsername: "-",
      };
}

export function filterOnus(
  onus: readonly DashboardOnu[],
  query: string,
  status: OnuStatusFilter,
  oltId: string,
): DashboardOnu[] {
  const q = query.trim().toLowerCase();
  return onus.filter((o) => {
    if (status === "online" && o.status !== "online") return false;
    if (status === "offline" && o.status !== "offline") return false;
    if (status === "los" && o.status !== "los") return false;
    if (
      status === "weak" &&
      (o.rxPowerDbm === null || o.rxPowerDbm >= WEAK_RX_DBM)
    )
      return false;
    if (
      status === "out" &&
      !getOpticalSignalStatus(o.status === "los" ? null : o.rxPowerDbm)
        .isOutOfThreshold
    ) {
      return false;
    }
    if (oltId !== "all" && o.oltId !== oltId) return false;
    if (!q) return true;
    return [o.serialNumber, o.customerName, o.pppoeUsername, o.ponPort].some(
      (f) => f.toLowerCase().includes(q),
    );
  });
}

// --- Mode live: ONU nyata dari tabel olt_onus (diisi polling OLT oleh backend Go) ---

// Satu ONU dari GET /api/onus (services/devices.service.ts listOnus).
export interface LiveOnuItem {
  id: string;
  oltId: string;
  oltName: string;
  ponIndex: number;
  onuIndex: number;
  description: string | null;
  model: string | null;
  serialNumber: string | null;
  customerId: string | null;
  customerName: string | null;
  pppoeUsername: string | null;
  rxPower: number | null;
  txPower: number | null;
  attenuation: number | null;
  status: string;
  capturedAt: string;
}

const toStatus = (s: string): DashboardOnu["status"] =>
  s === "online" || s === "los" ? s : "offline";

const toEpoch = (iso: string) => {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : Math.floor(ms / 1000);
};

/** Port ditulis "PON 1:7" (nomor PON, nomor ONU) sebagaimana dilaporkan OLT. */
export const formatPonPort = (ponIndex: number, onuIndex: number) =>
  `PON ${ponIndex}:${onuIndex}`;

// Jarak kabel tidak dilaporkan OLT HSGQ: null. Model "-" bila OLT tidak melaporkannya.
export function apiOnuToDashboard(o: LiveOnuItem): DashboardOnu {
  return {
    id: o.id,
    serialNumber: o.serialNumber ?? "-",
    oltId: o.oltId,
    oltName: o.oltName,
    ponPort: formatPonPort(o.ponIndex, o.onuIndex),
    ponIndex: o.ponIndex,
    onuIndex: o.onuIndex,
    model: o.model ?? "-",
    customerId: o.customerId,
    customerName: o.customerName ?? "Belum dipasangkan",
    pppoeUsername: o.pppoeUsername ?? "-",
    rxPowerDbm: o.rxPower,
    txPowerDbm: o.txPower,
    distanceMeters: null,
    status: toStatus(o.status),
    lastSeenAt: toEpoch(o.capturedAt),
  };
}

export function apiOnuToCustomerOptical(
  o: LiveOnuItem,
  isOnline: boolean,
): CustomerOpticalInfo {
  const online = o.status === "online";
  return {
    rxPowerDbm: online ? o.rxPower : null,
    txPowerDbm: online ? o.txPower : null,
    attenuationDb: online ? o.attenuation : null,
    oltName: o.oltName,
    ponPort: formatPonPort(o.ponIndex, o.onuIndex),
    distanceMeters: null,
    model: o.model ?? "-",
    serialNumber: o.serialNumber ?? "-",
    isOnline,
  };
}
