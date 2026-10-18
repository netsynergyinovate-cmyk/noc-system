import type { Metadata } from "next";
import { requireSession } from "@/lib/session";
import {
  getCompleteRealMapData,
  type CompleteRealMapDataResult,
} from "@/services/real-map-data.service";
import {
  getMapDrawingLayers,
  type DrawingLayersResponse,
} from "@/services/map-drawing-layers.service";
import { DrawingLayerMapBoard } from "@/components/map/drawing-layer-map-board";

export const metadata: Metadata = {
  title: "Lapisan Gambar & Anotasi Peta - NOC ISP",
  description:
    "Lapisan gambar dan anotasi kanvas 2D LeaferJS di atas peta jaringan geografis nyata untuk teknisi lapangan, perencanaan ODP, dan catatan insiden.",
};

const FALLBACK_MAP_DATA: CompleteRealMapDataResult = {
  customers: [],
  infrastructure: [],
  cables: [],
  summary: {
    totalCustomers: 0,
    geocodedCustomers: 0,
    unmappedCustomers: 0,
    onlineCustomers: 0,
    offlineCustomers: 0,
    criticalOpticsCount: 0,
    totalDevices: 0,
    totalRouters: 0,
    totalOlts: 0,
    totalOdps: 0,
    totalOdcs: 0,
    totalPoles: 0,
    totalCables: 0,
    totalCableLengthMeters: 0,
  },
  dataSource: {
    provider: "local-fallback",
    isRealData: false,
    registry: [],
    lastSynchronizedAt: new Date().toISOString(),
  },
};

const FALLBACK_DRAWING_LAYERS: DrawingLayersResponse = {
  layers: [],
  summary: {
    totalLayers: 0,
    visibleLayers: 0,
    totalShapes: 0,
  },
  dataSource: {
    provider: "local-fallback",
    isRealData: false,
    lastSynchronizedAt: new Date().toISOString(),
  },
};

export default async function PetaLapisanGambarPage() {
  await requireSession();

  let mapData: CompleteRealMapDataResult = FALLBACK_MAP_DATA;
  let drawingLayers: DrawingLayersResponse = FALLBACK_DRAWING_LAYERS;
  let loadError: string | null = null;

  try {
    const [fetchedMap, fetchedLayers] = await Promise.all([
      getCompleteRealMapData({
        includeCables: true,
        includeHierarchy: false,
      }),
      getMapDrawingLayers(),
    ]);
    mapData = fetchedMap;
    drawingLayers = fetchedLayers;
  } catch (err) {
    loadError =
      err instanceof Error
        ? err.message
        : "Gagal memuat data lapisan gambar dari database PostgreSQL.";
  }

  return (
    <div className="w-full" data-testid="peta-lapisan-gambar-page">
      <DrawingLayerMapBoard
        initialMapData={mapData}
        initialDrawingLayers={drawingLayers}
        initialError={loadError}
      />
    </div>
  );
}
