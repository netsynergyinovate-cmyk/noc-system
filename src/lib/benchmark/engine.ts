import { buildMockHistory } from "../dashboard/history";
import { mockRouters } from "../dashboard/mock-data";
import { hashString, unit } from "../dashboard/mock-random";
import type { TrafficRangeId } from "../dashboard/ranges";

// Padanan Node.js untuk collector, rule engine, dan /api/v1/traffic/history di
// layanan Go, dipakai uji banding stack lokal. Tanpa import server-only supaya
// bisa diuji langsung.

export class BenchmarkError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const CPU_THRESHOLD = 85;
export const QUEUE_THRESHOLD = 95;
export const TRAFFIC_RANGES = ["1h", "6h", "24h", "7d"] as const;

export const DEFAULT_SIMULATOR_URL = "http://127.0.0.1:8081";

export async function timed<T>(fn: () => Promise<T> | T) {
  const start = performance.now();
  const result = await fn();
  return { result, durationMs: performance.now() - start };
}

export const memory = () => process.memoryUsage();

// Jangan jadi proxy bebas (SSRF): `url` dari query hanya boleh ke loopback atau
// ke host yang sama dengan SIMULATOR_MIKROTIK_URL.
export function resolveSimulatorUrl(queryUrl: string | null) {
  const configured = process.env.SIMULATOR_MIKROTIK_URL || DEFAULT_SIMULATOR_URL;
  if (!queryUrl) return configured;
  let url: URL;
  try {
    url = new URL(queryUrl);
  } catch {
    throw new BenchmarkError(400, "Parameter url tidak valid.");
  }
  const allowed = new Set(["127.0.0.1", "localhost", "[::1]"]);
  allowed.add(new URL(configured).hostname);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    !allowed.has(url.hostname)
  )
    throw new BenchmarkError(400, "Host url tidak diizinkan untuk benchmark.");
  return url.origin;
}

export async function collect(baseUrl: string) {
  const user = process.env.SIMULATOR_MIKROTIK_USER || "admin";
  const pass = process.env.SIMULATOR_MIKROTIK_PASSWORD || "admin";
  const headers = {
    authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`,
  };
  const get = async (path: string) => {
    let res: Response;
    try {
      res = await fetch(new URL(path, baseUrl), {
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new BenchmarkError(502, "Simulator MikroTik tidak terjangkau.");
    }
    if (!res.ok)
      throw new BenchmarkError(502, `Simulator menjawab ${res.status}.`);
    return res.json();
  };
  const [resource, queues] = await Promise.all([
    get("/rest/system/resource"),
    get("/rest/queue/simple"),
  ]);
  return {
    resource,
    queueCount: Array.isArray(queues) ? queues.length : 0,
  };
}

export interface BenchmarkAnomaly {
  kind: "cpu" | "queue" | "offline";
  subjectId: string;
  subject: string;
  measured: number | null;
}

// Snapshot tetap: fungsi dari menit absolut, jadi tiap run sama bebannya.
export function evaluate(nowSec: number): BenchmarkAnomaly[] {
  const minute = Math.floor(nowSec / 60);
  const anomalies: BenchmarkAnomaly[] = [];
  for (const router of mockRouters) {
    const cpu = Math.round(unit(hashString(router.id) + minute) * 1000) / 10;
    if (cpu > CPU_THRESHOLD)
      anomalies.push({ kind: "cpu", subjectId: router.id, subject: router.name, measured: cpu });
  }
  const sampleCustomers: { id: string; name: string; isOnline: boolean }[] = [];
  for (const customer of sampleCustomers) {
    const queue =
      Math.round(unit(hashString(customer.id) * 31 + minute) * 1000) / 10;
    if (queue > QUEUE_THRESHOLD)
      anomalies.push({ kind: "queue", subjectId: customer.id, subject: customer.name, measured: queue });
    if (!customer.isOnline)
      anomalies.push({ kind: "offline", subjectId: customer.id, subject: customer.name, measured: null });
  }
  return anomalies;
}

export function parseRange(value: string | null): TrafficRangeId {
  const range = value ?? "1h";
  if (!(TRAFFIC_RANGES as readonly string[]).includes(range))
    throw new BenchmarkError(400, "range harus 1h, 6h, 24h, atau 7d.");
  return range as TrafficRangeId;
}

// Baca arsip traffic_samples lewat Drizzle; bila kosong, DB mati, atau env
// belum siap, jatuh ke data tiruan deterministik. Impor dinamis: modul service
// membawa "server-only" dan koneksi DB, yang tidak boleh menggagalkan engine.
export async function traffic(range: TrafficRangeId, nowSec: number) {
  if (range !== "live") {
    try {
      const { queryTrafficHistoryDrizzle } = await import(
        "@/services/traffic-archive.service"
      );
      const db = await queryTrafficHistoryDrizzle({ range, nowSec });
      if (db && db.points > 0) return db;
    } catch {
      // jatuh ke data tiruan
    }
  }
  const h = buildMockHistory(range, nowSec);
  return {
    source: "mock" as const,
    range,
    from: h.from,
    to: h.to,
    step: h.stepSeconds,
    points: h.series.times.length,
    times: h.series.times,
    rx: h.series.rx,
    tx: h.series.tx,
  };
}

export function parseNow(value: string | null) {
  if (value === null) return Math.floor(Date.now() / 1000);
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0)
    throw new BenchmarkError(400, "t harus detik unix bulat.");
  return n;
}
