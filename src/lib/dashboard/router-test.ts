import {
  MOCK_DEVICE_CONFIGS,
  runDeviceTest,
  sanitizeText,
  validateDeviceInput,
  type ConnectionStatus,
  type DeviceConfig,
  type DeviceMode,
  type TestOutcome,
} from "./device-config.ts";

export type RouterTestForm = {
  host: string;
  port: string;
  username: string;
  https: boolean;
  mode: DeviceMode;
  forceLocal: boolean;
};

export const DEFAULT_ROUTER_TEST_FORM: RouterTestForm = {
  host: "",
  port: "80",
  username: "",
  https: false,
  // Uji IP selalu nyata. Tidak ada mode simulator/contoh di halaman ini.
  mode: "real",
  forceLocal: false,
};

export type RouterTestEntry = {
  id: number;
  at: number;
  host: string;
  port: number;
  status: ConnectionStatus;
  latencyMs: number | null;
  message: string;
};

export type RouterResource = {
  board: string;
  version: string;
  cpuLoad: string;
  /** null = router tidak mengirim angka; jangan tampilkan 0 palsu. */
  cpuPct: number | null;
  memoryPct: number | null;
  temperature: number | null;
  uptime: string;
  latency: string;
  endpoint: string;
};

const template = MOCK_DEVICE_CONFIGS.find((d) => d.type === "mikrotik")!;

/** Ubah isian form menjadi DeviceConfig MikroTik; galat validasi dikembalikan per field. */
export function buildRouterTestDevice(
  form: RouterTestForm,
): { ok: true; device: DeviceConfig } | { ok: false; errors: Record<string, string> } {
  const port = /^\d{1,5}$/.test(form.port.trim()) ? Number(form.port.trim()) : NaN;
  const v = validateDeviceInput({ name: form.host || "router", host: form.host, port, username: form.username });
  if (!v.ok) return { ok: false, errors: v.errors };
  return {
    ok: true,
    device: {
      ...template,
      id: "router-test",
      name: sanitizeText(form.host),
      host: v.clean.host,
      port: v.clean.port,
      username: v.clean.username,
      protocol: form.https ? "HTTPS (REST API v7)" : "HTTP (REST API v7)",
      mode: form.mode,
      status: "untested",
      lastTestedAt: null,
      latencyMs: null,
      errorMessage: undefined,
    },
  };
}

/** Jalankan uji nyata; hasil simulasi hanya bila forceLocal diminta eksplisit. */
export function runRouterTest(
  form: RouterTestForm,
  opts: { password?: string; fetchImpl?: typeof fetch } = {},
) {
  const built = buildRouterTestDevice(form);
  if (!built.ok) return Promise.resolve({ ok: false as const, errors: built.errors });
  return runDeviceTest(built.device, {
    forceLocal: form.forceLocal,
    fetchImpl: opts.fetchImpl,
    password: opts.password,
    useTls: form.https,
  }).then((outcome) => ({
    ok: true as const,
    device: built.device,
    outcome,
  }));
}

// Semua angka berasal dari jawaban router (resource REST/API). Tidak ada nilai
// contoh: field yang tidak dikirim router menjadi null dan tampil "—".
export function routerResourceFromOutcome(outcome: TestOutcome, device: DeviceConfig): RouterResource | null {
  if (!outcome.ok) return null;
  const raw = (outcome.data ?? {}) as Record<string, unknown>;
  const res = (
    raw.resource && typeof raw.resource === "object" ? raw.resource : raw
  ) as Record<string, unknown>;
  const num = (v: unknown): number | null => {
    if (v === undefined || v === null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const cpu = num(res.cpuLoad ?? res["cpu-load"]);
  const freeBytes = num(res.freeMemory ?? res["free-memory"]);
  const totalBytes = num(res.totalMemory ?? res["total-memory"]);
  const freeMb = num(res.freeMemoryMb);
  const totalMb = num(res.totalMemoryMb);
  let memoryPct: number | null = null;
  if (totalBytes !== null && totalBytes > 0 && freeBytes !== null) {
    memoryPct = Math.round(100 * (1 - freeBytes / totalBytes));
  } else if (totalMb !== null && totalMb > 0 && freeMb !== null) {
    memoryPct = Math.round(100 * (1 - freeMb / totalMb));
  }
  const temp = num(res.temperature ?? res["temperature"]);
  const version = typeof res.version === "string" ? res.version : "";
  const board = typeof res.boardName === "string" ? res.boardName : "";
  const uptime = typeof res.uptime === "string" ? res.uptime : "";
  // Tidak ada satu pun data resource: jangan tampilkan kartu contoh.
  if (cpu === null && memoryPct === null && !version && !board && !uptime) return null;
  return {
    board: board || "—",
    version: version || "—",
    cpuLoad: cpu !== null ? `${cpu}%` : "—",
    cpuPct: cpu,
    memoryPct,
    temperature: temp !== null && temp > 0 ? temp : null,
    uptime,
    latency: outcome.latencyMs != null ? `${outcome.latencyMs} ms` : "—",
    endpoint: outcome.endpointTested ?? `${device.host}:${device.port}`,
  };
}

export function toTestEntry(
  id: number,
  device: DeviceConfig,
  outcome: TestOutcome,
  nowSec = Math.floor(Date.now() / 1000),
): RouterTestEntry {
  return {
    id,
    at: outcome.timestamp ?? nowSec,
    host: device.host,
    port: device.port,
    status: outcome.status ?? (outcome.ok ? "connected" : "error"),
    latencyMs: outcome.latencyMs,
    message: outcome.message,
  };
}
