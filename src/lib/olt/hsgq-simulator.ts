// Simulator OLT HSGQ untuk pengujian lokal. Hanya untuk dev/test: jangan impor dari kode produksi.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export type HsgqFault = "timeout" | "auth-fail" | "server-error";
export type HsgqOnuStatus = "online" | "offline" | "los";

export interface HsgqSimulatorOptions {
  port?: number;
  username?: string;
  password?: string;
}

interface SimOnu {
  ponIndex: number;
  onuIndex: number;
  serialNumber: string;
  macAddress: string;
  status: HsgqOnuStatus;
  rxPowerDbm: number | null;
  txPowerDbm: number | null;
  distanceMeters: number | null;
}

export interface HsgqFaultInput {
  fault?: HsgqFault | null;
  delayMs?: number;
  onuStatus?: { serialNumber: string; status: HsgqOnuStatus };
}

const PON_COUNT = 8;
const ONU_PER_PON = 8;
const DEFAULT_TIMEOUT_HANG_MS = 60_000;
const FAULTS: readonly string[] = ["timeout", "auth-fail", "server-error"];
const STATUSES: readonly string[] = ["online", "offline", "los"];
const hex = (n: number, len: number) => n.toString(16).toUpperCase().padStart(len, "0");

// 64 ONU: 52 online, 8 offline (ONU ke-8 tiap PON), 4 los (ONU ke-7 pada PON 1-4).
function defaultOnus(): SimOnu[] {
  const out: SimOnu[] = [];
  for (let p = 1; p <= PON_COUNT; p++) {
    for (let o = 1; o <= ONU_PER_PON; o++) {
      const status: HsgqOnuStatus = o === 8 ? "offline" : o === 7 && p <= 4 ? "los" : "online";
      out.push({
        ponIndex: p,
        onuIndex: o,
        serialNumber: `HSGQ${p}${o}`,
        macAddress: `00:1A:2B:${hex(p, 2)}:00:${hex(o, 2)}`,
        status,
        // online -18.0..-28.5; los -31; offline tanpa sinyal
        rxPowerDbm: status === "online" ? -(18 + ((p * 3 + o * 5) % 22) / 2) : status === "los" ? -31 : null,
        txPowerDbm: status === "online" ? 2.1 : null,
        distanceMeters: status === "offline" ? null : 300 * p + 40 * o,
      });
    }
  }
  return out;
}

function ponPorts(onus: SimOnu[]) {
  return Array.from({ length: PON_COUNT }, (_, i) => {
    const ponIndex = i + 1;
    return {
      ponIndex,
      name: `PON ${ponIndex}`,
      capacity: 128,
      status: "up" as const,
      txPowerDbm: 2.5,
      rxPowerDbm: -19.0,
      attenuationDb: 22 + (i % 4),
      onuOnlineCount: onus.filter((o) => o.ponIndex === ponIndex && o.status === "online").length,
    };
  });
}

export function createHsgqSimulator(options: HsgqSimulatorOptions = {}) {
  const username = options.username ?? "admin";
  const password = options.password ?? "admin";
  const expectedAuth = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;

  let onus = defaultOnus();
  let fault: HsgqFault | null = null;
  let delayMs: number | undefined;
  const timers = new Set<NodeJS.Timeout>();

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const injectFault = (input: HsgqFaultInput) => {
    if ("fault" in input) {
      if (input.fault != null && !FAULTS.includes(input.fault)) throw new Error("fault tidak dikenal");
      fault = input.fault ?? null;
      delayMs = fault === "timeout" ? input.delayMs : undefined;
    }
    if (input.onuStatus) {
      const { serialNumber, status } = input.onuStatus;
      if (!STATUSES.includes(status)) throw new Error("status ONU tidak dikenal");
      const onu = onus.find((o) => o.serialNumber === serialNumber);
      if (!onu) throw new Error("ONU tidak ditemukan");
      onu.status = status;
      if (status === "offline") {
        onu.rxPowerDbm = null;
        onu.txPowerDbm = null;
      } else if (status === "los") {
        onu.rxPowerDbm = -31;
        onu.txPowerDbm = null;
      } else {
        onu.rxPowerDbm = -22;
        onu.txPowerDbm = 2.1;
      }
    }
  };

  const reset = () => {
    onus = defaultOnus();
    fault = null;
    delayMs = undefined;
  };

  const readBody = (req: IncomingMessage) =>
    new Promise<string>((resolve, reject) => {
      let data = "";
      req.setEncoding("utf8");
      req.on("data", (c) => {
        data += c;
        if (data.length > 64 * 1024) reject(new Error("body terlalu besar"));
      });
      req.on("end", () => resolve(data));
      req.on("error", reject);
    });

  const handleControl = async (req: IncomingMessage, res: ServerResponse, path: string) => {
    if (req.method !== "POST") return json(res, 405, { error: "Method Not Allowed" });
    try {
      if (path === "/_control/reset") {
        reset();
        return json(res, 200, { ok: true });
      }
      const raw = await readBody(req);
      const body = raw ? JSON.parse(raw) : {};
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("body harus objek");
      injectFault(body as HsgqFaultInput);
      return json(res, 200, { ok: true, fault });
    } catch (e) {
      return json(res, 400, { error: e instanceof Error ? e.message : "Bad Request" });
    }
  };

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://sim.local");
    const path = url.pathname;

    if (path === "/_control/fault" || path === "/_control/reset") {
      void handleControl(req, res, path);
      return;
    }

    // Gangguan global atau per-request lewat header `x-fault`.
    const header = req.headers["x-fault"];
    const active = (typeof header === "string" && FAULTS.includes(header) ? header : fault) as HsgqFault | null;
    if (active === "timeout") {
      // Tahan respons lebih lama dari timeout klien; dibersihkan saat close/reset server.
      const t = setTimeout(() => {
        timers.delete(t);
        req.socket.destroy();
      }, delayMs ?? DEFAULT_TIMEOUT_HANG_MS);
      t.unref();
      timers.add(t);
      return;
    }
    if (active === "auth-fail") return json(res, 401, { error: "Unauthorized" });
    if (active === "server-error") return json(res, 500, { error: "Internal Server Error" });

    if (req.headers.authorization !== expectedAuth) {
      res.setHeader("WWW-Authenticate", 'Basic realm="HSGQ"');
      return json(res, 401, { error: "Unauthorized" });
    }
    if (req.method !== "GET") return json(res, 405, { error: "Method Not Allowed" });

    if (path === "/api/v1/system") {
      return json(res, 200, { model: "HSGQ-XPON-8", firmware: "V2.1.5", uptime: "15d 4h", ponPortCount: PON_COUNT });
    }
    if (path === "/api/v1/pon") return json(res, 200, ponPorts(onus));
    if (path === "/api/v1/onu") {
      const raw = url.searchParams.get("pon") ?? url.searchParams.get("ponIndex");
      if (raw === null) return json(res, 200, onus);
      const pon = Number(raw);
      return json(res, 200, Number.isInteger(pon) ? onus.filter((o) => o.ponIndex === pon) : []);
    }
    return json(res, 404, { error: "Not Found" });
  });

  const closeAll = () => {
    for (const t of timers) clearTimeout(t);
    timers.clear();
  };

  const ready = new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", resolve);
  });

  return {
    server,
    ready,
    get port() {
      return (server.address() as AddressInfo | null)?.port ?? 0;
    },
    get url() {
      return `http://127.0.0.1:${this.port}`;
    },
    injectFault,
    reset,
    close: () =>
      new Promise<void>((resolve, reject) => {
        closeAll();
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeAllConnections();
      }),
  };
}
