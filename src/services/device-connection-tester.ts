// Mesin uji koneksi bersama untuk semua konektor perangkat (MikroTik, OLT,
// GenieACS, Billing). Murni (tanpa "server-only" dan tanpa alias path) agar bisa
// diuji langsung dengan node --test. Dipakai device-connection.service.

import { parseMikrotikResource } from "../lib/device-connection.ts";

export type DeviceType = "mikrotik" | "olt" | "genieacs" | "billing";

export interface DeviceTestRequest {
  type: DeviceType;
  host: string;
  port: number;
  username: string;
  password?: string;
  mode?: "simulator" | "real";
  useTls?: boolean;
}

export interface DeviceTestResult {
  ok: boolean;
  status: "connected" | "disconnected" | "error" | "timeout" | "untested";
  code:
    | "OK"
    | "TIMEOUT"
    | "AUTH_FAILED"
    | "CONNECTION_REFUSED"
    | "INVALID_PORT"
    | "INVALID_HOST"
    | "HTTP_ERROR"
    | "DNS_ERROR";
  statusCode?: number;
  message: string;
  latencyMs: number | null;
  endpointTested: string;
  /** Epoch detik (sama dengan TestOutcome.timestamp di frontend). */
  timestamp: number;
  data?: Record<string, unknown>;
}

export const DEVICE_TEST_TIMEOUT_MS = 8000;

const LABEL: Record<DeviceType, string> = {
  mikrotik: "router",
  olt: "OLT",
  genieacs: "GenieACS",
  billing: "sistem billing",
};

/** Port bawaan bila pemanggil tidak menyebutkan port. */
export function defaultPortFor(type: DeviceType, useTls = false): number {
  if (type === "genieacs") return useTls ? 443 : 7557;
  return useTls ? 443 : 80;
}

// --- Validasi host (anti SSRF / injeksi) ------------------------------------

const LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;
const BLOCKED_HOSTS = new Set(["metadata.google.internal"]);

export interface ParsedTarget {
  host: string;
  port?: number;
  useTls?: boolean;
}

/**
 * Terima "host", "host:port", atau "http(s)://host[:port][/]". Tolak path, query,
 * kredensial, skema lain, spasi/karakter kontrol, IP tidak baku, dan alamat
 * link-local/metadata cloud (169.254.0.0/16). Mengembalikan null bila ditolak.
 */
export function parseTarget(raw: string): ParsedTarget | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  if (!s || s.length > 270) return null;
  let useTls: boolean | undefined;
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(s);
  if (scheme) {
    const sc = scheme[1].toLowerCase();
    if (sc !== "http" && sc !== "https") return null;
    useTls = sc === "https";
    s = s.slice(scheme[0].length);
  }
  if (s.endsWith("/")) s = s.slice(0, -1);
  const m = /^([a-z0-9.-]+)(?::(\d{1,6}))?$/i.exec(s);
  if (!m) return null; // spasi, @, /, ?, #, ;, kontrol, IPv6, dll.
  const host = m[1].toLowerCase();
  if (host.length > 253 || BLOCKED_HOSTS.has(host)) return null;
  if (/^[\d.]+$/.test(host)) {
    const o = host.split(".");
    if (o.length !== 4) return null;
    if (!o.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255 && (p.length === 1 || p[0] !== "0"))) return null;
    if (o[0] === "169" && o[1] === "254") return null;
  } else if (!host.split(".").every((l) => LABEL_RE.test(l))) {
    return null;
  }
  return { host, port: m[2] !== undefined ? Number(m[2]) : undefined, useTls };
}

const isPort = (p: unknown): p is number =>
  typeof p === "number" && Number.isInteger(p) && p >= 1 && p <= 65535;

// --- Endpoint & simulasi ----------------------------------------------------

function pathFor(type: DeviceType, port: number): string {
  switch (type) {
    case "mikrotik":
      return "/rest/system/resource";
    case "olt":
      return port === 23 ? "" : "/api/v1/system";
    case "genieacs":
      return "/devices";
    case "billing":
      return "/login";
  }
}

