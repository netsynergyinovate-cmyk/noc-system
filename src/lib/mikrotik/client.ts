// Klien REST MikroTik terpusat (RouterOS v7 /rest). Server-only: jangan impor dari komponen klien.
import {
  API_PROTOCOL_PORTS,
  DeviceConnectionError,
  impliesTls,
  runSimulatorDeviceTest,
  sanitizeHost,
} from "@/lib/device-connection";
import { MikrotikError, mapMikrotikError } from "./errors";

export { MikrotikError, mapMikrotikError } from "./errors";
export type { MikrotikErrorCode, MikrotikMappedError } from "./errors";

export interface MikrotikClientOptions {
  host: string;
  port?: number;
  username: string;
  password: string;
  useSsl?: boolean;
  timeoutMs?: number;
  mode: "real" | "simulator";
}

export interface MikrotikResource {
  version: string;
  cpuLoad: number;
  uptime: string;
  boardName: string;
  freeMemory: number;
  totalMemory: number;
  architecture: string;
}

export interface MikrotikSimpleQueue {
  id: string;
  name: string;
  target: string;
  maxLimit: string;
  rate: string;
  bytes: string;
  packets: string;
  disabled: boolean;
  comment: string;
}

export interface MikrotikInterface {
  id: string;
  name: string;
  type: string;
  running: boolean;
  disabled: boolean;
  rxByte: number;
  txByte: number;
  comment: string;
}

export interface MikrotikTestResult {
  ok: boolean;
  latencyMs: number;
  message: string;
  code?: string;
  status?: string;
  statusCode?: number;
  endpointTested?: string;
  timestamp?: number;
  resource?: MikrotikResource;
}

const DEFAULT_TIMEOUT_MS = 8000;
const LABEL = "router";

type Raw = Record<string, unknown>;
const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
// RouterOS REST mengirim boolean sebagai string "true"/"false".
const bool = (v: unknown) => v === true || v === "true";

function toResource(d: Raw): MikrotikResource {
  return {
    version: str(d["version"]),
    cpuLoad: num(d["cpu-load"]),
    uptime: str(d["uptime"]),
    boardName: str(d["board-name"]),
    freeMemory: num(d["free-memory"]),
    totalMemory: num(d["total-memory"]),
    architecture: str(d["architecture-name"]),
  };
}

function toQueue(d: Raw): MikrotikSimpleQueue {
  return {
    id: str(d[".id"]),
    name: str(d["name"]),
    target: str(d["target"]),
    maxLimit: str(d["max-limit"]),
    rate: str(d["rate"]),
    bytes: str(d["bytes"]),
    packets: str(d["packet-marks"] ?? d["packets"]),
    disabled: bool(d["disabled"]),
    comment: str(d["comment"]),
  };
}

function toInterface(d: Raw): MikrotikInterface {
  return {
    id: str(d[".id"]),
    name: str(d["name"]),
    type: str(d["type"]),
    running: bool(d["running"]),
    disabled: bool(d["disabled"]),
    rxByte: num(d["rx-byte"]),
    txByte: num(d["tx-byte"]),
    comment: str(d["comment"]),
  };
}

const SIM_INTERFACES = [
  ...Array.from({ length: 8 }, (_, i) => ["ether" + (i + 1), "ether"] as const),
  ["sfp-sfpplus1", "ether"] as const,
  ["bridge1", "bridge"] as const,
];

export class MikrotikRestClient {
  private readonly url: URL;
  private readonly opts: MikrotikClientOptions;
  private readonly timeoutMs: number;

  // Melempar DeviceConnectionError("INVALID_HOST") bila host tidak lolos sanitasi anti-SSRF.
  constructor(options: MikrotikClientOptions) {
    this.opts = options;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const url = sanitizeHost(options.host, options.port);
    // Eksplisit menang; bila tidak disebut, baca dari skema/port (443, 8443).
    if (options.useSsl ?? impliesTls(url)) {
      // Port 80 pada HTTP tidak tercatat di URL (port bawaan), jadi ambil dari opsi:
      // mengganti skema tanpa ini mengubah "80 + TLS" diam-diam menjadi 443.
      const port = url.port || (options.port !== undefined ? String(options.port) : "");
      url.protocol = "https:";
      if (port) url.port = port;
    }
    this.url = url;
  }

  // Tujuan akhir koneksi (setelah skema/port disimpulkan), untuk pesan dan catatan uji.
  get target() {
    const tls = this.url.protocol === "https:";
    return {
      host: this.url.hostname,
      port: this.url.port ? Number(this.url.port) : tls ? 443 : 80,
      tls,
      endpoint: `GET ${this.url.protocol}//${this.url.host}/rest/system/resource`,
    };
  }

