// Konfigurasi integrasi perangkat nyata & simulator untuk Fase 1
// Menampung data tiruan perangkat: MikroTik REST, OLT HSGQ, GenieACS NBI, dan Sistem Billing.

export type DeviceType = "mikrotik" | "olt" | "genieacs" | "billing";
export type DeviceMode = "simulator" | "real";
export type ConnectionStatus = "connected" | "disconnected" | "error" | "timeout" | "untested";

export interface DeviceConfig {
  id: string;
  type: DeviceType;
  name: string;
  description: string;
  host: string;
  port: number;
  protocol: string;
  username: string;
  mode: DeviceMode;
  status: ConnectionStatus;
  envHostKey: string;
  envUserKey: string;
  envPassKey: string;
  lastTestedAt: number | null;
  latencyMs: number | null;
  errorMessage?: string;
  metadata: Record<string, string | number | boolean>;
}

export const MOCK_DEVICE_CONFIGS: DeviceConfig[] = [
  {
    id: "dev-mt-01",
    type: "mikrotik",
    name: "Router Core MikroTik CCR2004",
    description: "Router gateway utama ISP untuk manajemen simple queue, bandwidth, dan resource CPU.",
    host: "10.10.0.1",
    port: 443,
    protocol: "HTTPS (REST API v7)",
    username: "noc-monitor",
    mode: "simulator",
    status: "connected",
    envHostKey: "MIKROTIK_REST_HOST",
    envUserKey: "MIKROTIK_REST_USER",
    envPassKey: "MIKROTIK_REST_PASSWORD",
    lastTestedAt: 1_760_000_000,
    latencyMs: 12,
    metadata: {
      firmware: "RouterOS v7.14.3",
      cpuCount: 4,
      queuesMonitored: 128,
    },
  },
  {
    id: "dev-olt-01",
    type: "olt",
    name: "OLT HSGQ EPON/GPON 8-Port",
    description: "Konsentrator fiber optik distribusi untuk monitoring port PON, redaman, dan status hidup/mati ONU.",
    host: "10.10.1.1",
    port: 80,
    protocol: "HTTP/Telnet CLI",
    username: "admin",
    mode: "simulator",
    status: "connected",
    envHostKey: "OLT_HSGQ_HOST",
    envUserKey: "OLT_HSGQ_USER",
    envPassKey: "OLT_HSGQ_PASSWORD",
    lastTestedAt: 1_760_000_000,
    latencyMs: 24,
    metadata: {
      brand: "HSGQ",
      model: "G008",
      ponPorts: 8,
      activeOnus: 64,
    },
  },
  {
    id: "dev-acs-01",
    type: "genieacs",
    name: "GenieACS NBI TR-069 Server",
    description: "Server Auto Configuration Server untuk kendali CPE pelanggan jarak jauh (SSID, Wi-Fi, host).",
    host: "10.10.2.1",
    port: 7557,
    protocol: "HTTP REST NBI",
    username: "acs-operator",
    mode: "simulator",
    status: "connected",
    envHostKey: "GENIEACS_NBI_URL",
    envUserKey: "GENIEACS_NBI_USER",
    envPassKey: "GENIEACS_NBI_PASSWORD",
    lastTestedAt: 1_760_000_000,
    latencyMs: 18,
    metadata: {
      cpeManaged: 85,
      version: "1.2.9",
    },
  },
  {
    id: "dev-bil-01",
    type: "billing",
    name: "Portal Billing ISP",
    description: "Sistem otomasi tagihan & invoice pelanggan dengan scraper sesi login (cookiejar + CSRF).",
    host: "10.10.3.1",
    port: 443,
    protocol: "HTTPS Web Scraper",
    username: "billing-sync",
    mode: "simulator",
    status: "connected",
    envHostKey: "BILLING_URL",
    envUserKey: "BILLING_USERNAME",
    envPassKey: "BILLING_PASSWORD",
    lastTestedAt: 1_760_000_000,
    latencyMs: 45,
    metadata: {
      totalInvoices: 250,
      syncInterval: "1 Jam",
    },
  },
];

export function getDeviceTypeLabel(type: DeviceType): string {
  switch (type) {
    case "mikrotik":
      return "Router MikroTik (REST)";
    case "olt":
      return "OLT HSGQ";
    case "genieacs":
      return "GenieACS NBI (CPE)";
    case "billing":
      return "Sistem Billing";
  }
}

export type TestCode =
  | "OK"
  | "TIMEOUT"
  | "AUTH_FAILED"
  | "CONNECTION_REFUSED"
  | "INVALID_PORT"
  | "INVALID_HOST"
  | "DNS_ERROR"
  | "HTTP_ERROR";