function endpointFor(type: DeviceType, host: string, port: number, tls: boolean): string {
  if (type === "olt" && port === 23) return `TELNET handshake ${host}:23`;
  return `GET ${tls ? "https" : "http"}://${host}:${port}${pathFor(type, port)}`;
}

const SIM_LATENCY: Record<DeviceType, number> = { mikrotik: 12, olt: 24, genieacs: 18, billing: 45 };
const SIM_DATA: Record<DeviceType, Record<string, unknown>> = {
  mikrotik: { version: "7.14 (stable)", cpuLoad: 8, uptime: "3d4h12m", boardName: "RB4011iGS+" },
  olt: { info: "OLT simulator terhubung" },
  genieacs: { deviceCount: 42 },
  billing: { info: "Sistem billing simulator terhubung", csrf: true },
};

type Fail = Pick<DeviceTestResult, "status" | "code" | "message" | "latencyMs"> & { statusCode?: number };

function timeoutFail(host: string, port: number, ms: number): Fail {
  return {
    status: "timeout",
    code: "TIMEOUT",
    latencyMs: ms,
    message: `Timeout ${ms}ms: host ${host}:${port} tidak merespons. Periksa rute jaringan.`,
  };
}
const refusedFail = (port: number, ms: number): Fail => ({
  status: "error",
  code: "CONNECTION_REFUSED",
  latencyMs: ms,
  message: `Koneksi ditolak (Connection Refused) pada port ${port}.`,
});
const authFail = (user: string, code: number, ms: number): Fail => ({
  status: "error",
  code: "AUTH_FAILED",
  statusCode: code,
  latencyMs: ms,
  message: `Autentikasi gagal ${code}: periksa username/password untuk ${user}.`,
});

function simulate(req: DeviceTestRequest, host: string, port: number, tls: boolean): Fail | null {
  if (host.endsWith(".0")) return timeoutFail(host, port, DEVICE_TEST_TIMEOUT_MS);
  if (port === 9999) return refusedFail(port, 5);
  if (host.endsWith(".255") || req.username === "bad-user") return authFail(req.username, 401, 35);
  void tls;
  return null;
}

// --- Mode real --------------------------------------------------------------

function mapError(error: unknown, host: string, port: number, timeoutMs: number, elapsed: number): Fail {
  const err = error as { name?: string; message?: string; code?: string; cause?: { code?: string } } | null;
  const code = err?.code ?? err?.cause?.code ?? "";
  const text = `${err?.message ?? ""} ${code}`;
  if (err?.name === "AbortError" || err?.name === "TimeoutError" || code === "ETIMEDOUT" || /timed? ?out/i.test(text)) {
    return timeoutFail(host, port, timeoutMs);
  }
  if (text.includes("ECONNREFUSED")) return refusedFail(port, elapsed);
  if (text.includes("ENOTFOUND") || text.includes("EAI_AGAIN")) {
    return {
      status: "error",
      code: "DNS_ERROR",
      latencyMs: elapsed,
      message: `Host ${host} tidak ditemukan. Pastikan alamat IP atau domain benar.`,
    };
  }
  return {
    status: "error",
    code: "HTTP_ERROR",
    latencyMs: elapsed,
    message: `Gagal menghubungi ${host}:${port}: ${(err?.message ?? "kesalahan tidak dikenal").slice(0, 200)}`,
  };
}

async function tcpProbe(host: string, port: number, timeoutMs: number): Promise<void> {
  const { connect } = await import("node:net");
  await new Promise<void>((resolve, reject) => {
    const socket = connect({ host, port });
    const done = (e?: Error) => {
      socket.destroy();
      if (e) reject(e);
      else resolve();
    };
    socket.setTimeout(timeoutMs, () => done(Object.assign(new Error("timeout"), { name: "TimeoutError" })));
    socket.once("connect", () => done());
    socket.once("error", done);
  });
}

