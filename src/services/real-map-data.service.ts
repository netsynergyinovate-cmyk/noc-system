import "server-only";
import { asc, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { effectiveBillingStatusSql } from "./customer-isolir";
import {
  customers,
  networkInfrastructure,
  networkCables,
  networkDeviceRelations,
  routers,
  oltOnus,
} from "@/db/schema";
import {
  MAP_DATA_SOURCE_REGISTRY,
  type MapDataSourceItem,
} from "@/lib/map-data-source-registry";
import type {
  NetworkCustomerPoint,
  NetworkInfrastructurePoint,
} from "./network-map.service";
import type { CableRouteSegment } from "./cable-map.service";
import {
  getDeviceHierarchyTree,
  type HierarchyTreeNode,
} from "./device-relations.service";

export interface CompleteRealMapDataOptions {
  includeCables?: boolean;
  includeHierarchy?: boolean;
  statusFilter?: "all" | "active" | "inactive" | "online" | "offline";
  searchQuery?: string;
}

export interface CompleteRealMapDataResult {
  customers: NetworkCustomerPoint[];
  infrastructure: NetworkInfrastructurePoint[];
  cables?: CableRouteSegment[];
  hierarchy?: HierarchyTreeNode[];
  summary: {
    totalCustomers: number;
    geocodedCustomers: number;
    unmappedCustomers: number;
    onlineCustomers: number;
    offlineCustomers: number;
    criticalOpticsCount: number;
    totalDevices: number;
    totalRouters: number;
    totalOlts: number;
    totalOdps: number;
    totalOdcs: number;
    totalPoles: number;
    totalCables: number;
    totalCableLengthMeters: number;
    totalRelations?: number;
  };
  dataSource: {
    provider: string;
    isRealData: boolean;
    registry: readonly MapDataSourceItem[];
    lastSynchronizedAt: string;
  };
}

export interface MapDatabaseHealthResult {
  healthy: boolean;
  tables: Array<{
    tableName: string;
    description: string;
    rowCount: number;
    status: "ok" | "empty" | "error";
  }>;
  checkedAt: string;
}

/**
 * Mengambil data peta terpadu dan menyeluruh dari PostgreSQL operasional nyata.
 */
export async function getCompleteRealMapData(
  options?: CompleteRealMapDataOptions,
): Promise<CompleteRealMapDataResult> {
  const includeCables = options?.includeCables ?? true;
  const searchQuery = options?.searchQuery?.trim().toLowerCase();
  const statusFilter = options?.statusFilter ?? "all";

  // 1. Ambil data pelanggan riil beserta info router & ONU
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
      billingStatus: effectiveBillingStatusSql,
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

  // 2. Ambil data perangkat infrastruktur fisik riil
  const rawInfra = await db
    .select()
    .from(networkInfrastructure)
    .orderBy(asc(networkInfrastructure.name));

  // 3. Ambil data kabel serat optik jika diminta
  let rawCables: typeof networkCables.$inferSelect[] = [];
  if (includeCables) {
    try {
      rawCables = await db.select().from(networkCables);
    } catch {
      rawCables = [];
    }
  }

  // Filter pelanggan
  let filteredCustomers = rawCustomers;
  if (searchQuery) {
    filteredCustomers = filteredCustomers.filter(
      (c) =>
        c.name.toLowerCase().includes(searchQuery) ||
        c.pppoeUsername.toLowerCase().includes(searchQuery) ||
        (c.odpName && c.odpName.toLowerCase().includes(searchQuery)),
    );
  }
  if (statusFilter === "online") {
    filteredCustomers = filteredCustomers.filter((c) => c.isOnline);
  } else if (statusFilter === "offline") {
    filteredCustomers = filteredCustomers.filter((c) => !c.isOnline);
  }

  // Filter infrastruktur
  let filteredInfra = rawInfra;
  if (searchQuery) {
    filteredInfra = filteredInfra.filter(
      (i) =>
        i.name.toLowerCase().includes(searchQuery) ||
        i.type.toLowerCase().includes(searchQuery) ||
        (i.host && i.host.toLowerCase().includes(searchQuery)),
    );
  }
  if (statusFilter === "active") {
    filteredInfra = filteredInfra.filter((i) => i.status === "active");
  } else if (statusFilter === "inactive") {
    filteredInfra = filteredInfra.filter((i) => i.status !== "active");
  }

  // Pemetaan Pelanggan ke format NetworkCustomerPoint
  let onlineCount = 0;
  let offlineCount = 0;
  let criticalOpticsCount = 0;
  let geocodedCount = 0;

  const mappedCustomers: NetworkCustomerPoint[] = filteredCustomers.map((c) => {
    if (c.isOnline) onlineCount++;
    else offlineCount++;

    const optical = c.onuRxPower ? Number(c.onuRxPower) : c.opticalPower ? Number(c.opticalPower) : null;
    if (optical !== null && optical <= -24.5) {
      criticalOpticsCount++;
    }

    const hasRealCoords =
      c.latitude !== null &&
      c.longitude !== null &&
      Number.isFinite(Number(c.latitude)) &&
      Number.isFinite(Number(c.longitude));

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
      latitude: c.latitude ? Number(c.latitude) : null,
      longitude: c.longitude ? Number(c.longitude) : null,
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
            opticalLevel: c.onuRxPower ? Number(c.onuRxPower) : null,
          }
        : null,
    };
  });

  // Pemetaan Infrastruktur ke format NetworkInfrastructurePoint
  const mappedInfra: NetworkInfrastructurePoint[] = filteredInfra.map((i) => ({
    id: i.id,
    name: i.name,
    type: i.type,
    host: i.host || undefined,
    status: i.status,
    latitude: Number(i.latitude),
    longitude: Number(i.longitude),
    parentId: i.parentId,
    details: (i.details as Record<string, unknown>) || {},
  }));

  // Hitung jumlah perangkat per jenis
  let totalRouters = 0;
  let totalOlts = 0;
  let totalOdps = 0;
  let totalOdcs = 0;
  let totalPoles = 0;

  for (const i of rawInfra) {
    if (i.type === "router" || i.type === "server") totalRouters++;
    else if (i.type === "olt") totalOlts++;
    else if (i.type === "odp") totalOdps++;
    else if (i.type === "odc") totalOdcs++;
    else if (i.type === "pole") totalPoles++;
  }

  // Hitung metrik kabel
  const infraLookup = new Map(rawInfra.map((i) => [i.id, i]));
  const customerLookup = new Map(rawCustomers.map((c) => [c.id, c]));

  let totalCableLengthMeters = 0;
  const mappedCables: CableRouteSegment[] = rawCables.map((c) => {
    const len = c.lengthMeters ? Number(c.lengthMeters) : 0;
    totalCableLengthMeters += len;

    const sourceInfra = infraLookup.get(c.sourceId);
    const targetInfra = c.targetId ? infraLookup.get(c.targetId) : undefined;
    const targetCust = c.targetId ? customerLookup.get(c.targetId) : undefined;

    const sourceName = sourceInfra ? sourceInfra.name : c.sourceId;
    const sourceType = sourceInfra ? sourceInfra.type : "infrastructure";

    const targetName = targetInfra
      ? targetInfra.name
      : targetCust
        ? targetCust.name
        : c.targetId || "Unassigned Target";

    const statusVal: "active" | "warning" | "offline" =
      c.status === "active" ? "active" : c.status === "maintenance" ? "warning" : "offline";

    return {
      id: c.id,
      name: c.name,
      sourceId: c.sourceId,
      sourceName,
      sourceType,
      targetId: c.targetId || "",
      targetName,
      targetType: c.targetType,
      type: c.cableType as "distribution" | "feeder" | "drop" | "backbone",
      coreCapacity: c.coreCapacity,
      color: c.color,
      lengthMeters: len,
      estimatedLengthMeters: len,
      coordinates: c.polyline,
      status: statusVal,
    };
  });

  // 4. Ambil pohon hierarki relasi perangkat jika diminta
  let hierarchyTree: HierarchyTreeNode[] | undefined = undefined;
  let totalRelations: number | undefined = undefined;
  if (options?.includeHierarchy) {
    try {
      hierarchyTree = await getDeviceHierarchyTree();
      const [relCount] = await db.select({ total: count() }).from(networkDeviceRelations);
      totalRelations = Number(relCount?.total ?? 0);
    } catch {
      hierarchyTree = [];
      totalRelations = 0;
    }
  }

  return {
    customers: mappedCustomers,
    infrastructure: mappedInfra,
    cables: includeCables ? mappedCables : undefined,
    hierarchy: hierarchyTree,
    summary: {
      totalCustomers: rawCustomers.length,
      geocodedCustomers: geocodedCount,
      unmappedCustomers: rawCustomers.length - geocodedCount,
      onlineCustomers: onlineCount,
      offlineCustomers: offlineCount,
      criticalOpticsCount,
      totalDevices: rawInfra.length,
      totalRouters,
      totalOlts,
      totalOdps,
      totalOdcs,
      totalPoles,
      totalCables: rawCables.length,
      totalCableLengthMeters: Math.round(totalCableLengthMeters),
      totalRelations,
    },
    dataSource: {
      provider: "PostgreSQL Database (NOC Operational)",
      isRealData: true,
      registry: MAP_DATA_SOURCE_REGISTRY,
      lastSynchronizedAt: new Date().toISOString(),
    },
  };
}

