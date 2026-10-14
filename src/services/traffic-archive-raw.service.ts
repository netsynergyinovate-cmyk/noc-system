import "server-only";
import { getRawPool } from "@/db";
import {
  trafficWindow,
  type RouterCustomerMetrics,
  type TrafficArchiveRange,
  type TrafficSampleInput,
} from "./traffic-archive.service";

// Padanan traffic-archive.service.ts dengan SQL berparameter murni (node-postgres,
// tanpa query builder Drizzle) untuk uji banding stack lokal.

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Cukup untuk pool.query dan PoolClient; memudahkan mock di tes.
export interface SqlClient {
  query(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export interface TrafficHistoryRawResult {
  source: "raw_sql";
  range: TrafficArchiveRange;
  from: number;
  to: number;
  step: number;
  points: number;
  times: number[];
  rx: number[];
  tx: number[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// Jumlahkan semua router per detik lebih dulu, baru rata-ratakan per bucket.
// Bucket tanpa sampel tidak muncul (celah data bukan traffic nol).
export const HISTORY_SQL = `
SELECT bucket, avg(rx) AS rx, avg(tx) AS tx
FROM (
  SELECT (floor(extract(epoch FROM sampled_at))::bigint / $3::bigint) * $3::bigint AS bucket,
         rx, tx
  FROM (
    SELECT sampled_at, sum(rx_mbps) AS rx, sum(tx_mbps) AS tx
    FROM traffic_samples
    WHERE sampled_at >= $1::timestamptz
      AND sampled_at < $2::timestamptz
      AND ($4::uuid IS NULL OR router_id = $4::uuid)
    GROUP BY sampled_at
  ) per_second
) bucketed
GROUP BY bucket
ORDER BY bucket`;

export async function queryTrafficHistoryRaw(
  options: {
    routerId?: string;
    range?: TrafficArchiveRange;
    stepSeconds?: number;
    nowSec?: number;
  },
  client: SqlClient = getRawPool(),
): Promise<TrafficHistoryRawResult | null> {
  const range = options.range ?? "1h";
  const { from, to, step } = trafficWindow(
    range,
    options.nowSec ?? Math.floor(Date.now() / 1000),
    options.stepSeconds,
  );
  if (options.routerId !== undefined && !UUID.test(options.routerId))
    throw new RangeError("routerId bukan UUID.");

  try {
    const result = await client.query(HISTORY_SQL, [
      new Date(from * 1000).toISOString(),
      new Date((to + step) * 1000).toISOString(),
      step,
      options.routerId ?? null,
    ]);
    const rows = result?.rows;
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const times: number[] = [];
    const rx: number[] = [];
    const tx: number[] = [];
    for (const row of rows) {
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
      source: "raw_sql",
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

export const INSERT_SQL = `
INSERT INTO traffic_samples (router_id, sampled_at, rx_mbps, tx_mbps)
SELECT * FROM UNNEST($1::uuid[], $2::timestamptz[], $3::float8[], $4::float8[])
ON CONFLICT (router_id, sampled_at)
DO UPDATE SET rx_mbps = EXCLUDED.rx_mbps, tx_mbps = EXCLUDED.tx_mbps`;

// Upsert massal satu pernyataan. Kunci (router, detik) kembar digabung,
// yang terakhir menang (PostgreSQL menolak ON CONFLICT yang menyentuh baris
// sama dua kali). Mengembalikan jumlah baris unik.
export async function insertTrafficSamplesRaw(
  samples: TrafficSampleInput[],
  client: SqlClient = getRawPool(),
): Promise<number> {
  const unique = new Map<string, [string, string, number, number]>();
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
    const second = Math.floor(s.sampledAt.getTime() / 1000);
    const id = s.routerId.toLowerCase();
    unique.set(`${id}|${second}`, [
      id,
      new Date(second * 1000).toISOString(),
      s.rxMbps,
      s.txMbps,
    ]);
  }
  if (unique.size === 0) return 0;
  const rows = [...unique.values()];
  await client.query(INSERT_SQL, [
    rows.map((r) => r[0]),
    rows.map((r) => r[1]),
    rows.map((r) => r[2]),
    rows.map((r) => r[3]),
  ]);
  return rows.length;
}

export const METRICS_SQL = `
SELECT router_id,
       count(*) AS total_customers,
       count(*) FILTER (WHERE is_online) AS online_customers,
       count(*) FILTER (WHERE billing_status = 'isolir') AS isolir_customers
FROM customers
WHERE ($1::uuid IS NULL OR router_id = $1::uuid)
GROUP BY router_id
ORDER BY router_id`;

export async function queryCustomerMetricsPerRouterRaw(
  routerId?: string,
  client: SqlClient = getRawPool(),
): Promise<RouterCustomerMetrics[]> {
  if (routerId !== undefined && !UUID.test(routerId))
    throw new RangeError("routerId bukan UUID.");
  const result = await client.query(METRICS_SQL, [routerId ?? null]);
  // count(*) bigint kembali sebagai string dari node-postgres.
  return result.rows.map((r) => ({
    routerId: String(r.router_id),
    totalCustomers: Number(r.total_customers),
    onlineCustomers: Number(r.online_customers),
    isolirCustomers: Number(r.isolir_customers),
  }));
}
