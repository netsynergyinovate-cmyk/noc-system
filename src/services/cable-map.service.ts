import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  networkInfrastructure,
  networkCables,
  networkDeviceRelations,
} from "@/db/schema";
import { getNetworkMapData, type NetworkMapData } from "./network-map.service";
import {
  generateRoadBendedPolyline,
  calculatePolylineTotalMeters,
} from "@/lib/cable-path-routing";
import { resolveCableCapacityStyle } from "@/config/cable-capacity";
import type { SaveCableWaypointsInput } from "@/validators/cable-waypoints";
import {
  resolveViewportBounds,
  type ResolvedViewportBounds,
} from "./customer-location.service";
import type { CableZoomQueryInput } from "@/validators/cable-query";

export interface CableRouteSegment {
  id: string;
  name: string;
  type: "backbone" | "feeder" | "distribution" | "drop";
  sourceId: string;
  sourceName: string;
  sourceType: string;
  targetId: string;
  targetName: string;
  targetType: string;
  coreCapacity: number;
  status: "active" | "warning" | "offline";
  estimatedLengthMeters: number;
  coordinates: [number, number][];
  color?: string;
  baseWeight?: number;
  isHighlighted?: boolean;
}

export interface CableMapSummary {
  totalSegments: number;
  totalEstimatedLengthMeters: number;
  totalBackboneSegments: number;
  totalFeederSegments: number;
  totalDistributionSegments: number;
  totalDropSegments: number;
  totalCoreCapacity: number;
  activeSegments: number;
  warningSegments: number;
  offlineSegments: number;
}

export interface CableMapData {
  cables: CableRouteSegment[];
  summary: CableMapSummary;
  networkMapData: NetworkMapData;
  dataSource: {
    provider: string;
    isRealData: boolean;
    lastSynchronizedAt: string;
  };
}

/**
 * Menghitung jarak perkiraan garis lintang-bujur ke meter menggunakan formula Haversine.
 */
export function calculateHaversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371e3; // Radius bumi dalam meter
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

/**
 * Mengambil dan menyusun data peta jalur kabel operasional nyata dari database backend.
 */
