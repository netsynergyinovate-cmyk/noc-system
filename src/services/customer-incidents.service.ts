import "server-only";
import { and, asc, desc, eq, gte, lt, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  customerConnectionEvents,
  customers,
  customerTrafficSamples,
  routers,
  runsnetCustomers,
} from "@/db/schema";
import {
  buildOutages,
  type RawOutage,
  type TrafficBucketInput,
} from "@/lib/customer-evidence";
import {
  buildIncidents,
  unionIntervals,
  INCIDENT_EDGE_SECONDS,
  INCIDENT_LOOKBACK_SECONDS,
  type BuildIncidentsResult,
  type CustomerIncidentRow,
  type IncidentSeriesPoint,
} from "@/lib/customer-incidents";
import {
  evidenceRanges,
  type ConnectionEvent,
  type EvidenceRangeId,
} from "@/lib/customer-evidence-types";

export async function listCustomerIncidentRows(
  range: EvidenceRangeId,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<CustomerIncidentRow[]> {
  const rangeConfig = evidenceRanges.find((r) => r.id === range);
  const seconds = rangeConfig ? rangeConfig.seconds : 24 * 3600;
  const from = nowSec - seconds;
  const to = nowSec;
  const toDate = new Date(to * 1000);
  const lookbackStart = nowSec - INCIDENT_LOOKBACK_SECONDS;
  const lookbackFromDate = new Date(lookbackStart * 1000);
  // 1. Batch query 1: Seluruh pelanggan + router + jumlah pelanggan per router
  const [allCustomerRows, eventRows, priorRows] = await Promise.all([
    db
      .select({
        id: customers.id,
        name: customers.name,
        pppoeUsername: customers.pppoeUsername,
        isOnline: customers.isOnline,
        routerId: customers.routerId,
        routerName: routers.name,
        routerCustomerCount: sql<number>`count(*) over (partition by ${customers.routerId})::int`,
        billingStatus: runsnetCustomers.status,
      })
      .from(customers)
      .leftJoin(routers, eq(customers.routerId, routers.id))
      .leftJoin(
        runsnetCustomers,
        sql`split_part(${customers.pppoeUsername}, '@', 1) = ${runsnetCustomers.custId}`,
      ),

    // 2. Batch query 2: Seluruh connection events dalam [nowSec - lookback, to]
    db
      .select({
        customerId: customerConnectionEvents.customerId,
        at: customerConnectionEvents.occurredAt,
        kind: customerConnectionEvents.kind,
        source: customerConnectionEvents.source,
      })
      .from(customerConnectionEvents)
      .where(
        and(
          gte(customerConnectionEvents.occurredAt, lookbackFromDate),
          lte(customerConnectionEvents.occurredAt, toDate),
        ),
      )
      .orderBy(asc(customerConnectionEvents.occurredAt)),

    // 3. Batch query 3: Event terakhir sebelum 'lookbackStart' per pelanggan
    db
      .selectDistinctOn([customerConnectionEvents.customerId], {
        customerId: customerConnectionEvents.customerId,
        at: customerConnectionEvents.occurredAt,
        kind: customerConnectionEvents.kind,
        source: customerConnectionEvents.source,
      })
      .from(customerConnectionEvents)
      .where(lt(customerConnectionEvents.occurredAt, lookbackFromDate))
      .orderBy(
        customerConnectionEvents.customerId,
        desc(customerConnectionEvents.occurredAt),
      ),
  ]);
  const customerRows = allCustomerRows;

  // Petakan event & prior per customer sepanjang lookback
  const eventsByCust = new Map<string, ConnectionEvent[]>();
  for (const row of eventRows) {
    const epochSec = Math.floor(row.at.getTime() / 1000);
    let list = eventsByCust.get(row.customerId);
    if (!list) {
      list = [];
      eventsByCust.set(row.customerId, list);
    }
    list.push({
      at: epochSec,
      kind: row.kind,
      source: row.source,
    });
  }

  const priorByCust = new Map<string, ConnectionEvent>();
  for (const row of priorRows) {
    priorByCust.set(row.customerId, {
      at: Math.floor(row.at.getTime() / 1000),
      kind: row.kind,
      source: row.source,
    });
  }

  // Bangun raw outages sepanjang lookback untuk tiap pelanggan
  const outagesByCust = new Map<string, RawOutage[]>();
  for (const cust of customerRows) {
    const events = eventsByCust.get(cust.id) ?? [];
    const prior = priorByCust.get(cust.id) ?? null;
    const outages = buildOutages(events, prior, lookbackStart, to, nowSec);
    outagesByCust.set(cust.id, outages);
  }

  // Kelompokkan outages per router untuk evaluasi scope 'massal'
  const custsByRouter = new Map<string, string[]>();
  for (const cust of customerRows) {
    let list = custsByRouter.get(cust.routerId);
    if (!list) {
      list = [];
      custsByRouter.set(cust.routerId, list);
    }
    list.push(cust.id);
  }

  // Kumpulkan candidate windows untuk query trafik tunggal
  const candidateWindows: {
    customerId: string;
    windowStart: Date;
    windowEnd: Date;
  }[] = [];

  const candidateIncidentsByCust = new Map<string, BuildIncidentsResult>();

  for (const cust of customerRows) {
    const outages = outagesByCust.get(cust.id) ?? [];
    const routerCustIds = custsByRouter.get(cust.routerId) ?? [];
    const others = routerCustIds
      .filter((id) => id !== cust.id)
      .map((otherId) => {
        const oList = outagesByCust.get(otherId) ?? [];
        return oList.map((o) => ({ from: o.from, to: o.to }));
      });

    const scope = {
      routerCustomers: cust.routerCustomerCount,
      others,
    };

    // Jalankan buildIncidents tanpa trafik untuk mendeteksi jendela waktu insiden
    const candidate = buildIncidents({
      nowSec,
      from,
      to,
      outages,
      buckets: [],
      scope,
    });
    candidateIncidentsByCust.set(cust.id, candidate);

    if (candidate.incidents.length > 0) {
      const windowMargin = Math.max(3600, INCIDENT_EDGE_SECONDS + 30 * 60);
      const rawWindows = candidate.incidents.map((inc) => ({
        from: inc.from - windowMargin,
        to: (inc.to ?? nowSec) + windowMargin,
      }));
      const merged = unionIntervals(rawWindows);
      for (const w of merged) {
        candidateWindows.push({
          customerId: cust.id,
          windowStart: new Date(w.from * 1000),
          windowEnd: new Date(w.to * 1000),
        });
      }
    }
  }

  // 4. Batch query 4: Satu query trafik hanya untuk jendela waktu insiden kandidat
  const bucketsByCustomer = new Map<string, TrafficBucketInput[]>();

  if (candidateWindows.length > 0) {
    const valueClauses = candidateWindows.map(
      (w) =>
        sql`(${w.customerId}::uuid, ${w.windowStart.toISOString()}::timestamptz, ${w.windowEnd.toISOString()}::timestamptz)`,
    );
    const query = sql`
      WITH w (customer_id, window_start, window_end) AS (
        VALUES ${sql.join(valueClauses, sql`, `)}
      )
      SELECT
        t.customer_id AS "customerId",
        t.bucket_start AS "bucketStart",
        t.samples AS "samples",
        t.download_mbps_avg AS "downloadMbpsAvg",
        t.upload_mbps_avg AS "uploadMbpsAvg",
        t.download_mbps_max AS "downloadMbpsMax",
        t.upload_mbps_max AS "uploadMbpsMax"
      FROM ${customerTrafficSamples} t
      JOIN w ON t.customer_id = w.customer_id
        AND t.bucket_start >= w.window_start
        AND t.bucket_start <= w.window_end
      ORDER BY t.bucket_start ASC
    `;

    const result = await db.execute<{
      customerId: string;
      bucketStart: string | Date;
      samples: number;
      downloadMbpsAvg: number;
      uploadMbpsAvg: number;
      downloadMbpsMax: number;
      uploadMbpsMax: number;
    }>(query);

    for (const row of result.rows) {
      const bStart = Math.floor(new Date(row.bucketStart).getTime() / 1000);
      const bInput: TrafficBucketInput = {
        bucketStart: bStart,
        samples: Number(row.samples),
        downAvg: Number(row.downloadMbpsAvg),
        upAvg: Number(row.uploadMbpsAvg),
        downMax: Number(row.downloadMbpsMax),
        upMax: Number(row.uploadMbpsMax),
      };
      let list = bucketsByCustomer.get(row.customerId);
      if (!list) {
        list = [];
        bucketsByCustomer.set(row.customerId, list);
      }
      list.push(bInput);
    }
  }

  // 5. Jalankan buildIncidents final per pelanggan dengan sampel trafik aktual
  const resultRows: CustomerIncidentRow[] = [];

  for (const cust of customerRows) {
    const outages = outagesByCust.get(cust.id) ?? [];
    const routerCustIds = custsByRouter.get(cust.routerId) ?? [];
    const others = routerCustIds
      .filter((id) => id !== cust.id)
      .map((otherId) => {
        const oList = outagesByCust.get(otherId) ?? [];
        return oList.map((o) => ({ from: o.from, to: o.to }));
      });

    const scope = {
      routerCustomers: cust.routerCustomerCount,
      others,
    };

    const buckets = bucketsByCustomer.get(cust.id) ?? [];
    const { summary } = buildIncidents({
      nowSec,
      from,
      to,
      outages,
      buckets,
      scope,
    });

    const hasIncidents =
      summary.real > 0 ||
      summary.belumTerverifikasi > 0 ||
      summary.tidakTerbukti > 0 ||
      summary.kedipan > 0;
    const isOffline = !cust.isOnline;

    if (hasIncidents || isOffline) {
      resultRows.push({
        customerId: cust.id,
        name: cust.name,
        pppoeUsername: cust.pppoeUsername,
        routerName: cust.routerName ?? null,
        summary,
        isOnline: cust.isOnline,
        billingStatus: cust.billingStatus,
      });
    }
  }

  // Urutkan: summary.real desc, realDownSeconds desc, name asc
  resultRows.sort((a, b) => {
    if (b.summary.real !== a.summary.real) {
      return b.summary.real - a.summary.real;
    }
    if (b.summary.realDownSeconds !== a.summary.realDownSeconds) {
      return b.summary.realDownSeconds - a.summary.realDownSeconds;
    }
    return a.name.localeCompare(b.name, "id");
  });

  return resultRows;
}

export async function getIncidentSeries(
  customerId: string,
  fromSec: number,
  toSecParam: number | "open",
  nowSec = Math.floor(Date.now() / 1000),
): Promise<IncidentSeriesPoint[]> {
  const toSec = toSecParam === "open" ? nowSec : toSecParam;
  if (toSec - fromSec > 90 * 86400) {
    throw new Error("Rentang waktu maksimal 90 hari.");
  }

  const fromDate = new Date((fromSec - 3600) * 1000);
  const toDate = new Date((toSec + 3600) * 1000);

  const rows = await db
    .select({
      bucketStart: customerTrafficSamples.bucketStart,
      samples: customerTrafficSamples.samples,
      downloadMbpsAvg: customerTrafficSamples.downloadMbpsAvg,
      uploadMbpsAvg: customerTrafficSamples.uploadMbpsAvg,
      downloadMbpsMax: customerTrafficSamples.downloadMbpsMax,
      uploadMbpsMax: customerTrafficSamples.uploadMbpsMax,
    })
    .from(customerTrafficSamples)
    .where(
      and(
        eq(customerTrafficSamples.customerId, customerId),
        gte(customerTrafficSamples.bucketStart, fromDate),
        lte(customerTrafficSamples.bucketStart, toDate),
      ),
    )
    .orderBy(asc(customerTrafficSamples.bucketStart));

  let points: IncidentSeriesPoint[] = rows.map((r) => ({
    t: Math.floor(r.bucketStart.getTime() / 1000),
    samples: r.samples,
    downMbps: Math.round(r.downloadMbpsAvg * 100) / 100,
    upMbps: Math.round(r.uploadMbpsAvg * 100) / 100,
    downMaxMbps: Math.round(r.downloadMbpsMax * 100) / 100,
    upMaxMbps: Math.round(r.uploadMbpsMax * 100) / 100,
  }));

  // Jika lebih dari 600 titik, gabungkan titik berurutan menjadi resolusi lebih kasar
  if (points.length > 600) {
    const step = Math.ceil(points.length / 600);
    const merged: IncidentSeriesPoint[] = [];
    for (let i = 0; i < points.length; i += step) {
      const chunk = points.slice(i, i + step);
      let totalSamples = 0;
      let weightedDown = 0;
      let weightedUp = 0;
      let maxDown = 0;
      let maxUp = 0;
      for (const p of chunk) {
        totalSamples += p.samples;
        weightedDown += p.downMbps * p.samples;
        weightedUp += p.upMbps * p.samples;
        if (p.downMaxMbps > maxDown) maxDown = p.downMaxMbps;
        if (p.upMaxMbps > maxUp) maxUp = p.upMaxMbps;
      }
      merged.push({
        t: chunk[0].t,
        samples: totalSamples,
        downMbps:
          totalSamples > 0
            ? Math.round((weightedDown / totalSamples) * 100) / 100
            : 0,
        upMbps:
          totalSamples > 0
            ? Math.round((weightedUp / totalSamples) * 100) / 100
            : 0,
        downMaxMbps: Math.round(maxDown * 100) / 100,
        upMaxMbps: Math.round(maxUp * 100) / 100,
      });
    }
    points = merged;
  }

  return points;
}
