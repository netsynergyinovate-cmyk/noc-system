import type { LatLngTuple } from "leaflet";

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

export const DEFAULT_MAP_ZOOM =
  Number(process.env.NEXT_PUBLIC_MAP_DEFAULT_ZOOM) || 14;

export function getTileProviders(): Record<MapLayerId, TileProviderConfig> {
  const satelliteUrl =
    process.env.NEXT_PUBLIC_MAP_SATELLITE_URL ||
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
  const satelliteSubdomains = satelliteUrl.includes("{s}")
    ? process.env.NEXT_PUBLIC_MAP_SATELLITE_SUBDOMAINS?.split(",") || [
        "0",
        "1",
        "2",
        "3",
      ]
    : undefined;
  return {
    satellite: {
      id: "satellite",
      name: "Satelit",
      url: satelliteUrl,
      attribution:
        process.env.NEXT_PUBLIC_MAP_SATELLITE_ATTRIBUTION ||
        "&copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community",
      maxNativeZoom: 20,
      maxZoom: 21,
      subdomains: satelliteSubdomains || ["0", "1", "2", "3"],
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

export function getBoundsWithPadding(
  points: LatLngTuple[],
  paddingPercent = 0.1,
): [LatLngTuple, LatLngTuple] | null {
  if (!points || points.length === 0) return null;
  let minLat = points[0][0],
    maxLat = points[0][0],
    minLng = points[0][1],
    maxLng = points[0][1];
  for (const [lat, lng] of points) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  const latSpan = Math.max(maxLat - minLat, 0.005);
  const lngSpan = Math.max(maxLng - minLng, 0.005);
  const padLat = latSpan * paddingPercent;
  const padLng = lngSpan * paddingPercent;
  return [
    [minLat - padLat, minLng - padLng],
    [maxLat + padLat, maxLng + padLng],
  ];
}
