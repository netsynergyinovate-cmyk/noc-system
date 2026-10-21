import { withApiSession } from "@/lib/api";
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from "@/config/map";
import { ROUTE_SAMPLE_INTERVAL_M, SNAP_TOLERANCE_M } from "@/services/map/adapter";

export const runtime = "nodejs";

// Bawaan per penyedia; URL dapat ditimpa lewat NEXT_PUBLIC_TILE_URL / NEXT_PUBLIC_TILE_URL_STREETS.
// maxNativeZoom = zoom asli tile, di atasnya Leaflet memperbesar tile terakhir (tidak kosong).
const TILE_PRESETS = {
  google: {
    satellite: "https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
    streets: "https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}",
    subdomains: "0123",
    maxNativeZoom: 20,
    attribution:
      'Citra &copy; Google (endpoint tile tidak resmi, dapat diblokir sewaktu-waktu)',
  },
  esri: {
    satellite:
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    streets:
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    subdomains: "",
    maxNativeZoom: 19,
    attribution:
      '&copy; <a href="https://www.esri.com/">Esri</a> &mdash; Sumber: Esri, Maxar, Earthstar Geographics, USGS',
  },
  carto: {
    // Carto tidak punya citra satelit; kedua lapis memakai peta jalan Voyager
    satellite:
      "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    streets:
      "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    subdomains: "abcd",
    maxNativeZoom: 20,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
  osm: {
    // OSM tidak punya citra satelit; kedua lapis memakai peta jalan standar
    satellite: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    streets: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    subdomains: "abc",
    maxNativeZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
} as const;

type TileProvider = keyof typeof TILE_PRESETS;

export function GET(request: Request) {
  return withApiSession(request, async () => {
    const requested = (process.env.NEXT_PUBLIC_TILE_PROVIDER || "google")
      .trim()
      .toLowerCase();
    const provider: TileProvider =
      requested in TILE_PRESETS ? (requested as TileProvider) : "google";
    const preset = TILE_PRESETS[provider];

    return Response.json({
      tileProvider: provider,
      tileUrl: process.env.NEXT_PUBLIC_TILE_URL || preset.satellite,
      streetsTileUrl: process.env.NEXT_PUBLIC_TILE_URL_STREETS || preset.streets,
      tileSubdomains: preset.subdomains,
      tileAttribution: preset.attribution,
      defaultCenter: DEFAULT_MAP_CENTER,
      defaultZoom: DEFAULT_MAP_ZOOM,
      maxNativeZoom: preset.maxNativeZoom,
      maxZoom: 22,
      dataSource: "central-api",
      hasCentralApiKey: true,
      routeSampleIntervalM: ROUTE_SAMPLE_INTERVAL_M,
      snapToleranceM: SNAP_TOLERANCE_M,
    });
  });
}
