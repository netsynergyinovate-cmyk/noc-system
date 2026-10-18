import {
  MAP_DATA_SOURCE_REGISTRY,
  type MapDataSourceItem,
  getMapDataSourceById,
  getMapDataSourcesSummary,
} from "./map-data-source-registry.ts";

export {
  MAP_DATA_SOURCE_REGISTRY,
  getMapDataSourceById,
  getMapDataSourcesSummary,
  type MapDataSourceItem,
};

export interface DataSourceRegistrySummary {
  totalRegisteredSources: number;
  liveOperationalCount: number;
  sources: readonly MapDataSourceItem[];
}

/**
 * Registri terpadu sumber data operasional peta NOC.
 * Seluruh entitas memetakan tabel fisik PostgreSQL nyata ke rute endpoint API internal.
 */
export const DATA_SOURCE_REGISTRY = {
  map: MAP_DATA_SOURCE_REGISTRY,
  getById: getMapDataSourceById,
  getSummary: getMapDataSourcesSummary,
  getAll: () => MAP_DATA_SOURCE_REGISTRY,
} as const;

/**
 * Mengambil ringkasan seluruh sumber data peta yang terdaftar.
 */
export function getRegisteredMapDataSources(): readonly MapDataSourceItem[] {
  return MAP_DATA_SOURCE_REGISTRY;
}

/**
 * Memeriksa apakah sebuah ID sumber data terdaftar pada data_source_registry.
 */
export function isDataSourceRegistered(id: string): boolean {
  return MAP_DATA_SOURCE_REGISTRY.some((source) => source.id === id);
}

/**
 * Mengambil metadata sumber data berdasarkan nama tabel database PostgreSQL.
 */
export function getDataSourceByTableName(tableName: string): MapDataSourceItem | undefined {
  return MAP_DATA_SOURCE_REGISTRY.find(
    (source) => source.tableName.toLowerCase() === tableName.toLowerCase(),
  );
}
