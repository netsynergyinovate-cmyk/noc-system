// Logika murni untuk tes koneksi perangkat (tanpa jaringan, bisa diuji langsung).

export class DeviceConnectionError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "DeviceConnectionError";
  }
}

export type DeviceType = "mikrotik" | "olt" | "genieacs" | "billing";
export type DeviceMode = "simulator" | "real";

export type DeviceConnectionTestInput = {
  type: DeviceType;
  // Opsional: bila kosong, mode diambil dari saklar lingkungan (mode-switch).
  mode?: DeviceMode;
  host: string;
  port?: number;
  username?: string;
  password?: string;
  useTls?: boolean;
};

export type DeviceConnectionTestResult = {
  ok: boolean;
  type: DeviceType;
  mode: DeviceMode;
  message: string;
  code?: string;
  latencyMs?: number;
  // Data spesifik perangkat: mikrotik = resource, olt/billing = info, genieacs = deviceCount.
  data?: Record<string, string | number | undefined>;
};

export type MikrotikResource = {
  version?: string;
  cpuLoad?: number;
  uptime?: string;
  boardName?: string;
  freeMemory?: number;
  totalMemory?: number;
};

const DEVICE_LABEL: Record<DeviceType, string> = {
  mikrotik: "router",
  olt: "OLT",
  genieacs: "GenieACS",
  billing: "sistem billing",
};
export const deviceLabel = (type: DeviceType) => DEVICE_LABEL[type];

// Terima "ip", "ip:port", atau "http(s)://ip[:port][/]". Tolak path, query,
// kredensial di URL, skema selain http/https, dan port di luar 1-65535.
// `port` (opsional) dipakai bila host tidak memuat port sendiri.
export function sanitizeHost(raw: string, port?: number): URL {
  const input = raw.trim();
  if (!input) throw new DeviceConnectionError("INVALID_HOST", "Host wajib diisi.");
  if (/\s/.test(input)) {
    throw new DeviceConnectionError("INVALID_HOST", "Host tidak boleh memuat spasi.");
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input) && !/^https?:\/\//i.test(input)) {
    throw new DeviceConnectionError(
      "INVALID_HOST",
      "Protokol host harus http atau https.",
    );
  }
  const withScheme = /^https?:\/\//i.test(input) ? input : `http://${input}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new DeviceConnectionError("INVALID_HOST", "Format host tidak valid.");
  }
  if (url.username || url.password) {
    throw new DeviceConnectionError(
      "INVALID_HOST",
      "Host tidak boleh memuat username/password.",
    );
  }
  if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
    throw new DeviceConnectionError("INVALID_HOST", "Host tidak boleh memuat path.");
  }
  // Port di luar rentang membuat URL() melempar; port 0 lolos sebagai "0".
  if (url.port === "0") {
    throw new DeviceConnectionError("INVALID_HOST", "Port tidak valid.");
  }
  if (port !== undefined) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new DeviceConnectionError("INVALID_HOST", "Port tidak valid.");
    }
    if (!url.port) url.port = String(port);
  }
  return url;
}

// Port yang oleh konvensi berarti HTTPS (www-ssl bawaan RouterOS = 443).
export const TLS_PORTS: ReadonlySet<number> = new Set([443, 8443]);
// Port bawaan yang bukan REST: API biner RouterOS (8728/8729) dan Winbox (8291). REST tidak menjawab di sini.
export const API_PROTOCOL_PORTS: ReadonlySet<number> = new Set([8728, 8729, 8291]);

// Kolom `routers.host` tidak punya kolom TLS, jadi HTTPS dibaca dari skema
// ("https://...") atau dari port 443/8443. Satu aturan untuk semua pembaca.
export function impliesTls(url: URL): boolean {
  return url.protocol === "https:" || TLS_PORTS.has(Number(url.port));
}

// Bentuk yang disimpan di `routers.host` (tanpa kolom port/TLS): "host" untuk
// HTTP:80, "host:port" untuk selain itu, dan "https://host[:port]" bila HTTPS
// tidak bisa dibaca dari port (443/8443). Semua pembaca (klien REST, uji
// koneksi, kredensial) membaca bentuk ini dengan aturan `impliesTls`.
export function storedRouterHost(url: URL, useSsl: boolean): string {
  const port = url.port ? Number(url.port) : useSsl ? 443 : 80;
  const bare = url.hostname;
  if (useSsl) {
    return TLS_PORTS.has(port) ? `${bare}:${port}` : `https://${bare}:${port}`;
  }
  // Port 443/8443 tanpa HTTPS tidak bisa disimpan: pembaca akan menganggapnya HTTPS.
  if (TLS_PORTS.has(port)) {
    throw new DeviceConnectionError(
      "INVALID_HOST",
      `Port ${port} dipakai untuk HTTPS. Centang HTTPS, atau pakai port layanan www (mis. 80).`,
    );
  }
  return port === 80 ? bare : `${bare}:${port}`;
}

