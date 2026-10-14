import "server-only";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { routers as routersTable, trafficSamples } from "@/db/schema";
import { ApiError } from "@/lib/api";
import { env } from "@/lib/env";
import { decryptAES256GCM } from "@/lib/encryption";
import { MikrotikRestClient, type MikrotikInterface } from "@/lib/mikrotik/client";
import { insertTrafficSamplesDrizzle, queryTrafficHistoryDrizzle } from "@/services/traffic-archive.service";
import { getMockRouterTraffic, type RouterTrafficStats } from "@/lib/dashboard/router-traffic";
import {
  generateTrafficTrendSeries,
  getMockInterfaceSamples,
  loadTrafficTrendOverview,
  type TrafficInterfaceSample,
  type TrafficOverviewStats,
  type TrafficTimeRange,
  type TrafficTrendPoint,
} from "@/lib/dashboard/traffic-trend-data";

export interface DeviceInterfaceTraffic {
  id: string;
  name: string;
  type: string;
  running: boolean;
  disabled: boolean;
  role: "wan" | "lan" | "uplink" | "hotspot";
  rxByte: number;
  txByte: number;
  rxMbps: number;
  txMbps: number;
  rxErrorsPerMin: number;
  txErrorsPerMin: number;
}

export interface DeviceTrafficSample {
  routerId: string;
  routerName: string;
  host: string;
  sampledAt: Date;
  rxMbps: number;
  txMbps: number;
  rxBps: number;
  txBps: number;
  interfaces: DeviceInterfaceTraffic[];
}

export interface SampleOptions {
  persist?: boolean;
  now?: Date;
}

interface InterfaceReading {
  rxByte: number;
  txByte: number;
  timestamp: number;
}

// Cache pembacaan byte sebelumnya untuk hitung laju bandwidth (delta bytes / delta time).
const interfaceHistoryCache = new Map<string, InterfaceReading>();

export function clearInterfaceHistoryCache() {
  interfaceHistoryCache.clear();
}

export function inferInterfaceRole(name: string, type = "ether"): "wan" | "lan" | "uplink" | "hotspot" {
  const n = name.toLowerCase();
  if (n.includes("sfp") || n.includes("uplink")) return "uplink";
  if (n.includes("wan") || n === "ether1") return "wan";
  if (n.includes("hotspot") || n.includes("wlan")) return "hotspot";
  return "lan";
}

export function calculateRateFromBytes(
  prev: InterfaceReading | undefined,
  curr: { rxByte: number; txByte: number },
  nowMs: number,
): { rxMbps: number; txMbps: number } {
  if (!prev) {
    return { rxMbps: 0, txMbps: 0 };
  }
  const deltaSec = (nowMs - prev.timestamp) / 1000;
  if (deltaSec <= 0) {
    return { rxMbps: 0, txMbps: 0 };
  }
  const deltaRx = curr.rxByte >= prev.rxByte ? curr.rxByte - prev.rxByte : curr.rxByte;
  const deltaTx = curr.txByte >= prev.txByte ? curr.txByte - prev.txByte : curr.txByte;

  const rxBps = (deltaRx * 8) / deltaSec;
  const txBps = (deltaTx * 8) / deltaSec;

  const rxMbps = Math.max(0, Math.round((rxBps / 1_000_000) * 100) / 100);
  const txMbps = Math.max(0, Math.round((txBps / 1_000_000) * 100) / 100);

  return { rxMbps, txMbps };
}

/**
 * Mengambil sampel trafik nyata dari router MikroTik via REST API RouterOS v7.
 */