export async function getCableMapData(options?: {
  forceMock?: boolean;
}): Promise<CableMapData> {
  const baseMapData = await getNetworkMapData(options);
  const infraList = baseMapData.infrastructure;
  const custList = baseMapData.customers;

  // Ambil semua relasi hierarki dari DB sebagai sumber topologi utama
  const hierarchyRelations = await db
    .select({
      parentId: networkDeviceRelations.parentId,
      childId: networkDeviceRelations.childId,
    })
    .from(networkDeviceRelations)
    .where(eq(networkDeviceRelations.relationType, "hierarchy"));

  const childToParentMap = new Map(
    hierarchyRelations.map((r) => [r.childId, r.parentId]),
  );

  const cables: CableRouteSegment[] = [];
  const connectedDeviceIds = new Set<string>();

  // 1. Ekstrak jalur kabel antar perangkat infrastruktur (Explicit Parent)
  for (const infra of infraList) {
    const parentId =
      childToParentMap.get(infra.id) || // networkDeviceRelations (sumber utama)
      infra.parentId || // kolom parentId lama (fallback)
      (infra.details?.parentId as string | undefined) ||
      (infra.details?.parentOdc as string | undefined) ||
      (infra.details?.parentRoot as string | undefined);

    if (!parentId) continue;

    const parent = infraList.find(
      (p) =>
        p.id === parentId || p.name.toLowerCase() === parentId.toLowerCase(),
    );

    if (parent && parent.id !== infra.id) {
      let type: "backbone" | "feeder" | "distribution" = "distribution";
      let coreCapacity = 8;

      if (
        (parent.type === "router" || parent.type === "olt") &&
        (infra.type === "odc" || infra.type === "olt")
      ) {
        type = "backbone";
        coreCapacity = 48;
      } else if (
        (parent.type === "odc" || parent.type === "olt") &&
        infra.type === "odp"
      ) {
        type = "feeder";
        coreCapacity = 16;
      } else if (infra.type === "pole") {
        type = "distribution";
        coreCapacity = 4;
      }

      const customWaypoints = infra.details?.cableWaypoints as
        [number, number][] | undefined;
      const path = generateRoadBendedPolyline(
        [parent.latitude, parent.longitude],
        [infra.latitude, infra.longitude],
        customWaypoints,
      );
      const distMeters = calculatePolylineTotalMeters(path);

      const style = resolveCableCapacityStyle({
        coreCapacity,
        type,
        status: infra.status === "active" ? "active" : "offline",
      });

      cables.push({
        id: `cable-infra-${parent.id}-${infra.id}`,
        name: `${type.toUpperCase()}: ${parent.name} ➔ ${infra.name}`,
        type,
        sourceId: parent.id,
        sourceName: parent.name,
        sourceType: parent.type,
        targetId: infra.id,
        targetName: infra.name,
        targetType: infra.type,
        coreCapacity,
        status: infra.status === "active" ? "active" : "offline",
        estimatedLengthMeters: distMeters,
        coordinates: path,
        color: style.color,
        baseWeight: style.baseWeight,
      });

      connectedDeviceIds.add(infra.id);
    }
  }

  // 2. Hubungkan perangkat yang belum memiliki induk eksplisit (Smart Fallback Topology)
  const routerNode = infraList.find((i) => i.type === "router");
  const oltNode = infraList.find((i) => i.type === "olt");
  const odcNodes = infraList.filter((i) => i.type === "odc");
  const odpNodes = infraList.filter((i) => i.type === "odp");

  if (routerNode && oltNode && !connectedDeviceIds.has(oltNode.id)) {
    const distMeters = calculateHaversineDistanceMeters(
      routerNode.latitude,
      routerNode.longitude,
      oltNode.latitude,
      oltNode.longitude,
    );
    cables.push({
      id: "cable-backbone-core-olt",
      name: `BACKBONE: ${routerNode.name} ➔ ${oltNode.name}`,
      type: "backbone",
      sourceId: routerNode.id,
      sourceName: routerNode.name,
      sourceType: routerNode.type,
      targetId: oltNode.id,
      targetName: oltNode.name,
      targetType: oltNode.type,
      coreCapacity: 48,
      status: "active",
      estimatedLengthMeters: distMeters,
      coordinates: [
        [routerNode.latitude, routerNode.longitude],
        [oltNode.latitude, oltNode.longitude],
      ],
    });
    connectedDeviceIds.add(oltNode.id);
  }

  for (const odc of odcNodes) {
    if (!connectedDeviceIds.has(odc.id)) {
      const rootParent = oltNode || routerNode;
      if (rootParent) {
        const distMeters = calculateHaversineDistanceMeters(
          rootParent.latitude,
          rootParent.longitude,
          odc.latitude,
          odc.longitude,
        );
        cables.push({
          id: `cable-backbone-odc-${odc.id}`,
          name: `FEEDER UTAMA: ${rootParent.name} ➔ ${odc.name}`,
          type: "backbone",
          sourceId: rootParent.id,
          sourceName: rootParent.name,
          sourceType: rootParent.type,
          targetId: odc.id,
          targetName: odc.name,
          targetType: odc.type,
          coreCapacity: 24,
          status: odc.status === "active" ? "active" : "offline",
          estimatedLengthMeters: distMeters,
          coordinates: [
            [rootParent.latitude, rootParent.longitude],
            [odc.latitude, odc.longitude],
          ],
        });
        connectedDeviceIds.add(odc.id);
      }
    }
  }

  for (const odp of odpNodes) {
    if (!connectedDeviceIds.has(odp.id)) {
      let parentCandidate = odcNodes[0] || oltNode || routerNode;
      if (odcNodes.length > 1) {
        let minDist = Infinity;
        for (const odc of odcNodes) {
          const d =
            Math.pow(odc.latitude - odp.latitude, 2) +
            Math.pow(odc.longitude - odp.longitude, 2);
          if (d < minDist) {
            minDist = d;
            parentCandidate = odc;
          }
        }
      }

      if (parentCandidate) {
        const distMeters = calculateHaversineDistanceMeters(
          parentCandidate.latitude,
          parentCandidate.longitude,
          odp.latitude,
          odp.longitude,
        );
        cables.push({
          id: `cable-feeder-odp-${odp.id}`,
          name: `DISTRIBUSI: ${parentCandidate.name} ➔ ${odp.name}`,
          type: "feeder",
          sourceId: parentCandidate.id,
          sourceName: parentCandidate.name,
          sourceType: parentCandidate.type,
          targetId: odp.id,
          targetName: odp.name,
          targetType: odp.type,
          coreCapacity: 16,
          status: odp.status === "active" ? "active" : "offline",
          estimatedLengthMeters: distMeters,
          coordinates: [
            [parentCandidate.latitude, parentCandidate.longitude],
            [odp.latitude, odp.longitude],
          ],
        });
        connectedDeviceIds.add(odp.id);
      }
    }
  }

  // 3. Ekstrak kabel drop pelanggan nyata (ODP ➔ Pelanggan)
  for (const cust of custList) {
    if (!cust.odpName || cust.latitude === null || cust.longitude === null)
      continue;

    const odp = infraList.find(
      (i) =>
        i.name.toLowerCase() === cust.odpName?.toLowerCase() ||
        i.id === cust.odpName,
    );

    if (odp) {
      const path = generateRoadBendedPolyline(
        [odp.latitude, odp.longitude],
        [cust.latitude, cust.longitude],
      );
      const distMeters = calculatePolylineTotalMeters(path);

      const opticalPower = cust.opticalPower;
      const isWarning = opticalPower !== null && opticalPower <= -25;
      const status: "active" | "warning" | "offline" = !cust.isOnline
        ? "offline"
        : isWarning
          ? "warning"
          : "active";

      const style = resolveCableCapacityStyle({
        coreCapacity: 2,
        type: "drop",
        status,
      });

      cables.push({
        id: `cable-drop-${cust.id}`,
        name: `DROP FIBER: ${odp.name} ➔ ${cust.name}`,
        type: "drop",
        sourceId: odp.id,
        sourceName: odp.name,
        sourceType: "odp",
        targetId: cust.id,
        targetName: cust.name,
        targetType: "customer",
        coreCapacity: 2, // Drop cable standar 1-2 core
        status,
        estimatedLengthMeters: distMeters,
        coordinates: path,
        color: style.color,
        baseWeight: style.baseWeight,
      });
    }
  }

  // 4. Kalkulasi ringkasan metrik
  let totalLength = 0;
  let backboneCount = 0;
  let feederCount = 0;
  let distributionCount = 0;
  let dropCount = 0;
  let totalCores = 0;
  let activeCount = 0;
  let warningCount = 0;
  let offlineCount = 0;

  for (const c of cables) {
    totalLength += c.estimatedLengthMeters;
    totalCores += c.coreCapacity;

    if (c.type === "backbone") backboneCount++;
    else if (c.type === "feeder") feederCount++;
    else if (c.type === "distribution") distributionCount++;
    else if (c.type === "drop") dropCount++;

    if (c.status === "active") activeCount++;
    else if (c.status === "warning") warningCount++;
    else offlineCount++;
  }

  const summary: CableMapSummary = {
    totalSegments: cables.length,
    totalEstimatedLengthMeters: totalLength,
    totalBackboneSegments: backboneCount,
    totalFeederSegments: feederCount,
    totalDistributionSegments: distributionCount,
    totalDropSegments: dropCount,
    totalCoreCapacity: totalCores,
    activeSegments: activeCount,
    warningSegments: warningCount,
    offlineSegments: offlineCount,
  };

  return {
    cables,
    summary,
    networkMapData: baseMapData,
    dataSource: baseMapData.dataSource,
  };
}

