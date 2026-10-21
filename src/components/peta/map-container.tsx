"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import "leaflet/dist/leaflet.css";
import type * as L from "leaflet";
import {
  CableRoute,
  CableSegment,
  HierarchyTreeNode,
  MapCustomer,
  MapDataResponse,
  MapDevice,
  MapLayerItem,
} from "@/services/map/types";
import { CustomerPanel } from "./customer-panel";
import { DevicePanel } from "./device-panel";
import { RoutePanel, type RouteUpdate } from "./route-panel";
import { HierarchyTreePanel } from "./hierarchy-tree-panel";
import { AnnotationPanel, AnnotationToolType } from "./annotation-panel";
import { MapLegends } from "./map-legends";
import { AlertWidget } from "./alert-widget";
import { capacityUse } from "@/services/map/loss-budget";
import { MapControls } from "./map-controls";
import {
  PlacementOverlay,
  PlacementModeType,
  PlacementRouteOption,
} from "./placement-overlay";
import { RouteDrawingModal } from "./route-drawing-modal";
import { QuickGuideModal } from "./quick-guide-modal";
import { parseCoordinates } from "./coords";
import { SegmentDrawingBar, SnapPreview } from "./segment-drawing-bar";
import {
  buildHierarchyTree,
  chainEndDeviceId,
  routeChainDeviceIds,
} from "@/services/map/topology";
import {
  DEVICE_TYPE_STYLE,
  capacityStyle,
  connectionStyle,
  markerIconHtml,
  MARKER_ALERT,
} from "./map-style";
import {
  AlertCircle,
  Loader2,
  Plus,
  Minus,
  Locate,
  X,
  Info,
  Undo2,
} from "lucide-react";

interface MapConfig {
  tileProvider: string;
  tileUrl: string;
  streetsTileUrl: string;
  tileSubdomains: string;
  tileAttribution: string;
  defaultCenter: [number, number];
  defaultZoom: number;
  maxNativeZoom: number;
  maxZoom: number;
  dataSource: "central-api" | "local-db";
  hasCentralApiKey: boolean;
  routeSampleIntervalM: number;
  snapToleranceM: number;
}

// Seluruh URL & atribusi tile datang dari /api/peta/config (env), bukan ditulis di komponen
function getTileLayerConfig(
  config: MapConfig,
  baseLayer: "satellite" | "streets",
) {
  return {
    url: baseLayer === "streets" ? config.streetsTileUrl : config.tileUrl,
    attribution: config.tileAttribution,
    subdomains: config.tileSubdomains,
    maxNativeZoom: config.maxNativeZoom,
    maxZoom: config.maxZoom,
    provider: config.tileProvider,
  };
}

type PanelUrlParams = {
  customer?: string | null;
  panel?: string | null;
  device?: string | null;
  route?: string | null;
};

// Mulai zoom ini pelanggan tampil sebagai ikon rumah; di bawahnya titik kanvas ringan
const DETAIL_ZOOM = 15;

const CUSTOMER_SUB_PANELS =["detail", "cpe", "onu", "billing"] as const;

// 0 = tanpa panel, 1 = panel utama, 2 = panel bertumpuk (sub-panel pelanggan)
function panelDepth(p: PanelUrlParams): number {
  if (p.customer) return p.panel && p.panel !== "detail" ? 2 : 1;
  return p.device || p.route ? 1 : 0;
}

