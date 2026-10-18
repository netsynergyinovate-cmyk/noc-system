import "server-only";
import {
  DEFAULT_MAP_CENTER,
  DEFAULT_MAP_ZOOM,
  getTileProviders,
  type MapLayerId,
  type TileProviderConfig,
} from "@/config/map";

export interface MapConfigData {
  defaultCenter: [number, number];
  defaultZoom: number;
  providers: Record<MapLayerId, TileProviderConfig>;
  availableLayers: MapLayerId[];
  operationalArea: {
    name: string;
    center: [number, number];
    defaultZoom: number;
  };
}

export function getMapConfiguration(): MapConfigData {
  const providers = getTileProviders();
  const defaultCenter = DEFAULT_MAP_CENTER;
  const defaultZoom = DEFAULT_MAP_ZOOM;

  return {
    defaultCenter,
    defaultZoom,
    providers,
    availableLayers: Object.keys(providers) as MapLayerId[],
    operationalArea: {
      name: process.env.MAP_AREA_NAME || "Mukomuko & Teras Terunjam",
      center: defaultCenter,
      defaultZoom,
    },
  };
}
