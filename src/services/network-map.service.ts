import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { customers, olts, oltOnus, routers, networkInfrastructure } from "@/db/schema";
import { getLocalMockMapData } from "./network-map-mock";

export { getLocalMockMapData } from "./network-map-mock";

export interface NetworkCustomerPoint {
  id: string;
  name: string;
  pppoeUsername: string;
  routerId: string;
  routerName?: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  odpName: string | null;
  billingStatus: "lunas" | "isolir";
  opticalPower: number | null;
  isOnline: boolean;
  lastUpdatedAt: Date;
  onuDetails?: {
    serialNumber: string | null;
    ponIndex: number | null;
    onuIndex: number | null;
    opticalLevel: number | null;
  } | null;
}

export interface NetworkInfrastructurePoint {
  id: string;
  name: string;
  type: "router" | "olt" | "odp" | "odc" | "pole" | "server";
  host?: string;
  status: string;
  latitude: number;
  longitude: number;
  parentId?: string | null;
  parentName?: string | null;
  details?: Record<string, unknown>;
}

export interface NetworkMapData {
  customers: NetworkCustomerPoint[];
  infrastructure: NetworkInfrastructurePoint[];
  summary: {
    totalCustomers: number;
    geocodedCustomers: number;
    onlineCustomers: number;
    offlineCustomers: number;
    criticalOpticsCount: number;
    totalOlts: number;
    totalRouters: number;
    totalOdps: number;
  };
  dataSource: {
    provider: string;
    isRealData: boolean;
    lastSynchronizedAt: string;
  };
}

// Koordinat referensi area operasional utama (Teras Terunjam / Mukomuko - Bengkulu)
const DEFAULT_CENTER_LAT = -2.5786;
const DEFAULT_CENTER_LNG = 101.2185;