/**
 * Menyimpan konfigurasi titik belokan (waypoints) kustom jalur kabel ke database.
 */
export async function saveCableWaypoints(
  input: SaveCableWaypointsInput,
): Promise<{
  success: boolean;
  cableId: string;
  waypoints: [number, number][];
  totalMeters: number;
}> {
  const { cableId, targetId, waypoints } = input;
  const totalMeters = calculatePolylineTotalMeters(waypoints);

  // Jika targetId merujuk ke network_infrastructure, simpan ke details.cableWaypoints
  if (targetId && !cableId.startsWith("cable-drop-")) {
    try {
      const rows = await db
        .select({
          id: networkInfrastructure.id,
          details: networkInfrastructure.details,
        })
        .from(networkInfrastructure)
        .where(eq(networkInfrastructure.id, targetId))
        .limit(1);

      if (rows.length > 0) {
        const currentDetails =
          (rows[0].details as Record<string, unknown>) || {};
        await db
          .update(networkInfrastructure)
          .set({
            details: {
              ...currentDetails,
              cableWaypoints: waypoints,
            },
            updatedAt: new Date(),
          })
          .where(eq(networkInfrastructure.id, targetId));
      }
    } catch (err) {
      console.error("[SAVE_CABLE_WAYPOINTS_DB_ERROR]", err);
    }
  }

  return {
    success: true,
    cableId,
    waypoints,
    totalMeters,
  };
}