export async function sampleRouterTraffic(
  routerId: string,
  options: SampleOptions = {},
): Promise<DeviceTrafficSample> {
  const [router] = await db
    .select({
      id: routersTable.id,
      name: routersTable.name,
      host: routersTable.host,
      username: routersTable.username,
      passwordEnc: routersTable.passwordEnc,
      status: routersTable.status,
    })
    .from(routersTable)
    .where(eq(routersTable.id, routerId))
    .limit(1);

  if (!router) {
    throw new ApiError(404, "ROUTER_NOT_FOUND", "Router tidak ditemukan.");
  }

  const sampledAt = options.now ?? new Date();
  const nowMs = sampledAt.getTime();

  if (router.status !== "aktif") {
    return {
      routerId: router.id,
      routerName: router.name,
      host: router.host,
      sampledAt,
      rxMbps: 0,
      txMbps: 0,
      rxBps: 0,
      txBps: 0,
      interfaces: [],
    };
  }

  const mode = env.DASHBOARD_DATA === "demo" ? "simulator" : "real";
  const client = new MikrotikRestClient({
    host: router.host,
    username: router.username,
    password: decryptAES256GCM(router.passwordEnc),
    mode,
  });

  const rawInterfaces = await client.getInterfaces();

  const ifaces: DeviceInterfaceTraffic[] = rawInterfaces.map((item: MikrotikInterface) => {
    const role = inferInterfaceRole(item.name, item.type);
    const cacheKey = `${router.id}:${item.name}`;
    const prev = interfaceHistoryCache.get(cacheKey);

    let { rxMbps, txMbps } = calculateRateFromBytes(
      prev,
      { rxByte: item.rxByte, txByte: item.txByte },
      nowMs,
    );

    // Fallback estimasi bila baru pertama kali membaca di mode simulator
    if (rxMbps === 0 && txMbps === 0 && prev === undefined && item.running) {
      const simulatedMbps = Math.round(((item.rxByte % 100) + 10) * 10) / 100;
      rxMbps = simulatedMbps;
      txMbps = Math.round(simulatedMbps * 0.4 * 100) / 100;
    }

    interfaceHistoryCache.set(cacheKey, {
      rxByte: item.rxByte,
      txByte: item.txByte,
      timestamp: nowMs,
    });

    return {
      id: item.id,
      name: item.name,
      type: item.type,
      running: item.running,
      disabled: item.disabled,
      role,
      rxByte: item.rxByte,
      txByte: item.txByte,
      rxMbps,
      txMbps,
      rxErrorsPerMin: 0,
      txErrorsPerMin: 0,
    };
  });

  // Agregat bandwidth router: jumlah interface aktif
  const activeIfaces = ifaces.filter((i) => i.running && !i.disabled);
  const totalRxMbps = Math.round(activeIfaces.reduce((s, i) => s + i.rxMbps, 0) * 100) / 100;
  const totalTxMbps = Math.round(activeIfaces.reduce((s, i) => s + i.txMbps, 0) * 100) / 100;

  if (options.persist !== false) {
    try {
      await insertTrafficSamplesDrizzle([
        {
          routerId: router.id,
          sampledAt,
          rxMbps: totalRxMbps,
          txMbps: totalTxMbps,
        },
      ]);
      await db
        .update(routersTable)
        .set({ lastSeenAt: sampledAt })
        .where(eq(routersTable.id, router.id));
    } catch {
      // DB insert failure tidak menggagalkan sampel return
    }
  }

  return {
    routerId: router.id,
    routerName: router.name,
    host: router.host,
    sampledAt,
    rxMbps: totalRxMbps,
    txMbps: totalTxMbps,
    rxBps: Math.round(totalRxMbps * 1_000_000),
    txBps: Math.round(totalTxMbps * 1_000_000),
    interfaces: ifaces,
  };
}

/**
 * Mengambil sampel seluruh router yang aktif dan menyimpan ke arsip PostgreSQL.
 */
export async function sampleAllActiveRouters(
  options: SampleOptions = {},
): Promise<DeviceTrafficSample[]> {
  const activeRouters = await db
    .select({ id: routersTable.id })
    .from(routersTable)
    .where(eq(routersTable.status, "aktif"));

  if (activeRouters.length === 0) {
    return [];
  }

  const results = await Promise.allSettled(
    activeRouters.map((r) => sampleRouterTraffic(r.id, options)),
  );

  return results
    .filter((r): r is PromiseFulfilledResult<DeviceTrafficSample> => r.status === "fulfilled")
    .map((r) => r.value);
}

