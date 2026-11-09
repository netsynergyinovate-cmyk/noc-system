export interface MapDataSourceItem {
  id: string;
  name: string;
  tableName: string;
  primaryKey: string;
  coordinateFields: readonly string[];
  sourceType: "postgresql" | "endpoint";
  endpointPath: string;
  description: string;
  isLiveOperational: boolean;
}

export const MAP_DATA_SOURCE_REGISTRY: readonly MapDataSourceItem[] = [
  {
    id: "customers-geocoded",
    name: "Pelanggan PPPoE Terpetakan",
    tableName: "customers",
    primaryKey: "id",
    coordinateFields: ["latitude", "longitude"],
    sourceType: "postgresql",
    endpointPath: "/api/map/customers",
    description:
      "Data pelanggan aktif PPPoE dengan koordinat GPS rumah/lokasi terpasang.",
    isLiveOperational: true,
  },
  {
    id: "network-infrastructure",
    name: "Infrastruktur Fisik Jaringan",
    tableName: "network_infrastructure",
    primaryKey: "id",
    coordinateFields: ["latitude", "longitude"],
    sourceType: "postgresql",
    endpointPath: "/api/map/infrastructure",
    description:
      "Peletakan fisik Core Router, OLT HSGQ, ODC, ODP, dan Tiang di lapangan.",
    isLiveOperational: true,
  },
  {
    id: "network-cables",
    name: "Bentangan Jalur Kabel Serat Optik",
    tableName: "network_cables",
    primaryKey: "id",
    coordinateFields: ["polyline"],
    sourceType: "postgresql",
    endpointPath: "/api/map/cables",
    description:
      "Polilin jalur kabel distribusi, feeder, dan drop optic menyusuri lekukan jalan nyata.",
    isLiveOperational: true,
  },
  {
    id: "network-device-relations",
    name: "Relasi Bertingkat Induk-Anak",
    tableName: "network_device_relations",
    primaryKey: "id",
    coordinateFields: ["parent_id", "child_id"],
    sourceType: "postgresql",
    endpointPath: "/api/devices/relations",
    description: "Struktur silsilah kepemilikan Core ➔ ODC ➔ ODP ➔ Pelanggan.",
    isLiveOperational: true,
  },
] as const;

export function getMapDataSourceById(
  id: string,
): MapDataSourceItem | undefined {
  return MAP_DATA_SOURCE_REGISTRY.find((item) => item.id === id);
}

export function getMapDataSourcesSummary() {
  return {
    totalSources: MAP_DATA_SOURCE_REGISTRY.length,
    liveOperationalSources: MAP_DATA_SOURCE_REGISTRY.filter(
      (s) => s.isLiveOperational,
    ).length,
    registeredTables: MAP_DATA_SOURCE_REGISTRY.map((s) => s.tableName),
    registeredEndpoints: MAP_DATA_SOURCE_REGISTRY.map((s) => s.endpointPath),
  };
}
