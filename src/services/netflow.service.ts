import "server-only";
import { and, desc, eq, gte, ilike, lt, or, sql, type SQL } from "drizzle-orm";
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
  NETFLOW_ACTIVE_WINDOW_MS,
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
  if (params.routerId) conditions.push(eq(netflowSamples.routerId, params.routerId));
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
    const [any] = await db.select({ id: netflowSamples.id }).from(netflowSamples).limit(1);
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
    .where(
      gte(
        netflowSamples.capturedAt,
        new Date(nowMs - NETFLOW_ACTIVE_WINDOW_MS),
      ),
    );
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
  if (params.routerId) conditions.push(eq(netflowSamples.routerId, params.routerId));
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
    const [any] = await db.select({ id: netflowSamples.id }).from(netflowSamples).limit(1);
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

export interface IngestFlowInput {
  routerId?: string | null;
  srcIp: string;
  dstIp: string;
  srcPort: number;
  dstPort: number;
  protocol: string | number;
  bytes: number;
  packets?: number;
  capturedAt?: Date | string | number;
}

export interface IngestResult {
  inserted: number;
  totalBytes: number;
  totalPackets: number;
}

export function normalizeProtocol(proto: string | number): string {
  if (typeof proto === "number") {
    switch (proto) {
      case 1:
        return "ICMP";
      case 6:
        return "TCP";
      case 17:
        return "UDP";
      case 47:
        return "GRE";
      case 50:
        return "ESP";
      case 89:
        return "OSPF";
      default:
        return `PROTO_${proto}`;
    }
  }
  const s = String(proto).trim().toUpperCase();
  if (s === "6") return "TCP";
  if (s === "17") return "UDP";
  if (s === "1") return "ICMP";
  return s || "OTHER";
}

const INGEST_CHUNK = 1000;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Memasukkan kumpulan flow NetFlow ke dalam tabel netflow_samples.
 */
export async function ingestNetflowFlows(
  flows: IngestFlowInput[],
): Promise<IngestResult> {
  if (!Array.isArray(flows) || flows.length === 0) {
    return { inserted: 0, totalBytes: 0, totalPackets: 0 };
  }

  const validRows = [];
  let totalBytes = 0;
  let totalPackets = 0;

  for (const f of flows) {
    const srcIp = String(f.srcIp ?? "").trim();
    const dstIp = String(f.dstIp ?? "").trim();
    if (!srcIp || !dstIp) continue;

    const srcPort = Number(f.srcPort);
    const dstPort = Number(f.dstPort);
    if (!Number.isInteger(srcPort) || srcPort < 0 || srcPort > 65535) continue;
    if (!Number.isInteger(dstPort) || dstPort < 0 || dstPort > 65535) continue;

    const bytes = Math.max(0, Math.floor(Number(f.bytes) || 0));
    const packets = Math.max(1, Math.floor(Number(f.packets) || 1));
    const protocol = normalizeProtocol(f.protocol);

    let capturedAt: Date;
    if (f.capturedAt instanceof Date && !Number.isNaN(f.capturedAt.getTime())) {
      capturedAt = f.capturedAt;
    } else if (typeof f.capturedAt === "number" && Number.isFinite(f.capturedAt)) {
      capturedAt = new Date(f.capturedAt > 1e11 ? f.capturedAt : f.capturedAt * 1000);
    } else if (typeof f.capturedAt === "string" && f.capturedAt) {
      const d = new Date(f.capturedAt);
      capturedAt = Number.isNaN(d.getTime()) ? new Date() : d;
    } else {
      capturedAt = new Date();
    }

    const routerId = f.routerId && UUID_REGEX.test(f.routerId) ? f.routerId : null;

    validRows.push({
      routerId,
      srcIp,
      dstIp,
      srcPort,
      dstPort,
      protocol,
      bytes,
      packets,
      capturedAt,
    });

    totalBytes += bytes;
    totalPackets += packets;
  }

  if (validRows.length === 0) {
    return { inserted: 0, totalBytes: 0, totalPackets: 0 };
  }

  let insertedCount = 0;
  for (let i = 0; i < validRows.length; i += INGEST_CHUNK) {
    const chunk = validRows.slice(i, i + INGEST_CHUNK);
    await db.insert(netflowSamples).values(chunk);
    insertedCount += chunk.length;
  }

  return {
    inserted: insertedCount,
    totalBytes,
    totalPackets,
  };
}

/**
 * Mem-parse datagram biner NetFlow v5 (standar MikroTik Traffic Flow UDP).
 */
export function parseNetflowV5Buffer(
  buffer: Buffer,
  routerId?: string,
): IngestFlowInput[] {
  if (buffer.length < 24) {
    throw new RangeError("Panjang paket NetFlow v5 kurang dari 24 byte.");
  }

  const version = buffer.readUInt16BE(0);
  if (version !== 5) {
    throw new RangeError(`Versi paket bukan NetFlow v5 (terbaca ${version}).`);
  }

  const count = buffer.readUInt16BE(2);
  if (count < 1 || count > 30) {
    throw new RangeError(`Jumlah record tidak valid (${count}).`);
  }

  if (buffer.length < 24 + count * 48) {
    throw new RangeError("Panjang paket tidak cukup untuk seluruh record NetFlow v5.");
  }

  const unixSecs = buffer.readUInt32BE(8);
  const capturedAt = new Date(unixSecs * 1000);

  const flows: IngestFlowInput[] = [];

  for (let i = 0; i < count; i++) {
    const offset = 24 + i * 48;
    const srcIp = `${buffer[offset]}.${buffer[offset + 1]}.${buffer[offset + 2]}.${buffer[offset + 3]}`;
    const dstIp = `${buffer[offset + 4]}.${buffer[offset + 5]}.${buffer[offset + 6]}.${buffer[offset + 7]}`;

    const packets = buffer.readUInt32BE(offset + 16);
    const bytes = buffer.readUInt32BE(offset + 20);

    const srcPort = buffer.readUInt16BE(offset + 32);
    const dstPort = buffer.readUInt16BE(offset + 34);

    const protoNum = buffer[offset + 38];

    flows.push({
      routerId,
      srcIp,
      dstIp,
      srcPort,
      dstPort,
      protocol: protoNum,
      bytes,
      packets,
      capturedAt,
    });
  }

  return flows;
}

/**
 * Menerima dan meng-ingest paket biner NetFlow v5 langsung ke basis data.
 */
export async function ingestRawNetflowV5(
  buffer: Buffer,
  routerId?: string,
): Promise<IngestResult> {
  const flows = parseNetflowV5Buffer(buffer, routerId);
  return ingestNetflowFlows(flows);
}

/**
 * Membersihkan sampel NetFlow lama di luar retensi waktu (standar 7 hari = 168 jam).
 */
export async function pruneOldNetflowSamples(
  retentionHours = 168,
): Promise<number> {
  const cutoff = new Date(Date.now() - retentionHours * 3600 * 1000);
  const deleted = await db
    .delete(netflowSamples)
    .where(lt(netflowSamples.capturedAt, cutoff))
    .returning({ id: netflowSamples.id });

  return deleted.length;
}