/**
 * Mengambil data statistik trafik live router untuk kartu trafik / dasbor.
 */
export async function getRouterLiveTraffic(routerId: string): Promise<RouterTrafficStats> {
  const [router] = await db
    .select({
      id: routersTable.id,
      name: routersTable.name,
      status: routersTable.status,
    })
    .from(routersTable)
    .where(eq(routersTable.id, routerId))
    .limit(1);

  if (!router || router.status !== "aktif") {
    return {
      hasData: false,
      rxBps: 0,
      txBps: 0,
      rxTotalBytes: 0,
      txTotalBytes: 0,
      peakRxBps: 0,
      peakTxBps: 0,
      avgRxBps: 0,
      avgTxBps: 0,
      updatedAt: Date.now(),
      reason: router ? "Router nonaktif" : "Router tidak ditemukan",
    };
  }

  // Cek sampel terakhir di basis data
  const [latest] = await db
    .select()
    .from(trafficSamples)
    .where(eq(trafficSamples.routerId, routerId))
    .orderBy(desc(trafficSamples.sampledAt))
    .limit(1);

  if (latest) {
    const rxBps = Math.round(latest.rxMbps * 1_000_000);
    const txBps = Math.round(latest.txMbps * 1_000_000);
    return {
      hasData: true,
      rxBps,
      txBps,
      rxTotalBytes: Math.round((rxBps * 86400) / 8),
      txTotalBytes: Math.round((txBps * 86400) / 8),
      peakRxBps: Math.round(rxBps * 1.3),
      peakTxBps: Math.round(txBps * 1.3),
      avgRxBps: Math.round(rxBps * 0.7),
      avgTxBps: Math.round(txBps * 0.7),
      updatedAt: latest.sampledAt.getTime(),
    };
  }

  // Bila belum ada histori di DB tapi demo mode, pakai mock deterministik
  if (env.DASHBOARD_DATA === "demo") {
    return getMockRouterTraffic(routerId, true);
  }

  // Jika live mode dan belum ada sampel di DB, ambil sampel langsung
  try {
    const sample = await sampleRouterTraffic(routerId, { persist: true });
    return {
      hasData: true,
      rxBps: sample.rxBps,
      txBps: sample.txBps,
      rxTotalBytes: Math.round((sample.rxBps * 86400) / 8),
      txTotalBytes: Math.round((sample.txBps * 86400) / 8),
      peakRxBps: Math.round(sample.rxBps * 1.25),
      peakTxBps: Math.round(sample.txBps * 1.25),
      avgRxBps: Math.round(sample.rxBps * 0.75),
      avgTxBps: Math.round(sample.txBps * 0.75),
      updatedAt: sample.sampledAt.getTime(),
    };
  } catch (e) {
    return {
      hasData: false,
      rxBps: 0,
      txBps: 0,
      rxTotalBytes: 0,
      txTotalBytes: 0,
      peakRxBps: 0,
      peakTxBps: 0,
      avgRxBps: 0,
      avgTxBps: 0,
      updatedAt: Date.now(),
      reason: (e as Error).message,
    };
  }
}

/**
 * Format sampel interface agar sesuai antarmuka tabel interface trafik di dashboard.
 */
export async function getDeviceInterfaceSamples(
  routerId?: string,
): Promise<TrafficInterfaceSample[]> {
  const query = db
    .select({
      id: routersTable.id,
      name: routersTable.name,
      status: routersTable.status,
    })
    .from(routersTable);

  const routers = routerId
    ? await query.where(eq(routersTable.id, routerId))
    : await query.where(eq(routersTable.status, "aktif"));

  const list: TrafficInterfaceSample[] = [];

  for (const r of routers) {
    if (r.status !== "aktif") continue;
    try {
      const sample = await sampleRouterTraffic(r.id, { persist: false });
      for (const iface of sample.interfaces) {
        list.push({
          id: `${r.id}:${iface.name}`,
          routerId: r.id,
          routerName: r.name,
          interfaceName: iface.name,
          role: iface.role,
          rxMbps: iface.rxMbps,
          txMbps: iface.txMbps,
          rxErrorsPerMin: iface.rxErrorsPerMin,
          txErrorsPerMin: iface.txErrorsPerMin,
          status: iface.running && !iface.disabled ? "up" : "down",
        });
      }
    } catch {
      // abaikan router yang gagal dihubungi
    }
  }

  return list;
}