// Simulator deterministik, tanpa jaringan: host berakhiran .0 = timeout,
// .255 = login ditolak (401), selain itu sukses dengan data khas perangkat.
export function runSimulatorDeviceTest(
  input: DeviceConnectionTestInput,
): DeviceConnectionTestResult {
  const { type } = input;
  const base = { type, mode: "simulator" as const };
  let url: URL;
  try {
    url = sanitizeHost(input.host, input.port);
  } catch (e) {
    const err = e as DeviceConnectionError;
    return { ...base, ok: false, code: err.code, message: err.message };
  }
  const label = deviceLabel(type);
  const last = url.hostname.split(".").pop();
  if (last === "0") {
    return {
      ...base,
      ok: false,
      code: "TIMEOUT",
      message: `Koneksi ke ${label} lambat atau terputus (timeout).`,
    };
  }
  if (last === "255") {
    return {
      ...base,
      ok: false,
      code: "AUTH_FAILED",
      message: `${label} menolak login (HTTP 401): periksa username dan password.`,
    };
  }
  const specific: Record<DeviceType, DeviceConnectionTestResult["data"]> = {
    mikrotik: { version: "7.14 (stable)", cpuLoad: 8, uptime: "3d4h12m", boardName: "RB4011iGS+" },
    olt: { info: "OLT simulator terhubung" },
    genieacs: { deviceCount: 42 },
    billing: { info: "Sistem billing simulator terhubung" },
  };
  return {
    ...base,
    ok: true,
    latencyMs: 12,
    message: `Koneksi ke ${label} (simulator) berhasil.`,
    data: specific[type],
  };
}

export function parseMikrotikResource(data: unknown): MikrotikResource {
  const d = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!d || typeof d !== "object") return {};
  const cpu = Number(d["cpu-load"]);
  const free = Number(d["free-memory"]);
  const total = Number(d["total-memory"]);
  return {
    version: typeof d["version"] === "string" ? d["version"] : undefined,
    cpuLoad: d["cpu-load"] !== undefined && Number.isFinite(cpu) ? cpu : undefined,
    uptime: typeof d["uptime"] === "string" ? d["uptime"] : undefined,
    boardName: typeof d["board-name"] === "string" ? d["board-name"] : undefined,
    freeMemory: Number.isFinite(free) && free >= 0 ? free : undefined,
    totalMemory: Number.isFinite(total) && total > 0 ? total : undefined,
  };
}

export function describeNetworkError(error: unknown, label: string): DeviceConnectionError {
  const err = error as Error;
  const msg = `${err?.message ?? ""} ${(err as { cause?: { code?: string } })?.cause?.code ?? ""}`;
  // Pesan dari backend Go (olt.ErrDriverNotFound / olt.ErrNotSupported).
  if (msg.includes("driver OLT tidak terdaftar"))
    return new DeviceConnectionError("DRIVER_NOT_FOUND", "Driver OLT ini belum tersedia. Pilih driver lain atau hubungi administrator.");
  if (msg.includes("tidak didukung oleh driver OLT"))
    return new DeviceConnectionError("NOT_SUPPORTED", "Fitur ini belum didukung oleh driver OLT yang dipilih.");
  if (err?.name === "AbortError")
    return new DeviceConnectionError("TIMEOUT", `Koneksi ke ${label} lambat atau terputus (timeout).`);
  if (msg.includes("ECONNREFUSED"))
    return new DeviceConnectionError("CONNECTION_REFUSED", `Koneksi ditolak oleh ${label}. Pastikan port terbuka.`);
  if (msg.includes("ENOTFOUND") || msg.includes("EAI_AGAIN"))
    return new DeviceConnectionError("DNS_ERROR", "Host tidak ditemukan. Pastikan alamat IP atau domain benar.");
  if (msg.includes("EHOSTUNREACH"))
    return new DeviceConnectionError("UNREACHABLE", `${label} tidak dapat dijangkau. Pastikan perangkat menyala dan terhubung ke jaringan.`);
  if (msg.includes("fetch failed") || msg.includes("NetworkError"))
    return new DeviceConnectionError("NETWORK_ERROR", `Gagal menghubungi ${label}. Pastikan alamat benar dan perangkat menyala.`);
  return new DeviceConnectionError("CONNECTION_FAILED", `Gagal menghubungi ${label}: ${err?.message ?? "kesalahan tidak dikenal"}`);
}
