import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { customers } from "@/db/schema";
import { getRouterQueues } from "@/services/router-queues.service";
import type { CustomerTrafficRange } from "@/validators/customer-traffic";

// Histori dari customer_traffic_samples (bucket 5 menit, diisi backend Go),
// diringkas seperti grafik MikroTik: 24 jam per 5 menit, 7 hari per 30 menit,
// 30 hari per 2 jam.
const HISTORY: Record<Exclude<CustomerTrafficRange, "live">, { seconds: number; step: number }> = {
  "24h": { seconds: 24 * 3600, step: 300 },
  "3d": { seconds: 3 * 24 * 3600, step: 900 },
  "7d": { seconds: 7 * 24 * 3600, step: 1800 },
  "30d": { seconds: 30 * 24 * 3600, step: 7200 },
  "90d": { seconds: 90 * 24 * 3600, step: 21600 },
};

export interface ByteTotals {
  download: number;
  upload: number;
}

export interface CustomerTrafficHistory {
  series: { times: number[]; rx: number[]; tx: number[] };
  from: number;
  to: number;
  usage: { today: ByteTotals; last7d: ByteTotals; thisMonth: ByteTotals };
  // Bucket tertua yang tersimpan (detik epoch); null = belum ada data sama sekali.
  since: number | null;
}

export interface CustomerLiveTraffic {
  downloadBps: number;
  uploadBps: number;
  maxDownloadBps: number;
  maxUploadBps: number;
  // Counter queue sejak sesi PPPoE ini tersambung.
  sessionDownloadBytes: number;
  sessionUploadBytes: number;
  sampledAt: number;
}

const num = (v: unknown) => (v == null ? 0 : Number(v));

export async function customerExists(customerId: string) {
  const [row] = await db
    .select({ id: customers.id, routerId: customers.routerId, pppoeUsername: customers.pppoeUsername })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  return row ?? null;
}

export async function getCustomerTrafficHistory(
  customerId: string,
  range: Exclude<CustomerTrafficRange, "live">,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<CustomerTrafficHistory> {
  const { seconds, step } = HISTORY[range];
  const from = nowSec - seconds;
  const [series, usage] = await Promise.all([
    db.execute(sql`
      SELECT (floor(extract(epoch FROM bucket_start))::bigint / ${step}::bigint) * ${step}::bigint AS t,
        sum(download_mbps_avg * samples) / sum(samples) AS rx,
        sum(upload_mbps_avg * samples) / sum(samples) AS tx
      FROM customer_traffic_samples
      WHERE customer_id = ${customerId}::uuid AND bucket_start >= to_timestamp(${from})
      GROUP BY 1 ORDER BY 1`),
    // Batas hari dan bulan menurut jam WIB, bukan UTC.
    db.execute(sql`
      WITH b AS (
        SELECT date_trunc('day', now() AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta' AS day,
          date_trunc('month', now() AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta' AS month
      )
      SELECT
        sum(download_bytes) FILTER (WHERE bucket_start >= b.day) AS today_dl,
        sum(upload_bytes) FILTER (WHERE bucket_start >= b.day) AS today_ul,
        sum(download_bytes) FILTER (WHERE bucket_start >= now() - interval '7 days') AS week_dl,
        sum(upload_bytes) FILTER (WHERE bucket_start >= now() - interval '7 days') AS week_ul,
        sum(download_bytes) FILTER (WHERE bucket_start >= b.month) AS month_dl,
        sum(upload_bytes) FILTER (WHERE bucket_start >= b.month) AS month_ul,
        extract(epoch FROM min(bucket_start)) AS since
      FROM customer_traffic_samples, b
      WHERE customer_id = ${customerId}::uuid`),
  ]);

  const rows = (series as { rows: Record<string, unknown>[] }).rows;
  const u = (usage as { rows: Record<string, unknown>[] }).rows[0] ?? {};
  return {
    series: {
      times: rows.map((r) => num(r.t)),
      rx: rows.map((r) => num(r.rx)),
      tx: rows.map((r) => num(r.tx)),
    },
    from,
    to: nowSec,
    usage: {
      today: { download: num(u.today_dl), upload: num(u.today_ul) },
      last7d: { download: num(u.week_dl), upload: num(u.week_ul) },
      thisMonth: { download: num(u.month_dl), upload: num(u.month_ul) },
    },
    since: u.since == null ? null : Math.floor(Number(u.since)),
  };
}

// Laju saat ini dari queue dinamis "<pppoe-USERNAME>" di router pelanggan.
// null = queue tidak ada (sesi PPPoE tidak aktif). Router tak terjangkau = error.
export async function getCustomerLiveTraffic(customer: {
  routerId: string;
  pppoeUsername: string;
}): Promise<CustomerLiveTraffic | null> {
  const name = `<pppoe-${customer.pppoeUsername}>`;
  const queues = await getRouterQueues(customer.routerId, customer.pppoeUsername);
  const q = queues.find((item) => item.name === name);
  return q
    ? {
        downloadBps: q.rate.download,
        uploadBps: q.rate.upload,
        maxDownloadBps: q.maxLimit.download,
        maxUploadBps: q.maxLimit.upload,
        sessionDownloadBytes: q.bytes.download,
        sessionUploadBytes: q.bytes.upload,
        sampledAt: Math.floor(Date.now() / 1000),
      }
    : null;
}
