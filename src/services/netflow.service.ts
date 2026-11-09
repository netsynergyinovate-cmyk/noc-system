import "server-only";
import { and, desc, eq, gte, ilike, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { netflowSamples, routers } from "@/db/schema";
import { env } from "@/lib/env";
import {
  appForPort,
  buildFlowHistory,
  flowHistoryStepSeconds,
  flowRangeSeconds,
  getNetflowFlows,
  getNetflowTimeline,
  type FlowHistory,
  selectTopFlows,
  type FlowProtocol,
  type FlowRange,
  type NetflowRecord,
  type TopFlowsResult,
} from "@/lib/dashboard/netflow";

import {
  buildNetflowStatus,
  NETFLOW_FRESH_MS,
  type NetflowStatus,
} from "@/lib/dashboard/netflow-status";

export interface TopFlowsParams {
  range?: FlowRange;
  routerId?: string;
  protocol?: string;
  app?: string;
  q?: string;
  limit?: number;
}

const escapeLike = (v: string) => v.replace(/[\\%_]/g, "\\$&");

export interface FlowHistoryParams {
  range: FlowRange;
  routerId?: string;
  protocol?: string;
}

export async function getFlowHistory(
  params: FlowHistoryParams,
): Promise<FlowHistory> {
  const { range } = params;
  const nowMs = Date.now();
  const now = Math.floor(nowMs / 1000);
  const mock = () => getNetflowTimeline(now, range, params);
  if (env.DASHBOARD_DATA === "demo") return mock();

  const seconds = flowRangeSeconds[range];
  const step = flowHistoryStepSeconds[range];
  const from = now - seconds;
  const conditions: SQL[] = [
    sql`${netflowSamples.capturedAt} > to_timestamp(${from})`,
    sql`${netflowSamples.capturedAt} <= to_timestamp(${now})`,
  ];
  if (params.routerId)
    conditions.push(eq(netflowSamples.routerId, params.routerId));
  if (params.protocol && params.protocol !== "ALL")
    conditions.push(eq(netflowSamples.protocol, params.protocol));

  // Angka from/step bilangan bulat buatan server (bukan input), aman di-inline agar GROUP BY identik.
  const bucket = sql`ceil((extract(epoch from ${netflowSamples.capturedAt}) - ${sql.raw(String(from))}) / ${sql.raw(String(step))})`;
  const rows = await db
    .select({
      bucket: sql<number>`${bucket}::int`,
      protocol: netflowSamples.protocol,
      dstPort: netflowSamples.dstPort,
      bytes: sql<number>`sum(${netflowSamples.bytes})::float8`,
      packets: sql<number>`sum(${netflowSamples.packets})::float8`,
    })
    .from(netflowSamples)
    .where(and(...conditions))
    .groupBy(bucket, netflowSamples.protocol, netflowSamples.dstPort);

  if (rows.length === 0) {
    const [any] = await db
      .select({ id: netflowSamples.id })
      .from(netflowSamples)
      .limit(1);
    if (!any) return mock();
  }
  return buildFlowHistory(
    rows.map((r) => ({
      endedAt: from + r.bucket * step,
      bytes: r.bytes,
      packets: r.packets,
      app: appForPort(r.protocol, r.dstPort),
    })),
    range,
    now,
  );
}

export async function getNetflowStatus(): Promise<NetflowStatus> {
  const nowMs = Date.now();
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      last: sql<Date | null>`max(${netflowSamples.capturedAt})`,
    })
    .from(netflowSamples);
  const total = row?.total ?? 0;
  const last = row?.last ? new Date(row.last) : null;
  const [routersRow] = await db
    .select({
      n: sql<number>`count(distinct ${netflowSamples.routerId})::int`,
    })
    .from(netflowSamples)
    .where(gte(netflowSamples.capturedAt, new Date(nowMs - NETFLOW_FRESH_MS)));
  return buildNetflowStatus({
    // Demo: env demo, atau tabel kosong (data tampil dari mock seperti getTopFlows).
    isDemo: env.DASHBOARD_DATA === "demo" || total === 0,
    totalSamples: total,
    lastCapturedAt: last,
    activeRoutersCount: routersRow?.n ?? 0,
    nowMs,
  });
}

export async function getTopFlows(
  params: TopFlowsParams = {},
): Promise<TopFlowsResult> {
  const range = params.range ?? "1h";
  const limit = params.limit ?? 50;
  const nowMs = Date.now();
  const now = Math.floor(nowMs / 1000);
  const mock = () => selectTopFlows(getNetflowFlows(now, range), params, now);

  if (env.DASHBOARD_DATA === "demo") return mock();

  const conditions: SQL[] = [
    gte(
      netflowSamples.capturedAt,
      new Date(nowMs - flowRangeSeconds[range] * 1000),
    ),
  ];
  if (params.routerId)
    conditions.push(eq(netflowSamples.routerId, params.routerId));
  if (params.protocol && params.protocol !== "ALL")
    conditions.push(eq(netflowSamples.protocol, params.protocol));
  const q = params.q?.trim();
  if (q) {
    const pattern = `%${escapeLike(q)}%`;
    const search = or(
      ilike(netflowSamples.srcIp, pattern),
      ilike(netflowSamples.dstIp, pattern),
      sql`${netflowSamples.srcPort}::text = ${q}`,
      sql`${netflowSamples.dstPort}::text = ${q}`,
    );
    if (search) conditions.push(search);
  }

  const appFilter = params.app?.trim().toLowerCase();
  // ponytail: kolom app tidak ada di DB; bila memfilter app, ambil 5000 teratas lalu saring di memori.
  const rows = await db
    .select({
      id: netflowSamples.id,
      routerId: netflowSamples.routerId,
      routerName: routers.name,
      srcIp: netflowSamples.srcIp,
      srcPort: netflowSamples.srcPort,
      dstIp: netflowSamples.dstIp,
      dstPort: netflowSamples.dstPort,
      protocol: netflowSamples.protocol,
      bytes: netflowSamples.bytes,
      packets: netflowSamples.packets,
      capturedAt: netflowSamples.capturedAt,
    })
    .from(netflowSamples)
    .leftJoin(routers, eq(routers.id, netflowSamples.routerId))
    .where(and(...conditions))
    .orderBy(desc(netflowSamples.bytes))
    .limit(appFilter ? 5000 : limit);

  if (rows.length === 0) {
    // Tabel kosong untuk rentang ini: tampilkan mock hanya bila tabel benar-benar kosong.
    const [any] = await db
      .select({ id: netflowSamples.id })
      .from(netflowSamples)
      .limit(1);
    if (!any) return mock();
    return { flows: [], totalBytes: 0, totalPackets: 0 };
  }

  let flows: NetflowRecord[] = rows.map((r) => {
    const endedAt = Math.floor(r.capturedAt.getTime() / 1000);
    return {
      id: r.id,
      routerId: r.routerId ?? "",
      routerName: r.routerName ?? "Tidak diketahui",
      srcIp: r.srcIp,
      srcPort: r.srcPort,
      dstIp: r.dstIp,
      dstPort: r.dstPort,
      protocol: r.protocol as FlowProtocol,
      app: appForPort(r.protocol, r.dstPort),
      bytes: r.bytes,
      packets: r.packets,
      startedAt: endedAt,
      durationSec: 0,
      endedAt,
    };
  });
  if (appFilter) flows = flows.filter((f) => f.app.toLowerCase() === appFilter);
  flows = flows.slice(0, limit);
  return {
    flows,
    totalBytes: flows.reduce((s, f) => s + f.bytes, 0),
    totalPackets: flows.reduce((s, f) => s + f.packets, 0),
  };
}