async function mikrotikApiProbe(
  host: string,
  port: number,
  username = "",
  password = "",
  useTls = false,
  timeoutMs = 8000,
): Promise<{ resource: Record<string, unknown> }> {
  const { connect: netConnect } = await import("node:net");
  const { connect: tlsConnect } = await import("node:tls");

  return new Promise((resolve, reject) => {
    const socket = useTls
      ? tlsConnect({ host, port, rejectUnauthorized: false, timeout: timeoutMs })
      : netConnect({ host, port });

    socket.setTimeout(timeoutMs);

    let incoming = Buffer.alloc(0);
    let state: "login" | "resource" = "login";

    const encodeSentence = (words: string[]): Buffer => {
      const bufs: Buffer[] = [];
      for (const word of words) {
        const len = Buffer.byteLength(word);
        if (len < 0x80) {
          bufs.push(Buffer.from([len]));
        } else if (len < 0x4000) {
          bufs.push(Buffer.from([(len >> 8) | 0x80, len & 0xff]));
        } else if (len < 0x200000) {
          bufs.push(Buffer.from([(len >> 16) | 0xc0, (len >> 8) & 0xff, len & 0xff]));
        }
        bufs.push(Buffer.from(word));
      }
      bufs.push(Buffer.from([0x00]));
      return Buffer.concat(bufs);
    };

    const cleanup = () => {
      socket.removeAllListeners();
      socket.destroy();
    };

    socket.on("connect", () => {
      socket.write(encodeSentence(["/login", `=name=${username}`, `=password=${password}`]));
    });

    socket.on("timeout", () => {
      cleanup();
      reject(Object.assign(new Error("Timeout waiting for MikroTik API response"), { name: "TimeoutError" }));
    });

    socket.on("error", (err) => {
      cleanup();
      reject(err);
    });

    socket.on("data", (chunk: Buffer) => {
      incoming = Buffer.concat([incoming, chunk]);

      while (incoming.length > 0) {
        let offset = 0;
        const words: string[] = [];
        let sentenceComplete = false;

        while (offset < incoming.length) {
          const b1 = incoming[offset++];
          if (b1 === 0x00) {
            sentenceComplete = true;
            break;
          }
          let len = 0;
          if ((b1 & 0x80) === 0) {
            len = b1;
          } else if ((b1 & 0xc0) === 0x80) {
            if (offset >= incoming.length) {
              offset--;
              break;
            }
            len = ((b1 & 0x3f) << 8) | incoming[offset++];
          } else if ((b1 & 0xe0) === 0xc0) {
            if (offset + 1 >= incoming.length) {
              offset--;
              break;
            }
            len = ((b1 & 0x1f) << 16) | (incoming[offset++] << 8) | incoming[offset++];
          }
          if (offset + len > incoming.length) {
            offset -= 2;
            break;
          }
          words.push(incoming.subarray(offset, offset + len).toString("utf8"));
          offset += len;
        }

        if (!sentenceComplete) break;
        incoming = incoming.subarray(offset);

        const type = words[0];
        if (state === "login") {
          if (type === "!trap") {
            cleanup();
            const msgWord = words.find((w) => w.startsWith("=message="));
            const msg = msgWord ? msgWord.slice(9) : "Autentikasi API gagal";
            const err = Object.assign(new Error(msg), { code: "AUTH_FAILED" });
            return reject(err);
          }
          if (type === "!done") {
            state = "resource";
            socket.write(encodeSentence(["/system/resource/print"]));
          }
        } else if (state === "resource") {
          if (type === "!re") {
            const res: Record<string, string> = {};
            for (const w of words.slice(1)) {
              const eq = w.indexOf("=");
              if (eq > 0) {
                const k = w.slice(1, eq);
                const v = w.slice(eq + 1);
                res[k] = v;
              }
            }
            cleanup();
            return resolve({
              resource: {
                version: res.version ?? "RouterOS v7",
                boardName: res["board-name"] ?? "MikroTik",
                cpuLoad: Number(res["cpu-load"] ?? 0),
                uptime: res.uptime ?? "0s",
                freeMemoryMb: Math.round(Number(res["free-memory"] ?? 0) / (1024 * 1024)),
                totalMemoryMb: Math.round(Number(res["total-memory"] ?? 0) / (1024 * 1024)),
              },
            });
          } else if (type === "!done") {
            cleanup();
            return resolve({
              resource: {
                version: "RouterOS v7",
                boardName: "MikroTik",
                cpuLoad: 0,
                uptime: "0s",
              },
            });
          }
        }
      }
    });
  });
}

