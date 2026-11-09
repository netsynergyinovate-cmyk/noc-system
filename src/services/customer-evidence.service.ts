import "server-only";
import { and, asc, desc, eq, gte, inArray, lt, lte, min } from "drizzle-orm";
import { db } from "@/db";
import {
  customerConnectionEvents,
  customers,
  customerTrafficSamples,
} from "@/db/schema";
import {
  buildCustomerEvidence,
  buildOutages,
  type TrafficBucketInput,
} from "@/lib/customer-evidence";
import {
  INCIDENT_LOOKBACK_SECONDS,
  type IncidentScopeInput,
} from "@/lib/customer-incidents";
import {
  evidenceRanges,
  type CustomerEvidence,
  type EvidenceRangeId,
} from "@/lib/customer-evidence-types";

export { customerExists } from "@/services/customer-traffic.service";

export async function getCustomerEvidence(
  customerId: string,
  range: EvidenceRangeId,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<CustomerEvidence> {
  const rangeConfig = evidenceRanges.find((r) => r.id === range);
  const seconds = rangeConfig ? rangeConfig.seconds : 24 * 3600;
  const from = nowSec - seconds;
  const to = nowSec;

  const trafficFromDate = new Date((from - 3600) * 1000);
  const toDate = new Date(to * 1000);
  const lookbackStart = nowSec - INCIDENT_LOOKBACK_SECONDS;
  const lookbackFromDate = new Date(lookbackStart * 1000);

  const [
    bucketRows,
    eventRows,
    priorRows,
    minBucketRows,
    minEventRows,
    customerRow,
  ] = await Promise.all([
    db
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
          gte(customerTrafficSamples.bucketStart, trafficFromDate),
          lt(customerTrafficSamples.bucketStart, toDate),
        ),
      )
      .orderBy(asc(customerTrafficSamples.bucketStart)),

    db
      .select({
        at: customerConnectionEvents.occurredAt,
        kind: customerConnectionEvents.kind,
        source: customerConnectionEvents.source,
      })
      .from(customerConnectionEvents)
      .where(
        and(
          eq(customerConnectionEvents.customerId, customerId),
          gte(customerConnectionEvents.occurredAt, lookbackFromDate),
          lte(customerConnectionEvents.occurredAt, toDate),
        ),
      )
      .orderBy(asc(customerConnectionEvents.occurredAt)),

    db
      .select({
        at: customerConnectionEvents.occurredAt,
        kind: customerConnectionEvents.kind,
        source: customerConnectionEvents.source,
      })
      .from(customerConnectionEvents)
      .where(
        and(
          eq(customerConnectionEvents.customerId, customerId),
          lt(customerConnectionEvents.occurredAt, lookbackFromDate),
        ),
      )
      .orderBy(desc(customerConnectionEvents.occurredAt))
      .limit(1),

    db
      .select({
        min: min(customerTrafficSamples.bucketStart),
      })
      .from(customerTrafficSamples)
      .where(eq(customerTrafficSamples.customerId, customerId)),

    db
      .select({
        min: min(customerConnectionEvents.occurredAt),
      })
      .from(customerConnectionEvents)
      .where(eq(customerConnectionEvents.customerId, customerId)),
    db
      .select({ routerId: customers.routerId })
      .from(customers)
      .where(eq(customers.id, customerId))
      .limit(1),
  ]);

  const allBuckets: TrafficBucketInput[] = bucketRows.map((r) => ({
    bucketStart: Math.floor(r.bucketStart.getTime() / 1000),
    samples: r.samples,
    downAvg: r.downloadMbpsAvg,
    upAvg: r.uploadMbpsAvg,
    downMax: r.downloadMbpsMax,
    upMax: r.uploadMbpsMax,
  }));
  const buckets = allBuckets.filter((b) => b.bucketStart >= from);
  const incidentBuckets = allBuckets;

  const lookbackEvents = eventRows.map((r) => ({
    at: Math.floor(r.at.getTime() / 1000),
    kind: r.kind,
    source: r.source,
  }));

  const lookbackPriorEvent = priorRows[0]
    ? {
        at: Math.floor(priorRows[0].at.getTime() / 1000),
        kind: priorRows[0].kind,
        source: priorRows[0].source,
      }
    : null;

  // Event & prior untuk statistik rentang waktu [from, to] (window/daily/hourly)
  const events = lookbackEvents.filter((e) => e.at >= from);
  const eventsBeforeFrom = lookbackEvents.filter((e) => e.at < from);
  const priorEvent =
    eventsBeforeFrom.length > 0
      ? eventsBeforeFrom[eventsBeforeFrom.length - 1]
      : lookbackPriorEvent;
  const trafficSince = minBucketRows[0]?.min
    ? Math.floor(new Date(minBucketRows[0].min).getTime() / 1000)
    : null;

  const eventsSince = minEventRows[0]?.min
    ? Math.floor(new Date(minEventRows[0].min).getTime() / 1000)
    : null;

  const routerId = customerRow[0]?.routerId ?? null;
  let scope: IncidentScopeInput = {
    routerCustomers: null,
    others: [],
  };

  if (routerId) {
    const routerCusts = await db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.routerId, routerId));
    const routerCustomers = routerCusts.length;
    const otherIds = routerCusts
      .filter((c) => c.id !== customerId)
      .map((c) => c.id);

    if (otherIds.length > 0) {
      const [otherEventRows, otherPriorRows] = await Promise.all([
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
              inArray(customerConnectionEvents.customerId, otherIds),
              gte(customerConnectionEvents.occurredAt, lookbackFromDate),
              lte(customerConnectionEvents.occurredAt, toDate),
            ),
          )
          .orderBy(asc(customerConnectionEvents.occurredAt)),
        db
          .selectDistinctOn([customerConnectionEvents.customerId], {
            customerId: customerConnectionEvents.customerId,
            at: customerConnectionEvents.occurredAt,
            kind: customerConnectionEvents.kind,
            source: customerConnectionEvents.source,
          })
          .from(customerConnectionEvents)
          .where(
            and(
              inArray(customerConnectionEvents.customerId, otherIds),
              lt(customerConnectionEvents.occurredAt, lookbackFromDate),
            ),
          )
          .orderBy(
            customerConnectionEvents.customerId,
            desc(customerConnectionEvents.occurredAt),
          ),
      ]);

      const eventsByCust = new Map<
        string,
        { at: number; kind: "up" | "down"; source: "live" | "alert" }[]
      >();
      for (const row of otherEventRows) {
        let list = eventsByCust.get(row.customerId);
        if (!list) {
          list = [];
          eventsByCust.set(row.customerId, list);
        }
        list.push({
          at: Math.floor(row.at.getTime() / 1000),
          kind: row.kind,
          source: row.source,
        });
      }

      const priorByCust = new Map<
        string,
        { at: number; kind: "up" | "down"; source: "live" | "alert" }
      >();
      for (const row of otherPriorRows) {
        priorByCust.set(row.customerId, {
          at: Math.floor(row.at.getTime() / 1000),
          kind: row.kind,
          source: row.source,
        });
      }

      const othersDownIntervals: { from: number; to: number | null }[][] = [];
      for (const oId of otherIds) {
        const cEvents = eventsByCust.get(oId) ?? [];
        const cPrior = priorByCust.get(oId) ?? null;
        const cOutages = buildOutages(
          cEvents,
          cPrior,
          lookbackStart,
          to,
          nowSec,
        );
        othersDownIntervals.push(
          cOutages.map((o) => ({ from: o.from, to: o.to })),
        );
      }

      scope = {
        routerCustomers,
        others: othersDownIntervals,
      };
    } else {
      scope = {
        routerCustomers,
        others: [],
      };
    }
  }

  return buildCustomerEvidence({
    range,
    nowSec,
    buckets,
    incidentBuckets,
    events,
    priorEvent,
    lookbackEvents,
    lookbackPriorEvent,
    trafficSince,
    eventsSince,
    scope,
  });
}