export type CableLodLevel = "overview" | "regional" | "detail";

/**
 * Menentukan level Level-of-Detail (LOD) berdasarkan level zoom Leaflet:
 * - overview (zoom <= 11): Hanya jalur backbone dan feeder utama kapasitas tinggi
 * - regional (zoom 12 - 14): Backbone, feeder, dan distribusi cabang (drop disembunyikan kecuali bermasalah/disorot)
 * - detail (zoom >= 15): Semua hierarki jalur serat optik sampai kabel drop pelanggan
 */
export function getLodLevelByZoom(zoom: number): CableLodLevel {
  if (zoom <= 11) return "overview";
  if (zoom <= 14) return "regional";
  return "detail";
}

export interface CableFilterOptions {
  zoom?: number;
  type?: string;
  status?: string;
  includeDrop?: boolean;
  bounds?: ResolvedViewportBounds | null;
}

export interface FilterCablesResult {
  filtered: CableRouteSegment[];
  lodLevel: CableLodLevel;
  summary: {
    totalCables: number;
    renderedCables: number;
    filteredByZoom: number;
    backboneCount: number;
    feederCount: number;
    distributionCount: number;
    dropCount: number;
  };
}

/**
 * Menyaring jalur kabel berdasarkan level zoom (LOD) dan batas spasial viewport.
 */
