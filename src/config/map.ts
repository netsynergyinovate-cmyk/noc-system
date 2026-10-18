export type MapLayerId = "satellite" | "streets" | "topo";

export interface TileProviderConfig {
  id: MapLayerId;
  name: string;
  url: string;
  attribution: string;
  maxNativeZoom: number;
  maxZoom: number;
  subdomains?: string[];
}

export const DEFAULT_MAP_CENTER: [number, number] = [
  Number(process.env.NEXT_PUBLIC_MAP_DEFAULT_LAT) || -2.5786,
  Number(process.env.NEXT_PUBLIC_MAP_DEFAULT_LNG) || 101.2185,
];

export const DEFAULT_MAP_ZOOM = Number(process.env.NEXT_PUBLIC_MAP_DEFAULT_ZOOM) || 14;

export function getTileProviders(): Record<MapLayerId, TileProviderConfig> {
  return {
    satellite: {
      id: "satellite",
      name: "Satelit (Esri)",
      url:
        process.env.NEXT_PUBLIC_MAP_SATELLITE_URL ||
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      attribution:
        process.env.NEXT_PUBLIC_MAP_SATELLITE_ATTRIBUTION ||
        '&copy; <a href="https://www.esri.com/">Esri World Imagery</a>',
      maxNativeZoom: 19,
      maxZoom: 20,
    },
    streets: {
      id: "streets",
      name: "Peta Jalan (OSM)",
      url:
        process.env.NEXT_PUBLIC_MAP_STREETS_URL ||
        "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      attribution:
        process.env.NEXT_PUBLIC_MAP_STREETS_ATTRIBUTION ||
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxNativeZoom: 19,
      maxZoom: 20,
      subdomains: ["a", "b", "c"],
    },
    topo: {
      id: "topo",
      name: "Topografi",
      url:
        process.env.NEXT_PUBLIC_MAP_TOPO_URL ||
        "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
      attribution:
        process.env.NEXT_PUBLIC_MAP_TOPO_ATTRIBUTION ||
        '&copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
      maxNativeZoom: 17,
      maxZoom: 20,
      subdomains: ["a", "b", "c"],
    },
  };
}
