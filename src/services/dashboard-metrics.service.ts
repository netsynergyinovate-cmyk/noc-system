import "server-only";
import { desc, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { isolirSql } from "./customer-isolir";
import { alerts, customers, routers, trafficSamples } from "@/db/schema";
import { env } from "@/lib/env";
export interface DashboardKpiMetrics {
  onlineCount: number;
  offlineCount: number;
  totalCustomers: number;
  percentOnline: number;
  weakSignalCount: number;
  criticalSignalCount: number;
  activeRouterCount: number;
  totalRouters: number;
  routerCpuAverage: number;
  totalBandwidthInMbps: number;
  totalBandwidthOutMbps: number;
  activeAlertsCount: number;
  criticalAlertsCount: number;
  warningAlertsCount: number;
  billingPaidCount: number;
  billingIsolatedCount: number;
  sourceStatus: "dummy" | "nyata";
  generatedAt: string;
}

export function emptyDashboardKpiMetrics(
  now = new Date(),
): DashboardKpiMetrics {
  return {
    onlineCount: 0,
    offlineCount: 0,
    totalCustomers: 0,
    percentOnline: 0,
    weakSignalCount: 0,
    criticalSignalCount: 0,
    activeRouterCount: 0,
    totalRouters: 0,
    routerCpuAverage: 0,
    totalBandwidthInMbps: 0,
    totalBandwidthOutMbps: 0,
    activeAlertsCount: 0,
    criticalAlertsCount: 0,
    warningAlertsCount: 0,
    billingPaidCount: 0,
    billingIsolatedCount: 0,
    sourceStatus: "nyata",
    generatedAt: now.toISOString(),
  };
}
import { getRouterResourcesSummary } from "@/services/router-resources.service";

// Sama dengan WEAK_DBM / CRITICAL_DBM di metric-board-data.ts.
const WEAK_DBM = -25;
const CRITICAL_DBM = -28;
// Sampel traffic lebih tua dari ini dianggap router sudah tidak melapor.
const TRAFFIC_FRESH_MS = 5 * 60 * 1000;

export interface DashboardAggregates {
  customers: {
    total: number;
    online: number;
    weak: number;
    critical: number;
    paid: number;
    isolated: number;
  };
  routers: { total: number; active: number };
  alerts: { critical: number; warning: number; active: number };
  traffic: readonly { rxMbps: number; txMbps: number }[];
  cpuLoads: readonly number[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Murni: baris hasil query -> metrik. Dipisah dari DB agar mudah diuji.
export function buildDashboardKpiMetrics(
  agg: DashboardAggregates,
  now: Date = new Date(),
): DashboardKpiMetrics {
  const total = num(agg.customers.total);
  const online = num(agg.customers.online);
  const cpus = agg.cpuLoads.filter((v) => Number.isFinite(v));
  return {
    onlineCount: online,
    offlineCount: total - online,
    totalCustomers: total,
    percentOnline: total === 0 ? 0 : Math.round((online / total) * 100),
    weakSignalCount: num(agg.customers.weak),
    criticalSignalCount: num(agg.customers.critical),
    activeRouterCount: num(agg.routers.active),
    totalRouters: num(agg.routers.total),
    routerCpuAverage:
      cpus.length === 0
        ? 0
        : round1(cpus.reduce((a, b) => a + b, 0) / cpus.length),
    totalBandwidthInMbps: round1(
      agg.traffic.reduce((s, t) => s + num(t.rxMbps), 0),
    ),
    totalBandwidthOutMbps: round1(
      agg.traffic.reduce((s, t) => s + num(t.txMbps), 0),
    ),
    activeAlertsCount: num(agg.alerts.active),
    criticalAlertsCount: num(agg.alerts.critical),
    warningAlertsCount: num(agg.alerts.warning),
    billingPaidCount: num(agg.customers.paid),
    billingIsolatedCount: num(agg.customers.isolated),
    sourceStatus: "nyata",
    generatedAt: now.toISOString(),
  };
}

async function loadAggregates(now: Date): Promise<DashboardAggregates> {
  const [[c], [r], [a], traffic] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)::int`,
        online: sql<number>`(count(*) filter (where ${customers.isOnline}))::int`,
        weak: sql<number>`(count(*) filter (where ${customers.isOnline} and ${customers.opticalPower} < ${WEAK_DBM}))::int`,
        critical: sql<number>`(count(*) filter (where ${customers.isOnline} and ${customers.opticalPower} < ${CRITICAL_DBM}))::int`,
        paid: sql<number>`(count(*) filter (where not ${isolirSql}))::int`,
        isolated: sql<number>`(count(*) filter (where ${isolirSql}))::int`,
      })
      .from(customers),
    db
      .select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`(count(*) filter (where ${routers.status} = 'aktif'))::int`,
      })
      .from(routers),
    db
      .select({
        active: sql<number>`count(*)::int`,
        critical: sql<number>`(count(*) filter (where ${alerts.severity} = 'critical'))::int`,
        warning: sql<number>`(count(*) filter (where ${alerts.severity} = 'warning'))::int`,
      })
      .from(alerts)
      .where(sql`${alerts.status} = 'active'`),
    // Sampel terbaru per router.
    db
      .selectDistinctOn([trafficSamples.routerId], {
        rxMbps: trafficSamples.rxMbps,
        txMbps: trafficSamples.txMbps,
      })
      .from(trafficSamples)
      .where(
        gte(
          trafficSamples.sampledAt,
          new Date(now.getTime() - TRAFFIC_FRESH_MS),
        ),
      )
      .orderBy(trafficSamples.routerId, desc(trafficSamples.sampledAt)),
  ]);

  // CPU hanya tersedia dengan menanyai router; di mode demo layanan itu
  // mengembalikan data tiruan, jadi jangan dicampur dengan data nyata.
  let cpuLoads: number[] = [];
  if (env.DASHBOARD_DATA === "live") {
    try {
      const { items } = await getRouterResourcesSummary();
      cpuLoads = items.filter((i) => i.active).map((i) => i.cpuLoad);
    } catch {
      cpuLoads = [];
    }
  }

  return {
    customers: c,
    routers: r,
    alerts: a,
    traffic,
    cpuLoads,
  };
}

export async function getDashboardKpiMetrics(): Promise<DashboardKpiMetrics> {
  const now = new Date();
  try {
    const agg = await loadAggregates(now);
    return buildDashboardKpiMetrics(agg, now);
  } catch {
    return emptyDashboardKpiMetrics(now);
  }
}
