// Klien OLT HSGQ terpusat. Server-only: jangan impor dari komponen klien.
import {
  DeviceConnectionError,
  describeNetworkError,
  runSimulatorDeviceTest,
  sanitizeHost,
} from "@/lib/device-connection";

export interface HsgqClientOptions {
  host: string;
  port?: number;
  username: string;
  password: string;
  community?: string;
  timeoutMs?: number;
  mode: "real" | "simulator";
}

export interface HsgqTestResult {
  ok: boolean;
  latencyMs: number;
  message: string;
  code?: string;
  status?: string;
  statusCode?: number;
  endpointTested?: string;
  timestamp?: number;
  data?: { model?: string; firmware?: string; uptime?: string; ponPortCount?: number };
}

export interface HsgqPonPort {
  ponIndex: number;
  name: string;
  capacity: number;
  status: "up" | "down";
  rxPowerDbm: number | null;
  txPowerDbm: number | null;
  attenuationDb: number | null;
  onuOnlineCount: number;
}

export interface HsgqOnu {
  ponIndex: number;
  onuIndex: number;
  serialNumber: string;
  macAddress: string;
  status: "online" | "offline" | "los";
  rxPowerDbm: number | null;
  txPowerDbm: number | null;
  distanceMeters: number | null;
}

const DEFAULT_TIMEOUT_MS = 8000;
const LABEL = "OLT";
const SIM_PON_COUNT = 8;
const SIM_ONU_PER_PON = 8;

type Raw = Record<string, unknown>;
const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
const numOrNull = (v: unknown) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const numOr = (v: unknown, d: number) => numOrNull(v) ?? d;
const hex = (n: number, len: number) => n.toString(16).toUpperCase().padStart(len, "0");

function simOnus(): HsgqOnu[] {
  const out: HsgqOnu[] = [];
  for (let p = 1; p <= SIM_PON_COUNT; p++) {
    for (let o = 1; o <= SIM_ONU_PER_PON; o++) {
      const status = o % 7 === 6 ? "los" : o % 5 === 3 ? "offline" : "online";
      const online = status === "online";
      out.push({
        ponIndex: p,
        onuIndex: o,
        serialNumber: `HSGQ${hex(p, 2)}${hex(o, 4)}`,
        macAddress: `00:1A:2B:${hex(p, 2)}:00:${hex(o, 2)}`,
        status,
        rxPowerDbm: online ? -(18 + ((p + o) % 8) + 0.5) : null,
        txPowerDbm: online ? 2.1 : null,
        distanceMeters: online ? 300 * p + 40 * o : null,
      });
    }
  }
  return out;
}

export class HsgqClient {
  private readonly url: URL;
  private readonly opts: HsgqClientOptions;
  private readonly timeoutMs: number;

  static fromEnv(overrides: Partial<HsgqClientOptions> = {}): HsgqClient {
    const e = process.env;
    const port = Number(e.OLT_HSGQ_PORT ?? e.OLT_PORT ?? 80);
    return new HsgqClient({
      host: e.OLT_HSGQ_HOST ?? e.OLT_HOST ?? "127.0.0.1",
      port,
      username: e.OLT_HSGQ_USER ?? e.OLT_USERNAME ?? "admin",
      password: e.OLT_HSGQ_PASSWORD ?? e.OLT_PASSWORD ?? "",
      community: e.OLT_COMMUNITY ?? "public",
      mode: e.DASHBOARD_DATA === "live" ? "real" : "simulator",
      ...overrides,
    });
  }

  // Melempar DeviceConnectionError("INVALID_HOST") bila host tidak lolos sanitasi anti-SSRF.
  constructor(options: HsgqClientOptions) {
    this.opts = options;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.url = sanitizeHost(options.host, options.port ?? 80);
  }

  private get simulated() {
    return this.opts.mode === "simulator";
  }

  // Simulator: .0 = timeout, .255 = login ditolak (sama seperti runSimulatorDeviceTest).
  private simulatorFailure() {
    const r = runSimulatorDeviceTest({
      type: "olt",
      mode: "simulator",
      host: this.opts.host,
      port: this.opts.port,
    });
    return r.ok ? null : new DeviceConnectionError(r.code ?? "CONNECTION_FAILED", r.message);
  }