export type TestOutcome = {
  ok: boolean;
  message: string;
  latencyMs: number | null;
  /** Status koneksi hasil uji; bila kosong diturunkan dari `ok`. */
  status?: ConnectionStatus;
  statusCode?: number;
  code?: TestCode;
  endpointTested?: string;
  /** Epoch detik (sama dengan `lastTestedAt`). */
  timestamp?: number;
  /** Data nyata dari perangkat (mis. resource RouterOS); tidak ada bila gagal. */
  data?: Record<string, unknown>;
};

export type MockTestResult = TestOutcome & {
  latencyMs: number;
  status: ConnectionStatus;
  code: TestCode;
  endpointTested: string;
  timestamp: number;
};

export const DEVICE_TEST_TIMEOUT_MS = 8000;

// Latensi simulasi tetap per jenis perangkat supaya hasil deterministik.
const SIM_LATENCY_MS: Record<DeviceType, number> = { mikrotik: 12, olt: 24, genieacs: 18, billing: 45 };
// Port yang disimulasikan menolak koneksi.
const REFUSED_PORTS = new Set([0, 9999]);

function endpointFor(d: DeviceConfig): string {
  const tls = d.port === 443 || d.port === 8443;
  const base = `${tls ? "https" : "http"}://${d.host}:${d.port}`;
  switch (d.type) {
    case "mikrotik":
      return `GET ${base}/rest/system/resource`;
    case "olt":
      return d.port === 23 ? `TELNET ${d.host}:23` : `GET ${base}/`;
    case "genieacs":
      return `GET ${base}/devices`;
    case "billing":
      return `GET ${base}/login (sesi cookie + token CSRF)`;
  }
}

function successDetail(type: DeviceType): string {
  switch (type) {
    case "mikrotik":
      return "REST RouterOS /rest/system/resource menjawab 200";
    case "olt":
      return "Web API/Telnet OLT menjawab dan sesi login diterima";
    case "genieacs":
      return "NBI GenieACS /devices menjawab 200";
    case "billing":
      return "portal billing menjawab 200, sesi login + CSRF valid";
  }
}

/** Simulasi uji koneksi deterministik (tanpa jaringan, tanpa acak). */
export function mockRunDeviceTest(
  device: DeviceConfig,
  nowSec = Math.floor(Date.now() / 1000),
): MockTestResult {
  const endpointTested = endpointFor(device);
  const base = { endpointTested, timestamp: nowSec };
  if (device.host.endsWith(".0")) {
    return {
      ...base,
      ok: false,
      status: "timeout",
      code: "TIMEOUT",
      latencyMs: DEVICE_TEST_TIMEOUT_MS,
      message: `Timeout ${DEVICE_TEST_TIMEOUT_MS}ms: host ${device.host} tidak merespons. Periksa rute jaringan.`,
    };
  }
  if (REFUSED_PORTS.has(device.port)) {
    return {
      ...base,
      ok: false,
      status: "error",
      code: "CONNECTION_REFUSED",
      latencyMs: 5,
      message: `Koneksi ditolak (Connection Refused) pada port ${device.port}.`,
    };
  }
  if (!isValidPort(device.port)) {
    return {
      ...base,
      ok: false,
      status: "error",
      code: "INVALID_PORT",
      latencyMs: 1,
      message: `Port ${device.port} tidak valid: harus bilangan bulat 1-65535.`,
    };
  }
  if (device.host.endsWith(".255") || device.username === "bad-user") {
    return {
      ...base,
      ok: false,
      status: "error",
      statusCode: 401,
      code: "AUTH_FAILED",
      latencyMs: 35,
      message: `Autentikasi gagal 401: periksa username/password untuk ${device.username}.`,
    };
  }
  return {
    ...base,
    ok: true,
    status: "connected",
    statusCode: 200,
    code: "OK",
    latencyMs: SIM_LATENCY_MS[device.type],
    message: `Sukses: ${successDetail(device.type)} (${device.name}, ${device.protocol}, mode ${device.mode}).`,
  };
}

// --- Validasi & sanitasi input form perangkat -------------------------------

const HOST_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;

/** Buang karakter kontrol & spasi tepi; batasi panjang. */
export function sanitizeText(value: string, max = 120): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
}

export function isValidHost(host: string): boolean {
  const h = host.trim();
  if (!h || h.length > 253) return false;
  const v4 = h.split(".");
  if (v4.length === 4 && v4.every((p) => /^\d{1,3}$/.test(p))) {
    return v4.every((p) => Number(p) <= 255);
  }
  if (/^[\d.]+$/.test(h)) return false; // mirip IP tapi tidak valid
  return h.split(".").every((l) => HOST_LABEL.test(l));
}

