import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { customers, olts, oltOnus, routers } from "@/db/schema";
import { DEFAULT_MAP_CENTER } from "@/config/map";

export type RealMarkerType = "customer" | "router" | "olt" | "odp" | "odc" | "pole";

export interface RealCustomerMarker {
  id: string;
  name: string;
  type: "customer";
  pppoeUsername: string;
  routerId: string;
  routerName?: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  hasCoordinates: boolean;
  odpName: string | null;
  billingStatus: "lunas" | "isolir";
  opticalPower: number | null;
  opticalCategory: "normal" | "warning" | "critical" | "unknown";
  isOnline: boolean;
  lastUpdatedAt: Date;
  onuDetails?: {
    serialNumber: string | null;
    ponIndex: number | null;
    onuIndex: number | null;
    opticalLevel: number | null;
  } | null;
}

export interface RealDeviceMarker {
  id: string;
  name: string;
  type: "router" | "olt" | "odp" | "odc" | "pole";
  host?: string;
  status: string;
  latitude: number;
  longitude: number;
  details?: Record<string, unknown>;
}

export interface RealMarkersResult {
  customerMarkers: RealCustomerMarker[];
  geocodedCustomers: RealCustomerMarker[];
  deviceMarkers: RealDeviceMarker[];
  allMarkers: (RealCustomerMarker | RealDeviceMarker)[];
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
  };
  dataSource: {
    provider: string;
    isRealData: boolean;
    lastSynchronizedAt: string;
  };
}

export async function fetchRealDatabaseMarkers(): Promise<RealMarkersResult> {
  const [centerLat, centerLng] = DEFAULT_MAP_CENTER;

  // 1. Ambil data pelanggan riil dari database PostgreSQL
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

  // 2. Ambil perangkat OLT dan Router riil
  const rawOlts = await db
    .select({
      id: olts.id,
      name: olts.name,
      host: olts.host,
      status: olts.status,
      brand: olts.brand,
    })
    .from(olts);

  const rawRouters = await db
    .select({
      id: routers.id,
      name: routers.name,
      host: routers.host,
      status: routers.status,
    })
    .from(routers);

  // 3. Bangun titik perangkat infrastruktur
  const deviceMarkers: RealDeviceMarker[] = [];

  for (const r of rawRouters) {
    deviceMarkers.push({
      id: `router-${r.id}`,
      name: r.name,
      type: "router",
      host: r.host,
      status: r.status,
      latitude: centerLat,
      longitude: centerLng,
      details: { role: "Core Gateway BGP/PPPoE" },
    });
  }

  for (const o of rawOlts) {
    deviceMarkers.push({
      id: `olt-${o.id}`,
      name: o.name,
      type: "olt",
      host: o.host,
      status: o.status,
      latitude: centerLat + 0.0015,
      longitude: centerLng + 0.0018,
      details: { brand: o.brand },
    });
  }

  // Identifikasi ODP dari sebaran pelanggan
  const odpMap = new Map<string, number>();
  for (const c of rawCustomers) {
    if (c.odpName) {
      odpMap.set(c.odpName, (odpMap.get(c.odpName) ?? 0) + 1);
    }
  }

  let odpIdx = 0;
  for (const [odpName, count] of odpMap.entries()) {
    const angle = (odpIdx / Math.max(1, odpMap.size)) * 2 * Math.PI;
    const distance = 0.005 + (odpIdx % 3) * 0.003;
    deviceMarkers.push({
      id: `odp-${odpName}`,
      name: odpName,
      type: "odp",
      status: "active",
      latitude: centerLat + Math.sin(angle) * distance,
      longitude: centerLng + Math.cos(angle) * distance,
      details: { connectedCustomers: count },
    });
    odpIdx++;
  }

  // 4. Petakan data pelanggan riil
  let onlineCount = 0;
  let offlineCount = 0;
  let criticalOpticsCount = 0;
  let geocodedCount = 0;

  const customerMarkers: RealCustomerMarker[] = rawCustomers.map((c) => {
    if (c.isOnline) onlineCount++;
    else offlineCount++;

    const optical = c.onuRxPower ?? c.opticalPower ?? null;
    let opticalCategory: "normal" | "warning" | "critical" | "unknown" = "unknown";
    if (optical !== null && Number.isFinite(optical)) {
      if (optical <= -25.0) {
        opticalCategory = "critical";
        criticalOpticsCount++;
      } else if (optical <= -23.0) {
        opticalCategory = "warning";
      } else {
        opticalCategory = "normal";
      }
    }

    const hasCoords =
      c.latitude !== null &&
      c.longitude !== null &&
      Number.isFinite(c.latitude) &&
      Number.isFinite(c.longitude);

    if (hasCoords) {
      geocodedCount++;
    }

    return {
      id: c.id,
      name: c.name,
      type: "customer",
      pppoeUsername: c.pppoeUsername,
      routerId: c.routerId,
      routerName: c.routerName ?? undefined,
      address: c.address,
      latitude: c.latitude,
      longitude: c.longitude,
      hasCoordinates: hasCoords,
      odpName: c.odpName,
      billingStatus: c.billingStatus as "lunas" | "isolir",
      opticalPower: optical,
      opticalCategory,
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

  const geocodedCustomers = customerMarkers.filter((c) => c.hasCoordinates);

  return {
    customerMarkers,
    geocodedCustomers,
    deviceMarkers,
    allMarkers: [...geocodedCustomers, ...deviceMarkers],
    summary: {
      totalCustomers: rawCustomers.length,
      geocodedCustomers: geocodedCount,
      unmappedCustomers: rawCustomers.length - geocodedCount,
      onlineCustomers: onlineCount,
      offlineCustomers: offlineCount,
      criticalOpticsCount,
      totalDevices: deviceMarkers.length,
      totalRouters: rawRouters.length,
      totalOlts: rawOlts.length,
      totalOdps: odpMap.size,
    },
    dataSource: {
      provider: "PostgreSQL Database (NOC Operational)",
      isRealData: true,
      lastSynchronizedAt: new Date().toISOString(),
    },
  };
}