function buildPanelUrl(p: PanelUrlParams): string {
  const url = new URL(window.location.href);
  for (const key of ["customer", "panel", "device", "route"] as const) {
    const value = p[key];
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  return url.toString();
}

const hasCoords = (p: { latitude: number | null; longitude: number | null }) =>
  Number.isFinite(p.latitude) && Number.isFinite(p.longitude);

function customerMatches(
  c: MapCustomer,
  query: string,
  status: string,
  region: string,
): boolean {
  if (!hasCoords(c)) return false;
  const q = query.toLowerCase();
  if (
    q &&
    ![c.name, c.customerNumber, c.onuSerial].some((v) =>
      v?.toLowerCase().includes(q),
    )
  ) {
    return false;
  }
  if (status && c.status !== status) return false;
  if (region && c.region !== region) return false;
  return true;
}

// Jalur yang ujung atau salah satu segmennya masuk ke / keluar dari perangkat
function routesTouchingDevice(
  data: MapDataResponse | null,
  deviceId: string,
  end: "fromDeviceId" | "toDeviceId",
): CableRoute[] {
  if (!data) return [];
  return data.routes.filter(
    (r) =>
      r[end] === deviceId ||
      data.segments.some((s) => s.routeId === r.id && s[end] === deviceId),
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readApiJson(res: Response): Promise<any> {
  const json = await res.json().catch(() => null);
  if (json === null && !res.ok) {
    return {
      error: {
        code: res.status === 504 ? "TIMEOUT" : "UPSTREAM_ERROR",
        message: `Server peta tidak merespons dengan benar (status ${res.status}). Coba lagi.`,
      },
    };
  }
  return json;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function MapContainer() {
  const mapElementRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const leafletRef = useRef<typeof L | null>(null);

  // Layer groups refs
  const baseTileLayerRef = useRef<L.TileLayer | null>(null);
  const customersLayerRef = useRef<L.LayerGroup | null>(null);
  const devicesLayerRef = useRef<L.LayerGroup | null>(null);
  const routesLayerRef = useRef<L.LayerGroup | null>(null);
  // Peta memakai kanvas; garis beranimasi butuh path SVG agar CSS stroke-dashoffset berlaku
  const flowRendererRef = useRef<L.Renderer | null>(null);
  const hierarchyLinesLayerRef = useRef<L.LayerGroup | null>(null);
  const distanceMarkersLayerRef = useRef<L.LayerGroup | null>(null);
  const placementMarkerRef = useRef<L.Marker | null>(null);
  const drawingPolylineRef = useRef<L.Polyline | null>(null);
  const drawingPreviewLayerRef = useRef<L.LayerGroup | null>(null);
  const coordEditMarkerRef = useRef<L.Marker | null>(null);
  const annotationsLayerRef = useRef<L.LayerGroup | null>(null);
  const annotationPreviewLayerRef = useRef<L.LayerGroup | null>(null);
  // Key (mis. "customer:ID") entitas yang koordinatnya sedang diubah; null jika tidak aktif
  const coordEditKeyRef = useRef<string | null>(null);

  // Map state
  const [loading, setLoading] = useState(true);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  // Kode galat dari /api/peta/data (AUTH_FAILED, CONFIG_ERROR, RATE_LIMIT, TIMEOUT, ...)
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [tileErrorNotice, setTileErrorNotice] = useState<string | null>(null);
  const [mapConfig, setMapConfig] = useState<MapConfig | null>(null);
  const [mapData, setMapData] = useState<MapDataResponse | null>(null);
  const [layers, setLayers] = useState<MapLayerItem[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [emptyNoticeDismissed, setEmptyNoticeDismissed] = useState(false);
  // Naik setiap geser/zoom selesai; memicu render ulang penanda jarak
  const [viewTick, setViewTick] = useState(0);
  const [detailZoom, setDetailZoom] = useState(false);

  // Filters & search
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [regionFilter, setRegionFilter] = useState("");
  const [baseLayer, setBaseLayer] = useState<"satellite" | "streets">("satellite");
  const [visibleLayers, setVisibleLayers] = useState({
    customers: true,
    devices: true,
    routes: true,
    hierarchyLines: true,
    annotations: true,
  });

  // Panel state (Max 1 primary panel)
  const [selectedCustomer, setSelectedCustomer] = useState<MapCustomer | null>(null);
  const [customerSubPanel, setCustomerSubPanel] = useState<
    "detail" | "cpe" | "onu" | "billing" | null
  >(null);
  const [selectedDevice, setSelectedDevice] = useState<MapDevice | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<CableRoute | null>(null);
  const [showHierarchyTree, setShowHierarchyTree] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [showAnnotationPanel, setShowAnnotationPanel] = useState(false);

  // Annotation Drawing mode state
  const [annotationTool, setAnnotationTool] = useState<AnnotationToolType>(null);
  const [annotationPoints, setAnnotationPoints] = useState<[number, number][]>([]);
  const annotationToolRef = useRef<AnnotationToolType>(null);
  useEffect(() => {
    annotationToolRef.current = annotationTool;
  }, [annotationTool]);

  // Placement mode state
  const [placementMode, setPlacementMode] = useState<PlacementModeType>(null);
  const [placementCoords, setPlacementCoords] = useState<{
    lat: number;
    lng: number;
  } | null>(null);

  // Cable Drawing mode state
  const [isCreatingRouteModal, setIsCreatingRouteModal] = useState(false);
  const [drawingRoute, setDrawingRoute] = useState<CableRoute | null>(null);
  const [drawingPoints, setDrawingPoints] = useState<[number, number][]>([]);
  const [editingSegment, setEditingSegment] = useState<CableSegment | null>(null);
  const [drawingFrom, setDrawingFrom] = useState("");
  const [placementRouteId, setPlacementRouteId] = useState("");
  const [placementOdpId, setPlacementOdpId] = useState("");
  const [drawingTarget, setDrawingTarget] = useState("");
  const [snapPreview, setSnapPreview] = useState<SnapPreview | null>(null);
  const [savingSegment, setSavingSegment] = useState(false);
  const [segmentError, setSegmentError] = useState<string | null>(null);
  // Mode titik ODP: tiap klik = perangkat baru, garis berangkat dari ujung rantai (tak perlu diklik)
  const odpMode =
    !!drawingRoute && !editingSegment && drawingTarget.startsWith("new:");
  const origin = odpMode
    ? mapData?.devices.find((d) => d.id === drawingFrom)
    : undefined;
  const originLat = origin?.latitude;
  const originLng = origin?.longitude;
  const drawingPath = useMemo<[number, number][]>(
    () =>
      originLat !== undefined && originLng !== undefined
        ? [[originLat, originLng], ...drawingPoints]
        : drawingPoints,
    [originLat, originLng, drawingPoints],
  );
  const drawingKey = JSON.stringify(drawingPath);
  // Pratinjau hanya berlaku untuk titik yang sedang tampil
  const activeSnapPreview =
    drawingRoute && snapPreview?.key === drawingKey ? snapPreview : null;

  // Draft koordinat untuk entitas terpilih (dibagi dua arah: form panel <-> peta)
  const [coordDraftState, setCoordDraftState] = useState<{
    key: string;
    lat: string;
    lng: string;
  } | null>(null);
  const editKey = selectedCustomer
    ? `customer:${selectedCustomer.id}`
    : selectedDevice
      ? `device:${selectedDevice.id}`
      : null;
  const [prevEditKey, setPrevEditKey] = useState(editKey);
  if (prevEditKey !== editKey) {
    // Pilihan berganti/ditutup: buang draft lama
    setPrevEditKey(editKey);
    setCoordDraftState(null);
  }
  const activeDraft =
    coordDraftState && coordDraftState.key === editKey ? coordDraftState : null;
  const activeDraftLat = activeDraft?.lat ?? null;
  const activeDraftLng = activeDraft?.lng ?? null;

  // Refs untuk mode interaktif (hindari re-init Leaflet berkali-kali)
  const baseLayerRef = useRef(baseLayer);
  const placementModeRef = useRef<PlacementModeType>(null);
  const drawingRouteRef = useRef<CableRoute | null>(null);

  useEffect(() => {
    baseLayerRef.current = baseLayer;
  }, [baseLayer]);

  useEffect(() => {
    placementModeRef.current = placementMode;
  }, [placementMode]);

  useEffect(() => {
    drawingRouteRef.current = drawingRoute;
  }, [drawingRoute]);

  useEffect(() => {
    coordEditKeyRef.current = activeDraftLat !== null ? editKey : null;
  }, [activeDraftLat, editKey]);

  // 1. Sinkronisasi status URL Query String & PopState
  // Satu entri riwayat per lapis panel: Back menutup lapis teratas, bukan pindah dokumen
  const panelDepthRef = useRef(0);
  const pendingUrlRef = useRef<{ url: string; depth: number } | null>(null);
  const mapDataRef = useRef<MapDataResponse | null>(null);

  useEffect(() => {
    mapDataRef.current = mapData;
  }, [mapData]);

  const syncUrlState = useCallback((params: PanelUrlParams) => {
    if (typeof window === "undefined") return;
    const url = buildPanelUrl(params);
    const current = panelDepthRef.current;
    const target = panelDepth(params);
    panelDepthRef.current = target;

    if (target < current) {
      // Mundur ke entri lapis target; URL-nya diselaraskan saat popstate tiba
      pendingUrlRef.current = { url, depth: target };
      window.history.go(target - current);
      return;
    }
    if (target === current) {
      window.history.replaceState({ mapPanelDepth: target }, "", url);
      return;
    }
    if (target === 2 && current === 0) {
      window.history.pushState(
        { mapPanelDepth: 1 },
        "",
        buildPanelUrl({ customer: params.customer, panel: "detail" }),
      );
    }
    window.history.pushState({ mapPanelDepth: target }, "", url);
  }, []);

  // Terapkan penanda URL ke panel; nilai/ID tak dikenal diabaikan
  const applyUrlToPanels = useCallback(
    (data: MapDataResponse | null): PanelUrlParams => {
      const params = new URL(window.location.href).searchParams;
      const customerId = params.get("customer");
      const deviceId = params.get("device");
      const routeId = params.get("route");
      const customer = customerId
        ? (data?.customers.find((c) => c.id === customerId) ?? null)
        : null;
      const device =
        !customer && deviceId
          ? (data?.devices.find((d) => d.id === deviceId) ?? null)
          : null;
      const route =
        !customer && !device && routeId
          ? (data?.routes.find((r) => r.id === routeId) ?? null)
          : null;
      const panelParam = params.get("panel");
      const subPanel = customer
        ? (CUSTOMER_SUB_PANELS.find((p) => p === panelParam) ?? "detail")
        : null;

      setSelectedCustomer(customer);
      setCustomerSubPanel(subPanel);
      setSelectedDevice(device);
      setSelectedRoute(route);
      if (customer || device || route) {
        setShowHierarchyTree(false);
        setShowAnnotationPanel(false);
        setAnnotationTool(null);
        setAnnotationPoints([]);
      }

      return {
        customer: customer?.id,
        panel: subPanel,
        device: device?.id,
        route: route?.id,
      };
    },
    [],
  );

  // Penanganan tombol Back/Forward peramban (popstate)
  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      const pending = pendingUrlRef.current;
      if (pending) {
        // Panel sudah ditutup oleh UI; samakan URL entri hasil mundur
        pendingUrlRef.current = null;
        panelDepthRef.current = pending.depth;
        window.history.replaceState(
          { mapPanelDepth: pending.depth },
          "",
          pending.url,
        );
        return;
      }
      panelDepthRef.current = Number(e.state?.mapPanelDepth) || 0;
      applyUrlToPanels(mapDataRef.current);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [applyUrlToPanels]);

  // Panel samping yang terbuka; hanya satu dari ini atau dropdown toolbar yang boleh terbuka
  const openPanelKey = selectedCustomer
    ? `customer:${selectedCustomer.id}`
    : selectedDevice
      ? `device:${selectedDevice.id}`
      : selectedRoute
        ? `route:${selectedRoute.id}`
        : showHierarchyTree
          ? "tree"
          : showAnnotationPanel
            ? "annotation"
            : "";

  // Panel detail (pelanggan/perangkat/jalur) ditutup saat panel/menu lain dibuka
  const closeDetailPanels = useCallback(() => {
    if (!selectedCustomer && !selectedDevice && !selectedRoute) return;
    setSelectedCustomer(null);
    setCustomerSubPanel(null);
    setSelectedDevice(null);
    setSelectedRoute(null);
    syncUrlState({});
  }, [selectedCustomer, selectedDevice, selectedRoute, syncUrlState]);

  // Dropdown toolbar dibuka: tutup semua panel samping
  const closeSidePanels = useCallback(() => {
    closeDetailPanels();
    setShowHierarchyTree(false);
    setShowAnnotationPanel(false);
    setAnnotationTool(null);
    setAnnotationPoints([]);
  }, [closeDetailPanels]);

  // Tutup panel teratas (lapis kedua dulu); false bila tidak ada panel terbuka
  const closeTopPanel = useCallback((): boolean => {
    if (selectedCustomer && customerSubPanel && customerSubPanel !== "detail") {
      setCustomerSubPanel("detail");
      syncUrlState({ customer: selectedCustomer.id, panel: "detail" });
    } else if (selectedCustomer) {
      setSelectedCustomer(null);
      setCustomerSubPanel(null);
      syncUrlState({});
    } else if (selectedDevice) {
      setSelectedDevice(null);
      syncUrlState({});
    } else if (selectedRoute) {
      setSelectedRoute(null);
      syncUrlState({});
    } else if (showHierarchyTree) {
      setShowHierarchyTree(false);
    } else if (showAnnotationPanel) {
      if (annotationTool) {
        setAnnotationTool(null);
        setAnnotationPoints([]);
      } else {
        setShowAnnotationPanel(false);
      }
    } else {
      return false;
    }
    return true;
  }, [
    customerSubPanel,
    selectedCustomer,
    selectedDevice,
    selectedRoute,
    showHierarchyTree,
    showAnnotationPanel,
    annotationTool,
    syncUrlState,
  ]);

  // Dipakai handler klik peta Leaflet yang hanya didaftarkan sekali
  const closeTopPanelRef = useRef(closeTopPanel);
  useEffect(() => {
    closeTopPanelRef.current = closeTopPanel;
  }, [closeTopPanel]);

  // Penanganan tombol ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || closeTopPanel()) return;
      if (placementMode) {
        setPlacementMode(null);
        setPlacementCoords(null);
      } else if (drawingRoute) {
        setDrawingRoute(null);
        setDrawingPoints([]);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeTopPanel, placementMode, drawingRoute]);

  // 2. Muat konfigurasi peta dan data dari backend
  useEffect(() => {
    let ignore = false;

    async function initMapData() {
      try {
        const configRes = await fetch("/api/peta/config");
        if (!configRes.ok) throw new Error("Gagal mengambil konfigurasi peta.");
        const configJson: MapConfig = await configRes.json();
        if (!ignore) setMapConfig(configJson);

        const dataRes = await fetch("/api/peta/data");
        const dataJson = await readApiJson(dataRes);

        if (!ignore) {
          if (!dataRes.ok) {
            setErrorNotice(
              dataJson?.error?.message ||
                "Gagal memuat data dari sumber backend.",
            );
            setErrorCode(dataJson?.error?.code ?? null);
          } else {
            setMapData(dataJson.data);
            // Buka panel dari penanda URL (bookmark); entri awal jadi dasar tanpa panel
            const restored = applyUrlToPanels(dataJson.data);
            window.history.replaceState(
              { mapPanelDepth: 0 },
              "",
              buildPanelUrl({}),
            );
            panelDepthRef.current = 0;
            syncUrlState(restored);
          }
        }

        const layersRes = await fetch("/api/peta/layers");
        if (layersRes.ok && !ignore) {
          const layersJson = await layersRes.json();
          setLayers(layersJson.data || []);
        }
      } catch (err: unknown) {
        if (!ignore) {
          setErrorNotice(
            err instanceof Error ? err.message : "Kesalahan koneksi data peta.",
          );
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    void initMapData();

    return () => {
      ignore = true;
    };
  }, [applyUrlToPanels, syncUrlState]);

  // Refresh daftar lapisan anotasi
  const handleRefreshLayers = useCallback(async () => {
    try {
      const res = await fetch("/api/peta/layers");
      if (res.ok) {
        const json = await res.json();
        setLayers(json.data || []);
      }
    } catch {
      // Abaikan kegagalan jaringan di latar belakang
    }
  }, []);

  // Refresh data secara manual/otomatis di background tanpa mereset view peta
  const handleRefreshData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const dataRes = await fetch("/api/peta/data");
      const dataJson = await readApiJson(dataRes);
      if (!dataRes.ok) {
        setErrorNotice(dataJson?.error?.message || "Gagal menyegarkan data.");
        setErrorCode(dataJson?.error?.code ?? null);
      } else {
        setErrorNotice(null);
        setErrorCode(null);
        setMapData(dataJson.data);
        setSelectedCustomer((prev) => {
          if (!prev) return null;
          return (
            dataJson.data?.customers?.find(
              (c: MapCustomer) => c.id === prev.id,
            ) ?? prev
          );
        });
        setSelectedDevice((prev) => {
          if (!prev) return null;
          return (
            dataJson.data?.devices?.find((d: MapDevice) => d.id === prev.id) ??
            prev
          );
        });
        setSelectedRoute((prev) => {
          if (!prev) return null;
          return (
            dataJson.data?.routes?.find(
              (r: CableRoute) => r.id === prev.id,
            ) ?? prev
          );
        });
      }

      await handleRefreshLayers();
    } catch (err: unknown) {
      setErrorNotice(
        err instanceof Error ? err.message : "Gagal menyegarkan data peta.",
      );
    } finally {
      setIsRefreshing(false);
    }
  }, [handleRefreshLayers]);

  // Undo: tumpukan id aksi tulis milik sesi ini; server memulihkan baris sebelum aksi itu
  const undoStackRef = useRef<string[]>([]);
  const [undoCount, setUndoCount] = useState(0);
  const [undoNotice, setUndoNotice] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);
  const pushUndo = useCallback((id: unknown) => {
    if (typeof id !== "string") return;
    undoStackRef.current.push(id);
    setUndoCount(undoStackRef.current.length);
  }, []);

  const handleUndo = useCallback(async () => {
    // Saat menggambar, Ctrl+Z hanya menghapus titik terakhir yang belum disimpan
    if (drawingRoute && drawingPoints.length > 0) {
      setDrawingPoints((prev) => prev.slice(0, -1));
      return;
    }
    const id = undoStackRef.current.pop();
    setUndoCount(undoStackRef.current.length);
    if (!id || undoing) return;
    setUndoing(true);
    try {
      const res = await fetch(`/api/peta/undo/${id}`, { method: "POST" });
      const json = await readApiJson(res);
      if (!res.ok) throw new Error(json?.error?.message || "Gagal membatalkan aksi.");
      // Panel/mode gambar bisa menunjuk entitas yang baru saja dihapus/dipulihkan, jadi ditutup
      setDrawingRoute(null);
      setSelectedCustomer(null);
      setSelectedDevice(null);
      setSelectedRoute(null);
      setCoordDraftState(null);
      syncUrlState({});
      await handleRefreshData();
      setUndoNotice(`Dibatalkan: ${json.data.label}`);
    } catch (err: unknown) {
      setUndoNotice(err instanceof Error ? err.message : "Gagal membatalkan aksi.");
    } finally {
      setUndoing(false);
    }
  }, [drawingRoute, drawingPoints.length, undoing, syncUrlState, handleRefreshData]);

  // Ctrl+Z / Cmd+Z; di dalam kolom isian dibiarkan untuk undo teks bawaan
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== "z") return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable=true]")) return;
      e.preventDefault();
      void handleUndo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleUndo]);

  useEffect(() => {
    if (!undoNotice) return;
    const t = setTimeout(() => setUndoNotice(null), 4000);
    return () => clearTimeout(t);
  }, [undoNotice]);

  // Kunci ditolak / belum dikonfigurasi: hentikan auto-refresh, hanya "Coba lagi" manual
  const isAuthError = errorCode === "AUTH_FAILED" || errorCode === "CONFIG_ERROR";
  const hierarchyTreeData = useMemo<HierarchyTreeNode[]>(
    () =>
      mapData ? buildHierarchyTree(mapData.devices, mapData.customers) : [],
    [mapData],
  );
  // Tangguhkan auto-refresh saat interaksi penempatan / gambar rute / edit koordinat / gambar anotasi
  const isAutoRefreshPaused = Boolean(
    placementMode !== null ||
      drawingRoute !== null ||
      activeDraftLat !== null ||
      annotationTool !== null,
  );
  const autoRefreshStatus: "active" | "paused" | "disabled" = isAuthError
    ? "disabled"
    : isAutoRefreshPaused
      ? "paused"
      : "active";

  // Auto-refresh interval 60 detik saat peta aktif
  useEffect(() => {
    if (loading || isAuthError || isAutoRefreshPaused) return;

    const intervalId = setInterval(() => {
      void handleRefreshData();
    }, 60000);

    return () => clearInterval(intervalId);
  }, [loading, isAuthError, isAutoRefreshPaused, handleRefreshData]);

  // Evaluasi status data jaringan kosong dari backend
  const isEmptyData = Boolean(
    !loading &&
      !errorNotice &&
      mapData &&
      mapData.customers.length === 0 &&
      mapData.devices.length === 0,
  );

  // Daftar hasil cari: satu-satunya jalan membuka pelanggan yang belum punya koordinat
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q.length < 2 || !mapData) return [];
    const devices = mapData.devices
      .filter((d) => d.name.toLowerCase().includes(q))
      .map((d) => ({
        id: d.id,
        type: d.type,
        name: d.name,
        detail: d.type.toUpperCase(),
        latitude: d.latitude,
        longitude: d.longitude,
      }));
    const customers = mapData.customers
      .filter((c) =>
        [c.name, c.customerNumber, c.onuSerial].some((v) =>
          v?.toLowerCase().includes(q),
        ),
      )
      .map((c) => ({
        id: c.id,
        type: "customer" as const,
        name: c.name,
        detail: hasCoords(c)
          ? c.customerNumber
          : `${c.customerNumber} • belum ada koordinat`,
        latitude: c.latitude ?? undefined,
        longitude: c.longitude ?? undefined,
      }));
    return [...devices, ...customers].slice(0, 8);
  }, [searchQuery, mapData]);
  const unplacedCustomers = mapData
    ? mapData.customers.filter((c) => !hasCoords(c)).length
    : 0;
  const [unplacedNoticeDismissed, setUnplacedNoticeDismissed] = useState(false);

  // Cari/saring aktif tetapi tidak ada titik yang cocok
  const hasActiveFilter = Boolean(searchQuery || statusFilter || regionFilter);
  const noFilterResults = Boolean(
    mapData &&
      hasActiveFilter &&
      !mapData.customers.some((c) =>
        customerMatches(c, searchQuery, statusFilter, regionFilter),
      ) &&
      !mapData.devices.some(
        (d) =>
          !searchQuery ||
          d.name.toLowerCase().includes(searchQuery.toLowerCase()),
      ),
  );

  // 3. Inisialisasi Peta Leaflet
  useEffect(() => {
    if (!mapElementRef.current || mapInstanceRef.current || !mapConfig) return;

    let isMounted = true;

    async function initLeaflet() {
      const L = await import("leaflet");
      if (!isMounted || !mapElementRef.current) return;
      leafletRef.current = L;

      // Inisialisasi peta
      const map = L.map(mapElementRef.current, {
        // Canvas: ribuan circleMarker/polyline jauh lebih ringan daripada node SVG; hanya area tampil yang digambar
        preferCanvas: true,
        center: mapConfig!.defaultCenter,
        zoom: mapConfig!.defaultZoom,
        maxZoom: mapConfig!.maxZoom,
        zoomControl: false, // Kita pindahkan ke floating control
        attributionControl: true, // Tampilkan atribusi tile (Google / Esri / OSM) sesuai PRD
      });

      const tileConfig = getTileLayerConfig(mapConfig!, baseLayerRef.current);

      const tileLayer = L.tileLayer(tileConfig.url, {
        subdomains: tileConfig.subdomains,
        maxNativeZoom: tileConfig.maxNativeZoom,
        maxZoom: tileConfig.maxZoom,
        attribution: tileConfig.attribution,
      }).addTo(map);

      let tileFailCount = 0;
      tileLayer.on("tileerror", () => {
        tileFailCount++;
        if (tileFailCount >= 3) {
          setTileErrorNotice(
            `Tile peta (${tileConfig.provider.toUpperCase()}) gagal dimuat atau akses diblokir. Ganti NEXT_PUBLIC_TILE_PROVIDER=esri, carto, atau osm di .env.local untuk penyedia cadangan.`,
          );
        }
      });
      tileLayer.on("load", () => {
        setTileErrorNotice(null);
      });

      baseTileLayerRef.current = tileLayer;

      // Pane sendiri di atas kanvas (overlayPane 400) dan di bawah ikon (markerPane 600)
      map.createPane("flowPane").style.zIndex = "450";
      flowRendererRef.current = L.svg({ pane: "flowPane" });

      // Inisialisasi layer groups
      hierarchyLinesLayerRef.current = L.layerGroup().addTo(map);
      routesLayerRef.current = L.layerGroup().addTo(map);
      devicesLayerRef.current = L.layerGroup().addTo(map);
      customersLayerRef.current = L.layerGroup().addTo(map);
      distanceMarkersLayerRef.current = L.layerGroup().addTo(map);
      annotationsLayerRef.current = L.layerGroup().addTo(map);
      annotationPreviewLayerRef.current = L.layerGroup().addTo(map);

      map.on("moveend", () => setViewTick((t) => t + 1));
      // Hanya berubah saat melewati ambang, jadi penanda tidak dirender ulang tiap zoom
      const syncDetailZoom = () => setDetailZoom(map.getZoom() >= DETAIL_ZOOM);
      map.on("zoomend", syncDetailZoom);
      syncDetailZoom();

      mapInstanceRef.current = map;
      setMapReady(true);

      // Klik peta untuk penempatan atau gambar jalur
      map.on("click", (e: L.LeafletMouseEvent) => {
        const { lat, lng } = e.latlng;

        // Mode ubah koordinat: klik peta mengisi form panel, panel tetap terbuka
        const editKeyNow = coordEditKeyRef.current;
        if (editKeyNow) {
          setCoordDraftState({
            key: editKeyNow,
            lat: lat.toFixed(6),
            lng: lng.toFixed(6),
          });
          return;
        }

        // Jika dalam mode penempatan pelanggan / perangkat
        if (placementModeRef.current) {
          setPlacementCoords({ lat, lng });
          return;
        }

        // Jika dalam mode gambar jalur kabel
        if (drawingRouteRef.current) {
          setDrawingPoints((prev) => [...prev, [lat, lng]]);
          return;
        }

        // Jika dalam mode gambar bentuk anotasi
        if (annotationToolRef.current) {
          const tool = annotationToolRef.current;
          const newPt: [number, number] = [lat, lng];
          if (tool === "circle" || tool === "label") {
            setAnnotationPoints([newPt]);
          } else if (tool === "rect" || tool === "arrow") {
            setAnnotationPoints((prev) => {
              if (prev.length === 0) return [newPt];
              if (prev.length === 1) return [prev[0], newPt];
              return [newPt];
            });
          }
          return;
        }

        // Klik area kosong menutup panel teratas (tanpa memuat ulang data peta)
        closeTopPanelRef.current();
      });
    }

    initLeaflet();

    return () => {
      isMounted = false;
      setMapReady(false);
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [mapConfig]);

  // Sekali saat data pertama tiba: arahkan peta ke sebaran titik nyata (pusat bawaan bisa jauh dari data).
  // Setelah itu posisi peta milik pengguna; refresh dan buka-tutup panel tidak menggesernya.
  const initialFitDoneRef = useRef(false);
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady || !mapData || initialFitDoneRef.current) return;
    initialFitDoneRef.current = true;
    const points: [number, number][] = [
      ...mapData.devices.filter(hasCoords),
      ...mapData.customers.filter(hasCoords),
    ].map((p) => [p.latitude!, p.longitude!]);
    if (points.length > 0) {
      map.fitBounds(points, { padding: [60, 60], maxZoom: 17 });
    }
  }, [mapReady, mapData]);

  // Ganti Base Tile Layer saat toggle Satelit / Jalan
  useEffect(() => {
    if (
      !mapInstanceRef.current ||
      !leafletRef.current ||
      !baseTileLayerRef.current ||
      !mapConfig
    )
      return;

    const L = leafletRef.current;
    mapInstanceRef.current.removeLayer(baseTileLayerRef.current);

    const tileConfig = getTileLayerConfig(mapConfig, baseLayer);

    const newTile = L.tileLayer(tileConfig.url, {
      subdomains: tileConfig.subdomains,
      maxNativeZoom: tileConfig.maxNativeZoom,
      maxZoom: tileConfig.maxZoom,
      attribution: tileConfig.attribution,
    }).addTo(mapInstanceRef.current);

    let switchFailCount = 0;
    newTile.on("tileerror", () => {
      switchFailCount++;
      if (switchFailCount >= 3) {
        setTileErrorNotice(
          `Tile peta (${tileConfig.provider.toUpperCase()}) gagal dimuat atau akses diblokir. Ganti NEXT_PUBLIC_TILE_PROVIDER=esri, carto, atau osm di .env.local untuk penyedia cadangan.`,
        );
      }
    });
    newTile.on("load", () => {
      setTileErrorNotice(null);
    });

    baseTileLayerRef.current = newTile;
  }, [baseLayer, mapConfig]);

  // Kursor bidik saat mode penempatan/anotasi; lewat classList agar kelas milik Leaflet tetap utuh
  const crosshair = !!placementMode || !!annotationTool;
  useEffect(() => {
    mapElementRef.current?.classList.toggle("cursor-crosshair", crosshair);
  }, [crosshair, mapReady]);

  // 4. Update Marker Penempatan Eksplisit (Placement Preview Marker)
  useEffect(() => {
    if (!mapInstanceRef.current || !leafletRef.current) return;
    const L = leafletRef.current;
    const map = mapInstanceRef.current;

    if (placementMarkerRef.current) {
      map.removeLayer(placementMarkerRef.current);
      placementMarkerRef.current = null;
    }

    if (placementMode && placementCoords) {
      const crosshairIcon = L.divIcon({
        className: "custom-crosshair-marker",
        html: `
          <div style="position: relative; width: 32px; height: 32px; display: flex; items-center: center; justify-content: center;">
            <div style="width: 24px; height: 24px; border: 2px dashed #f97316; border-radius: 50%; background: rgba(249, 115, 22, 0.25); animation: pulse 1.5s infinite;"></div>
            <div style="position: absolute; width: 6px; height: 6px; background: #ea580c; border-radius: 50%;"></div>
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });

      const marker = L.marker([placementCoords.lat, placementCoords.lng], {
        icon: crosshairIcon,
        draggable: true,
      }).addTo(map);

      marker.on("dragend", () => {
        const pos = marker.getLatLng();
        setPlacementCoords({ lat: pos.lat, lng: pos.lng });
      });

      placementMarkerRef.current = marker;
    }
  }, [placementMode, placementCoords]);

  // 4b. Penanda pratinjau draggable untuk mode ubah koordinat (sinkron dengan form)
  useEffect(() => {
    if (!mapInstanceRef.current || !leafletRef.current) return;
    const L = leafletRef.current;
    const map = mapInstanceRef.current;

    if (coordEditMarkerRef.current) {
      map.removeLayer(coordEditMarkerRef.current);
      coordEditMarkerRef.current = null;
    }

    if (activeDraftLat === null || activeDraftLng === null || !editKey) return;
    const coords = parseCoordinates(activeDraftLat, activeDraftLng);
    if (!coords) return;
    const { lat, lng } = coords;

    // Violet: bukan kuning/merah/hijau (status) dan beda dari oranye penempatan
    const icon = L.divIcon({
      className: "custom-coord-edit-marker",
      html: `
        <div style="position: relative; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;">
          <div style="width: 26px; height: 26px; border: 2px dashed #8b5cf6; border-radius: 50%; background: rgba(139, 92, 246, 0.25);"></div>
          <div style="position: absolute; width: 6px; height: 6px; background: #7c3aed; border-radius: 50%;"></div>
        </div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });

    const marker = L.marker([lat, lng], {
      icon,
      draggable: true,
      zIndexOffset: 1000,
    }).addTo(map);

    marker.on("dragend", () => {
      const pos = marker.getLatLng();
      setCoordDraftState({
        key: editKey,
        lat: pos.lat.toFixed(6),
        lng: pos.lng.toFixed(6),
      });
    });

    coordEditMarkerRef.current = marker;
  }, [activeDraftLat, activeDraftLng, editKey, mapReady]);

  // 5. Update Preview Polilin Penggambaran Jalur Kabel
  useEffect(() => {
    if (!mapInstanceRef.current || !leafletRef.current) return;
    const L = leafletRef.current;
    const map = mapInstanceRef.current;

    if (drawingPolylineRef.current) {
      map.removeLayer(drawingPolylineRef.current);
      drawingPolylineRef.current = null;
    }

    drawingPreviewLayerRef.current?.remove();
    drawingPreviewLayerRef.current = null;

    if (drawingRoute && drawingPoints.length > 0) {
      const poly = L.polyline(drawingPath, {
        color: "#f97316",
        weight: 4,
        dashArray: "6, 6",
        opacity: 0.9,
        interactive: false,
      }).addTo(map);

      drawingPolylineRef.current = poly;

      const group = L.layerGroup().addTo(map);
      if (activeSnapPreview?.snapped && activeSnapPreview.geometry) {
        // Hasil tarikan ke jalan (pratinjau, belum disimpan)
        L.polyline(activeSnapPreview.geometry, {
          color: "#ffffff",
          weight: 3,
          opacity: 0.95,
          interactive: false,
        }).addTo(group);
      }
      drawingPoints.forEach((pt, idx) => {
        const vertex = L.marker(pt, {
          draggable: true,
          icon: L.divIcon({
            className: "custom-route-vertex",
            html: odpMode
              ? `<div style="width:20px;height:20px;border-radius:50%;background:#ea580c;color:#fff;border:2px solid #fff;font:700 10px/16px sans-serif;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.5)">${idx + 1}</div>`
              : `<div style="width:12px;height:12px;border-radius:50%;background:#fff;border:2px solid #ea580c;box-shadow:0 1px 3px rgba(0,0,0,.5)"></div>`,
            iconSize: odpMode ? [20, 20] : [12, 12],
            iconAnchor: odpMode ? [10, 10] : [6, 6],
          }),
          title: `${odpMode ? "ODP baru" : "Titik"} ${idx + 1} (geser untuk memindah, klik kanan untuk hapus)`,
        }).addTo(group);
        vertex.on("dragend", () => {
          const { lat, lng } = vertex.getLatLng();
          setDrawingPoints((prev) =>
            prev.map((p, i) => (i === idx ? [lat, lng] : p)),
          );
        });
        vertex.on("contextmenu", () =>
          setDrawingPoints((prev) => prev.filter((_, i) => i !== idx)),
        );
      });
      drawingPreviewLayerRef.current = group;
    }
  }, [drawingRoute, drawingPoints, drawingPath, odpMode, activeSnapPreview]);

  // 5a. Pratinjau snapping otomatis (server) setiap titik berubah, ditunda 400 ms
  useEffect(() => {
    if (!drawingRoute || drawingPath.length < 2) return;
    const key = JSON.stringify(drawingPath);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/peta/routes/snap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ geometry: drawingPath }),
          signal: controller.signal,
        });
        const json = await res.json();
        setSnapPreview(
          res.ok
            ? { key, ...json.data }
            : {
                key,
                error: json?.error?.message || "Pratinjau penyesuaian jalan gagal.",
              },
        );
      } catch {
        if (!controller.signal.aborted) {
          setSnapPreview({
            key,
            error: "Pratinjau penyesuaian jalan gagal. Periksa koneksi.",
          });
        }
      }
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [drawingRoute, drawingPath]);

  // 5b. Update Preview Penggambaran Bentuk Anotasi
  useEffect(() => {
    if (!mapInstanceRef.current || !leafletRef.current) return;
    const L = leafletRef.current;
    const layer = annotationPreviewLayerRef.current;
    if (!layer) return;

    layer.clearLayers();

    if (!annotationTool || annotationPoints.length === 0) return;

    const color = "#f97316";

    const p1 = annotationPoints[0];
    const marker1 = L.circleMarker(p1, {
      radius: 6,
      color,
      fillColor: color,
      fillOpacity: 0.8,
      weight: 2,
    });
    layer.addLayer(marker1);

    if (annotationTool === "circle") {
      const circle = L.circle(p1, {
        radius: 250,
        color,
        dashArray: "4, 4",
        weight: 2,
        fillColor: color,
        fillOpacity: 0.2,
      });
      layer.addLayer(circle);
    } else if (annotationPoints.length > 1) {
      const p2 = annotationPoints[1];
      const marker2 = L.circleMarker(p2, {
        radius: 6,
        color,
        fillColor: color,
        fillOpacity: 0.8,
        weight: 2,
      });
      layer.addLayer(marker2);

      if (annotationTool === "rect") {
        const bounds: L.LatLngBoundsExpression = [p1, p2];
        const rect = L.rectangle(bounds, {
          color,
          dashArray: "4, 4",
          weight: 2,
          fillColor: color,
          fillOpacity: 0.2,
        });
        layer.addLayer(rect);
      } else if (annotationTool === "arrow") {
        const line = L.polyline([p1, p2], {
          color,
          dashArray: "4, 4",
          weight: 3,
        });
        layer.addLayer(line);
      }
    }
  }, [annotationTool, annotationPoints]);

  // 6. Render Data Nyata Peta (Pelanggan, Perangkat, Jalur Kabel, Relasi)
  useEffect(() => {
    if (!mapInstanceRef.current || !leafletRef.current || !mapData) return;
    const L = leafletRef.current;

    // Bersihkan layer sebelumnya
    customersLayerRef.current?.clearLayers();
    devicesLayerRef.current?.clearLayers();
    routesLayerRef.current?.clearLayers();
    hierarchyLinesLayerRef.current?.clearLayers();

    const devMap = new Map<string, MapDevice>(
      mapData.devices.map((d) => [d.id, d]),
    );

    // Filter pelanggan berdasarkan query, status, wilayah
    const filteredCustomers = mapData.customers.filter((c) =>
      customerMatches(c, searchQuery, statusFilter, regionFilter),
    );

    // Render Titik Pelanggan
    if (visibleLayers.customers && customersLayerRef.current) {
      filteredCustomers.forEach((c) => {
        // Warna status layanan; belum diketahui = abu (tidak ditebak hijau)
        const color = connectionStyle(c.status).color;

        // Zoom dekat: ikon rumah; zoom jauh: titik kanvas ringan agar ribuan pelanggan tetap lancar
        const alert =
          c.status === "loss" || c.status === "isolir" || c.status === "offline"
            ? MARKER_ALERT[c.status]
            : undefined;
        const marker = detailZoom
          ? L.marker([c.latitude!, c.longitude!], {
              bubblingMouseEvents: false,
              title: alert ? `${c.name} • ${alert.label}` : c.name,
              icon: L.divIcon({
                className: "custom-customer-icon",
                html: markerIconHtml("customer", color, 24, alert),
                iconSize: [24, 24],
                iconAnchor: [12, 12],
              }),
            })
          : L.circleMarker([c.latitude!, c.longitude!], {
              bubblingMouseEvents: false, // klik titik tidak diteruskan ke "klik area kosong"
              radius: 6,
              fillColor: color,
              color: "#ffffff",
              weight: 1.5,
              opacity: 1,
              fillOpacity: 0.9,
            });

        marker.on("click", () => {
          if (coordEditKeyRef.current) return; // sedang ubah koordinat: klik diteruskan ke peta
          setSelectedCustomer(c);
          setCustomerSubPanel("detail");
          setSelectedDevice(null);
          setSelectedRoute(null);
          setShowHierarchyTree(false);
          setShowAnnotationPanel(false);
          setAnnotationTool(null);
          setAnnotationPoints([]);
          syncUrlState({ customer: c.id, panel: "detail" });
        });

        customersLayerRef.current?.addLayer(marker);
      });
    }

    // Render Perangkat Jaringan (Server, ODC, ODP, Tiang)
    if (visibleLayers.devices && devicesLayerRef.current) {
      mapData.devices.forEach((d) => {
        if (!hasCoords(d)) return;
        if (
          searchQuery &&
          !d.name.toLowerCase().includes(searchQuery.toLowerCase())
        ) {
          return;
        }

        const type = DEVICE_TYPE_STYLE[d.type] ? d.type : "odp";
        // OLT lebih besar: titik asal jaringan
        const size = type === "server" ? 32 : 28;
        const use = capacityUse(d, mapData.devices);
        const full = use && use.used >= use.total ? use : null;
        const icon = L.divIcon({
          className: "custom-device-icon",
          html: markerIconHtml(type, DEVICE_TYPE_STYLE[type].color, size, full ? MARKER_ALERT.full : undefined),
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        });

        const marker = L.marker([d.latitude, d.longitude], {
          icon,
          title: `${DEVICE_TYPE_STYLE[type].name}: ${d.name}${full ? ` • PENUH ${full.used}/${full.total} port` : ""}`,
        });

        marker.on("click", () => {
          if (coordEditKeyRef.current) return;
          setSelectedDevice(d);
          setSelectedCustomer(null);
          setSelectedRoute(null);
          setShowHierarchyTree(false);
          setShowAnnotationPanel(false);
          setAnnotationTool(null);
          setAnnotationPoints([]);
          syncUrlState({ device: d.id });
        });

        devicesLayerRef.current?.addLayer(marker);
      });
    }

    // Render Jalur Kabel Nyata (Polilin)
    if (visibleLayers.routes && routesLayerRef.current) {
      mapData.segments.forEach((seg) => {
        if (!seg.geometry || seg.geometry.length < 2) return;

        const parentRoute = mapData.routes.find((r) => r.id === seg.routeId);
        const tier = capacityStyle(parentRoute?.fiberCapacity || 24);
        const weight = tier.weight;
        // Segmen drop ke pelanggan: warna mengikuti status layanan (abu bila belum diketahui)
        const conn = seg.customerId ? connectionStyle(seg.connectionStatus) : null;

        const poly = L.polyline(seg.geometry, {
          bubblingMouseEvents: false,
          color: conn?.color ?? parentRoute?.color ?? tier.color,
          weight,
          opacity: 0.85,
        });

        // Alir putih di atas kabel: arah asal → tujuan; drop loss/belum diketahui tidak mengalir
        if (conn?.flow !== "map-flow-off") {
          routesLayerRef.current?.addLayer(
            L.polyline(seg.geometry, {
              renderer: flowRendererRef.current ?? undefined,
              className: conn?.flow ?? "map-flow",
              color: parentRoute?.color === "#f8fafc" ? "#0f172a" : "#ffffff",
              weight: Math.max(1.5, weight - 3),
              opacity: 0.8,
              interactive: false,
            }),
          );
        }

        poly.on("click", () => {
          if (coordEditKeyRef.current) return;
          if (parentRoute) {
            setSelectedRoute(parentRoute);
            setSelectedCustomer(null);
            setSelectedDevice(null);
            setShowHierarchyTree(false);
            setShowAnnotationPanel(false);
            setAnnotationTool(null);
            setAnnotationPoints([]);
            syncUrlState({ route: parentRoute.id });
          }
        });

        routesLayerRef.current?.addLayer(poly);
      });
    }

    // Render Garis Hubungan Induk - Anak (perangkat -> induk, pelanggan -> ODP)
    if (visibleLayers.hierarchyLines && hierarchyLinesLayerRef.current) {
      const addLink = (from: [number, number], to: [number, number]) =>
        hierarchyLinesLayerRef.current?.addLayer(
          // Garis putus-putus tipis non-interaktif: beda dari jalur kabel, tidak menghalangi klik ikon
          L.polyline([from, to], {
            color: "#94a3b8",
            weight: 1.5,
            dashArray: "4, 4",
            opacity: 0.5,
            interactive: false,
          }),
        );
      mapData.devices.forEach((d) => {
        const parent = d.parentDeviceId ? devMap.get(d.parentDeviceId) : null;
        if (parent && hasCoords(d) && hasCoords(parent)) {
          addLink([d.latitude, d.longitude], [parent.latitude, parent.longitude]);
        }
      });
      if (visibleLayers.customers) {
        filteredCustomers.forEach((c) => {
          const odp = c.odpId ? devMap.get(c.odpId) : null;
          if (!odp || !hasCoords(odp)) return;
          // Sambungan ODP → pelanggan diwarnai status layanan dan mengalir bila aktif (PRD)
          const conn = connectionStyle(c.status);
          hierarchyLinesLayerRef.current?.addLayer(
            L.polyline(
              [
                [odp.latitude, odp.longitude],
                [c.latitude!, c.longitude!],
              ],
              {
                renderer: flowRendererRef.current ?? undefined,
                className: conn.flow,
                color: conn.color,
                weight: 2.5,
                opacity: 0.9,
                interactive: false,
              },
            ),
          );
        });
      }
    }
  }, [
    mapData,
    mapReady,
    searchQuery,
    statusFilter,
    regionFilter,
    visibleLayers,
    syncUrlState,
    detailZoom,
  ]);

  // 6b. Render Lapisan Gambar & Anotasi
  useEffect(() => {
    if (
      !mapInstanceRef.current ||
      !leafletRef.current ||
      !annotationsLayerRef.current
    )
      return;
    const L = leafletRef.current;
    const group = annotationsLayerRef.current;
    group.clearLayers();

    if (!visibleLayers.annotations) return;

    layers.forEach((layer) => {
      if (!layer.visible) return;
      const opacity = layer.opacity ?? 1.0;

      layer.shapes.forEach((shape) => {
        const color = shape.properties?.color || "#3b82f6";
        const strokeWidth = shape.properties?.strokeWidth || 2;
        const text = shape.properties?.text;

        if (shape.type === "rect" && shape.coordinates.length >= 2) {
          const bounds: L.LatLngBoundsExpression = [
            [shape.coordinates[0][0], shape.coordinates[0][1]],
            [shape.coordinates[1][0], shape.coordinates[1][1]],
          ];
          const rect = L.rectangle(bounds, {
            color,
            weight: strokeWidth,
            opacity,
            fillColor: color,
            fillOpacity: opacity * 0.25,
          });
          if (text) rect.bindTooltip(escapeHtml(text), { sticky: true });
          group.addLayer(rect);
        } else if (shape.type === "circle" && shape.coordinates.length >= 1) {
          const center: L.LatLngExpression = [
            shape.coordinates[0][0],
            shape.coordinates[0][1],
          ];
          const radius = shape.properties?.radiusM || 100;
          const circle = L.circle(center, {
            radius,
            color,
            weight: strokeWidth,
            opacity,
            fillColor: color,
            fillOpacity: opacity * 0.25,
          });
          if (text)
            circle.bindTooltip(`${escapeHtml(text)} (${radius}m)`, {
              sticky: true,
            });
          group.addLayer(circle);
        } else if (shape.type === "label" && shape.coordinates.length >= 1) {
          const pos: L.LatLngExpression = [
            shape.coordinates[0][0],
            shape.coordinates[0][1],
          ];
          const labelText = text || "Anotasi";
          const icon = L.divIcon({
            className: "custom-annotation-label",
            html: `<div style="transform: translate(-50%, -50%); display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 6px; background: rgba(15, 23, 42, ${Math.max(0.4, opacity * 0.9)}); border: 1px solid ${color}; color: #ffffff; font-size: 11px; font-weight: 600; white-space: nowrap; box-shadow: 0 2px 6px rgba(0,0,0,0.5); pointer-events: auto;">
              <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background-color: ${color};"></span>
              <span>${escapeHtml(labelText)}</span>
            </div>`,
            iconSize: [0, 0],
          });
          const marker = L.marker(pos, { icon });
          group.addLayer(marker);
        } else if (shape.type === "arrow" && shape.coordinates.length >= 2) {
          const line = L.polyline(shape.coordinates, {
            color,
            weight: Math.max(strokeWidth, 3),
            opacity,
            dashArray: "6, 6",
          });
          if (text) line.bindTooltip(escapeHtml(text), { sticky: true });
          group.addLayer(line);

          const tipMarker = L.circleMarker(shape.coordinates[1], {
            radius: 5,
            color,
            fillColor: color,
            fillOpacity: opacity,
            weight: 1,
          });
          group.addLayer(tipMarker);
        }
      });
    });
  }, [layers, visibleLayers.annotations, mapReady]);

  // 7. Penanda jarak kumulatif (50m, 100m, ...) pada titik sampling
  useEffect(() => {
    const map = mapInstanceRef.current;
    const L = leafletRef.current;
    const layer = distanceMarkersLayerRef.current;
    if (!map || !L || !layer) return;

    layer.clearLayers();
    if (!mapData || !visibleLayers.routes) return;

    const zoomedIn = map.getZoom() >= 17;
    if (!selectedRoute && !zoomedIn) return;

    const bounds = map.getBounds();
    // Offset jarak antar segmen agar label kumulatif sepanjang rute
    const routeOffset = new Map<string, number>();
    const ordered = [...mapData.segments].sort(
      (a, b) => a.sequence - b.sequence,
    );

    ordered.forEach((seg) => {
      const offset = routeOffset.get(seg.routeId) ?? 0;
      routeOffset.set(seg.routeId, offset + seg.lengthM);

      const isSelected = selectedRoute?.id === seg.routeId;
      if (!isSelected && !zoomedIn) return;
      if (!seg.samples || seg.samples.length < 3) return;
      if (!isSelected && !bounds.intersects(L.latLngBounds(seg.geometry))) {
        return;
      }

      // Lewati titik awal & akhir (berimpit dengan perangkat / segmen lain)
      seg.samples.slice(1, -1).forEach((s) => {
        if (!isSelected && !bounds.contains([s.latitude, s.longitude])) return;
        const label = `${Math.round(offset + s.cumulativeM)}m`;
        layer.addLayer(
          L.marker([s.latitude, s.longitude], {
            interactive: false,
            keyboard: false,
            icon: L.divIcon({
              className: "distance-marker-icon",
              html: `<div style="transform: translate(-50%, -50%); display: inline-block; padding: 1px 5px; border-radius: 9999px; background: rgba(15,23,42,0.7); color: #ffffff; font-size: 10px; line-height: 14px; font-weight: 600; white-space: nowrap; pointer-events: none;">${label}</div>`,
              iconSize: [0, 0],
            }),
          }),
        );
      });
    });
  }, [mapData, mapReady, selectedRoute, visibleLayers.routes, viewTick]);

  // Aksi Penyimpanan Penempatan Pelanggan / Perangkat
  const handleSavePlacement = async (formData: Record<string, unknown>) => {
    if (placementMode === "customer") {
      // Pelanggan dipilih dari data yang ada: simpan titik + ODP penghubungnya
      const { customerId, ...body } = formData;
      const res = await fetch(`/api/peta/customers/${customerId}/location`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error?.message || "Gagal menyimpan pelanggan.");
      }
      pushUndo(json.undoId);
    } else {
      const res = await fetch("/api/peta/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error?.message || "Gagal menyimpan perangkat.");
      }
      pushUndo(json.data?.undoId);
      const segment: CableSegment | null = json.data?.segment ?? null;
      const route = mapData?.routes.find((r) => r.id === segment?.routeId);
      setPlacementMode(null);
      setPlacementCoords(null);
      await handleRefreshData();
      // Segmen awal masih garis ujung rantai → perangkat; langsung buka untuk dirapikan mengikuti jalan
      if (segment && route) startDrawing(route, segment);
      return;
    }

    setPlacementMode(null);
    setPlacementCoords(null);
    await handleRefreshData();
    // Dibuka dari panel ODP: kembali ke ODP itu agar pelanggan barunya terlihat di daftar
    const odp = mapData?.devices.find((d) => d.id === formData.odpId);
    if (placementOdpId && odp) {
      setSelectedDevice(odp);
      syncUrlState({ device: odp.id });
    }
  };

  const placementRouteOptions = useMemo<PlacementRouteOption[]>(() => {
    if (!mapData) return [];
    const deviceName = new Map(mapData.devices.map((d) => [d.id, d.name]));
    return mapData.routes
      .filter((r) => !r.readOnly)
      .map((r) => {
        const endId = chainEndDeviceId(
          r.fromDeviceId,
          mapData.segments.filter((s) => s.routeId === r.id),
        );
        return {
          id: r.id,
          label: `${r.code} — ${r.name}`,
          chainEndName: deviceName.get(endId) ?? endId,
        };
      });
  }, [mapData]);

  // Aksi Update Koordinat Pelanggan
  const handleUpdateCustomerLocation = async (
    id: string,
    lat: number,
    lng: number,
    odpId?: string,
  ) => {
    const res = await fetch(`/api/peta/customers/${id}/location`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ latitude: lat, longitude: lng, odpId }),
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json?.error?.message || "Gagal memperbarui posisi.");
    }
    pushUndo(json.undoId);
    await handleRefreshData();
    if (selectedCustomer && selectedCustomer.id === id) {
      setSelectedCustomer((prev) =>
        prev
          ? { ...prev, latitude: lat, longitude: lng, odpId: odpId ?? prev.odpId }
          : null,
      );
    }
  };

  // Simpan port (pelanggan di ODP, ODP di ODC) atau rasio splitter, lalu muat ulang peta
  const saveMapChange = async (url: string, method: "PUT" | "PATCH", body: unknown) => {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json?.error?.message || "Gagal menyimpan perubahan.");
    }
    pushUndo(json.undoId);
    await handleRefreshData();
  };

  // Aksi Update Koordinat Perangkat
  const handleUpdateDeviceLocation = async (
    id: string,
    lat: number,
    lng: number,
  ) => {
    const res = await fetch(`/api/peta/devices/${id}/location`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ latitude: lat, longitude: lng }),
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json?.error?.message || "Gagal memperbarui posisi.");
    }
    pushUndo(json.undoId);
    await handleRefreshData();
    if (selectedDevice && selectedDevice.id === id) {
      setSelectedDevice((prev) =>
        prev ? { ...prev, latitude: lat, longitude: lng } : null,
      );
    }
  };

  // Aksi Update Induk Perangkat (Reparenting)
  const handleUpdateDeviceParent = async (
    id: string,
    parentId: string | null,
  ) => {
    const res = await fetch(`/api/peta/devices/${id}/parent`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentDeviceId: parentId }),
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json?.error?.message || "Gagal memindahkan induk.");
    }
    pushUndo(json.undoId);
    await handleRefreshData();
    if (selectedDevice && selectedDevice.id === id) {
      setSelectedDevice((prev) =>
        prev ? { ...prev, parentDeviceId: parentId } : null,
      );
    }
  };

  // Aksi Ubah Keterangan Perangkat
  const handleUpdateDeviceNotes = async (id: string, notes: string) => {
    const res = await fetch(`/api/peta/devices/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json?.error?.message || "Gagal menyimpan keterangan.");
    }
    pushUndo(json.undoId);
    await handleRefreshData();
  };

  // Aksi Hapus Perangkat
  const handleDeleteDevice = async (id: string) => {
    const res = await fetch(`/api/peta/devices/${id}`, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json?.error?.message || "Gagal menghapus perangkat.");
    }
    pushUndo(json.undoId);
    setSelectedDevice(null);
    await handleRefreshData();
  };

  // Aksi Buat Rute Kabel Baru
  const handleCreateRoute = async (formData: {
    code: string;
    name: string;
    cableType: string;
    fiberCapacity: number;
    fromDeviceId: string;
    toDeviceId?: string;
    color?: string;
  }) => {
    const res = await fetch("/api/peta/routes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formData),
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json?.error?.message || "Gagal membuat rute kabel.");
    }
    pushUndo(json.data?.undoId);
    await handleRefreshData();
    // Identitas tersimpan: langsung gambar segmen pertama (jalur kosong belum bisa diklik di peta)
    startDrawing(json.data);
    return json.data;
  };

  // Ubah identitas jalur (nama, warna, kabel, PON); panel jalur ikut segar lewat handleRefreshData
  const handleUpdateRoute = async (routeId: string, data: RouteUpdate) => {
    const res = await fetch(`/api/peta/routes/${routeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const json = await readApiJson(res);
    if (!res.ok) throw new Error(json?.error?.message || "Gagal mengubah jalur.");
    pushUndo(json.undoId);
    await handleRefreshData();
  };

  // Aksi Simpan Segmen Jalur yang Digambar
  const startDrawing = (route: CableRoute, segment: CableSegment | null = null) => {
    setSelectedRoute(null);
    syncUrlState({});
    setDrawingRoute(route);
    setEditingSegment(segment);
    setDrawingPoints(segment?.geometry ?? []);
    setSegmentError(null);
    // Segmen baru berangkat dari ujung rantai terakhir, bukan dari OLT
    setDrawingFrom(
      chainEndDeviceId(
        route.fromDeviceId,
        (mapData?.segments || []).filter((s) => s.routeId === route.id),
      ),
    );
    // Bawaan: titik akhir segmen baru = ODP baru pada rantai jalur ini
    setDrawingTarget(segment ? "" : "new:odp");
  };

  const handleSaveDrawnSegment = async (newDevices?: {
    names: string[];
    capacity: number;
  }) => {
    if (!drawingRoute || drawingPoints.length < (odpMode ? 1 : 2)) return;
    const [targetKind, targetId] = drawingTarget.split(":");
    const base = `/api/peta/routes/${drawingRoute.id}/segments`;

    setSegmentError(null);
    try {
      setSavingSegment(true);
      if (odpMode && newDevices) {
        // Tiap titik = perangkat baru + segmen dari titik sebelumnya; server menarik segmen ke jalan
        let from = drawingFrom;
        let prev = drawingPath[0];
        for (let i = 0; i < drawingPoints.length; i++) {
          const [lat, lng] = drawingPoints[i];
          const res = await fetch("/api/peta/devices", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: newDevices.names[i],
              type: targetId,
              capacity: newDevices.capacity,
              latitude: lat,
              longitude: lng,
              routeId: drawingRoute.id,
              fromDeviceId: from,
              geometry: [prev, [lat, lng]],
            }),
          });
          const json = await res.json();
          if (!res.ok) {
            // Titik yang sudah tersimpan dibuang dari gambar; sisanya tetap untuk dicoba lagi
            setDrawingPoints(drawingPoints.slice(i));
            setDrawingFrom(from);
            await handleRefreshData();
            throw new Error(json?.error?.message || "Gagal menyimpan perangkat.");
          }
          pushUndo(json.data.undoId);
          from = json.data.device.id;
          prev = [lat, lng];
        }
        await handleRefreshData();
        // Lanjut menarik rantai dari perangkat terakhir; Batal bila jalur selesai
        setDrawingPoints([]);
        setDrawingFrom(from);
        return;
      }
      const res = await fetch(
        editingSegment ? `${base}/${editingSegment.id}` : base,
        {
          method: editingSegment ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            editingSegment
              ? { geometry: drawingPoints }
              : {
                  fromDeviceId: drawingFrom,
                  ...(targetKind === "customer"
                    ? { customerId: targetId }
                    : { toDeviceId: targetId }),
                  geometry: drawingPoints,
                },
          ),
        },
      );

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error?.message || "Gagal menyimpan segmen.");
      }
      pushUndo(json.data?.undoId);

      setDrawingRoute(null);
      setDrawingPoints([]);
      setEditingSegment(null);
      await handleRefreshData();
    } catch (err: unknown) {
      // Titik tetap di peta agar pengguna dapat mencoba lagi
      setSegmentError(
        err instanceof Error ? err.message : "Gagal menyimpan segmen.",
      );
    } finally {
      setSavingSegment(false);
    }
  };

  // Mengarahkan peta ke node yang dipilih pada pohon hierarki
  const handleSelectTreeNode = (node: HierarchyTreeNode) => {
    setShowAnnotationPanel(false);
    setAnnotationTool(null);
    setAnnotationPoints([]);

    if (node.latitude && node.longitude && mapInstanceRef.current) {
      mapInstanceRef.current.setView([node.latitude, node.longitude], 17, {
        animate: true,
      });
    }

    if (node.type === "customer") {
      const cust = mapData?.customers.find((c) => c.id === node.id);
      if (cust) {
        setShowHierarchyTree(false);
        setSelectedCustomer(cust);
        setCustomerSubPanel("detail");
        setSelectedDevice(null);
        setSelectedRoute(null);
        syncUrlState({ customer: cust.id, panel: "detail" });
      }
    } else {
      const dev = mapData?.devices.find((d) => d.id === node.id);
      if (dev) {
        setShowHierarchyTree(false);
        setSelectedDevice(dev);
        setSelectedCustomer(null);
        setSelectedRoute(null);
        syncUrlState({ device: dev.id });
      }
    }
  };

  // Toggle Panel Lapisan Gambar & Anotasi
  // Efek samping (riwayat URL, state lain) tidak boleh di dalam updater setState: updater jalan saat render
  const handleToggleAnnotationPanel = useCallback(() => {
    if (!showAnnotationPanel) {
      setSelectedCustomer(null);
      setSelectedDevice(null);
      setSelectedRoute(null);
      setShowHierarchyTree(false);
      setPlacementMode(null);
      setPlacementCoords(null);
      setDrawingRoute(null);
      setDrawingPoints([]);
      syncUrlState({});
    } else {
      setAnnotationTool(null);
      setAnnotationPoints([]);
    }
    setShowAnnotationPanel(!showAnnotationPanel);
  }, [showAnnotationPanel, syncUrlState]);

  // Kumpulan wilayah unik untuk dropdown filter
  const availableRegions = Array.from(
    new Set((mapData?.customers || []).map((c) => c.region).filter(Boolean)),
  );

  return (
    <div className="relative w-full h-full overflow-hidden select-none bg-black">
      {/* Kanvas Utama Leaflet (100% Full-Bleed) */}
      {/* className statis: render ulang React menimpa kelas leaflet-container dan peta jadi hitam */}
      <div ref={mapElementRef} className="w-full h-full z-0" />

      {/* Loading Overlay */}
      {loading && (
        <div className="absolute inset-0 z-[1500] flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm gap-3">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
          <p className="text-xs font-medium text-foreground">
            Memuat Peta Satelit & Data NOC...
          </p>
        </div>
      )}

      {/* Banner Notifikasi Kesalahan Data Nyata */}
      {errorNotice && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[1100] max-w-lg w-full px-4 animate-in fade-in duration-200 pointer-events-auto">
          <div className="bg-destructive/95 backdrop-blur-md text-destructive-foreground border border-destructive/40 shadow-xl rounded-2xl p-3 flex items-start gap-2.5 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1">
              <span className="font-semibold block mb-0.5">
                Peringatan Sumber Data:
              </span>
              <p className="text-[11px] leading-relaxed opacity-90">
                {errorNotice}
              </p>
            </div>
            <button
              onClick={handleRefreshData}
              className="px-2.5 py-1 rounded-lg bg-background text-foreground text-[10px] font-medium hover:bg-muted shrink-0 transition-colors"
            >
              Coba lagi
            </button>
          </div>
        </div>
      )}

      {/* Notifikasi Galat Tile Peta (Fase 1 PRD) */}
      {tileErrorNotice && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[1100] max-w-lg w-full px-4 animate-in fade-in duration-200 pointer-events-auto">
          <div className="bg-amber-950/95 backdrop-blur-md text-amber-200 border border-amber-500/40 shadow-xl rounded-2xl p-3 flex items-start gap-2.5 text-xs">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <span className="font-semibold block mb-0.5 text-amber-300">
                Peringatan Lapis Tile Peta:
              </span>
              <p className="text-[11px] leading-relaxed opacity-90">
                {tileErrorNotice}
              </p>
            </div>
            <button
              onClick={() => setTileErrorNotice(null)}
              className="text-amber-400 hover:text-amber-200 p-1 rounded"
              title="Tutup Peringatan"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {unplacedCustomers > 0 &&
        !unplacedNoticeDismissed &&
        !errorNotice &&
        !noFilterResults && (
          <div
            role="status"
            className="absolute top-28 left-3 z-[980] max-w-xs bg-card/95 backdrop-blur-md text-foreground border border-border shadow-lg rounded-xl p-2.5 flex items-start gap-2 text-[11px]"
          >
            <Info className="w-3.5 h-3.5 text-blue-500 shrink-0 mt-0.5" />
            <span className="flex-1">
              {unplacedCustomers} dari {mapData?.customers.length} pelanggan
              belum punya koordinat sehingga tidak tampil di peta. Cari nama,
              nomor, atau SN ONU untuk membuka detail dan menempatkan titiknya.
            </span>
            <button
              onClick={() => setUnplacedNoticeDismissed(true)}
              aria-label="Tutup informasi pelanggan tanpa koordinat"
              className="p-0.5 rounded hover:bg-muted text-muted-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

      {noFilterResults && searchResults.length === 0 && (
        <div
          role="status"
          className="absolute top-20 left-1/2 -translate-x-1/2 z-[1050] max-w-md w-[calc(100%-2rem)] bg-card/95 backdrop-blur-md text-foreground border border-border shadow-xl rounded-2xl p-3 flex items-center gap-2.5 text-xs"
        >
          <Info className="w-4 h-4 text-blue-500 shrink-0" />
          Tidak ada titik yang cocok dengan pencarian atau saringan. Ubah kata
          kunci, wilayah, atau status.
        </div>
      )}

      {/* Banner Informasi Data Jaringan Kosong (Non-intrusif) */}
      {isEmptyData && !emptyNoticeDismissed && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[1050] max-w-md w-full px-4 animate-in fade-in duration-200 pointer-events-auto">
          <div className="bg-card/95 backdrop-blur-md text-foreground border border-border shadow-xl rounded-2xl p-3 flex items-start gap-2.5 text-xs">
            <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
            <div className="flex-1">
              <span className="font-semibold block mb-0.5 text-foreground">
                Data Jaringan Belum Terdaftar:
              </span>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Belum ada data pelanggan atau perangkat yang terdaftar di sumber{" "}
                <span className="font-medium text-foreground">
                  {mapData?.source === "central-api" ? "database NOC" : "database lokal peta"}
                </span>
                . Gunakan menu <strong>+ Tambah</strong> untuk mulai memetakan.
              </p>
            </div>
            <button
              onClick={() => setEmptyNoticeDismissed(true)}
              className="text-muted-foreground hover:text-foreground p-1 rounded transition-colors"
              title="Tutup Pemberitahuan"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Kendali Mengambang di Atas Peta */}
      <MapControls
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchResults={searchResults}
        onSelectSearchResult={(r) => {
          setSearchQuery("");
          handleSelectTreeNode({ ...r, status: "", children: [] });
        }}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        regionFilter={regionFilter}
        onRegionFilterChange={setRegionFilter}
        availableRegions={availableRegions}
        baseLayer={baseLayer}
        onBaseLayerChange={setBaseLayer}
        visibleLayers={visibleLayers}
        onToggleLayer={(k) =>
          setVisibleLayers((prev) => ({ ...prev, [k]: !prev[k] }))
        }
        dataSource={mapData?.source || mapConfig?.dataSource || "central-api"}
        lastUpdated={mapData?.lastUpdated || null}
        autoRefreshStatus={autoRefreshStatus}
        onRefresh={handleRefreshData}
        isRefreshing={isRefreshing}
        onStartAddCustomer={() => {
          setSelectedCustomer(null);
          setSelectedDevice(null);
          setSelectedRoute(null);
          setShowHierarchyTree(false);
          setShowAnnotationPanel(false);
          setAnnotationTool(null);
          setAnnotationPoints([]);
          setPlacementOdpId("");
          setPlacementMode("customer");
          setPlacementCoords(
            mapInstanceRef.current
              ? {
                  lat: mapInstanceRef.current.getCenter().lat,
                  lng: mapInstanceRef.current.getCenter().lng,
                }
              : { lat: -6.2088, lng: 106.8456 },
          );
        }}
        onStartAddDevice={() => {
          setSelectedCustomer(null);
          setSelectedDevice(null);
          setSelectedRoute(null);
          setShowHierarchyTree(false);
          setShowAnnotationPanel(false);
          setAnnotationTool(null);
          setAnnotationPoints([]);
          setPlacementRouteId("");
          setPlacementMode("device");
          setPlacementCoords(
            mapInstanceRef.current
              ? {
                  lat: mapInstanceRef.current.getCenter().lat,
                  lng: mapInstanceRef.current.getCenter().lng,
                }
              : { lat: -6.2088, lng: 106.8456 },
          );
        }}
        onStartAddRoute={() => {
          setSelectedCustomer(null);
          setSelectedDevice(null);
          setSelectedRoute(null);
          setShowHierarchyTree(false);
          setShowAnnotationPanel(false);
          setAnnotationTool(null);
          setAnnotationPoints([]);
          setIsCreatingRouteModal(true);
        }}
        onMenuOpen={closeSidePanels}
        openPanelKey={openPanelKey}
        onToggleTree={() => {
          closeDetailPanels();
          setShowAnnotationPanel(false);
          setAnnotationTool(null);
          setAnnotationPoints([]);
          setShowHierarchyTree(!showHierarchyTree);
        }}
        onOpenGuide={() => setShowGuide(true)}
        isAnnotationOpen={showAnnotationPanel}
        onToggleAnnotation={handleToggleAnnotationPanel}
      />

      {/* Urungkan aksi terakhir (Ctrl+Z); tombol untuk layar sentuh/tablet */}
      {!drawingRoute && (undoCount > 0 || undoNotice) && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[990] flex items-center gap-2 pointer-events-auto">
          {undoNotice && (
            <span role="status" className="px-3 py-1.5 rounded-xl bg-card/95 backdrop-blur-md border border-border shadow-lg text-[11px] text-foreground">
              {undoNotice}
            </span>
          )}
          {undoCount > 0 && (
            <button
              type="button"
              onClick={() => void handleUndo()}
              disabled={undoing}
              title="Urungkan aksi terakhir (Ctrl+Z)"
              className="px-3 py-1.5 rounded-xl bg-card/95 backdrop-blur-md border border-border shadow-lg text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {undoing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Undo2 className="w-3.5 h-3.5" />}
              Urungkan ({undoCount})
            </button>
          )}
        </div>
      )}

      {/* Floating Legenda (Pojok Kiri Bawah) */}
      <div className="absolute bottom-6 left-3 z-[980] pointer-events-none flex flex-col gap-2">
        {mapData && (
          <AlertWidget
            customers={mapData.customers}
            devices={mapData.devices}
            onSelect={handleSelectTreeNode}
          />
        )}
        <MapLegends />
      </div>

      {/* Mode Penempatan Eksplisit (Banner & Form Floating) */}
      {placementMode && (
      <PlacementOverlay
        mode={placementMode}
        coordinates={placementCoords}
        onCoordinatesChange={(coords) => setPlacementCoords(coords)}
        availableDevices={mapData?.devices || []}
        availableCustomers={mapData?.customers || []}
        routeOptions={placementRouteOptions}
        initialRouteId={placementRouteId}
        initialOdpId={placementMode === "customer" ? placementOdpId : ""}
        onSave={handleSavePlacement}
        onCancel={() => {
          setPlacementMode(null);
          setPlacementCoords(null);
        }}
      />
      )}

      {/* Bar Bantuan Mode Gambar Jalur Kabel */}
      {drawingRoute && (
        <SegmentDrawingBar
          route={drawingRoute}
          chain={routeChainDeviceIds(
            drawingRoute.fromDeviceId,
            (mapData?.segments || []).filter((s) => s.routeId === drawingRoute.id),
          ).flatMap((id) => mapData?.devices.find((d) => d.id === id) ?? [])}
          editingSegment={editingSegment}
          pointCount={drawingPoints.length}
          devices={mapData?.devices || []}
          customers={mapData?.customers || []}
          fromDeviceId={drawingFrom}
          onFromChange={setDrawingFrom}
          target={drawingTarget}
          onTargetChange={setDrawingTarget}
          preview={activeSnapPreview}
          saving={savingSegment}
          error={segmentError}
          onUndo={() => setDrawingPoints((prev) => prev.slice(0, -1))}
          onCancel={() => {
            setDrawingRoute(null);
            setDrawingPoints([]);
          }}
          onSave={handleSaveDrawnSegment}
          // Prefix: saudara DevicePanel memakai ID perangkat yang sama sebagai key
          key={`draw:${drawingFrom}`}
        />
      )}

      {/* Panel Pelanggan (Level 1 & Stacked Level 2) */}
      {selectedCustomer && (
        <CustomerPanel
          key={selectedCustomer.id}
          customer={selectedCustomer}
          subPanel={customerSubPanel}
          onSubPanelChange={(p) => {
            setCustomerSubPanel(p);
            syncUrlState({ customer: selectedCustomer.id, panel: p });
          }}
          onClose={() => {
            setSelectedCustomer(null);
            setCustomerSubPanel(null);
            syncUrlState({});
          }}
          onUpdateCoordinates={handleUpdateCustomerLocation}
          devices={mapData?.devices || []}
          segments={mapData?.segments || []}
          coordDraft={
            activeDraft ? { lat: activeDraft.lat, lng: activeDraft.lng } : null
          }
          onCoordDraftChange={(d) =>
            setCoordDraftState(
              d ? { key: `customer:${selectedCustomer.id}`, ...d } : null,
            )
          }
        />
      )}

      {/* Panel Perangkat */}
      {selectedDevice && (
        <DevicePanel
          key={selectedDevice.id}
          device={selectedDevice}
          allDevices={mapData?.devices || []}
          allCustomers={mapData?.customers || []}
          connectedCustomers={(mapData?.customers || []).filter(
            (c) => c.odpId === selectedDevice.id,
          )}
          cablesIn={routesTouchingDevice(mapData, selectedDevice.id, "toDeviceId")}
          cablesOut={routesTouchingDevice(
            mapData,
            selectedDevice.id,
            "fromDeviceId",
          )}
          onUpdateNotes={handleUpdateDeviceNotes}
          onClose={() => {
            setSelectedDevice(null);
            syncUrlState({});
          }}
          onUpdateCoordinates={handleUpdateDeviceLocation}
          onUpdateParent={handleUpdateDeviceParent}
          onDeleteDevice={handleDeleteDevice}
          coordDraft={
            activeDraft ? { lat: activeDraft.lat, lng: activeDraft.lng } : null
          }
          onCoordDraftChange={(d) =>
            setCoordDraftState(
              d ? { key: `device:${selectedDevice.id}`, ...d } : null,
            )
          }
          onSelectCustomer={(c) => {
            setSelectedCustomer(c);
            setCustomerSubPanel("detail");
            setSelectedDevice(null);
            syncUrlState({ customer: c.id, panel: "detail" });
          }}
          segments={mapData?.segments || []}
          onSetCustomerPort={(id, port) =>
            saveMapChange(`/api/peta/customers/${id}/port`, "PUT", { port })
          }
          onSetDevicePort={(id, port, odcId) =>
            saveMapChange(`/api/peta/devices/${id}/port`, "PUT", { port, odcId })
          }
          onSetSplitterRatio={(id, splitterRatio) =>
            saveMapChange(`/api/peta/devices/${id}`, "PATCH", { splitterRatio })
          }
          onLinkOlt={(id, centralOltId) =>
            saveMapChange(`/api/peta/devices/${id}`, "PATCH", { centralOltId })
          }
          onSetSplitterTap={(id, splitterTap) =>
            saveMapChange(`/api/peta/devices/${id}`, "PATCH", { splitterTap })
          }
          onSetDeviceType={(id, type) =>
            saveMapChange(`/api/peta/devices/${id}`, "PATCH", { type })
          }
          onSelectDevice={(d) => {
            setSelectedDevice(d);
            syncUrlState({ device: d.id });
          }}
          onUpdateRoutePon={(routeId, pon) => handleUpdateRoute(routeId, { pon })}
          onSelectRoute={(r) => {
            setSelectedDevice(null);
            setSelectedRoute(r);
            syncUrlState({ route: r.id });
          }}
          onConnectCustomer={(odp) => {
            // Form Hubungkan Pelanggan dengan ODP ini terpilih; titik pelanggan diklik di peta
            setSelectedDevice(null);
            syncUrlState({});
            setPlacementOdpId(odp.id);
            setPlacementMode("customer");
            setPlacementCoords({ lat: odp.latitude, lng: odp.longitude });
          }}
        />
      )}

      {/* Panel Rute Kabel */}
      {selectedRoute && (
        <RoutePanel
          route={selectedRoute}
          segments={(mapData?.segments || []).filter(
            (s) => s.routeId === selectedRoute.id,
          )}
          devices={mapData?.devices || []}
          customers={mapData?.customers || []}
          onClose={() => {
            setSelectedRoute(null);
            syncUrlState({});
          }}
          onAddSegment={(route) => startDrawing(route)}
          onAddDevice={(route) => {
            setSelectedRoute(null);
            syncUrlState({});
            setPlacementRouteId(route.id);
            setPlacementMode("device");
            const center = mapInstanceRef.current?.getCenter();
            if (center) setPlacementCoords({ lat: center.lat, lng: center.lng });
          }}
          onEditSegment={(route, segment) => startDrawing(route, segment)}
          routes={mapData?.routes || []}
          onUpdateRoute={(data) => handleUpdateRoute(selectedRoute.id, data)}
        />
      )}

      {/* Panel Pohon Hierarki Relasi */}
      {showHierarchyTree && (
        <HierarchyTreePanel
          tree={hierarchyTreeData}
          onClose={() => setShowHierarchyTree(false)}
          onSelectNode={handleSelectTreeNode}
        />
      )}

      {/* Modal Pembuatan Identitas Jalur Kabel */}
      {/* Dipasang ulang tiap dibuka agar identitas otomatis dihitung dari data terbaru */}
      {isCreatingRouteModal && (
        <RouteDrawingModal
          isOpen
          onClose={() => setIsCreatingRouteModal(false)}
          devices={mapData?.devices || []}
          routes={mapData?.routes || []}
          onCreateRoute={handleCreateRoute}
        />
      )}

      {/* Modal Panduan Singkat */}
      <QuickGuideModal
        isOpen={showGuide}
        onClose={() => setShowGuide(false)}
      />

      {/* Bar Bantuan Mode Gambar Anotasi */}
      {annotationTool && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1000] bg-card/95 backdrop-blur-md border border-primary/40 shadow-2xl rounded-2xl p-3 flex items-center gap-3 text-xs pointer-events-auto">
          <div className="flex flex-col">
            <span className="font-semibold text-foreground flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              Mode Gambar:{" "}
              {annotationTool === "rect"
                ? "Kotak / Zona"
                : annotationTool === "circle"
                  ? "Radius Sinyal"
                  : annotationTool === "label"
                    ? "Tanda Label"
                    : "Panah Arah"}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {annotationPoints.length === 0
                ? "Klik titik pertama pada peta..."
                : annotationTool === "circle" || annotationTool === "label"
                  ? "Titik lokasi dipilih. Lengkapi di panel samping."
                  : annotationPoints.length === 1
                    ? "Klik titik kedua pada peta..."
                    : "2 Titik dipilih. Lengkapi di panel samping."}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setAnnotationTool(null);
                setAnnotationPoints([]);
              }}
              className="px-2.5 py-1.5 rounded-lg border border-border text-muted-foreground hover:bg-muted"
            >
              Batal
            </button>
          </div>
        </div>
      )}

      {/* Panel Lapisan Gambar & Anotasi */}
      {showAnnotationPanel && (
        <AnnotationPanel
          layers={layers}
          onClose={() => {
            setShowAnnotationPanel(false);
            setAnnotationTool(null);
            setAnnotationPoints([]);
          }}
          onRefreshLayers={handleRefreshLayers}
          onUndoable={pushUndo}
          onGetCenterCoords={() =>
            mapInstanceRef.current
              ? [
                  mapInstanceRef.current.getCenter().lat,
                  mapInstanceRef.current.getCenter().lng,
                ]
              : mapConfig?.defaultCenter || [-6.2088, 106.8456]
          }
          activeTool={annotationTool}
          onSelectTool={setAnnotationTool}
          collectedPoints={annotationPoints}
          onClearPoints={() => setAnnotationPoints([])}
        />
      )}

      {/* Floating Zoom & Center Controls (Pojok Kanan Bawah - Fase 1 PRD) */}
      <div className="absolute bottom-6 right-3 z-[980] flex flex-col gap-1.5 pointer-events-auto">
        <button
          onClick={() => mapInstanceRef.current?.zoomIn()}
          className="w-8 h-8 rounded-xl bg-card/95 backdrop-blur-md border border-border text-foreground hover:bg-muted shadow-lg flex items-center justify-center font-bold text-base transition-colors"
          title="Perbesar Peta (Zoom In)"
        >
          <Plus className="w-4 h-4" />
        </button>
        <button
          onClick={() => mapInstanceRef.current?.zoomOut()}
          className="w-8 h-8 rounded-xl bg-card/95 backdrop-blur-md border border-border text-foreground hover:bg-muted shadow-lg flex items-center justify-center font-bold text-base transition-colors"
          title="Perkecil Peta (Zoom Out)"
        >
          <Minus className="w-4 h-4" />
        </button>
        <button
          onClick={() => {
            if (mapInstanceRef.current && mapConfig) {
              mapInstanceRef.current.setView(
                mapConfig.defaultCenter,
                mapConfig.defaultZoom,
              );
            }
          }}
          className="w-8 h-8 rounded-xl bg-card/95 backdrop-blur-md border border-border text-foreground hover:bg-muted shadow-lg flex items-center justify-center text-xs transition-colors"
          title="Pusatkan Ulang Peta"
        >
          <Locate className="w-4 h-4 text-primary" />
        </button>
      </div>
    </div>
  );
}