/**
 * Buang rahasia dari teks yang akan dikirim ke klien: password polos, Basic Auth
 * base64 (dengan/tanpa awalan "Basic "), kredensial di URL (//user:pass@), dan
 * parameter query token/password/auth/secret.
 */
export function redactSecrets(text: string, req: Pick<DeviceTestRequest, "username" | "password">): string {
  let out = text;
  if (req.password) {
    const b64 = Buffer.from(`${req.username ?? ""}:${req.password}`).toString("base64");
    // Terpanjang dulu agar "Basic <b64>" tidak terpecah oleh penggantian lain.
    for (const s of [`Basic ${b64}`, b64, req.password]) out = out.split(s).join("***");
  }
  return out
    .replace(/\/\/[^/@\s]*:[^/@\s]*@/g, "//***@")
    .replace(/([?&](?:token|password|auth|secret)=)[^&\s]*/gi, "$1***");
}

// --- Fungsi utama -----------------------------------------------------------

export async function testDeviceConnection(
  request: DeviceTestRequest,
  options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<DeviceTestResult> {
  const timeoutMs = options.timeoutMs ?? DEVICE_TEST_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timestamp = Math.floor(Date.now() / 1000);
  const mode = request.mode ?? "real";
  const finish = (r: Fail & { ok?: boolean; data?: Record<string, unknown> }, endpointTested: string): DeviceTestResult => ({
    ok: false,
    ...r,
    message: redactSecrets(r.message, request),
    endpointTested: redactSecrets(endpointTested, request),
    timestamp,
  });

  const target = parseTarget(request.host);
  if (!target) {
    return finish(
      {
        status: "error",
        code: "INVALID_HOST",
        latencyMs: null,
        message: "Host tidak valid: gunakan IPv4 atau nama host tanpa path, kredensial, atau karakter khusus.",
      },
      "-",
    );
  }
  const { host } = target;
  const port = target.port ?? request.port;
  const tls = target.useTls ?? request.useTls ?? (port === 443 || port === 8443);

  // Simulator menyimulasikan port 0 sebagai "ditolak"; mode real menolaknya.
  const portZeroRefused = mode === "simulator" && port === 0;
  if (!isPort(port) && !portZeroRefused) {
    return finish(
      {
        status: "error",
        code: "INVALID_PORT",
        latencyMs: null,
        message: `Port ${String(port)} tidak valid: harus bilangan bulat 1-65535.`,
      },
      "-",
    );
  }
  const endpoint = endpointFor(request.type, host, port, tls);

  if (mode === "simulator") {
    const fail = portZeroRefused ? refusedFail(port, 5) : simulate(request, host, port, tls);
    if (fail) return finish(fail, endpoint);
    return {
      ok: true,
      status: "connected",
      code: "OK",
      statusCode: 200,
      message: `Sukses: koneksi ke ${LABEL[request.type]} (simulator) berhasil.`,
      latencyMs: SIM_LATENCY[request.type],
      endpointTested: endpoint,
      timestamp,
      data: { ...SIM_DATA[request.type] },
    };
  }

  const started = performance.now();
  const elapsed = () => Math.max(1, Math.round(performance.now() - started));
  try {
    if (request.type === "olt" && port === 23) {
      await tcpProbe(host, port, timeoutMs);
      return {
        ok: true,
        status: "connected",
        code: "OK",
        message: "Sukses: handshake TCP/Telnet OLT diterima.",
        latencyMs: elapsed(),
        endpointTested: endpoint,
        timestamp,
        data: { info: "OLT terhubung" },
      };
    }

    if (request.type === "mikrotik" && (port === 8728 || port === 8729)) {
      try {
        const apiResult = await mikrotikApiProbe(
          host,
          port,
          request.username,
          request.password,
          tls || port === 8729,
          timeoutMs,
        );
        return {
          ok: true,
          status: "connected",
          code: "OK",
          statusCode: 200,
          message: `Sukses: handshake API RouterOS (port ${port}) berhasil.`,
          latencyMs: elapsed(),
          endpointTested: endpoint,
          timestamp,
          data: { resource: apiResult.resource },
        };
      } catch (err: unknown) {
        const errObj = err as { code?: string; message?: string };
        if (errObj?.code === "AUTH_FAILED") {
          return finish(authFail(request.username, 401, elapsed()), endpoint);
        }
        throw err;
      }
    }

    const headers: Record<string, string> = { Accept: "application/json" };
    if (request.username && request.password) {
      headers.Authorization = `Basic ${Buffer.from(`${request.username}:${request.password}`).toString("base64")}`;
    }
    const path = request.type === "genieacs" ? "/devices/?query=%7B%7D&projection=_id" : pathFor(request.type, port);
    const url = `${tls ? "https" : "http"}://${host}:${port}${path}`;
    // redirect "manual": jangan ikuti pengalihan ke host lain (SSRF).
    const res = await fetchImpl(url, {
      method: "GET",
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = elapsed();

    if (res.status === 401 || res.status === 403) return finish({ ...authFail(request.username, res.status, latencyMs) }, endpoint);

    const httpFail = (message: string): DeviceTestResult =>
      finish({ status: "error", code: "HTTP_ERROR", statusCode: res.status, latencyMs, message }, endpoint);
    const success = (message: string, data: Record<string, unknown>): DeviceTestResult => ({
      ok: true,
      status: "connected",
      code: "OK",
      statusCode: res.status,
      message,
      latencyMs,
      endpointTested: endpoint,
      timestamp,
      data,
    });

    switch (request.type) {
      case "mikrotik": {
        if (res.status === 404) {
          return httpFail("Router menjawab HTTP 404: layanan REST (www/www-ssl) belum aktif atau RouterOS di bawah v7.1.");
        }
        if (!res.ok) return httpFail(`Router menjawab HTTP ${res.status}.`);
        const body = await res.json().catch(() => undefined);
        if (body === undefined) return httpFail("Router menjawab dengan format yang tidak dikenal.");
        return success("Sukses: REST RouterOS /rest/system/resource menjawab 200.", { ...parseMikrotikResource(body) });
      }
      case "genieacs": {
        if (!res.ok) return httpFail(`GenieACS menjawab HTTP ${res.status}.`);
        const body = await res.json().catch(() => null);
        return success("Sukses: NBI GenieACS /devices menjawab 200.", {
          deviceCount: Array.isArray(body) ? body.length : undefined,
        });
      }
      case "billing": {
        if (res.status >= 500) return httpFail(`Sistem billing menjawab HTTP ${res.status}.`);
        const html = await res.text().catch(() => "");
        const csrf = /csrf|_token|authenticity_token/i.test(html);
        return success("Sukses: portal billing menjawab dan halaman login terbaca.", {
          info: "Sistem billing terhubung",
          csrf,
        });
      }
      default: {
        if (res.status >= 500) return httpFail(`OLT menjawab HTTP ${res.status}.`);
        // 404 bukan "OLT menjawab": alamat itu tidak ada. Biasanya yang menjawab perangkat lain
        // (mis. router yang meneruskan port 80) atau OLT ini hanya punya CLI telnet.
        if (res.status === 404) {
          return httpFail(
            "Web API OLT tidak ditemukan (HTTP 404). Bila OLT hanya punya CLI telnet, pilih driver hsgq-telnet; bila bukan, periksa alamat dan port.",
          );
        }
        return success("Sukses: Web API OLT menjawab.", { info: "OLT terhubung" });
      }
    }
  } catch (error) {
    const f = mapError(error, host, port, timeoutMs, elapsed());
    return finish(f, endpoint);
  }
}