export function isValidPort(port: unknown): boolean {
  return typeof port === "number" && Number.isInteger(port) && port >= 1 && port <= 65535;
}

export type DeviceInputErrors = Partial<Record<"name" | "host" | "port" | "username", string>>;

export function validateDeviceInput(input: {
  name: string;
  host: string;
  port: number;
  username: string;
}): { ok: boolean; errors: DeviceInputErrors; clean: { name: string; host: string; port: number; username: string } } {
  const clean = {
    name: sanitizeText(input.name),
    host: sanitizeText(input.host, 253),
    port: input.port,
    username: sanitizeText(input.username, 64),
  };
  const errors: DeviceInputErrors = {};
  if (!clean.name) errors.name = "Nama perangkat wajib diisi.";
  if (!isValidHost(clean.host)) errors.host = "Host harus berupa IPv4 atau nama host yang valid.";
  if (!isValidPort(clean.port)) errors.port = "Port harus bilangan bulat 1-65535.";
  if (!clean.username) errors.username = "Username wajib diisi.";
  return { ok: Object.keys(errors).length === 0, errors, clean };
}

// --- Uji koneksi: API dulu, simulasi lokal bila API tidak tersedia ----------

export type RunDeviceTestOptions = {
  /** Paksa simulasi lokal tanpa memanggil endpoint backend (berlaku untuk semua mode). */
  forceLocal?: boolean;
  fetchImpl?: typeof fetch;
  /** Kata sandi nyata untuk autentikasi perangkat; hanya dikirim ke endpoint uji. */
  password?: string;
  /** Paksa HTTPS/TLS pada port yang diuji. */
  useTls?: boolean;
};

export async function runDeviceTest(
  d: DeviceConfig,
  options: RunDeviceTestOptions | typeof fetch = {},
): Promise<TestOutcome> {
  // Kompatibel mundur: argumen kedua boleh berupa fungsi fetch.
  const opts: RunDeviceTestOptions = typeof options === "function" ? { fetchImpl: options } : options;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  const simulate = (why: string): TestOutcome => {
    const r = mockRunDeviceTest(d);
    return { ...r, message: `${r.message} (simulasi lokal: ${why})` };
  };
  const fallback = (why: string): TestOutcome => {
    if (d.mode !== "simulator") return { ok: false, message: why, latencyMs: null };
    return simulate(why);
  };
  if (opts.forceLocal) return simulate("dipaksa tanpa panggilan jaringan");
  if (offline) return fallback("browser offline");
  try {
    const res = await fetchImpl("/api/devices/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: d.type,
        mode: d.mode,
        host: d.host,
        port: d.port,
        username: d.username || undefined,
        password: opts.password || undefined,
        useTls: opts.useTls,
      }),
      signal: AbortSignal.timeout(DEVICE_TEST_TIMEOUT_MS),
    });
    const json = await res.json().catch(() => null);
    if (res.ok && json?.success && json.data) {
      const d = json.data;
      return {
        ok: !!d.ok,
        message: String(d.message ?? ""),
        latencyMs: d.latencyMs ?? null,
        ...(d.status && { status: d.status }),
        ...(d.code && { code: d.code }),
        ...(d.statusCode && { statusCode: d.statusCode }),
        ...(d.endpointTested && { endpointTested: d.endpointTested }),
        ...(d.timestamp && { timestamp: d.timestamp }),
        ...(d.data && typeof d.data === "object" && { data: d.data as Record<string, unknown> }),
      };
    }
    if (res.status === 401) return { ok: false, message: "Sesi berakhir, silakan masuk lagi.", latencyMs: null };
    if (res.status === 403)
      return { ok: false, message: "Akun ini tidak berhak menguji perangkat (butuh izin router:manage).", latencyMs: null };
    if (res.status === 404 || res.status >= 500) return fallback(`API uji koneksi belum tersedia (HTTP ${res.status})`);
    return { ok: false, message: json?.error?.message ?? `Server menjawab HTTP ${res.status}.`, latencyMs: null };
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    if (timeout)
      return {
        ok: false,
        status: "timeout",
        code: "TIMEOUT",
        message: `Batas waktu ${DEVICE_TEST_TIMEOUT_MS / 1000} detik terlampaui.`,
        latencyMs: null,
      };
    return fallback("server NOC tidak dapat dihubungi");
  }
}

export interface FormattedDeviceError {
  title: string;
  detail: string;
  suggestion: string;
}

