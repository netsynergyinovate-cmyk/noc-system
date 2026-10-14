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
  port: "443",
  username: "noc-monitor",
  https: true,
  mode: "simulator",
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
  cpuPct: number;
  memoryPct: number;
  temperature: number;
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

/** Jalankan uji; hasil nyata/simulasi memakai runDeviceTest (POST /api/devices/test atau mock). */
export function runRouterTest(form: RouterTestForm, fetchImpl?: typeof fetch) {
  const built = buildRouterTestDevice(form);
  if (!built.ok) return Promise.resolve({ ok: false as const, errors: built.errors });
  return runDeviceTest(built.device, { forceLocal: form.forceLocal, fetchImpl }).then((outcome) => ({
    ok: true as const,
    device: built.device,
    outcome,
  }));
}

// ponytail: REST /system/resource belum dikembalikan API; nilai sumber daya ini tiruan
// deterministik untuk simulator. Ganti dengan field respons nyata saat endpoint menyediakannya.
export function routerResourceFromOutcome(outcome: TestOutcome, device: DeviceConfig): RouterResource | null {
  if (!outcome.ok) return null;
  return {
    board: "CCR2004-16G-2S+",
    version: String(template.metadata.firmware ?? "RouterOS v7"),
    cpuLoad: "7%",
    cpuPct: 7,
    memoryPct: 38,
    temperature: 42,
    uptime: "12h 34m",
    latency: outcome.latencyMs != null ? `${outcome.latencyMs} ms` : "-",
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
