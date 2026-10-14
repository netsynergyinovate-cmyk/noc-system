// Data tiruan daftar OLT. Pengganti sementara untuk GET /api/v1/olts.
export interface DashboardOlt {
  id: string;
  name: string;
  host: string;
  brand: string;
  driver: string;
  status: "aktif" | "nonaktif";
  totalPonPorts: number;
  activeOnus: number;
  /** null = belum ada sensor/data (OLT nyata dari DB). */
  temperatureC: number | null;
  uptime: string;
  /** Epoch detik; null jika belum pernah terlihat. */
  lastSeenAt: number | null;
}

// Epoch tetap (bukan Date.now) supaya HTML server dan klien sama.
const LAST_SEEN_EPOCH = 1_760_000_000;

export const mockOlts: readonly DashboardOlt[] = [
  {
    id: "olt-gpon-core-01",
    name: "OLT-GPON-CORE-01",
    host: "10.10.0.10",
    brand: "HSGQ",
    driver: "hsgq-gpon",
    status: "aktif",
    totalPonPorts: 8,
    activeOnus: 128,
    temperatureC: 41,
    uptime: "42 hari 6 jam",
    lastSeenAt: LAST_SEEN_EPOCH,
  },
  {
    id: "olt-epon-timur-02",
    name: "OLT-EPON-TIMUR-02",
    host: "10.10.1.20",
    brand: "ZTE",
    driver: "zte-c320",
    status: "aktif",
    totalPonPorts: 16,
    activeOnus: 214,
    temperatureC: 38,
    uptime: "19 hari 14 jam",
    lastSeenAt: LAST_SEEN_EPOCH,
  },
  {
    id: "olt-gpon-cadangan-03",
    name: "OLT-GPON-CADANGAN-03",
    host: "10.10.2.30",
    brand: "Fiberhome",
    driver: "fh-an5516",
    status: "nonaktif",
    totalPonPorts: 4,
    activeOnus: 0,
    temperatureC: 29,
    uptime: "-",
    lastSeenAt: null,
  },
];

export function getOltStats(olts: readonly DashboardOlt[]) {
  let active = 0;
  let totalPon = 0;
  let totalOnu = 0;
  for (const o of olts) {
    if (o.status === "aktif") active++;
    totalPon += o.totalPonPorts;
    totalOnu += o.activeOnus;
  }
  return { total: olts.length, active, totalPon, totalOnu };
}

export interface OltInput {
  name: string;
  brand: string;
  driver: string;
  host: string;
  port: number;
  username: string;
  password: string;
  totalPonPorts: number;
}

export const OLT_BRANDS = ["HSGQ", "ZTE", "Huawei", "Fiberhome"] as const;
export const OLT_PON_OPTIONS = [4, 8, 16, 32] as const;

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export function validateOltInput(input: OltInput): Partial<Record<keyof OltInput, string>> {
  const e: Partial<Record<keyof OltInput, string>> = {};
  if (!input.name.trim()) e.name = "Nama wajib diisi.";
  else if (input.name.trim().length > 64) e.name = "Nama maksimal 64 karakter.";
  if (!(OLT_BRANDS as readonly string[]).includes(input.brand)) e.brand = "Pilih brand yang tersedia.";
  if (!input.driver.trim()) e.driver = "Driver wajib diisi.";
  if (!IPV4.test(input.host.trim())) e.host = "Host harus berupa alamat IPv4 yang valid.";
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535)
    e.port = "Port harus bilangan bulat 1-65535.";
  if (!input.username.trim()) e.username = "Username wajib diisi.";
  if (!input.password) e.password = "Password wajib diisi.";
  if (!(OLT_PON_OPTIONS as readonly number[]).includes(input.totalPonPorts))
    e.totalPonPorts = "Total port PON harus 4, 8, 16, atau 32.";
  return e;
}

// Uji koneksi tiruan, deterministik dari host: ".0" timeout, ".255" gagal login.
export function mockTestOltConnection(input: OltInput): {
  ok: boolean;
  reason?: string;
  diagnostics: { latencyMs: number; protocol: string; firmware?: string };
} {
  const host = input.host.trim();
  const protocol = input.port === 22 ? "SSH" : "Telnet";
  if (host.endsWith(".0"))
    return { ok: false, reason: "Koneksi timeout: perangkat tidak merespons.", diagnostics: { latencyMs: 5000, protocol } };
  if (host.endsWith(".255"))
    return { ok: false, reason: "Autentikasi gagal: username atau password salah.", diagnostics: { latencyMs: 120, protocol } };
  return { ok: true, diagnostics: { latencyMs: 42, protocol, firmware: `${input.brand} v1.0.0` } };
}

/** Bentuk baris OLT dari GET /api/devices (kolom publik tabel olts). */
export interface ApiOlt {
  id: string;
  name: string;
  host: string;
  brand: string;
  driver: string;
  status: "aktif" | "nonaktif";
  lastSeenAt: string | null;
  // Dari hasil polling backend; kosong pada jawaban lama.
  ponPortCount?: number;
  onuTotal?: number;
  onuOnline?: number;
}

/** Petakan OLT dari DB ke baris tabel. Jumlah port dan ONU dari hasil polling (0 bila belum pernah dipoll). */
export function apiOltToDashboard(o: ApiOlt): DashboardOlt {
  const seen = o.lastSeenAt ? Date.parse(o.lastSeenAt) : NaN;
  return {
    id: o.id,
    name: o.name,
    host: o.host,
    brand: o.brand,
    driver: o.driver,
    status: o.status,
    totalPonPorts: o.ponPortCount ?? 0,
    activeOnus: o.onuOnline ?? 0,
    temperatureC: null,
    uptime: "-",
    lastSeenAt: Number.isNaN(seen) ? null : Math.floor(seen / 1000),
  };
}