/** Pesan galat ramah operator (Bahasa Indonesia), seragam di semua kartu perangkat. */
export function formatDeviceError(
  outcome: TestOutcome,
  device: Pick<DeviceConfig, "host" | "port" | "username" | "type" | "envPassKey">,
): FormattedDeviceError {
  const { host, port, username, envPassKey } = device;
  switch (outcome.code) {
    case "TIMEOUT":
      return {
        title: "Batas Waktu Terlampaui (Timeout)",
        detail: `Host ${host}:${port} tidak merespons dalam ${DEVICE_TEST_TIMEOUT_MS / 1000} detik.`,
        suggestion: "Periksa rute jaringan, IP gateway, atau pastikan perangkat dalam kondisi hidup.",
      };
    case "AUTH_FAILED":
      return {
        title: "Autentikasi Gagal (HTTP 401)",
        detail: `Kredensial pengguna "${username}" ditolak oleh perangkat.`,
        suggestion: `Periksa username dan kecocokan kata sandi di environment (${envPassKey}) atau hak akses akun.`,
      };
    case "CONNECTION_REFUSED":
      return {
        title: "Koneksi Ditolak (Connection Refused)",
        detail: `Port ${port} pada ${host} tertutup atau layanan tidak aktif.`,
        suggestion: `Pastikan service API/REST/Telnet aktif di perangkat dan firewall mengizinkan port ${port}.`,
      };
    case "INVALID_PORT":
      return {
        title: "Port Tidak Valid",
        detail: `Port ${port} berada di luar rentang port yang sah (1-65535).`,
        suggestion: "Ubah konfigurasi port ke nomor port standar yang valid.",
      };
    default:
      return {
        title: outcome.statusCode ? `Galat HTTP ${outcome.statusCode}` : "Koneksi Gagal",
        detail: outcome.message || "Perangkat mengembalikan respons galat.",
        suggestion: "Periksa format URL API, sertifikat TLS, atau log service perangkat.",
      };
  }
}

export function statusLabel(s: ConnectionStatus): string {
  switch (s) {
    case "connected":
      return "Terhubung";
    case "untested":
      return "Belum Diuji";
    case "timeout":
      return "Timeout";
    default:
      return "Gagal";
  }
}

export interface DeviceStatusSummary {
  total: number;
  connected: number;
  error: number;
  timeout: number;
  untested: number;
  testing: number;
  allOk: boolean;
}

/**
 * Agregasi status perangkat. Perangkat yang sedang diuji (`testingIds`) dihitung
 * hanya sebagai `testing`, apa pun status tersimpannya. "disconnected" dihitung `error`.
 */
export function summarizeDeviceStatuses(devices: DeviceConfig[], testingIds: string[] = []): DeviceStatusSummary {
  const busy = new Set(testingIds);
  const s: DeviceStatusSummary = { total: devices.length, connected: 0, error: 0, timeout: 0, untested: 0, testing: 0, allOk: false };
  for (const d of devices) {
    if (busy.has(d.id)) s.testing++;
    else if (d.status === "connected") s.connected++;
    else if (d.status === "timeout") s.timeout++;
    else if (d.status === "untested") s.untested++;
    else s.error++;
  }
  s.allOk = s.total > 0 && s.connected === s.total;
  return s;
}

export type StatusBadgeKind = "testing" | "connected" | "error" | "timeout" | "untested";

/** Model tampilan badge status: `isTesting` selalu menimpa status. */
export function getStatusBadgeModel(
  status: ConnectionStatus,
  isTesting = false,
  latencyMs: number | null = null,
  showLatency = true,
): { kind: StatusBadgeKind; label: string; ariaLabel: string; busy: boolean } {
  if (isTesting) return { kind: "testing", label: "Sedang diuji...", ariaLabel: "Status koneksi: sedang diuji", busy: true };
  const kind: StatusBadgeKind =
    status === "connected" ? "connected" : status === "timeout" ? "timeout" : status === "untested" ? "untested" : "error";
  const base = kind === "untested" ? "Belum Diuji" : statusLabel(status);
  const label = kind === "connected" && showLatency && latencyMs != null ? `${base} · ${latencyMs} ms` : base;
  return { kind, label, ariaLabel: `Status koneksi: ${label}`, busy: false };
}

export function applyTestOutcome(d: DeviceConfig, r: TestOutcome, nowSec = Math.floor(Date.now() / 1000)): DeviceConfig {
  const status: ConnectionStatus = r.status ?? (r.ok ? "connected" : "error");
  return { ...d, status, lastTestedAt: nowSec, latencyMs: r.latencyMs, errorMessage: r.ok ? undefined : r.message };
}