export async function getNetworkMapData(options?: {
  forceMock?: boolean;
}): Promise<NetworkMapData> {
  if (options?.forceMock) {
    return getLocalMockMapData();
  }

  try {
    // 1. Ambil data pelanggan riil beserta join ONU
  const rawCustomers = await db
    .select({
      id: customers.id,
      name: customers.name,
      pppoeUsername: customers.pppoeUsername,
      routerId: customers.routerId,
      routerName: routers.name,
      address: customers.address,
      latitude: customers.latitude,
      longitude: customers.longitude,
      odpName: customers.odpName,
      billingStatus: customers.billingStatus,
      opticalPower: customers.opticalPower,
      isOnline: customers.isOnline,
      lastUpdatedAt: customers.lastUpdatedAt,
      onuSerial: oltOnus.serialNumber,
      onuPonIndex: oltOnus.ponIndex,
      onuIndex: oltOnus.onuIndex,
      onuRxPower: oltOnus.rxPower,
    })
    .from(customers)
    .leftJoin(routers, eq(customers.routerId, routers.id))
    .leftJoin(oltOnus, eq(oltOnus.customerId, customers.id))
    .orderBy(asc(customers.name));

  // 2. Ambil OLT dan Routers riil
  const rawOlts = await db
    .select({
      id: olts.id,
      name: olts.name,
      host: olts.host,
      status: olts.status,
      brand: olts.brand,
      latitude: olts.latitude,
      longitude: olts.longitude,
    })
    .from(olts);

  const rawRouters = await db
    .select({
      id: routers.id,
      name: routers.name,
      host: routers.host,
      status: routers.status,
      latitude: routers.latitude,
      longitude: routers.longitude,
    })
    .from(routers);

  // 3. Bangun titik infrastruktur
  const infrastructure: NetworkInfrastructurePoint[] = [];

  // Core Router
  for (const r of rawRouters) {
    infrastructure.push({
      id: `router-${r.id}`,
      name: r.name,
      type: "router",
      host: r.host,
      status: r.status,
      latitude: r.latitude !== null ? Number(r.latitude) : DEFAULT_CENTER_LAT,
      longitude: r.longitude !== null ? Number(r.longitude) : DEFAULT_CENTER_LNG,
      details: { role: "Core Gateway BGP/PPPoE" },
    });
  }

  // OLT
  for (const o of rawOlts) {
    infrastructure.push({
      id: `olt-${o.id}`,
      name: o.name,
      type: "olt",
      host: o.host,
      status: o.status,
      latitude: o.latitude !== null ? Number(o.latitude) : DEFAULT_CENTER_LAT + 0.0015,
      longitude: o.longitude !== null ? Number(o.longitude) : DEFAULT_CENTER_LNG + 0.0018,
      details: { brand: o.brand },
    });
  }

  // ODPs yang teridentifikasi
  const odpMap = new Map<string, number>();
  for (const c of rawCustomers) {
    if (c.odpName) {
      odpMap.set(c.odpName, (odpMap.get(c.odpName) ?? 0) + 1);
    }
  }

  // Buat koordinat ODP terdistribusi di sekitar sentral
  let odpIdx = 0;
  for (const [odpName, count] of odpMap.entries()) {
    const angle = (odpIdx / Math.max(1, odpMap.size)) * 2 * Math.PI;
    const distance = 0.005 + (odpIdx % 3) * 0.003;
    infrastructure.push({
      id: `odp-${odpName}`,
      name: odpName,
      type: "odp",
      status: "active",
      latitude: DEFAULT_CENTER_LAT + Math.sin(angle) * distance,
      longitude: DEFAULT_CENTER_LNG + Math.cos(angle) * distance,
      details: { connectedCustomers: count },
    });
    odpIdx++;
  }

  // 3b. Muat titik infrastruktur riil (ODC, ODP, Tiang, dsb.) dari tabel network_infrastructure
  try {
    const realInfraRows = await db
      .select()
      .from(networkInfrastructure)
      .orderBy(asc(networkInfrastructure.name));

    for (const row of realInfraRows) {
      const existingIdx = infrastructure.findIndex(
        (i) => i.id === row.id || i.name.toLowerCase() === row.name.toLowerCase(),
      );
      const pointData: NetworkInfrastructurePoint = {
        id: row.id,
        name: row.name,
        type: row.type as "router" | "olt" | "odp" | "odc" | "pole",
        host: row.host || undefined,
        status: row.status,
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        parentId: row.parentId,
        details: (row.details as Record<string, unknown>) || {},
      };

      if (existingIdx >= 0) {
        infrastructure[existingIdx] = pointData;
      } else {
        infrastructure.push(pointData);
      }
    }
  } catch (err) {
    console.error("[GET_NETWORK_MAP_DATA INFRA DB ERROR]", err);
  }

  // 4. Petakan data pelanggan
  let onlineCount = 0;
  let offlineCount = 0;
  let criticalOpticsCount = 0;
  let geocodedCount = 0;

  const mappedCustomers: NetworkCustomerPoint[] = rawCustomers.map((c) => {
    if (c.isOnline) onlineCount++;
    else offlineCount++;

    const optical = c.onuRxPower ?? c.opticalPower ?? null;
    if (optical !== null && optical <= -24.5) {
      criticalOpticsCount++;
    }

    const hasRealCoords =
      c.latitude !== null &&
      c.longitude !== null &&
      Number.isFinite(c.latitude) &&
      Number.isFinite(c.longitude);

    if (hasRealCoords) {
      geocodedCount++;
    }

    return {
      id: c.id,
      name: c.name,
      pppoeUsername: c.pppoeUsername,
      routerId: c.routerId,
      routerName: c.routerName ?? undefined,
      address: c.address,
      latitude: c.latitude,
      longitude: c.longitude,
      odpName: c.odpName,
      billingStatus: c.billingStatus as "lunas" | "isolir",
      opticalPower: optical,
      isOnline: c.isOnline,
      lastUpdatedAt: c.lastUpdatedAt,
      onuDetails: c.onuSerial
        ? {
            serialNumber: c.onuSerial,
            ponIndex: c.onuPonIndex,
            onuIndex: c.onuIndex,
            opticalLevel: c.onuRxPower,
          }
        : null,
    };
  });

  return {
    customers: mappedCustomers,
    infrastructure,
    summary: {
      totalCustomers: rawCustomers.length,
      geocodedCustomers: geocodedCount,
      onlineCustomers: onlineCount,
      offlineCustomers: offlineCount,
      criticalOpticsCount,
      totalOlts: rawOlts.length,
      totalRouters: rawRouters.length,
      totalOdps: odpMap.size,
    },
    dataSource: {
      provider: "PostgreSQL Database (NOC Operational)",
      isRealData: true,
      lastSynchronizedAt: new Date().toISOString(),
    },
  };
  } catch (err) {
    console.error("[network-map] Gagal mengambil data peta dari PostgreSQL:", err);
    throw err;
  }
}
