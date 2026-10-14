import "server-only";
import { asc, count, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { customers, trafficSamples } from "@/db/schema";

// Akses arsip traffic_samples dan agregat pelanggan lewat Drizzle, dipakai uji
// banding stack lokal. Padanan Node untuk archive.History di backend Go.

export type TrafficArchiveRange = "1h" | "6h" | "24h" | "7d";

// Sama dengan TRAFFIC_RANGES di lib/dashboard/ranges.ts dan rentang di Go.
const RANGES: Record<TrafficArchiveRange, { seconds: number; step: number }> = {
  "1h": { seconds: 3600, step: 10 },
  "6h": { seconds: 6 * 3600, step: 60 },
  "24h": { seconds: 24 * 3600, step: 300 },
  "7d": { seconds: 7 * 24 * 3600, step: 1800 },
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Batas parameter PostgreSQL 65535; 4 kolom per baris.
const INSERT_CHUNK = 5000;

export interface TrafficHistoryResult {
  source: "db";
  range: TrafficArchiveRange;
  from: number;
  to: number;
  step: number;
  points: number;
  times: number[];
  rx: number[];
  tx: number[];
}

// Jendela sama dengan buildMockHistory: `to` adalah awal bucket terakhir
// (dibulatkan ke bawah ke kelipatan step), `from` awal bucket pertama.
export function trafficWindow(
  range: TrafficArchiveRange,
  nowSec: number,
  stepSeconds?: number,
) {
  const spec = RANGES[range];
  if (!spec) throw new RangeError("range tidak dikenal.");
  const step = stepSeconds ?? spec.step;
  if (!Number.isInteger(step) || step < 1)
    throw new RangeError("stepSeconds harus bilangan bulat positif.");
  if (!Number.isInteger(nowSec) || nowSec < 0)
    throw new RangeError("nowSec harus detik unix bulat.");
  const buckets = Math.max(1, Math.floor(spec.seconds / step));
  const to = Math.floor(nowSec / step) * step;
  const from = to - (buckets - 1) * step;
  return { from, to, step };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export async function queryTrafficHistoryDrizzle(
  options: {
    routerId?: string;
    range?: TrafficArchiveRange;
    stepSeconds?: number;
    nowSec?: number;
  },
  database: Pick<typeof db, "execute"> = db,
): Promise<TrafficHistoryResult | null> {
  const range = options.range ?? "1h";
  const { from, to, step } = trafficWindow(
    range,
    options.nowSec ?? Math.floor(Date.now() / 1000),
    options.stepSeconds,
  );
  if (options.routerId !== undefined && !UUID.test(options.routerId))
    throw new RangeError("routerId bukan UUID.");

  const routerFilter = options.routerId
    ? sql`AND ${trafficSamples.routerId} = ${options.routerId}::uuid`
    : sql``;
  // Jumlahkan semua router per detik lebih dulu, baru rata-ratakan per
  // bucket (total jaringan, bukan rata-rata per router). Bucket tanpa sampel
  // tidak muncul, supaya celah data tidak terbaca sebagai traffic nol.
  const fromTs = new Date(from * 1000).toISOString();
  const toTs = new Date((to + step) * 1000).toISOString();
  try {
    const result = await database.execute(sql`
      SELECT bucket, avg(rx) AS rx, avg(tx) AS tx
      FROM (
        SELECT (floor(extract(epoch FROM sampled_at))::bigint / ${step}::bigint) * ${step}::bigint AS bucket,
               rx, tx
        FROM (
          SELECT ${trafficSamples.sampledAt} AS sampled_at,
                 sum(${trafficSamples.rxMbps}) AS rx,
                 sum(${trafficSamples.txMbps}) AS tx
          FROM ${trafficSamples}
          WHERE ${trafficSamples.sampledAt} >= ${fromTs}::timestamptz
            AND ${trafficSamples.sampledAt} < ${toTs}::timestamptz
            ${routerFilter}
          GROUP BY ${trafficSamples.sampledAt}
        ) per_second
      ) bucketed
      GROUP BY bucket
      ORDER BY bucket`);
    const rows = (result as { rows?: unknown[] }).rows;
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const times: number[] = [];
    const rx: number[] = [];
    const tx: number[] = [];
    for (const row of rows as Array<Record<string, unknown>>) {
      const t = Number(row.bucket);
      const r = Number(row.rx);
      const x = Number(row.tx);
      if (!Number.isFinite(t) || !Number.isFinite(r) || !Number.isFinite(x))
        return null;
      times.push(t);
      rx.push(round1(r));
      tx.push(round1(x));
    }
    return {
      source: "db",
      range,
      from,
      to,
      step,
      points: times.length,
      times,
      rx,
      tx,
    };
  } catch {
    return null;
  }
}

export interface TrafficSampleInput {
  routerId: string;
  sampledAt: Date;
  rxMbps: number;
  txMbps: number;
}

// Upsert massal. Sampel dengan kunci (router, detik) yang sama dalam satu
// panggilan digabung (yang terakhir menang), karena PostgreSQL menolak
// ON CONFLICT yang menyentuh baris sama dua kali. Mengembalikan jumlah baris
// unik yang ditulis.
export async function insertTrafficSamplesDrizzle(
  samples: TrafficSampleInput[],
  database: Pick<typeof db, "insert"> = db,
): Promise<number> {
  const unique = new Map<string, TrafficSampleInput>();
  for (const s of samples) {
    if (!UUID.test(s.routerId)) throw new RangeError("routerId bukan UUID.");
    if (!(s.sampledAt instanceof Date) || Number.isNaN(s.sampledAt.getTime()))
      throw new RangeError("sampledAt tidak valid.");
    if (
      !Number.isFinite(s.rxMbps) ||
      !Number.isFinite(s.txMbps) ||
      s.rxMbps < 0 ||
      s.txMbps < 0
    )
      throw new RangeError("rxMbps dan txMbps harus bilangan tak negatif.");
    // Kunci utama di basis data per detik.
    const second = Math.floor(s.sampledAt.getTime() / 1000);
    unique.set(`${s.routerId.toLowerCase()}|${second}`, {
      ...s,
      routerId: s.routerId.toLowerCase(),
      sampledAt: new Date(second * 1000),
    });
  }
  const rows = [...unique.values()];
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    await database
      .insert(trafficSamples)
      .values(rows.slice(i, i + INSERT_CHUNK))
      .onConflictDoUpdate({
        target: [trafficSamples.routerId, trafficSamples.sampledAt],
        set: {
          rxMbps: sql`excluded.rx_mbps`,
          txMbps: sql`excluded.tx_mbps`,
        },
      });
  }
  return rows.length;
}

export interface RouterCustomerMetrics {
  routerId: string;
  totalCustomers: number;
  onlineCustomers: number;
  isolirCustomers: number;
}

export async function queryCustomerMetricsPerRouterDrizzle(
  routerId?: string,
  database: Pick<typeof db, "select"> = db,
): Promise<RouterCustomerMetrics[]> {
  if (routerId !== undefined && !UUID.test(routerId))
    throw new RangeError("routerId bukan UUID.");
  const rows = await database
    .select({
      routerId: customers.routerId,
      totalCustomers: count(),
      onlineCustomers: sql<number>`count(*) filter (where ${customers.isOnline})`,
      isolirCustomers: sql<number>`count(*) filter (where ${customers.billingStatus} = 'isolir')`,
    })
    .from(customers)
    .where(routerId ? eq(customers.routerId, routerId) : undefined)
    .groupBy(customers.routerId)
    .orderBy(asc(customers.routerId));
  // count() mengembalikan bigint sebagai string pada beberapa driver.
  return rows.map((r) => ({
    routerId: r.routerId,
    totalCustomers: Number(r.totalCustomers),
    onlineCustomers: Number(r.onlineCustomers),
    isolirCustomers: Number(r.isolirCustomers),
  }));
}