export function filterCablesByZoomAndLod(
  cables: CableRouteSegment[],
  options: CableFilterOptions,
): FilterCablesResult {
  const zoom = options.zoom ?? 15;
  const lodLevel = getLodLevelByZoom(zoom);
  const totalCables = cables.length;

  let filtered = cables;

  // 1. Filter per jenis kabel eksplisit jika bukan "all"
  if (options.type && options.type !== "all") {
    filtered = filtered.filter((c) => c.type === options.type);
  }

  // 2. Filter per status jika bukan "all"
  if (options.status && options.status !== "all") {
    filtered = filtered.filter((c) => c.status === options.status);
  }

  // 3. Level-of-Detail (LOD) berdasarkan level zoom
  filtered = filtered.filter((cable) => {
    // Kabel yang sedang disorot/highlighted selalu tampil
    if (cable.isHighlighted) return true;

    if (lodLevel === "overview") {
      if (cable.type === "backbone") return true;
      if (cable.type === "feeder" && cable.coreCapacity >= 24) return true;
      if (cable.status === "offline" || cable.status === "warning") return true;
      return false;
    }

    if (lodLevel === "regional") {
      if (cable.type === "drop" && !options.includeDrop) {
        // Drop hanya tampil jika offline atau warning
        return cable.status === "offline" || cable.status === "warning";
      }
      return true;
    }

    // detail: tampilkan semua
    return true;
  });

  // 4. Viewport Spatial Bounding Box Culling jika bounds tersedia
  if (options.bounds) {
    const { bufferedMinLat, bufferedMaxLat, bufferedMinLng, bufferedMaxLng } =
      options.bounds;
    filtered = filtered.filter((cable) => {
      if (cable.isHighlighted) return true;
      return cable.coordinates.some(
        ([lat, lng]) =>
          lat >= bufferedMinLat &&
          lat <= bufferedMaxLat &&
          lng >= bufferedMinLng &&
          lng <= bufferedMaxLng,
      );
    });
  }

  const renderedCables = filtered.length;
  const filteredByZoom = totalCables - renderedCables;

  const backboneCount = filtered.filter((c) => c.type === "backbone").length;
  const feederCount = filtered.filter((c) => c.type === "feeder").length;
  const distributionCount = filtered.filter(
    (c) => c.type === "distribution",
  ).length;
  const dropCount = filtered.filter((c) => c.type === "drop").length;

  return {
    filtered,
    lodLevel,
    summary: {
      totalCables,
      renderedCables,
      filteredByZoom,
      backboneCount,
      feederCount,
      distributionCount,
      dropCount,
    },
  };
}

export interface CablesByZoomResult {
  ok: boolean;
  success: boolean;
  zoom: number;
  lodLevel: CableLodLevel;
  cables: CableRouteSegment[];
  summary: FilterCablesResult["summary"];
  dataSource: CableMapData["dataSource"];
}

/**
 * Mengambil jalur kabel jaringan operasional yang dioptimasi untuk level zoom tertentu.
 */
export async function getCablesByZoom(
  query: CableZoomQueryInput,
): Promise<CablesByZoomResult> {
  const baseData = await getCableMapData({ forceMock: query.forceMock });
  const bounds = resolveViewportBounds(query);

  const { filtered, lodLevel, summary } = filterCablesByZoomAndLod(
    baseData.cables,
    {
      zoom: query.zoom,
      type: query.type,
      status: query.status,
      includeDrop: query.includeDrop,
      bounds,
    },
  );

  return {
    ok: true,
    success: true,
    zoom: query.zoom ?? 15,
    lodLevel,
    cables: filtered,
    summary,
    dataSource: baseData.dataSource,
  };
}

export async function deleteCable(
  id: string,
): Promise<{ id: string; deleted: boolean }> {
  if (!id || typeof id !== "string") {
    throw new Error("ID kabel tidak valid.");
  }
  await db.delete(networkCables).where(eq(networkCables.id, id));
  return { id, deleted: true };
}

export async function updateCableColor(
  id: string,
  color: string,
): Promise<{ id: string; color: string }> {
  if (!id) throw new Error("ID kabel tidak valid.");
  await db
    .update(networkCables)
    .set({ color, updatedAt: new Date() })
    .where(eq(networkCables.id, id));
  return { id, color };
}

export async function createCable(input: {
  name: string;
  sourceId: string;
  targetId: string | null;
  cableType: string;
  coreCapacity: number;
  color: string;
  polyline: [number, number][];
}) {
  const lengthMeters = calculatePolylineTotalMeters(input.polyline);
  const [row] = await db
    .insert(networkCables)
    .values({
      name: input.name,
      sourceId: input.sourceId,
      targetId: input.targetId,
      targetType: "infrastructure",
      cableType: input.cableType,
      coreCapacity: input.coreCapacity,
      color: input.color,
      lengthMeters,
      polyline: input.polyline,
      status: "active",
    })
    .returning();
  return row;
}