  private get ctx() {
    const { host, port } = this.target;
    return { host, port };
  }

  private get simulated() {
    return this.opts.mode === "simulator";
  }

  // Simulator: .0 = timeout, .255 = login ditolak, selain itu sukses (sama seperti runSimulatorDeviceTest).
  private simulatorFailure() {
    const r = runSimulatorDeviceTest({
      type: "mikrotik",
      mode: "simulator",
      host: this.opts.host,
      port: this.opts.port,
    });
    return r.ok ? null : new DeviceConnectionError(r.code ?? "CONNECTION_FAILED", r.message);
  }

  private async request(path: string): Promise<unknown> {
    // 8728/8729 adalah API biner RouterOS: fetch ke sana hanya macet atau ditolak.
    if (API_PROTOCOL_PORTS.has(this.target.port)) {
      throw new MikrotikError(
        mapMikrotikError(
          new DeviceConnectionError(
            "WRONG_PORT",
            `Port ${this.target.port} adalah API biner RouterOS, bukan REST. Pakai port layanan www (80) atau www-ssl (443).`,
          ),
          this.ctx,
        ),
      );
    }
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
      if (res.status >= 300) throw new MikrotikError(mapMikrotikError(res.status, this.ctx));
      return await res.json();
    } catch (e) {
      if (e instanceof MikrotikError) throw e;
      throw new MikrotikError(mapMikrotikError(e, this.ctx), e);
    } finally {
      clearTimeout(timer);
    }
  }

  async testConnection(): Promise<MikrotikTestResult> {
    const started = Date.now();
    try {
      const resource = await this.getResource();
      return {
        ok: true,
        latencyMs: this.simulated ? 12 : Date.now() - started,
        message: this.simulated
          ? "Koneksi ke router (simulator) berhasil."
          : "Koneksi ke router berhasil.",
        resource,
      };
    } catch (e) {
      const m = mapMikrotikError(e, this.ctx);
      return {
        ok: false,
        latencyMs: this.simulated ? 0 : Date.now() - started,
        message: m.message,
        code: m.code,
      };
    }
  }

  async getResource(): Promise<MikrotikResource> {
    if (this.simulated) {
      const fail = this.simulatorFailure();
      if (fail) throw fail;
      return {
        version: "7.14 (stable)",
        cpuLoad: 8,
        uptime: "3d4h12m",
        boardName: "RB4011iGS+",
        freeMemory: 805306368,
        totalMemory: 1073741824,
        architecture: "arm64",
      };
    }
    const data = await this.request("/rest/system/resource");
    const d = (Array.isArray(data) ? data[0] : data) as Raw | null;
    return toResource(d && typeof d === "object" ? d : {});
  }

  async getQueues(): Promise<MikrotikSimpleQueue[]> {
    if (this.simulated) {
      const fail = this.simulatorFailure();
      if (fail) throw fail;
      return Array.from({ length: 5 }, (_, i) => ({
        id: `*${(i + 1).toString(16).toUpperCase()}`,
        name: `pppoe-user${i + 1}`,
        target: `10.10.0.${i + 10}/32`,
        maxLimit: i % 2 ? "20M/20M" : "10M/10M",
        rate: `${(i + 1) * 100000}/${(i + 1) * 500000}`,
        bytes: `${(i + 1) * 1000000}/${(i + 1) * 5000000}`,
        packets: `${(i + 1) * 1000}/${(i + 1) * 5000}`,
        disabled: i === 4,
        comment: `Pelanggan simulator ${i + 1}`,
      }));
    }
    const data = await this.request("/rest/queue/simple");
    return Array.isArray(data) ? (data as Raw[]).map(toQueue) : [];
  }

  async getInterfaces(): Promise<MikrotikInterface[]> {
    if (this.simulated) {
      const fail = this.simulatorFailure();
      if (fail) throw fail;
      return SIM_INTERFACES.map(([name, type], i) => ({
        id: `*${(i + 1).toString(16).toUpperCase()}`,
        name,
        type,
        running: i < 6 || name === "bridge1",
        disabled: false,
        rxByte: (i + 1) * 123456789,
        txByte: (i + 1) * 98765432,
        comment: i === 0 ? "Uplink" : "",
      }));
    }
    const data = await this.request("/rest/interface");
    return Array.isArray(data) ? (data as Raw[]).map(toInterface) : [];
  }
}