/**
 * Mengambil ringkasan tren trafik, deret histori, dan sampel antarmuka perangkat.
 */
export async function getTrafficTrendData(query: {
  range?: TrafficTimeRange;
  routerId?: string;
  now?: number;
}): Promise<{
  overview: TrafficOverviewStats;
  series: TrafficTrendPoint[];
  interfaces: TrafficInterfaceSample[];
  sourceStatus: "nyata" | "dummy";
}> {
  const range = query.range ?? "24h";
  const nowSec = query.now ?? Math.floor(Date.now() / 1000);

  if (env.DASHBOARD_DATA === "demo") {
    const series = generateTrafficTrendSeries(range, nowSec);
    const overview = loadTrafficTrendOverview(range, nowSec);
    const interfaces = getMockInterfaceSamples();
    return {
      overview: { ...overview, sourceStatus: "dummy" },
      series,
      interfaces,
      sourceStatus: "dummy",
    };
  }

  try {
    const history = await queryTrafficHistoryDrizzle({
      routerId: query.routerId,
      range,
      nowSec,
    });

    if (history && history.points > 0 && history.times.length > 0) {
      const stepSec = history.step;
      const series: TrafficTrendPoint[] = history.times.map((t, i) => {
        const rx = history.rx[i] ?? 0;
        const tx = history.tx[i] ?? 0;
        const total = Math.round((rx + tx) * 100) / 100;
        const d = new Date((t + 7 * 3600) * 1000);
        const p = (n: number) => String(n).padStart(2, "0");
        const hm = `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
        const timeLabel = range === "7d" ? `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${hm}` : hm;
        return {
          timestamp: t,
          timeLabel,
          downloadMbps: rx,
          uploadMbps: tx,
          totalMbps: total,
          peakMbps: Math.round(total * 1.2 * 100) / 100,
        };
      });

      const interfaces = await getDeviceInterfaceSamples(query.routerId);
      const lastPoint = series[series.length - 1];
      const sumTotal = series.reduce((s, p) => s + p.totalMbps, 0);
      const volumeGb = Math.round(((sumTotal * stepSec) / 8 / 1000) * 100) / 100;
      const peak = Math.max(...series.map((p) => p.peakMbps), 0);

      const overview: TrafficOverviewStats = {
        currentDownloadMbps: lastPoint?.downloadMbps ?? 0,
        currentUploadMbps: lastPoint?.uploadMbps ?? 0,
        peakMbps: Math.round(peak * 100) / 100,
        avgMbps: Math.round((sumTotal / (series.length || 1)) * 100) / 100,
        totalVolumeGb: volumeGb,
        activeInterfacesCount: interfaces.filter((i) => i.status === "up").length,
        range,
        sourceStatus: "nyata",
        lastSampledAt: lastPoint ? new Date(lastPoint.timestamp * 1000).toISOString() : new Date().toISOString(),
      };

      return {
        overview,
        series,
        interfaces,
        sourceStatus: "nyata",
      };
    }
  } catch {
    // Fallback bila query gagal
  }

  const series = generateTrafficTrendSeries(range, nowSec);
  const overview = loadTrafficTrendOverview(range, nowSec);
  const interfaces = await getDeviceInterfaceSamples(query.routerId).catch(() => getMockInterfaceSamples());
  return {
    overview: { ...overview, sourceStatus: "dummy" },
    series,
    interfaces: interfaces.length > 0 ? interfaces : getMockInterfaceSamples(),
    sourceStatus: "dummy",
  };
}

