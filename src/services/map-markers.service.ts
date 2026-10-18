import "server-only";
import { getNetworkMapData } from "./network-map.service";

export type MarkerType = "customer" | "router" | "olt" | "odp" | "odc" | "pole" | "server";

export type OpticalCategory = "normal" | "warning" | "critical" | "unknown";

export interface UnifiedMapMarker {
  id: string;
  name: string;
  type: MarkerType;
  latitude: number;
  longitude: number;
  isOnline: boolean;
  status: string;
  odpName?: string | null;
  opticalPower?: number | null;
  opticalCategory?: OpticalCategory;
  billingStatus?: "lunas" | "isolir";
  address?: string | null;
  host?: string;
  details?: Record<string, unknown>;
}

export interface MapMarkersFilterOptions {
  type?: "all" | "customers" | "devices" | MarkerType;
  status?: "all" | "online" | "offline" | "critical";
  search?: string;
  forceMock?: boolean;
}

export interface MapMarkersResponse {
  markers: UnifiedMapMarker[];
  customers: UnifiedMapMarker[];
  devices: UnifiedMapMarker[];
  summary: {
    total: number;
    totalCustomers: number;
    totalDevices: number;
    unmappedCustomersCount: number;
    onlineCount: number;
    offlineCount: number;
    criticalOpticsCount: number;
  };
  dataSource: {
    provider: string;
    isRealData: boolean;
    lastSynchronizedAt: string;
  };
}

export function classifyOpticalPower(power: number | null): OpticalCategory {
  if (power === null || !Number.isFinite(power)) return "unknown";
  if (power <= -25.0) return "critical";
  if (power <= -23.0) return "warning";
  return "normal";
}

export async function getMapMarkersData(
  options: MapMarkersFilterOptions = {},
): Promise<MapMarkersResponse> {
  const baseData = await getNetworkMapData({ forceMock: options.forceMock });
  const rawCustomers = baseData.customers;
  const rawInfrastructure = baseData.infrastructure;

  let unmappedCount = 0;
  const customerMarkers: UnifiedMapMarker[] = [];

  for (const c of rawCustomers) {
    const hasCoords =
      c.latitude !== null &&
      c.longitude !== null &&
      Number.isFinite(c.latitude) &&
      Number.isFinite(c.longitude);

    if (!hasCoords) {
      unmappedCount++;
      continue;
    }

    const opticalPower = c.opticalPower ?? null;
    const opticalCategory = classifyOpticalPower(opticalPower);

    customerMarkers.push({
      id: c.id,
      name: c.name,
      type: "customer",
      latitude: c.latitude as number,
      longitude: c.longitude as number,
      isOnline: c.isOnline,
      status: c.isOnline ? "online" : "offline",
      odpName: c.odpName,
      opticalPower,
      opticalCategory,
      billingStatus: c.billingStatus,
      address: c.address,
      details: {
        pppoeUsername: c.pppoeUsername,
        routerId: c.routerId,
        routerName: c.routerName,
        onuDetails: c.onuDetails,
      },
    });
  }

  const deviceMarkers: UnifiedMapMarker[] = rawInfrastructure.map((i) => {
    const isOnline = i.status === "aktif" || i.status === "active";
    return {
      id: i.id,
      name: i.name,
      type: i.type,
      latitude: i.latitude,
      longitude: i.longitude,
      isOnline,
      status: i.status,
      host: i.host,
      details: i.details,
    };
  });

  // Gabungkan semua penanda
  let allMarkers = [...customerMarkers, ...deviceMarkers];

  // 1. Filter berdasarkan tipe penanda
  if (options.type && options.type !== "all") {
    if (options.type === "customers") {
      allMarkers = customerMarkers;
    } else if (options.type === "devices") {
      allMarkers = deviceMarkers;
    } else {
      allMarkers = allMarkers.filter((m) => m.type === options.type);
    }
  }

  // 2. Filter berdasarkan status
  if (options.status && options.status !== "all") {
    if (options.status === "online") {
      allMarkers = allMarkers.filter((m) => m.isOnline);
    } else if (options.status === "offline") {
      allMarkers = allMarkers.filter((m) => !m.isOnline);
    } else if (options.status === "critical") {
      allMarkers = allMarkers.filter(
        (m) =>
          m.opticalCategory === "critical" ||
          m.status === "critical" ||
          m.status === "isolir",
      );
    }
  }

  // 3. Filter berdasarkan pencarian nama/username/odp/host
  if (options.search && options.search.trim().length > 0) {
    const query = options.search.trim().toLowerCase();
    allMarkers = allMarkers.filter((m) => {
      const matchName = m.name.toLowerCase().includes(query);
      const matchId = m.id.toLowerCase().includes(query);
      const matchOdp = m.odpName?.toLowerCase().includes(query) ?? false;
      const matchHost = m.host?.toLowerCase().includes(query) ?? false;
      const matchAddr = m.address?.toLowerCase().includes(query) ?? false;
      const pppoe = (m.details?.pppoeUsername as string | undefined)?.toLowerCase();
      const matchPppoe = pppoe ? pppoe.includes(query) : false;
      const onuDetails = m.details?.onuDetails as { serialNumber?: string | null } | undefined;
      const matchSerial = onuDetails?.serialNumber?.toLowerCase().includes(query) ?? false;
      return matchName || matchId || matchOdp || matchHost || matchAddr || matchPppoe || matchSerial;
    });
  }

  const filteredCustomers = allMarkers.filter((m) => m.type === "customer");
  const filteredDevices = allMarkers.filter((m) => m.type !== "customer");

  let onlineCount = 0;
  let offlineCount = 0;
  let criticalOpticsCount = 0;

  for (const m of allMarkers) {
    if (m.isOnline) onlineCount++;
    else offlineCount++;

    if (m.opticalCategory === "critical") {
      criticalOpticsCount++;
    }
  }

  return {
    markers: allMarkers,
    customers: filteredCustomers,
    devices: filteredDevices,
    summary: {
      total: allMarkers.length,
      totalCustomers: filteredCustomers.length,
      totalDevices: filteredDevices.length,
      unmappedCustomersCount: unmappedCount,
      onlineCount,
      offlineCount,
      criticalOpticsCount,
    },
    dataSource: baseData.dataSource,
  };
}