  private async request(path: string): Promise<unknown> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const auth = Buffer.from(`${this.opts.username}:${this.opts.password}`).toString("base64");
      const res = await fetch(new URL(path, this.url), {
        method: "GET",
        headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
        signal: ctrl.signal,
        redirect: "manual", // anti-SSRF: jangan ikuti redirect
      });
      if (res.status === 401 || res.status === 403) {
        throw new DeviceConnectionError(
          "AUTH_FAILED",
          `${LABEL} menolak login (HTTP ${res.status}): periksa username dan password.`,
        );
      }
      if (res.status >= 300) {
        throw new DeviceConnectionError("HTTP_ERROR", `${LABEL} membalas HTTP ${res.status}.`);
      }
      return await res.json();
    } catch (e) {
      if (e instanceof DeviceConnectionError) throw e;
      throw describeNetworkError(e, LABEL);
    } finally {
      clearTimeout(timer);
    }
  }

  async testConnection(): Promise<HsgqTestResult> {
    if (this.simulated) {
      const r = runSimulatorDeviceTest({
        type: "olt",
        mode: "simulator",
        host: this.opts.host,
        port: this.opts.port,
      });
      return {
        ok: r.ok,
        latencyMs: r.latencyMs ?? 0,
        message: r.message,
        code: r.code,
        data: r.ok
          ? { model: "HSGQ-XPON-8", firmware: "V2.1.5", uptime: "12d3h45m", ponPortCount: SIM_PON_COUNT }
          : undefined,
      };
    }
    const started = Date.now();
    try {
      const raw = await this.request("/api/v1/system");
      const d = (Array.isArray(raw) ? raw[0] : raw) as Raw | null;
      const o: Raw = d && typeof d === "object" ? d : {};
      return {
        ok: true,
        latencyMs: Date.now() - started,
        message: "Koneksi ke OLT berhasil.",
        data: {
          model: str(o["model"]) || undefined,
          firmware: str(o["firmware"]) || undefined,
          uptime: str(o["uptime"]) || undefined,
          ponPortCount: numOrNull(o["ponPortCount"]) ?? undefined,
        },
      };
    } catch (e) {
      const err =
        e instanceof DeviceConnectionError ? e : describeNetworkError(e, LABEL);
      return { ok: false, latencyMs: Date.now() - started, message: err.message, code: err.code };
    }
  }

  async getPonPorts(): Promise<HsgqPonPort[]> {
    if (this.simulated) {
      const fail = this.simulatorFailure();
      if (fail) throw fail;
      const onus = simOnus();
      return Array.from({ length: SIM_PON_COUNT }, (_, i) => {
        const ponIndex = i + 1;
        return {
          ponIndex,
          name: `PON ${ponIndex}`,
          capacity: 128,
          status: "up" as const,
          rxPowerDbm: -(19 + (i % 4)),
          txPowerDbm: 3.5,
          attenuationDb: 22 + (i % 4),
          onuOnlineCount: onus.filter((o) => o.ponIndex === ponIndex && o.status === "online").length,
        };
      });
    }
    const data = await this.request("/api/v1/pon");
    if (!Array.isArray(data)) return [];
    return (data as Raw[]).map((d, i) => {
      const ponIndex = numOr(d["ponIndex"], i + 1);
      return {
        ponIndex,
        name: str(d["name"], `PON ${ponIndex}`),
        capacity: numOr(d["capacity"], 128),
        status: d["status"] === "up" ? "up" : "down",
        rxPowerDbm: numOrNull(d["rxPowerDbm"]),
        txPowerDbm: numOrNull(d["txPowerDbm"]),
        attenuationDb: numOrNull(d["attenuationDb"]),
        onuOnlineCount: numOr(d["onuOnlineCount"], 0),
      };
    });
  }

  async getOnus(ponIndex?: number): Promise<HsgqOnu[]> {
    if (this.simulated) {
      const fail = this.simulatorFailure();
      if (fail) throw fail;
      const all = simOnus();
      return ponIndex === undefined ? all : all.filter((o) => o.ponIndex === ponIndex);
    }
    const path = ponIndex === undefined ? "/api/v1/onu" : `/api/v1/onu?pon=${encodeURIComponent(String(ponIndex))}`;
    const data = await this.request(path);
    if (!Array.isArray(data)) return [];
    const list = (data as Raw[]).map((d): HsgqOnu => {
      const st = d["status"];
      return {
        ponIndex: numOr(d["ponIndex"], 0),
        onuIndex: numOr(d["onuIndex"], 0),
        serialNumber: str(d["serialNumber"]),
        macAddress: str(d["macAddress"]),
        status: st === "online" || st === "los" ? st : "offline",
        rxPowerDbm: numOrNull(d["rxPowerDbm"]),
        txPowerDbm: numOrNull(d["txPowerDbm"]),
        distanceMeters: numOrNull(d["distanceMeters"]),
      };
    });
    return ponIndex === undefined ? list : list.filter((o) => o.ponIndex === ponIndex);
  }
}