/**
 * Memeriksa status kesehatan tabel-tabel fisik peta di database PostgreSQL.
 */
export async function checkMapDatabaseHealth(): Promise<MapDatabaseHealthResult> {
  const tableChecks: MapDatabaseHealthResult["tables"] = [];

  for (const reg of MAP_DATA_SOURCE_REGISTRY) {
    try {
      let rowCount = 0;
      if (reg.tableName === "customers") {
        const [res] = await db.select({ total: count() }).from(customers);
        rowCount = Number(res?.total ?? 0);
      } else if (reg.tableName === "network_infrastructure") {
        const [res] = await db.select({ total: count() }).from(networkInfrastructure);
        rowCount = Number(res?.total ?? 0);
      } else if (reg.tableName === "network_cables") {
        const [res] = await db.select({ total: count() }).from(networkCables);
        rowCount = Number(res?.total ?? 0);
      } else if (reg.tableName === "network_device_relations") {
        const [res] = await db.select({ total: count() }).from(networkDeviceRelations);
        rowCount = Number(res?.total ?? 0);
      }

      tableChecks.push({
        tableName: reg.tableName,
        description: reg.description,
        rowCount,
        status: rowCount > 0 ? "ok" : "empty",
      });
    } catch {
      tableChecks.push({
        tableName: reg.tableName,
        description: reg.description,
        rowCount: 0,
        status: "error",
      });
    }
  }

  const allHealthy = tableChecks.every((t) => t.status !== "error");

  return {
    healthy: allHealthy,
    tables: tableChecks,
    checkedAt: new Date().toISOString(),
  };
}
