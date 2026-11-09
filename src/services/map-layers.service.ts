import "server-only";
import { db } from "@/db";
import { networkCables } from "@/db/schema";
import {
  getNetworkMapData,
  type NetworkCustomerPoint,
  type NetworkInfrastructurePoint,
} from "./network-map.service";
import {
  getTileProviders,
  type MapLayerId,
  type TileProviderConfig,
} from "@/config/map";

export type LayerType = "points" | "polylines" | "circles" | "tiles";

export interface MapCableRoute {
  id: string;
  name: string;
  type: "backbone" | "feeder" | "drop";
  path: [number, number][];
  color: string;
  fiberCapacity: number;
}

export interface MapCoverageZone {
  id: string;
  odpName: string;
  center: [number, number];
  radiusMeters: number;
  connectedCustomers: number;
  color: string;
}

export interface MapLayerPayload<T = unknown> {
  id: string;
  name: string;
  type: LayerType;
  visibleDefault: boolean;
  itemCount: number;
  data: T;
}

export interface MapLayersResponse {
  layers: {
    tiles: MapLayerPayload<Record<MapLayerId, TileProviderConfig>>;
    customers: MapLayerPayload<NetworkCustomerPoint[]>;
    infrastructure: MapLayerPayload<NetworkInfrastructurePoint[]>;
    cables: MapLayerPayload<MapCableRoute[]>;
    coverage: MapLayerPayload<MapCoverageZone[]>;
  };
  summary: {
    totalCustomers: number;
    geocodedCustomers: number;
    totalInfrastructure: number;
    totalCableRoutes: number;
    totalCoverageZones: number;
  };
  dataSource: {
    provider: string;
    isRealData: boolean;
    lastSynchronizedAt: string;
  };
}

export async function getMapLayersData(options?: {
  layer?: string | null;
  forceMock?: boolean;
}): Promise<MapLayersResponse | MapLayerPayload> {
  const baseData = await getNetworkMapData({ forceMock: options?.forceMock });
  const tileProviders = getTileProviders();

  // 1. Ekstraksi Titik Pelanggan & Infrastruktur
  const customers = baseData.customers;
  const infrastructure = baseData.infrastructure;

  const geocodedCustomers = customers.filter(
    (c) =>
      c.latitude !== null &&
      c.longitude !== null &&
      Number.isFinite(c.latitude) &&
      Number.isFinite(c.longitude),
  );

  const odpNodes = infrastructure.filter((i) => i.type === "odp");

  // 2. Bangun Topologi Jalur Kabel Serat Optik (membaca tabel networkCables riil terlebih dahulu)
  const cables: MapCableRoute[] = [];
  let loadedFromDb = false;

  if (!options?.forceMock) {
    try {
      const realCables = await db.select().from(networkCables);
      if (realCables.length > 0) {
        loadedFromDb = true;
        for (const rc of realCables) {
          cables.push({
            id: rc.id,
            name: rc.name,
            type: (rc.cableType as "backbone" | "feeder" | "drop") || "drop",
            path: rc.polyline as [number, number][],
            color: rc.color,
            fiberCapacity: rc.coreCapacity,
          });
        }
      }
    } catch (err) {
      console.error("[MAP_LAYERS_CABLES_DB_ERROR]", err);
    }
  }

  // Hanya jika opsi forceMock aktif secara eksplisit (unit test), generate rute kabel sintetis
  if (!loadedFromDb && options?.forceMock) {
    const oltNode = infrastructure.find((i) => i.type === "olt");
    const routerNode = infrastructure.find((i) => i.type === "router");

    if (routerNode && oltNode) {
      cables.push({
        id: "backbone-core-olt",
        name: `Backbone Core (${routerNode.name} -> ${oltNode.name})`,
        type: "backbone",
        path: [
          [routerNode.latitude, routerNode.longitude],
          [oltNode.latitude, oltNode.longitude],
        ],
        color: "#8b5cf6",
        fiberCapacity: 24,
      });
    }

    if (oltNode) {
      for (const odp of odpNodes) {
        cables.push({
          id: `feeder-${odp.id}`,
          name: `Feeder Distribution (${oltNode.name} -> ${odp.name})`,
          type: "feeder",
          path: [
            [oltNode.latitude, oltNode.longitude],
            [odp.latitude, odp.longitude],
          ],
          color: "#06b6d4",
          fiberCapacity: 12,
        });
      }
    }

    for (const cust of geocodedCustomers) {
      if (!cust.odpName || cust.latitude === null || cust.longitude === null)
        continue;
      const odp = odpNodes.find((i) => i.name === cust.odpName);
      if (odp) {
        cables.push({
          id: `drop-${cust.id}`,
          name: `Drop Core (${odp.name} -> ${cust.name})`,
          type: "drop",
          path: [
            [odp.latitude, odp.longitude],
            [cust.latitude, cust.longitude],
          ],
          color: cust.isOnline ? "#10b981" : "#ef4444",
          fiberCapacity: 1,
        });
      }
    }
  }

  // 3. Bangun Zona Cakupan ODP (Optical Distribution Coverage)
  const coverageZones: MapCoverageZone[] = odpNodes.map((odp) => {
    const connectedCount =
      typeof odp.details?.connectedCustomers === "number"
        ? odp.details.connectedCustomers
        : customers.filter((c) => c.odpName === odp.name).length;

    return {
      id: `coverage-${odp.id}`,
      odpName: odp.name,
      center: [odp.latitude, odp.longitude],
      radiusMeters: 150, // Radius jangkauan standar 150 meter
      connectedCustomers: connectedCount,
      color: "#3b82f6",
    };
  });

  const layerMap: MapLayersResponse["layers"] = {
    tiles: {
      id: "tiles",
      name: "Lapis Peta Dasar (Tiles)",
      type: "tiles",
      visibleDefault: true,
      itemCount: Object.keys(tileProviders).length,
      data: tileProviders,
    },
    customers: {
      id: "customers",
      name: "Lapis Titik Pelanggan",
      type: "points",
      visibleDefault: true,
      itemCount: customers.length,
      data: customers,
    },
    infrastructure: {
      id: "infrastructure",
      name: "Lapis Titik Infrastruktur (Router/OLT/ODP)",
      type: "points",
      visibleDefault: true,
      itemCount: infrastructure.length,
      data: infrastructure,
    },
    cables: {
      id: "cables",
      name: "Lapis Jalur Kabel Serat Optik",
      type: "polylines",
      visibleDefault: true,
      itemCount: cables.length,
      data: cables,
    },
    coverage: {
      id: "coverage",
      name: "Lapis Zona Cakupan ODP",
      type: "circles",
      visibleDefault: false,
      itemCount: coverageZones.length,
      data: coverageZones,
    },
  };

  // Jika parameter layer spesifik diminta
  if (options?.layer && options.layer in layerMap) {
    return layerMap[options.layer as keyof typeof layerMap];
  }

  return {
    layers: layerMap,
    summary: {
      totalCustomers: customers.length,
      geocodedCustomers: geocodedCustomers.length,
      totalInfrastructure: infrastructure.length,
      totalCableRoutes: cables.length,
      totalCoverageZones: coverageZones.length,
    },
    dataSource: baseData.dataSource,
  };
}
