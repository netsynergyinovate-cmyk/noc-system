"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import L from "leaflet";
import type { DivIcon, LatLngBoundsExpression, Map as LeafletMap } from "leaflet";

interface LeafletTileLayerInternal {
  options: {
    subdomains?: string[] | string;
    [key: string]: unknown;
  };
  _getSubdomain: (coords: { x: number; y: number }) => string;
}

// Pertahanan runtime global: Cegah crash TileLayer._getSubdomain jika subdomains undefined/kosong
if (typeof window !== "undefined") {
  const tileLayerProto = (
    L.TileLayer as unknown as { prototype: LeafletTileLayerInternal }
  )?.prototype;
  if (tileLayerProto?._getSubdomain) {
    const originalGetSubdomain = tileLayerProto._getSubdomain;
    tileLayerProto._getSubdomain = function (
      this: LeafletTileLayerInternal,
      coords: { x: number; y: number },
    ) {
      if (
        !this.options ||
        !Array.isArray(this.options.subdomains) ||
        this.options.subdomains.length === 0
      ) {
        this.options = this.options || {};
        this.options.subdomains = ["a", "b", "c"];
      }
      return originalGetSubdomain.call(this, coords);
    };
  }
}
import {
  Circle,
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  Tooltip,
  useMapEvents,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import {
  AlertTriangle,
  Copy,
  Crosshair,
  Database,
  ExternalLink,
  Filter,
  Layers,
  Loader2,
  MapPin,
  MapPinOff,
  Maximize2,
  Move,
  Navigation,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Share2,
  WifiOff,
  X,
} from "lucide-react";
import Link from "next/link";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CustomerDetailPanel } from "./customer-detail-panel";
import { DeviceDetailPanel } from "./device-detail-panel";
import { MapDetailInspectorLayer } from "./map-detail-inspector-layer";
import { useMapDetailPanel } from "./use-map-detail-panel";
import { NetworkMapLegend } from "./network-map-legend";
import { MapSymbolsGuideDialog } from "./map-symbols-guide-dialog";
import { CustomerCoordinatePickerModal } from "./customer-coordinate-picker-modal";
import {
  DeviceTypePicker,
  type InfrastructureDeviceType,
} from "./device-type-picker";
import type {
  NetworkCustomerPoint,
  NetworkInfrastructurePoint,
  NetworkMapData,
} from "@/services/network-map.service";

import {
  DEFAULT_MAP_CENTER,
  DEFAULT_MAP_ZOOM,
  getTileProviders,
  type MapLayerId,
  type TileProviderConfig,
} from "@/config/map";
import { INFRASTRUCTURE_DEVICE_CONFIG } from "@/config/map-infrastructure";
import { getZoomScaledLineWeight } from "@/lib/hierarchy-lineage";
import { generateRoadBendedPolyline } from "@/lib/cable-path-routing";
import { resolveCableCapacityStyle } from "@/config/cable-capacity";
import {
  flyToWithoutOcclusion,
  calculatePanelClearanceLatLng,
} from "@/lib/map-viewport-offset";

export {
  CustomerDetailPanel,
  DeviceDetailPanel,
  MapDetailInspectorLayer,
  useMapDetailPanel,
  NetworkMapLegend,
  MapSymbolsGuideDialog,
  flyToWithoutOcclusion,
  calculatePanelClearanceLatLng,
};
export type { MapLayerId };
export type TileProvider = TileProviderConfig;
export const TILE_PROVIDERS: Record<MapLayerId, TileProvider> = getTileProviders();
export const DEFAULT_CENTER: [number, number] = DEFAULT_MAP_CENTER;
export const DEFAULT_ZOOM = DEFAULT_MAP_ZOOM;

export interface NetworkMapProps {
  data?: NetworkMapData;
  initialData?: NetworkMapData;
  customers?: NetworkCustomerPoint[];
  infrastructure?: NetworkInfrastructurePoint[];
  initialFocusId?: string;
  focusedNodeId?: string | null;
  onSelectCustomer?: (customer: NetworkCustomerPoint | null) => void;
  onSelectInfrastructure?: (infra: NetworkInfrastructurePoint | null) => void;
  onMapReady?: (map: LeafletMap) => void;
  className?: string;
}

function MapZoomTracker({ onZoomChange }: { onZoomChange: (zoom: number) => void }) {
  useMapEvents({
    zoomend(e) {
      onZoomChange(e.target.getZoom());
    },
  });
  return null;
}

function MapViewportTracker({
  onViewportChange,
}: {
  onViewportChange: (bounds: L.LatLngBounds, zoom: number) => void;
}) {
  const map = useMapEvents({
    moveend(e) {
      onViewportChange(e.target.getBounds(), e.target.getZoom());
    },
    zoomend(e) {
      onViewportChange(e.target.getBounds(), e.target.getZoom());
    },
  });

  useEffect(() => {
    if (map) {
      onViewportChange(map.getBounds(), map.getZoom());
    }
  }, [map, onViewportChange]);

  return null;
}

function MapLocationPicker({
  isEditing,
  isPlacing,
  isMovingInfra,
  isPlottingCustomer,
  onSelectLocation,
  onSelectPlacement,
  onSelectInfraMove,
  onSelectPlotting,
  onInspectMapCoord,
  isDrawCable,
  onDrawCableAddPoint,
  onDrawCableMouseMove,
}: {
  isEditing: boolean;
  isPlacing: boolean;
  isMovingInfra?: boolean;
  isPlottingCustomer?: boolean;
  onSelectLocation: (lat: number, lng: number) => void;
  onSelectPlacement: (lat: number, lng: number) => void;
  onSelectInfraMove?: (lat: number, lng: number) => void;
  onSelectPlotting?: (lat: number, lng: number) => void;
  onInspectMapCoord?: (lat: number, lng: number) => void;
  isDrawCable?: boolean;
  onDrawCableAddPoint?: (lat: number, lng: number) => void;
  onDrawCableMouseMove?: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(e) {
      if (isDrawCable && onDrawCableAddPoint) {
        onDrawCableAddPoint(e.latlng.lat, e.latlng.lng);
        return;
      }
      if (isMovingInfra && onSelectInfraMove) {
        onSelectInfraMove(e.latlng.lat, e.latlng.lng);
      } else if (isPlacing) {
        onSelectPlacement(e.latlng.lat, e.latlng.lng);
      } else if (isPlottingCustomer && onSelectPlotting) {
        onSelectPlotting(e.latlng.lat, e.latlng.lng);
      } else if (isEditing) {
        onSelectLocation(e.latlng.lat, e.latlng.lng);
      } else if (onInspectMapCoord) {
        onInspectMapCoord(e.latlng.lat, e.latlng.lng);
      }
    },
    mousemove(e) {
      if (isDrawCable && onDrawCableMouseMove) {
        onDrawCableMouseMove(e.latlng.lat, e.latlng.lng);
      }
    },
  });
  return null;
}

export function NetworkMap({
  data: propData,
  initialData,
  customers: propCustomers,
  infrastructure: propInfra,
  initialFocusId,
  focusedNodeId,
  onSelectCustomer,
  onSelectInfrastructure,
  onMapReady,
  className,
}: NetworkMapProps) {
  const [fetchedData, setFetchedData] = useState<NetworkMapData | null>(initialData ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(
    !propData && !initialData && !propCustomers && !propInfra,
  );

  // Filter & Search
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "online" | "offline" | "weak" | "isolir" | "geocoded"
  >("all");
  const [regionFilter, setRegionFilter] = useState<string>("all");
  const [isSearchDropdownOpen, setIsSearchDropdownOpen] = useState(false);

  // Layer switches & Tile Error Indicator
  const [layerMode, setLayerMode] = useState<MapLayerId>("satellite");
  const [showCustomers, setShowCustomers] = useState(true);
  const [showInfrastructure, setShowInfrastructure] = useState(true);
  const [showCables, setShowCables] = useState(true);
  const [isLayerMenuOpen, setIsLayerMenuOpen] = useState(false);
  const [tileErrorCount, setTileErrorCount] = useState(0);
  const [isTileErrorDismissed, setIsTileErrorDismissed] = useState(false);

  const handleLayerChange = useCallback((newMode: MapLayerId) => {
    setLayerMode(newMode);
    setTileErrorCount(0);
    setIsTileErrorDismissed(false);
  }, []);

  // Selected item detail panel
  const [selectedCustomer, setSelectedCustomer] = useState<NetworkCustomerPoint | null>(null);
  const [selectedInfra, setSelectedInfra] = useState<NetworkInfrastructurePoint | null>(null);
  const [currentZoom, setCurrentZoom] = useState<number>(DEFAULT_ZOOM);

  // Pelacak area viewport peta Leaflet & optimasi spatial culling (sembunyikan titik di luar layar)
  const [viewportBounds, setViewportBounds] = useState<L.LatLngBounds | null>(null);
  const [enableViewportCulling, setEnableViewportCulling] = useState<boolean>(true);
  const [enableCableOptimization, setEnableCableOptimization] = useState<boolean>(true);

  const handleViewportChange = useCallback(
    (bounds: L.LatLngBounds, zoom: number) => {
      setViewportBounds(bounds);
      setCurrentZoom(zoom);
    },
    [],
  );

  const isPointInViewport = useCallback(
    (lat: number | null, lng: number | null, isHighlighted?: boolean) => {
      if (lat === null || lng === null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
        return false;
      }
      if (!enableViewportCulling || !viewportBounds) {
        return true;
      }
      if (isHighlighted) {
        return true;
      }
      // Margin buffer 15% agar titik di tepi batas pandang tidak muncul mendadak (pop-in) saat peta digeser
      const paddedBounds = viewportBounds.pad ? viewportBounds.pad(0.15) : viewportBounds;
      return paddedBounds.contains(L.latLng(lat, lng));
    },
    [enableViewportCulling, viewportBounds],
  );

  // Optimasi render ribuan jalur kabel: spatial viewport bounds culling & level-of-detail (LOD)
  const isCableInViewport = useCallback(
    (
      cable: {
        path: [number, number][];
        type: "backbone" | "feeder" | "distribution" | "drop";
        isHighlighted?: boolean;
      },
      bounds: L.LatLngBounds | null,
      zoom: number,
      enableOptimization: boolean,
    ) => {
      if (!enableOptimization || !bounds) {
        return true;
      }
      // Kabel yang sedang disorot/dipilih operator wajib selalu tampil
      if (cable.isHighlighted) {
        return true;
      }
      // Level-of-Detail (LOD): Pada zoom jauh (zoom < 13), sembunyikan kabel drop pelanggan agar tidak menjadi benang kusut yang membebani DOM
      if (zoom < 13 && cable.type === "drop") {
        return false;
      }
      // Periksa apakah jalur kabel beririsan dengan area viewport (dengan buffer margin 15%)
      if (!cable.path || cable.path.length === 0) {
        return false;
      }
      const paddedBounds = bounds.pad ? bounds.pad(0.15) : bounds;

      let minLat = Infinity;
      let maxLat = -Infinity;
      let minLng = Infinity;
      let maxLng = -Infinity;

      for (const [lat, lng] of cable.path) {
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
          if (lng < minLng) minLng = lng;
          if (lng > maxLng) maxLng = lng;
        }
      }

      if (!Number.isFinite(minLat) || !Number.isFinite(maxLat)) {
        return false;
      }

      const cableBounds = L.latLngBounds([minLat, minLng], [maxLat, maxLng]);
      return paddedBounds.intersects(cableBounds);
    },
    [],
  );

  // Mode Geser & Simpan Posisi Titik Pelanggan
  const [isEditingLocation, setIsEditingLocation] = useState(false);
  const [draftCoords, setDraftCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [isSavingLocation, setIsSavingLocation] = useState(false);
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const [dragPinIcon, setDragPinIcon] = useState<DivIcon | null>(null);
  const [isDeletingCustomer, setIsDeletingCustomer] = useState(false);

  // Mode Penentuan / Plotting Titik Pelanggan Baru & Inspeksi Koordinat
  const [isCustomerPickerOpen, setIsCustomerPickerOpen] = useState(false);
  const [plottingCustomer, setPlottingCustomer] = useState<NetworkCustomerPoint | null>(null);
  const [inspectedMapCoord, setInspectedMapCoord] = useState<{ lat: number; lng: number } | null>(null);
  const [isUnmappedDismissed, setIsUnmappedDismissed] = useState(false);
  const [isCopiedCoord, setIsCopiedCoord] = useState(false);

  // Mode Inspeksi Koordinat Klik Peta (harus diaktifkan manual)
  const [isInspectModeActive, setIsInspectModeActive] = useState(false);

  // Mode Input Titik Koordinat GPS Manual
  const [isManualCoordModalOpen, setIsManualCoordModalOpen] = useState(false);
  const [manualCoordInput, setManualCoordInput] = useState("");
  const [manualCoordError, setManualCoordError] = useState<string | null>(null);
  const [manualCoordSuccess, setManualCoordSuccess] = useState<string | null>(null);

  // Mode Penempatan Perangkat Infrastruktur
  const [isPlacementPickerOpen, setIsPlacementPickerOpen] = useState(false);
  const [placementType, setPlacementType] = useState<InfrastructureDeviceType | null>(null);
  const [placementDraftCoords, setPlacementDraftCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [isSavingPlacement, setIsSavingPlacement] = useState(false);
  const [placementSuccessMessage, setPlacementSuccessMessage] = useState<string | null>(null);
  const [placementErrorMessage, setPlacementErrorMessage] = useState<string | null>(null);
  const [infraIcons, setInfraIcons] = useState<Record<string, DivIcon>>({});

  // Mode Pindah & Hapus Titik Perangkat Infrastruktur
  const [isMovingInfra, setIsMovingInfra] = useState(false);
  const [infraMoveDraftCoords, setInfraMoveDraftCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [isSavingInfraMove, setIsSavingInfraMove] = useState(false);
  const [isDeletingInfra, setIsDeletingInfra] = useState(false);
  const [isSettingParent, setIsSettingParent] = useState(false);
  const [infraActionSuccessMessage, setInfraActionSuccessMessage] = useState<string | null>(null);
  const [infraActionErrorMessage, setInfraActionErrorMessage] = useState<string | null>(null);

  // Mode Sambung Kabel
  const [isConnectCableMode, setIsConnectCableMode] = useState(false);
  const [connectRouteName, setConnectRouteName] = useState("");
  const [connectSavedSegments, setConnectSavedSegments] = useState(0);
  const [connectSource, setConnectSource] = useState<NetworkInfrastructurePoint | null>(null);
  const [connectTarget, setConnectTarget] = useState<NetworkInfrastructurePoint | null>(null);
  const [showConnectDialog, setShowConnectDialog] = useState(false);
  const [connectCableName, setConnectCableName] = useState("");
  const [connectCableType, setConnectCableType] = useState("distribution");
  const [connectCableCapacity, setConnectCableCapacity] = useState(12);
  const [connectCableColor, setConnectCableColor] = useState("#3b82f6");
  const [isSavingCable, setIsSavingCable] = useState(false);
  const [connectCableError, setConnectCableError] = useState<string | null>(null);

  // Mode Gambar Kabel (free draw)
  const [isDrawCableMode, setIsDrawCableMode] = useState(false);
  const [drawWaypoints, setDrawWaypoints] = useState<[number, number][]>([]);
  const [drawMousePos, setDrawMousePos] = useState<[number, number] | null>(null);
  const [drawFirstNodeId, setDrawFirstNodeId] = useState<string | null>(null);
  const [drawLastNodeId, setDrawLastNodeId] = useState<string | null>(null);
  const [showDrawDialog, setShowDrawDialog] = useState(false);
  const [drawCableName, setDrawCableName] = useState("");
  const [drawCableType, setDrawCableType] = useState("distribution");
  const [drawCableCapacity, setDrawCableCapacity] = useState(12);
  const [drawCableColor, setDrawCableColor] = useState("#3b82f6");
  const [isSavingDraw, setIsSavingDraw] = useState(false);
  const [drawCableError, setDrawCableError] = useState<string | null>(null);

  // Inisialisasi ikon drag pin & ikon unik tiap jenis perangkat infrastruktur Leaflet
  useEffect(() => {
    if (typeof window !== "undefined") {
      import("leaflet").then((leafletModule) => {
        const leaflet = leafletModule.default || leafletModule;
        const icon = leaflet.divIcon({
          className: "custom-customer-drag-pin",
          html: `
            <div class="relative flex flex-col items-center -translate-x-1/2 -translate-y-full cursor-grab active:cursor-grabbing">
              <div class="size-9 rounded-full bg-rose-600 text-white shadow-2xl flex items-center justify-center ring-4 ring-rose-500/40 animate-pulse border-2 border-white">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="3"></circle>
                  <path d="M12 2v3m0 14v3M2 12h3m14 0h3"></path>
                </svg>
              </div>
              <div class="w-2.5 h-2.5 bg-rose-600 rotate-45 -mt-1 border-r border-b border-white"></div>
              <span class="mt-1 bg-black/85 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow-md whitespace-nowrap border border-white/20">
                Geser Titik
              </span>
            </div>
          `,
          iconSize: [36, 48],
          iconAnchor: [18, 48],
        });
        setDragPinIcon(icon);

        // Inisialisasi ikon vektor unik tiap jenis perangkat infrastruktur
        const icons: Record<string, DivIcon> = {};
        for (const [key, cfg] of Object.entries(INFRASTRUCTURE_DEVICE_CONFIG)) {
          icons[key] = leaflet.divIcon({
            className: `custom-infra-icon custom-infra-${key}`,
            html: `
              <div style="width: ${cfg.radius * 2}px; height: ${cfg.radius * 2}px;" class="flex items-center justify-center pointer-events-none text-white drop-shadow-sm">
                ${cfg.iconSvg}
              </div>
            `,
            iconSize: [cfg.radius * 2, cfg.radius * 2],
            iconAnchor: [cfg.radius, cfg.radius],
          });
        }
        setInfraIcons(icons);
      });
    }
  }, []);

  // Geolocation
  const [userLocation, setUserLocation] = useState<{
    lat: number;
    lng: number;
    accuracy: number;
  } | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [geoStatus, setGeoStatus] = useState<string | null>(null);

  const [map, setMap] = useState<LeafletMap | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);

  const handleMapRef = useCallback(
    (mapInstance: LeafletMap | null) => {
      setMap(mapInstance);
      if (mapInstance && onMapReady) {
        onMapReady(mapInstance);
      }
    },
    [onMapReady],
  );

  // Pertahankan geometri peta saat panel detail dibuka/ditutup tanpa me-reset objek
  useEffect(() => {
    if (!map) return;
    const timer = setTimeout(() => {
      map.invalidateSize({ pan: false });
    }, 120);
    return () => clearTimeout(timer);
  }, [map, selectedCustomer, selectedInfra]);

  // Pantau ukuran fisik container peta jika layout berubah (misal toggle sidebar/panel)
  useEffect(() => {
    if (!map || !mapContainerRef.current) return;
    const container = mapContainerRef.current;
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      map.invalidateSize({ pan: false });
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, [map]);

  // Fetch data dari endpoint nyata (dipanggil via tombol refresh)
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/map/network", { credentials: "same-origin" });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: Gagal memuat data peta dari server`);
      }
      const json = await res.json();
      if (json.success && json.data) {
        setFetchedData(json.data);
        setLoadError(null);
      } else {
        throw new Error(json.error || "Format data peta tidak valid");
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Koneksi ke server gagal");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Turunkan data efektif dari prop eksternal atau hasil fetch/initialData tanpa set-state-in-effect
  const data = useMemo<NetworkMapData | null>(() => {
    if (propData) return propData;

    if (propCustomers || propInfra) {
      const base = fetchedData ?? {
        customers: [],
        infrastructure: [],
        summary: {
          totalCustomers: 0,
          geocodedCustomers: 0,
          onlineCustomers: 0,
          offlineCustomers: 0,
          criticalOpticsCount: 0,
          totalOlts: 0,
          totalRouters: 0,
          totalOdps: 0,
        },
        dataSource: {
          provider: "Prop Data Eksternal",
          isRealData: true,
          lastSynchronizedAt: new Date().toISOString(),
        },
      };

      const custs = propCustomers ?? base.customers;
      const infras = propInfra ?? base.infrastructure;

      return {
        ...base,
        customers: custs,
        infrastructure: infras,
        summary: {
          ...base.summary,
          totalCustomers: custs.length,
          geocodedCustomers: custs.filter(
            (c) =>
              c.latitude !== null &&
              c.longitude !== null &&
              Number.isFinite(c.latitude) &&
              Number.isFinite(c.longitude),
          ).length,
        },
      };
    }

    return fetchedData;
  }, [propData, propCustomers, propInfra, fetchedData]);

  const initialFocusAppliedRef = useRef(false);
  useEffect(() => {
    if (!initialFocusId || initialFocusAppliedRef.current || !data) return;
    const targetCust = data.customers?.find(
      (c) => c.id === initialFocusId || c.pppoeUsername === initialFocusId,
    );
    if (targetCust) {
      initialFocusAppliedRef.current = true;
      const timer = setTimeout(() => {
        setSelectedCustomer(targetCust);
        if (
          map &&
          targetCust.latitude !== null &&
          targetCust.longitude !== null &&
          Number.isFinite(targetCust.latitude) &&
          Number.isFinite(targetCust.longitude)
        ) {
          flyToWithoutOcclusion(map, targetCust.latitude, targetCust.longitude, 17, { duration: 1 });
        }
      }, 0);
      return () => clearTimeout(timer);
    }

    const targetInfra = data.infrastructure?.find((inf) => inf.id === initialFocusId);
    if (targetInfra) {
      initialFocusAppliedRef.current = true;
      const timer = setTimeout(() => {
        setSelectedInfra(targetInfra);
        if (
          map &&
          Number.isFinite(targetInfra.latitude) &&
          Number.isFinite(targetInfra.longitude)
        ) {
          flyToWithoutOcclusion(map, targetInfra.latitude, targetInfra.longitude, 17, { duration: 1 });
        }
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [data, initialFocusId, map]);

  // Efek penyorotan titik dan navigasi kamera saat focusedNodeId berubah dari panel pohon
  useEffect(() => {
    if (!focusedNodeId || !data) return;

    // 1. Cek pada simpul infrastruktur (Server, ODC, ODP)
    const targetInfra = data.infrastructure?.find((inf) => inf.id === focusedNodeId);
    if (targetInfra) {
      const timer = setTimeout(() => {
        setSelectedInfra(targetInfra);
        setSelectedCustomer(null);
        if (
          map &&
          Number.isFinite(targetInfra.latitude) &&
          Number.isFinite(targetInfra.longitude)
        ) {
          flyToWithoutOcclusion(
            map,
            targetInfra.latitude,
            targetInfra.longitude,
            Math.max(map.getZoom(), 17),
            { duration: 0.8 },
          );
        }
      }, 0);
      return () => clearTimeout(timer);
    }

    // 2. Cek pada simpul pelanggan akhir
    const targetCust = data.customers?.find(
      (c) => c.id === focusedNodeId || c.pppoeUsername === focusedNodeId,
    );
    if (targetCust) {
      const timer = setTimeout(() => {
        setSelectedCustomer(targetCust);
        setSelectedInfra(null);
        if (
          map &&
          targetCust.latitude !== null &&
          targetCust.longitude !== null &&
          Number.isFinite(targetCust.latitude) &&
          Number.isFinite(targetCust.longitude)
        ) {
          flyToWithoutOcclusion(
            map,
            targetCust.latitude,
            targetCust.longitude,
            Math.max(map.getZoom(), 17),
            { duration: 0.8 },
          );
        }
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [data, focusedNodeId, map]);

  const handleSelectCustomer = useCallback(
    (cust: NetworkCustomerPoint | null) => {
      setSelectedCustomer(cust);
      if (cust) {
        setSelectedInfra(null);
        if (
          map &&
          cust.latitude !== null &&
          cust.longitude !== null &&
          Number.isFinite(cust.latitude) &&
          Number.isFinite(cust.longitude)
        ) {
          flyToWithoutOcclusion(
            map,
            cust.latitude,
            cust.longitude,
            Math.max(map.getZoom(), 17),
            { duration: 0.8 },
          );
        }
      }
      setIsEditingLocation(false);
      setDraftCoords(null);
      setSaveErrorMessage(null);
      setSaveSuccessMessage(null);
      onSelectCustomer?.(cust);
    },
    [onSelectCustomer, map],
  );

  const handleToggleEditLocation = useCallback(() => {
    if (isEditingLocation) {
      setIsEditingLocation(false);
      setDraftCoords(null);
      setSaveErrorMessage(null);
    } else if (selectedCustomer) {
      setIsEditingLocation(true);
      setSaveSuccessMessage(null);
      setSaveErrorMessage(null);
      const initialLat = selectedCustomer.latitude ?? DEFAULT_CENTER[0];
      const initialLng = selectedCustomer.longitude ?? DEFAULT_CENTER[1];
      setDraftCoords({ lat: initialLat, lng: initialLng });
      if (map) {
        map.flyTo([initialLat, initialLng], 17, { duration: 0.6 });
      }
    }
  }, [isEditingLocation, selectedCustomer, map]);

  const handleCancelEditLocation = useCallback(() => {
    setIsEditingLocation(false);
    setDraftCoords(null);
    setSaveErrorMessage(null);
  }, []);

  const handleSaveLocation = useCallback(async () => {
    if (!selectedCustomer || !draftCoords) return;
    setIsSavingLocation(true);
    setSaveErrorMessage(null);
    setSaveSuccessMessage(null);

    try {
      const res = await fetch(`/api/customers/${selectedCustomer.id}/location`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          latitude: draftCoords.lat,
          longitude: draftCoords.lng,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Gagal menyimpan koordinat titik pelanggan.");
      }

      const updatedCustomer: NetworkCustomerPoint = {
        ...selectedCustomer,
        latitude: draftCoords.lat,
        longitude: draftCoords.lng,
      };

      setSelectedCustomer(updatedCustomer);
      onSelectCustomer?.(updatedCustomer);

      setFetchedData((prev) => {
        if (!prev) return prev;
        const updatedCustomers = prev.customers.map((c) =>
          c.id === updatedCustomer.id ? updatedCustomer : c,
        );
        const geocodedCustomers = updatedCustomers.filter(
          (c) => c.latitude !== null && c.longitude !== null,
        );
        return {
          ...prev,
          customers: updatedCustomers,
          summary: {
            ...prev.summary,
            geocodedCustomers: geocodedCustomers.length,
            unmappedCustomers: updatedCustomers.length - geocodedCustomers.length,
          },
        };
      });

      setSaveSuccessMessage("Posisi titik pelanggan berhasil disimpan ke database.");
      setIsEditingLocation(false);
      setTimeout(() => setSaveSuccessMessage(null), 4000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSaveErrorMessage(msg);
    } finally {
      setIsSavingLocation(false);
    }
  }, [selectedCustomer, draftCoords, onSelectCustomer]);

  const handleSelectCustomerForPlotting = useCallback(
    (customer: NetworkCustomerPoint) => {
      setPlottingCustomer(customer);
      setIsUnmappedDismissed(true);
      setSelectedCustomer(null);
      setSelectedInfra(null);
      setIsPlacementPickerOpen(false);
      setPlacementType(null);
      setPlacementDraftCoords(null);
      setIsMovingInfra(false);
      setInfraMoveDraftCoords(null);
      setIsEditingLocation(false);

      if (inspectedMapCoord) {
        setDraftCoords(inspectedMapCoord);
      } else if (customer.latitude !== null && customer.longitude !== null) {
        setDraftCoords({ lat: customer.latitude, lng: customer.longitude });
        if (map) {
          flyToWithoutOcclusion(
            map,
            customer.latitude,
            customer.longitude,
            Math.max(map.getZoom(), 17),
            { duration: 0.6 },
          );
        }
      } else {
        setDraftCoords(null);
      }
    },
    [inspectedMapCoord, map],
  );

  const handleSavePlottedCustomer = useCallback(async () => {
    if (!plottingCustomer || !draftCoords) return;
    setIsSavingLocation(true);
    setSaveErrorMessage(null);
    setSaveSuccessMessage(null);

    try {
      const res = await fetch(`/api/customers/${plottingCustomer.id}/location`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          latitude: draftCoords.lat,
          longitude: draftCoords.lng,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Gagal menyimpan koordinat titik pelanggan ke database.");
      }

      const updatedCustomer: NetworkCustomerPoint = {
        ...plottingCustomer,
        latitude: draftCoords.lat,
        longitude: draftCoords.lng,
      };

      setSelectedCustomer(updatedCustomer);
      onSelectCustomer?.(updatedCustomer);

      setFetchedData((prev) => {
        if (!prev) return prev;
        const updatedCustomers = prev.customers.map((c) =>
          c.id === updatedCustomer.id ? updatedCustomer : c,
        );
        const geocodedCustomers = updatedCustomers.filter(
          (c) => c.latitude !== null && c.longitude !== null,
        );
        return {
          ...prev,
          customers: updatedCustomers,
          summary: {
            ...prev.summary,
            geocodedCustomers: geocodedCustomers.length,
            unmappedCustomers: updatedCustomers.length - geocodedCustomers.length,
          },
        };
      });

      setSaveSuccessMessage(
        `Posisi titik pelanggan '${updatedCustomer.name}' berhasil disimpan ke database.`,
      );
      setPlottingCustomer(null);
      setDraftCoords(null);
      setInspectedMapCoord(null);

      if (
        map &&
        updatedCustomer.latitude !== null &&
        updatedCustomer.longitude !== null
      ) {
        flyToWithoutOcclusion(
          map,
          updatedCustomer.latitude,
          updatedCustomer.longitude,
          Math.max(map.getZoom(), 17),
          { duration: 0.8 },
        );
      }

      setTimeout(() => setSaveSuccessMessage(null), 4000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSaveErrorMessage(msg);
    } finally {
      setIsSavingLocation(false);
    }
  }, [plottingCustomer, draftCoords, map, onSelectCustomer]);

  // Parser titik koordinat fleksibel (mendukung format "lat, lng", "lat lng", atau URL Google Maps)
  const parseCoordinates = useCallback(
    (raw: string): { lat: number; lng: number } | null => {
      if (!raw || typeof raw !== "string") return null;
      const trimmed = raw.trim();

      // Format URL Google Maps: @lat,lng atau q=lat,lng
      const googleMapsMatch =
        /@(-?\d+\.?\d*),(-?\d+\.?\d*)/.exec(trimmed) ||
        /[?&]q=(-?\d+\.?\d*),(-?\d+\.?\d*)/.exec(trimmed);
      if (googleMapsMatch) {
        const lat = parseFloat(googleMapsMatch[1]);
        const lng = parseFloat(googleMapsMatch[2]);
        if (
          Number.isFinite(lat) &&
          Number.isFinite(lng) &&
          lat >= -90 &&
          lat <= 90 &&
          lng >= -180 &&
          lng <= 180
        ) {
          return { lat, lng };
        }
      }

      // Format pasangan desimal: "-2.578556, 101.218500" atau "-2.578556 101.218500"
      const pairMatch = /^(-?\d+\.?\d*)[\s,]+(-?\d+\.?\d*)$/.exec(trimmed);
      if (pairMatch) {
        const lat = parseFloat(pairMatch[1]);
        const lng = parseFloat(pairMatch[2]);
        if (
          Number.isFinite(lat) &&
          Number.isFinite(lng) &&
          lat >= -90 &&
          lat <= 90 &&
          lng >= -180 &&
          lng <= 180
        ) {
          return { lat, lng };
        }
      }

      return null;
    },
    [],
  );

  const handleApplyManualCoord = useCallback(
    (inputString?: string) => {
      const valueToParse = inputString ?? manualCoordInput;
      const parsed = parseCoordinates(valueToParse);
      if (!parsed) {
        setManualCoordError(
          "Format koordinat tidak valid. Gunakan format 'latitude, longitude' (misal: -2.5786, 101.2185) atau tautan Google Maps.",
        );
        return false;
      }

      setManualCoordError(null);
      setManualCoordSuccess(
        `Titik ditemukan: ${parsed.lat.toFixed(6)}, ${parsed.lng.toFixed(6)}`,
      );
      setInspectedMapCoord(parsed);

      if (plottingCustomer) {
        setDraftCoords(parsed);
      }

      if (map) {
        flyToWithoutOcclusion(
          map,
          parsed.lat,
          parsed.lng,
          Math.max(map.getZoom(), 17),
          { duration: 0.8 },
        );
      }

      return true;
    },
    [manualCoordInput, parseCoordinates, map, plottingCustomer],
  );

  const handleConfirmDevicePlacement = useCallback(
    async (point: {
      name: string;
      type: InfrastructureDeviceType;
      latitude: number;
      longitude: number;
      host?: string;
    }) => {
      setIsSavingPlacement(true);
      setPlacementErrorMessage(null);
      setPlacementSuccessMessage(null);

      try {
        const res = await fetch("/api/map/infrastructure", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(point),
        });

        const json = await res.json();
        if (!res.ok || !json.ok) {
          throw new Error(json.error || "Gagal menempatkan titik perangkat infrastruktur.");
        }

        const newPoint: NetworkInfrastructurePoint = json.data;

        // Optimistic update pada state peta lokal
        setFetchedData((prev) => {
          if (!prev) return prev;
          const updatedInfra = [...prev.infrastructure, newPoint];
          return {
            ...prev,
            infrastructure: updatedInfra,
            summary: {
              ...prev.summary,
              totalRouters: newPoint.type === "router" ? prev.summary.totalRouters + 1 : prev.summary.totalRouters,
              totalOlts: newPoint.type === "olt" ? prev.summary.totalOlts + 1 : prev.summary.totalOlts,
              totalOdps: newPoint.type === "odp" ? prev.summary.totalOdps + 1 : prev.summary.totalOdps,
            },
          };
        });

        setSelectedInfra(newPoint);
        setPlacementSuccessMessage(`Perangkat ${newPoint.name} (${newPoint.type.toUpperCase()}) berhasil ditempatkan!`);
        setPlacementDraftCoords(null);
        setPlacementType(null);
        setIsPlacementPickerOpen(false);

        if (map) {
          map.flyTo([newPoint.latitude, newPoint.longitude], 17, { duration: 0.8 });
        }

        setTimeout(() => setPlacementSuccessMessage(null), 4000);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setPlacementErrorMessage(msg);
      } finally {
        setIsSavingPlacement(false);
      }
    },
    [map],
  );

  const handleSelectInfra = useCallback(
    (infra: NetworkInfrastructurePoint | null) => {
      // Jika mode gambar kabel aktif — snap ke node yang diklik
      if (isDrawCableMode && infra) {
        setDrawWaypoints((prev) => {
          if (prev.length === 0) setDrawFirstNodeId(infra.id);
          setDrawLastNodeId(infra.id);
          return [...prev, [infra.latitude, infra.longitude] as [number, number]];
        });
        return;
      }
      // Jika mode sambung kabel aktif
      if (isConnectCableMode && infra) {
        if (!connectSource) {
          setConnectSource(infra);
          return;
        }
        if (infra.id !== connectSource.id) {
          setConnectTarget(infra);
          const prefix = connectRouteName.trim() || "Jalur";
          setConnectCableName(`${prefix} ➔ ${infra.name}`);
          setShowConnectDialog(true);
          return;
        }
        return;
      }
      setSelectedInfra(infra);
      if (infra) {
        setSelectedCustomer(null);
        if (
          map &&
          Number.isFinite(infra.latitude) &&
          Number.isFinite(infra.longitude)
        ) {
          flyToWithoutOcclusion(
            map,
            infra.latitude,
            infra.longitude,
            Math.max(map.getZoom(), 17),
            { duration: 0.8 },
          );
        }
      }
      setIsEditingLocation(false);
      setDraftCoords(null);
      setIsMovingInfra(false);
      setInfraMoveDraftCoords(null);
      onSelectInfrastructure?.(infra);
    },
    [onSelectInfrastructure, map, isConnectCableMode, connectSource, connectRouteName],
  );

  const handleSaveConnectCable = useCallback(async () => {
    if (!connectSource || !connectTarget) return;
    setIsSavingCable(true);
    setConnectCableError(null);
    try {
      const polyline: [number, number][] = [
        [connectSource.latitude, connectSource.longitude],
        [connectTarget.latitude, connectTarget.longitude],
      ];
      const res = await fetch("/api/map/cables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: connectCableName,
          sourceId: connectSource.id,
          targetId: connectTarget.id,
          cableType: connectCableType,
          coreCapacity: connectCableCapacity,
          color: connectCableColor,
          polyline,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Gagal membuat kabel.");
      setConnectSavedSegments((n) => n + 1);
      // Chain: source = target lama, tunggu klik ODP berikutnya
      setConnectSource(connectTarget);
      setConnectTarget(null);
      setShowConnectDialog(false);
      setConnectCableError(null);
      fetchData();
    } catch (err) {
      setConnectCableError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSavingCable(false);
    }
  }, [connectSource, connectTarget, connectCableName, connectCableType, connectCableCapacity, connectCableColor, fetchData, setConnectSavedSegments]);


  const SNAP_DIST = 0.0004; // ~44m

  const handleDrawAddPoint = useCallback((lat: number, lng: number) => {
    let finalLat = lat, finalLng = lng, nodeId: string | null = null;
    for (const infra of (fetchedData?.infrastructure ?? [])) {
      if (Math.abs(infra.latitude - lat) < SNAP_DIST && Math.abs(infra.longitude - lng) < SNAP_DIST) {
        finalLat = infra.latitude; finalLng = infra.longitude; nodeId = infra.id; break;
      }
    }
    setDrawWaypoints((prev) => {
      if (prev.length === 0 && nodeId) setDrawFirstNodeId(nodeId);
      if (nodeId) setDrawLastNodeId(nodeId);
      return [...prev, [finalLat, finalLng]];
    });
  }, [fetchedData]);

  const handleDrawMouseMove = useCallback((lat: number, lng: number) => {
    setDrawMousePos([lat, lng]);
  }, []);

  const handleDrawUndo = useCallback(() => {
    setDrawWaypoints((prev) => prev.slice(0, -1));
  }, []);

  const handleDrawFinish = useCallback(() => {
    if (drawWaypoints.length < 2) return;
    setDrawCableName("Jalur Kabel Baru");
    setShowDrawDialog(true);
  }, [drawWaypoints]);

  const handleSaveDrawCable = useCallback(async () => {
    if (drawWaypoints.length < 2) return;
    setIsSavingDraw(true);
    setDrawCableError(null);
    try {
      const res = await fetch("/api/map/cables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: drawCableName,
          sourceId: drawFirstNodeId ?? `draw-${Date.now()}`,
          targetId: drawLastNodeId,
          cableType: drawCableType,
          coreCapacity: drawCableCapacity,
          color: drawCableColor,
          polyline: drawWaypoints,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Gagal simpan.");
      setShowDrawDialog(false);
      setIsDrawCableMode(false);
      setDrawWaypoints([]);
      setDrawMousePos(null);
      setDrawFirstNodeId(null);
      setDrawLastNodeId(null);
      fetchData();
    } catch (err) {
      setDrawCableError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSavingDraw(false);
    }
  }, [drawWaypoints, drawCableName, drawCableType, drawCableCapacity, drawCableColor, drawFirstNodeId, drawLastNodeId, fetchData]);

  const handleStartMoveInfra = useCallback(() => {
    if (!selectedInfra) return;
    setIsMovingInfra(true);
    setInfraMoveDraftCoords({
      lat: selectedInfra.latitude,
      lng: selectedInfra.longitude,
    });
    setInfraActionSuccessMessage(null);
    setInfraActionErrorMessage(null);
    if (map) {
      map.flyTo([selectedInfra.latitude, selectedInfra.longitude], 17, { duration: 0.6 });
    }
  }, [selectedInfra, map]);

  const handleCancelMoveInfra = useCallback(() => {
    setIsMovingInfra(false);
    setInfraMoveDraftCoords(null);
    setInfraActionErrorMessage(null);
  }, []);

  const handleSaveMoveInfra = useCallback(async () => {
    if (!selectedInfra || !infraMoveDraftCoords) return;
    setIsSavingInfraMove(true);
    setInfraActionErrorMessage(null);

    try {
      const res = await fetch(`/api/map/infrastructure/${selectedInfra.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          latitude: infraMoveDraftCoords.lat,
          longitude: infraMoveDraftCoords.lng,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Gagal memindahkan posisi perangkat.");
      }

      const updatedPoint: NetworkInfrastructurePoint = {
        ...selectedInfra,
        latitude: infraMoveDraftCoords.lat,
        longitude: infraMoveDraftCoords.lng,
      };

      setFetchedData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          infrastructure: prev.infrastructure.map((i) =>
            i.id === selectedInfra.id ? updatedPoint : i,
          ),
        };
      });

      setSelectedInfra(updatedPoint);
      setIsMovingInfra(false);
      setInfraMoveDraftCoords(null);
      setInfraActionSuccessMessage(`Posisi perangkat '${updatedPoint.name}' berhasil diperbarui.`);
      setTimeout(() => setInfraActionSuccessMessage(null), 4000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setInfraActionErrorMessage(msg);
    } finally {
      setIsSavingInfraMove(false);
    }
  }, [selectedInfra, infraMoveDraftCoords]);

  const handleDeleteInfra = useCallback(async () => {
    if (!selectedInfra) return;
    setIsDeletingInfra(true);
    setInfraActionErrorMessage(null);

    try {
      const res = await fetch(`/api/map/infrastructure/${selectedInfra.id}`, {
        method: "DELETE",
      });

      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Gagal menghapus perangkat infrastruktur.");
      }

      const deletedId = selectedInfra.id;
      const deletedName = selectedInfra.name;
      const deletedType = selectedInfra.type;

      setFetchedData((prev) => {
        if (!prev) return prev;
        const updatedInfra = prev.infrastructure.filter((i) => i.id !== deletedId);
        return {
          ...prev,
          infrastructure: updatedInfra,
          summary: {
            ...prev.summary,
            totalRouters: deletedType === "router" ? Math.max(0, prev.summary.totalRouters - 1) : prev.summary.totalRouters,
            totalOlts: deletedType === "olt" ? Math.max(0, prev.summary.totalOlts - 1) : prev.summary.totalOlts,
            totalOdps: deletedType === "odp" ? Math.max(0, prev.summary.totalOdps - 1) : prev.summary.totalOdps,
          },
        };
      });

      setSelectedInfra(null);
      setIsMovingInfra(false);
      setInfraMoveDraftCoords(null);
      setInfraActionSuccessMessage(`Perangkat '${deletedName}' berhasil dihapus dari peta.`);
      setTimeout(() => setInfraActionSuccessMessage(null), 4000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setInfraActionErrorMessage(msg);
    } finally {
      setIsDeletingInfra(false);
    }
  }, [selectedInfra]);

  const handleSetParent = useCallback(async (parentId: string | null) => {
    if (!selectedInfra) return;
    setIsSettingParent(true);
    try {
      const res = await fetch(`/api/map/infrastructure/${selectedInfra.id}/parent`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentId }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Gagal set parent.");
      setFetchedData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          infrastructure: prev.infrastructure.map((i) =>
            i.id === selectedInfra.id ? { ...i, parentId } : i
          ),
        };
      });
    } catch (err) {
      console.error("[SET PARENT]", err);
    } finally {
      setIsSettingParent(false);
    }
  }, [selectedInfra]);

  const handleDeleteCustomer = useCallback(async () => {
    if (!selectedCustomer) return;
    setIsDeletingCustomer(true);

    try {
      const res = await fetch(`/api/customers/${selectedCustomer.id}/location`, {
        method: "DELETE",
      });

      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Gagal menghapus titik koordinat pelanggan.");
      }

      const deletedId = selectedCustomer.id;

      setFetchedData((prev) => {
        if (!prev) return prev;
        const updatedCustomers = prev.customers.map((c) =>
          c.id === deletedId ? { ...c, latitude: null, longitude: null } : c,
        );
        const geocodedCustomers = updatedCustomers.filter(
          (c) => c.latitude !== null && c.longitude !== null,
        );
        return {
          ...prev,
          customers: updatedCustomers,
          summary: {
            ...prev.summary,
            geocodedCustomers: geocodedCustomers.length,
            unmappedCustomers: updatedCustomers.length - geocodedCustomers.length,
          },
        };
      });

      setSelectedCustomer(null);
      handleSelectCustomer(null);
    } catch (err) {
      console.error("[DELETE CUSTOMER LOCATION]", err);
    } finally {
      setIsDeletingCustomer(false);
    }
  }, [selectedCustomer, handleSelectCustomer]);

  useEffect(() => {
    let active = true;
    if (!initialData && !propData && !propCustomers && !propInfra) {
      fetch("/api/map/network", { credentials: "same-origin" })
        .then((res) => res.json())
        .then((json) => {
          if (active && json.success && json.data) {
            setFetchedData(json.data);
            setIsLoading(false);
          }
        })
        .catch((err) => {
          if (active) {
            setLoadError(err instanceof Error ? err.message : "Gagal memuat data dari server");
            setIsLoading(false);
          }
        });
    }
    return () => {
      active = false;
    };
  }, [initialData, propData, propCustomers, propInfra]);

  // Handle Geolocation
  const handleLocateMe = useCallback(() => {
    if (typeof window === "undefined" || !navigator.geolocation) {
      setGeoStatus("Geolocation tidak didukung peramban ini.");
      return;
    }
    setIsLocating(true);
    setGeoStatus(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setIsLocating(false);
        const { latitude, longitude, accuracy } = position.coords;
        setUserLocation({ lat: latitude, lng: longitude, accuracy });
        setGeoStatus(null);
        if (map) {
          map.flyTo([latitude, longitude], 17, { duration: 1 });
        }
      },
      (err) => {
        setIsLocating(false);
        if (err.code === err.PERMISSION_DENIED) {
          setGeoStatus("Izin akses GPS ditolak.");
        } else {
          setGeoStatus("Gagal mendapatkan sinyal GPS.");
        }
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, [map]);

  // Daftar wilayah operasional & kluster ODP yang tersedia
  const availableRegions = useMemo(() => {
    if (!data) return [];
    const set = new Set<string>();
    data.customers.forEach((c) => {
      if (c.odpName) set.add(c.odpName);
    });
    data.infrastructure.forEach((i) => {
      if (i.type === "odp" && i.name) set.add(i.name);
    });
    return Array.from(set).sort();
  }, [data]);

  // Pelanggan dengan filter & koordinat
  const { geocodedList } = useMemo(() => {
    if (!data?.customers) return { geocodedList: [] };

    const query = searchQuery.trim().toLowerCase();
    const filtered = data.customers.filter((c) => {
      // 1. Saringan status titik
      if (statusFilter === "online" && !c.isOnline) return false;
      if (statusFilter === "offline" && c.isOnline) return false;
      if (statusFilter === "weak") {
        if (!c.opticalPower || c.opticalPower > -24.5) return false;
      }
      if (statusFilter === "isolir" && c.billingStatus !== "isolir") return false;
      if (statusFilter === "geocoded") {
        if (
          c.latitude === null ||
          c.longitude === null ||
          !Number.isFinite(c.latitude) ||
          !Number.isFinite(c.longitude)
        ) {
          return false;
        }
      }

      // 2. Saringan wilayah / ODP
      if (regionFilter !== "all" && c.odpName !== regionFilter) {
        return false;
      }

      // 3. Filter search berdasarkan nama dan nomor pelanggan
      if (query) {
        const matchesName = c.name.toLowerCase().includes(query);
        const matchesUsername = c.pppoeUsername.toLowerCase().includes(query);
        const matchesId = c.id.toLowerCase().includes(query);
        const matchesSerial = c.onuDetails?.serialNumber?.toLowerCase().includes(query) ?? false;
        const matchesOdp = c.odpName?.toLowerCase().includes(query) ?? false;
        const matchesAddress = c.address?.toLowerCase().includes(query) ?? false;
        if (!matchesName && !matchesUsername && !matchesId && !matchesSerial && !matchesOdp && !matchesAddress) {
          return false;
        }
      }
      return true;
    });

    // Ambil pelanggan yang memiliki koordinat sah
    const geocoded = filtered.filter(
      (c) =>
        c.latitude !== null &&
        c.longitude !== null &&
        Number.isFinite(c.latitude) &&
        Number.isFinite(c.longitude),
    );

    return { geocodedList: geocoded };
  }, [data, searchQuery, statusFilter, regionFilter]);

  // Titik infrastruktur yang tampil (disaring berdasarkan area pandang viewport jika optimasi culling aktif)
  const visibleInfrastructure = useMemo(() => {
    if (!data?.infrastructure) return [];
    return data.infrastructure.filter((infra) => {
      const isHighlighted =
        selectedInfra?.id === infra.id || focusedNodeId === infra.id;
      return isPointInViewport(infra.latitude, infra.longitude, isHighlighted);
    });
  }, [data, isPointInViewport, selectedInfra, focusedNodeId]);

  // Titik pelanggan yang tampil (disaring berdasarkan area pandang viewport jika optimasi culling aktif)
  const visibleCustomers = useMemo(() => {
    return geocodedList.filter((cust) => {
      const isHighlighted =
        selectedCustomer?.id === cust.id || focusedNodeId === cust.id;
      return isPointInViewport(cust.latitude, cust.longitude, isHighlighted);
    });
  }, [geocodedList, isPointInViewport, selectedCustomer, focusedNodeId]);

  // Daftar saran pelanggan untuk pencarian cepat (nama & nomor pelanggan)
  const matchingCustomers = useMemo(() => {
    if (!data?.customers || !searchQuery.trim()) return [];
    const q = searchQuery.trim().toLowerCase();
    return data.customers
      .filter((c) => {
        if (regionFilter !== "all" && c.odpName !== regionFilter) return false;
        const matchesName = c.name.toLowerCase().includes(q);
        const matchesUsername = c.pppoeUsername.toLowerCase().includes(q);
        const matchesId = c.id.toLowerCase().includes(q);
        const matchesSerial = c.onuDetails?.serialNumber?.toLowerCase().includes(q) ?? false;
        const matchesOdp = c.odpName?.toLowerCase().includes(q) ?? false;
        const matchesAddress = c.address?.toLowerCase().includes(q) ?? false;
        return matchesName || matchesUsername || matchesId || matchesSerial || matchesOdp || matchesAddress;
      })
      .slice(0, 6);
  }, [data, searchQuery, regionFilter]);

  // Jalur kabel serat optik dan garis penghubung perangkat ke induk
  const cableRoutes = useMemo(() => {
    if (!data?.infrastructure || !showCables) return [];

    const routes: Array<{
      id: string;
      name: string;
      path: [number, number][];
      color: string;
      type: "backbone" | "feeder" | "distribution" | "drop";
      sourceId?: string;
      sourceName?: string;
      targetId?: string;
      targetName?: string;
      coreCapacity?: number;
      status?: string;
      isHighlighted?: boolean;
    }> = [];

    const infraList = data.infrastructure;
    const connectedDeviceIds = new Set<string>();

    // 1. Hubungkan setiap perangkat infrastruktur ke induknya (explicit parent relation)
    for (const infra of infraList) {
      const parentIdentifier =
        infra.parentId ||
        (infra.details?.parentId as string | undefined) ||
        (infra.details?.parentOdc as string | undefined) ||
        (infra.details?.parentRoot as string | undefined);

      if (!parentIdentifier) continue;

      const parent = infraList.find(
        (p) =>
          p.id === parentIdentifier ||
          p.name.toLowerCase() === parentIdentifier.toLowerCase(),
      );

      if (parent && parent.id !== infra.id) {
        let type: "backbone" | "feeder" | "distribution" = "distribution";
        let color = "#f59e0b"; // Amber (distribusi)
        let coreCapacity = 8;

        if (
          (parent.type === "router" || parent.type === "olt") &&
          (infra.type === "odc" || infra.type === "olt")
        ) {
          type = "backbone";
          color = "#8b5cf6"; // Ungu Backbone
          coreCapacity = 48;
        } else if (
          (parent.type === "odc" || parent.type === "olt") &&
          infra.type === "odp"
        ) {
          type = "feeder";
          color = "#06b6d4"; // Cyan Feeder
          coreCapacity = 16;
        } else if (infra.type === "pole") {
          type = "distribution";
          color = "#f59e0b";
          coreCapacity = 4;
        }

        const isHighlighted =
          selectedInfra?.id === infra.id ||
          selectedInfra?.id === parent.id ||
          (selectedCustomer && selectedCustomer.odpName?.toLowerCase() === infra.name.toLowerCase());

        routes.push({
          id: `parent-link-${parent.id}-${infra.id}`,
          name: `Relasi Induk: ${parent.name} ➔ ${infra.name}`,
          path: generateRoadBendedPolyline(
            [parent.latitude, parent.longitude],
            [infra.latitude, infra.longitude],
          ),
          color: isHighlighted ? "#22d3ee" : color,
          type,
          sourceId: parent.id,
          sourceName: parent.name,
          targetId: infra.id,
          targetName: infra.name,
          coreCapacity,
          status: infra.status === "active" ? "active" : "inactive",
          isHighlighted: Boolean(isHighlighted),
        });

        connectedDeviceIds.add(infra.id);
      }
    }

    // 2. Hubungkan perangkat yang belum memiliki induk eksplisit (smart fallback)
    const routerNode = infraList.find((i) => i.type === "router");
    const oltNode = infraList.find((i) => i.type === "olt");
    const odcNodes = infraList.filter((i) => i.type === "odc");
    const odpNodes = infraList.filter((i) => i.type === "odp");

    // Backbone Core: Router -> OLT (jika belum terhubung)
    if (routerNode && oltNode && !connectedDeviceIds.has(oltNode.id)) {
      const isHighlighted =
        selectedInfra?.id === routerNode.id || selectedInfra?.id === oltNode.id;

      routes.push({
        id: "backbone-core-olt",
        name: `Backbone Core: ${routerNode.name} ➔ ${oltNode.name}`,
        path: [
          [routerNode.latitude, routerNode.longitude],
          [oltNode.latitude, oltNode.longitude],
        ],
        color: isHighlighted ? "#22d3ee" : "#8b5cf6",
        type: "backbone",
        sourceId: routerNode.id,
        sourceName: routerNode.name,
        targetId: oltNode.id,
        targetName: oltNode.name,
        coreCapacity: 48,
        status: "active",
        isHighlighted: Boolean(isHighlighted),
      });
      connectedDeviceIds.add(oltNode.id);
    }

    // ODC ke Core/OLT jika belum terhubung
    for (const odc of odcNodes) {
      if (!connectedDeviceIds.has(odc.id)) {
        const rootParent = oltNode || routerNode;
        if (rootParent) {
          const isHighlighted =
            selectedInfra?.id === odc.id || selectedInfra?.id === rootParent.id;

          routes.push({
            id: `backbone-odc-${odc.id}`,
            name: `Feeder Induk: ${rootParent.name} ➔ ${odc.name}`,
            path: [
              [rootParent.latitude, rootParent.longitude],
              [odc.latitude, odc.longitude],
            ],
            color: isHighlighted ? "#22d3ee" : "#8b5cf6",
            type: "backbone",
            sourceId: rootParent.id,
            sourceName: rootParent.name,
            targetId: odc.id,
            targetName: odc.name,
            coreCapacity: 24,
            status: odc.status,
            isHighlighted: Boolean(isHighlighted),
          });
          connectedDeviceIds.add(odc.id);
        }
      }
    }

    // ODP ke ODC atau OLT jika belum terhubung
    for (const odp of odpNodes) {
      if (!connectedDeviceIds.has(odp.id)) {
        let parentCandidate = odcNodes[0] || oltNode || routerNode;
        if (odcNodes.length > 1) {
          let minDist = Infinity;
          for (const odc of odcNodes) {
            const dist =
              Math.pow(odc.latitude - odp.latitude, 2) +
              Math.pow(odc.longitude - odp.longitude, 2);
            if (dist < minDist) {
              minDist = dist;
              parentCandidate = odc;
            }
          }
        }

        if (parentCandidate) {
          const isHighlighted =
            selectedInfra?.id === odp.id ||
            selectedInfra?.id === parentCandidate.id ||
            (selectedCustomer && selectedCustomer.odpName?.toLowerCase() === odp.name.toLowerCase());

          routes.push({
            id: `feeder-odp-${odp.id}`,
            name: `Feeder Distribusi: ${parentCandidate.name} ➔ ${odp.name}`,
            path: generateRoadBendedPolyline(
              [parentCandidate.latitude, parentCandidate.longitude],
              [odp.latitude, odp.longitude],
            ),
            color: isHighlighted ? "#22d3ee" : "#06b6d4",
            type: "feeder",
            sourceId: parentCandidate.id,
            sourceName: parentCandidate.name,
            targetId: odp.id,
            targetName: odp.name,
            coreCapacity: 16,
            status: odp.status,
            isHighlighted: Boolean(isHighlighted),
          });
          connectedDeviceIds.add(odp.id);
        }
      }
    }

    // 3. Kabel Drop: ODP -> Pelanggan bertitik
    for (const cust of geocodedList) {
      if (!cust.odpName || cust.latitude === null || cust.longitude === null) continue;
      const odp = infraList.find(
        (i) =>
          i.name.toLowerCase() === cust.odpName?.toLowerCase() ||
          i.id === cust.odpName,
      );
      if (odp) {
        const isCustHighlighted =
          selectedCustomer?.id === cust.id || selectedInfra?.id === odp.id;

        routes.push({
          id: `drop-${cust.id}`,
          name: `Drop Core: ${odp.name} ➔ ${cust.name}`,
          path: generateRoadBendedPolyline(
            [odp.latitude, odp.longitude],
            [cust.latitude, cust.longitude],
          ),
          color: isCustHighlighted ? "#22d3ee" : (cust.isOnline ? "#10b981" : "#ef4444"),
          type: "drop",
          sourceId: odp.id,
          sourceName: odp.name,
          targetId: cust.id,
          targetName: cust.name,
          coreCapacity: 2,
          status: cust.isOnline ? "online" : "offline",
          isHighlighted: Boolean(isCustHighlighted),
        });
      }
    }

    return routes;
  }, [data, geocodedList, showCables, selectedInfra, selectedCustomer]);

  // Jalur kabel yang aktif dirender (disaring berdasarkan spatial viewport dan level zoom LOD jika optimasi aktif)
  const visibleCableRoutes = useMemo(() => {
    if (!cableRoutes || cableRoutes.length === 0) return [];
    if (!enableCableOptimization || !viewportBounds) return cableRoutes;
    return cableRoutes.filter((cable) =>
      isCableInViewport(cable, viewportBounds, currentZoom, enableCableOptimization),
    );
  }, [cableRoutes, enableCableOptimization, viewportBounds, currentZoom, isCableInViewport]);

  // Fit bounds ke semua titik yang ada
  const handleFitBounds = useCallback(() => {
    if (!map) return;
    const allCoords: [number, number][] = [];

    if (data?.infrastructure) {
      for (const infra of data.infrastructure) {
        allCoords.push([infra.latitude, infra.longitude]);
      }
    }
    for (const c of geocodedList) {
      if (c.latitude !== null && c.longitude !== null) {
        allCoords.push([c.latitude, c.longitude]);
      }
    }

    if (allCoords.length > 0) {
      const lats = allCoords.map((c) => c[0]);
      const lngs = allCoords.map((c) => c[1]);
      const bounds: LatLngBoundsExpression = [
        [Math.min(...lats) - 0.001, Math.min(...lngs) - 0.001],
        [Math.max(...lats) + 0.001, Math.max(...lngs) + 0.001],
      ];
      map.fitBounds(bounds, { padding: [30, 30] });
    } else {
      map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    }
  }, [map, data, geocodedList]);

  // Objek state terisolasi untuk layer inspeksi detail (decoupled dari render canvas)
  const customerEditState = useMemo(
    () => ({
      isEditing: isEditingLocation,
      draftCoords,
      isSaving: isSavingLocation,
      successMessage: saveSuccessMessage,
      errorMessage: saveErrorMessage,
    }),
    [isEditingLocation, draftCoords, isSavingLocation, saveSuccessMessage, saveErrorMessage],
  );

  const infraMoveState = useMemo(
    () => ({
      isMoving: isMovingInfra,
      draftCoords: infraMoveDraftCoords,
      isSaving: isSavingInfraMove,
      isDeleting: isDeletingInfra,
      successMessage: infraActionSuccessMessage,
      errorMessage: infraActionErrorMessage,
    }),
    [
      isMovingInfra,
      infraMoveDraftCoords,
      isSavingInfraMove,
      isDeletingInfra,
      infraActionSuccessMessage,
      infraActionErrorMessage,
    ],
  );

  return (
    <div
      className={cn(
        "relative flex flex-col w-full h-[calc(100vh-140px)] min-h-[540px] md:min-h-[600px] lg:min-h-[640px] rounded-xl border bg-card shadow-sm overflow-hidden",
        className,
      )}
      data-testid="network-map-container"
    >
      {/* Top Floating Control Bar - Responsif Tablet & Desktop */}
      <div
        className="absolute top-2 sm:top-3 left-2 sm:left-3 right-2 sm:right-3 z-[1030] flex flex-col md:flex-row md:items-center md:justify-between gap-2 pointer-events-none"
        data-testid="map-top-control-bar"
      >
        {/* Search & Filter Group */}
        <div
          className="flex flex-wrap items-center gap-1.5 sm:gap-2 pointer-events-auto bg-card/95 backdrop-blur-md p-1.5 rounded-lg border shadow-md max-w-full"
          data-testid="map-search-filter-group"
        >
          <div className="relative w-full sm:w-60 md:w-56 lg:w-72">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Cari nama atau nomor pelanggan..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setIsSearchDropdownOpen(true);
              }}
              onFocus={() => {
                if (searchQuery.trim()) setIsSearchDropdownOpen(true);
              }}
              className="h-9 sm:h-8 pl-8 pr-7 text-xs bg-background"
              data-testid="map-search-input"
              aria-label="Cari nama atau nomor pelanggan"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setIsSearchDropdownOpen(false);
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 rounded"
                aria-label="Bersihkan pencarian"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}

            {/* Dropdown Hasil Pencarian Cepat Nama & Nomor Pelanggan */}
            {isSearchDropdownOpen && searchQuery.trim().length > 0 && (
              <div
                className="absolute left-0 right-0 top-10 z-[1050] max-h-64 overflow-y-auto rounded-lg border bg-card/95 backdrop-blur-md shadow-xl p-1 animate-in fade-in duration-100"
                data-testid="search-results-dropdown"
              >
                {matchingCustomers.length > 0 ? (
                  <div className="space-y-0.5">
                    <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex justify-between items-center">
                      <span>Hasil Pencarian ({matchingCustomers.length})</span>
                      <button
                        type="button"
                        onClick={() => setIsSearchDropdownOpen(false)}
                        className="text-[10px] text-muted-foreground hover:text-foreground"
                      >
                        Tutup
                      </button>
                    </div>
                    {matchingCustomers.map((cust) => (
                      <button
                        key={cust.id}
                        type="button"
                        onClick={() => {
                          handleSelectCustomer(cust);
                          setIsSearchDropdownOpen(false);
                          if (
                            map &&
                            cust.latitude !== null &&
                            cust.longitude !== null &&
                            Number.isFinite(cust.latitude) &&
                            Number.isFinite(cust.longitude)
                          ) {
                            map.flyTo([cust.latitude, cust.longitude], 17, { duration: 0.8 });
                          }
                        }}
                        className="w-full text-left p-1.5 rounded-md hover:bg-muted/80 transition-colors flex items-center justify-between gap-2 text-xs"
                        data-testid="search-result-item"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-foreground truncate" data-testid="search-result-name">
                            {cust.name}
                          </p>
                          <p className="font-mono text-[10px] text-muted-foreground truncate" data-testid="search-result-number">
                            {cust.pppoeUsername}
                            {cust.onuDetails?.serialNumber ? ` • ${cust.onuDetails.serialNumber}` : ""}
                          </p>
                        </div>
                        <div className="shrink-0 flex items-center gap-1.5">
                          <span
                            className={cn(
                              "size-2 rounded-full",
                              cust.isOnline ? "bg-emerald-500" : "bg-rose-500",
                            )}
                            title={cust.isOnline ? "Online" : "Offline"}
                          />
                          {cust.opticalPower !== null && (
                            <span className="font-mono text-[10px] text-muted-foreground">
                              {cust.opticalPower} dBm
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="p-3 text-center text-xs text-muted-foreground" data-testid="search-no-results">
                    Tidak ditemukan pelanggan dengan nama atau nomor &quot;{searchQuery}&quot;
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Saringan Wilayah / ODP */}
          <select
            value={regionFilter}
            onChange={(e) => setRegionFilter(e.target.value)}
            className="h-9 sm:h-8 rounded-md border border-input bg-background px-2.5 sm:px-2.5 text-xs text-foreground font-medium shadow-xs focus:outline-none max-w-[130px] sm:max-w-[140px] md:max-w-[150px] truncate"
            data-testid="map-region-filter"
            aria-label="Saring berdasarkan wilayah atau ODP"
          >
            <option value="all">Semua Wilayah</option>
            {availableRegions.map((reg) => (
              <option key={reg} value={reg}>
                {reg}
              </option>
            ))}
          </select>

          {/* Saringan Status Titik */}
          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(
                e.target.value as "all" | "online" | "offline" | "weak" | "isolir" | "geocoded",
              )
            }
            className="h-9 sm:h-8 rounded-md border border-input bg-background px-2.5 sm:px-2.5 text-xs text-foreground font-medium shadow-xs focus:outline-none max-w-[140px] sm:max-w-none truncate"
            data-testid="map-status-filter"
            aria-label="Saring berdasarkan status titik"
          >
            <option value="all">Semua Status Titik</option>
            <option value="online">Titik Online</option>
            <option value="offline">Titik Offline</option>
            <option value="weak">Redaman Kritis (&le; -24.5 dBm)</option>
            <option value="isolir">Titik Terisolir</option>
            <option value="geocoded">Hanya Titik GPS</option>
          </select>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={fetchData}
            disabled={isLoading}
            className="h-9 sm:h-8 px-2.5 sm:px-2.5 text-xs gap-1.5 font-medium"
            title="Segarkan data dari backend"
            data-testid="map-refresh-button"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>

        {/* Layer & Action Buttons - Adaptif Tablet */}
        <div
          className="flex flex-wrap items-center gap-1.5 sm:gap-2 pointer-events-auto bg-card/95 backdrop-blur-md p-1.5 rounded-lg border shadow-md self-start md:self-auto max-w-full"
          data-testid="map-actions-group"
        >
          {/* Layer switcher & Control Panel */}
          <div className="relative">
            <Button
              type="button"
              variant={isLayerMenuOpen ? "default" : "outline"}
              size="sm"
              onClick={() => setIsLayerMenuOpen(!isLayerMenuOpen)}
              className="h-9 sm:h-8 px-2.5 text-xs gap-1.5 font-medium"
              data-testid="map-layer-control-toggle"
              title="Buka kontrol lapis satelit dan jalan"
            >
              <Layers className="h-3.5 w-3.5" />
              <span>Lapis: {TILE_PROVIDERS[layerMode].name.split(" ")[0]}</span>
            </Button>

            {isLayerMenuOpen && (
              <Card
                className="absolute right-0 top-10 z-[1010] w-64 p-3 shadow-xl border bg-card/95 backdrop-blur-md animate-in fade-in duration-100"
                data-testid="layer-control-panel"
              >
                <div className="space-y-3 text-xs">
                  <div>
                    <span className="font-semibold text-muted-foreground uppercase text-[10px] tracking-wider block mb-1.5">
                      Peta Dasar (Base Map)
                    </span>
                    <div className="space-y-1">
                      {Object.values(TILE_PROVIDERS).map((provider) => (
                        <label
                          key={provider.id}
                          className={cn(
                            "flex items-center justify-between p-1.5 rounded cursor-pointer border transition-colors",
                            layerMode === provider.id
                              ? "border-primary bg-primary/10 text-primary font-medium"
                              : "border-transparent hover:bg-muted/50 text-foreground",
                          )}
                          data-testid={`layer-${provider.id}-option`}
                        >
                          <div className="flex items-center gap-2">
                            <input
                              type="radio"
                              name="map-base-layer"
                              value={provider.id}
                              checked={layerMode === provider.id}
                              onChange={() => {
                                handleLayerChange(provider.id);
                              }}
                              className="size-3 text-primary"
                            />
                            <span>{provider.name}</span>
                          </div>
                          <span className="text-[10px] text-muted-foreground">
                            {provider.id === "satellite" ? "Esri" : provider.id === "streets" ? "OSM" : "Topo"}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="border-t pt-2">
                    <span className="font-semibold text-muted-foreground uppercase text-[10px] tracking-wider block mb-1.5">
                      Lapis Hamparan (Overlays)
                    </span>
                    <div className="space-y-1">
                      <label className="flex items-center gap-2 p-1 rounded cursor-pointer hover:bg-muted/40">
                        <input
                          type="checkbox"
                          checked={showCustomers}
                          onChange={(e) => setShowCustomers(e.target.checked)}
                          className="size-3 rounded text-primary"
                          data-testid="toggle-customers-layer"
                        />
                        <span className="size-2 rounded-full bg-emerald-500" />
                        <span>Titik Pelanggan ({geocodedList.length})</span>
                      </label>

                      <label className="flex items-center gap-2 p-1 rounded cursor-pointer hover:bg-muted/40">
                        <input
                          type="checkbox"
                          checked={showInfrastructure}
                          onChange={(e) => setShowInfrastructure(e.target.checked)}
                          className="size-3 rounded text-primary"
                          data-testid="toggle-infrastructure-layer"
                        />
                        <span className="size-2 rounded-full bg-cyan-500" />
                        <span>Infrastruktur ({data?.infrastructure.length ?? 0})</span>
                      </label>

                      <label className="flex items-center gap-2 p-1 rounded cursor-pointer hover:bg-muted/40">
                        <input
                          type="checkbox"
                          checked={showCables}
                          onChange={(e) => setShowCables(e.target.checked)}
                          className="size-3 rounded text-primary"
                          data-testid="toggle-cables-layer"
                        />
                        <span className="w-2.5 h-0.5 bg-cyan-400" />
                        <span>Jalur Kabel Fiber</span>
                      </label>

                      <label className="flex items-center gap-2 p-1 rounded cursor-pointer hover:bg-muted/40">
                        <input
                          type="checkbox"
                          checked={enableViewportCulling}
                          onChange={(e) => setEnableViewportCulling(e.target.checked)}
                          className="size-3 rounded text-primary"
                          data-testid="toggle-viewport-culling"
                        />
                        <span className="size-2 rounded-full bg-indigo-500" />
                        <span>Sembunyikan Luar Layar (Viewport)</span>
                      </label>

                      <label className="flex items-center gap-2 p-1 rounded cursor-pointer hover:bg-muted/40">
                        <input
                          type="checkbox"
                          checked={enableCableOptimization}
                          onChange={(e) => setEnableCableOptimization(e.target.checked)}
                          className="size-3 rounded text-primary"
                          data-testid="toggle-cable-optimization"
                        />
                        <span className="size-2 rounded-full bg-cyan-500" />
                        <span>Optimasi Kabel (Viewport & LOD)</span>
                      </label>
                    </div>
                  </div>
                </div>
              </Card>
            )}
          </div>

          {/* Indikator Viewport Culling */}
          <div
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border bg-card/95 backdrop-blur-md shadow-xs text-muted-foreground"
            data-testid="viewport-culling-indicator"
            title={`Menampilkan ${visibleCustomers.length + visibleInfrastructure.length} dari ${geocodedList.length + (data?.infrastructure.length ?? 0)} titik di dalam area viewport layar`}
          >
            <span
              className={cn(
                "size-2 rounded-full",
                enableViewportCulling ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground",
              )}
            />
            <span>
              Viewport:{" "}
              <strong className="text-foreground font-semibold">
                {visibleCustomers.length + visibleInfrastructure.length}
              </strong>
              /{geocodedList.length + (data?.infrastructure.length ?? 0)} titik
            </span>
          </div>

          {/* Indikator Optimasi Jalur Kabel */}
          {showCables && (
            <div
              className="hidden md:flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border bg-card/95 backdrop-blur-md shadow-xs text-muted-foreground"
              data-testid="cable-render-indicator"
              title={`Menampilkan ${visibleCableRoutes.length} dari ${cableRoutes.length} jalur kabel di area pandang`}
            >
              <span
                className={cn(
                  "size-2 rounded-full",
                  enableCableOptimization ? "bg-cyan-500 animate-pulse" : "bg-muted-foreground",
                )}
              />
              <span>
                Kabel:{" "}
                <strong className="text-foreground font-semibold">
                  {visibleCableRoutes.length}
                </strong>
                /{cableRoutes.length} jalur
              </span>
            </div>
          )}

          {/* Fit Bounds */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleFitBounds}
            className="h-9 sm:h-8 px-2.5 text-xs gap-1.5 font-medium"
            title="Fokuskan ke seluruh jaringan"
            data-testid="fit-bounds-button"
          >
            <Maximize2 className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Semua Titik</span>
          </Button>

          {/* GPS Teknisi */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleLocateMe}
            disabled={isLocating}
            className={cn("h-9 sm:h-8 px-2.5 text-xs gap-1.5 font-medium", userLocation && "border-blue-500 text-blue-500")}
            title="Tampilkan lokasi GPS teknisi saat ini"
            data-testid="locate-me-button"
          >
            <Navigation className={cn("h-3.5 w-3.5", isLocating && "animate-spin")} />
            <span className="hidden md:inline">Lokasi Saya</span>
          </Button>

          {/* Panduan Singkat Simbol & Interaksi Peta */}
          <MapSymbolsGuideDialog />

          {/* Tombol Sambung Kabel */}
          <Button
            type="button"
            variant={isConnectCableMode ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setIsConnectCableMode(!isConnectCableMode);
              setConnectSource(null);
              setConnectTarget(null);
              setShowConnectDialog(false);
            }}
            className={cn("h-9 sm:h-8 px-2.5 text-xs gap-1.5 font-medium", isConnectCableMode && "bg-indigo-600 text-white border-indigo-700")}
            title="Mode sambung kabel: klik 2 titik untuk buat jalur"
          >
            <Share2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Sambung Kabel</span>
          </Button>

          {/* Tombol Gambar Kabel */}
          <Button
            type="button"
            variant={isDrawCableMode ? "default" : "outline"}
            size="sm"
            onClick={() => {
              const next = !isDrawCableMode;
              setIsDrawCableMode(next);
              setDrawWaypoints([]);
              setDrawMousePos(null);
              setShowDrawDialog(false);
              if (next) {
                setIsPlacementPickerOpen(false);
                setPlacementType(null);
                setPlacementDraftCoords(null);
              }
            }}
            className={cn("h-9 sm:h-8 px-2.5 text-xs gap-1.5 font-medium", isDrawCableMode && "bg-violet-600 text-white border-violet-700")}
            title="Mode gambar kabel: klik peta untuk tambah waypoint"
          >
            <Pencil className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Gambar Kabel</span>
          </Button>

          {/* Tombol Tempatkan Titik Perangkat Infrastruktur */}
          <Button
            type="button"
            variant={placementType || isPlacementPickerOpen ? "default" : "outline"}
            size="sm"
            onClick={() => {
              if (placementType || isPlacementPickerOpen) {
                setIsPlacementPickerOpen(false);
                setPlacementType(null);
                setPlacementDraftCoords(null);
              } else {
                setIsPlacementPickerOpen(true);
                setIsEditingLocation(false);
                setDraftCoords(null);
                setIsDrawCableMode(false);
                setDrawWaypoints([]);
                setDrawMousePos(null);
              }
            }}
            className={cn(
              "h-9 sm:h-8 px-2.5 text-xs gap-1.5 font-medium",
              (placementType || isPlacementPickerOpen) && "bg-primary text-primary-foreground",
            )}
            data-testid="toggle-device-placement-button"
            title="Pilih dan tempatkan titik perangkat infrastruktur di peta"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">
              {placementType ? `Pasang ${placementType.toUpperCase()}` : "Pasang Titik"}
            </span>
            <span className="sm:hidden">Pasang</span>
          </Button>

          {/* Tombol Tentukan Titik Koordinat Pelanggan */}
          <Button
            type="button"
            variant={plottingCustomer || isCustomerPickerOpen ? "default" : "outline"}
            size="sm"
            onClick={() => {
              if (plottingCustomer || isCustomerPickerOpen) {
                setIsCustomerPickerOpen(false);
                setPlottingCustomer(null);
                setDraftCoords(null);
              } else {
                setIsCustomerPickerOpen(true);
                setIsPlacementPickerOpen(false);
                setPlacementType(null);
                setPlacementDraftCoords(null);
                setIsMovingInfra(false);
                setInfraMoveDraftCoords(null);
                setIsEditingLocation(false);
                setIsUnmappedDismissed(true);
              }
            }}
            className={cn(
              "h-9 sm:h-8 px-2.5 text-xs gap-1.5 font-medium",
              (plottingCustomer || isCustomerPickerOpen) && "bg-primary text-primary-foreground",
            )}
            data-testid="open-customer-coordinate-picker-button"
            title="Tentukan titik koordinat pelanggan di peta dan simpan langsung ke database"
          >
            <MapPin className="h-3.5 w-3.5 text-emerald-500" />
            <span className="hidden sm:inline">
              {plottingCustomer ? `Plot ${plottingCustomer.name}` : "Tentukan Titik"}
            </span>
            <span className="sm:hidden">Titik</span>
            {data && data.customers.filter((c) => c.latitude === null).length > 0 && (
              <Badge
                variant="secondary"
                className="px-1 py-0 text-[10px] h-4 font-normal bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
              >
                {data.customers.filter((c) => c.latitude === null).length}
              </Badge>
            )}
          </Button>

          {/* Tombol Input Titik Koordinat GPS Manual */}
          <Button
            type="button"
            variant={isManualCoordModalOpen ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setIsManualCoordModalOpen(!isManualCoordModalOpen);
              setManualCoordError(null);
              setManualCoordSuccess(null);
            }}
            className={cn(
              "h-9 sm:h-8 px-2.5 text-xs gap-1.5 font-medium",
              isManualCoordModalOpen && "bg-primary text-primary-foreground",
            )}
            data-testid="open-manual-coord-input-button"
            title="Ketik atau tempel titik koordinat GPS manual untuk melompat ke lokasi"
          >
            <Crosshair className="h-3.5 w-3.5 text-emerald-500" />
            <span className="hidden sm:inline">Input GPS</span>
            <span className="sm:hidden">GPS</span>
          </Button>

          {/* Tombol Toggle Mode Pilih Titik Koordinat dari Klik Peta */}
          <Button
            type="button"
            variant={isInspectModeActive ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setIsInspectModeActive((prev) => {
                if (prev) setInspectedMapCoord(null);
                return !prev;
              });
            }}
            className={cn(
              "h-9 sm:h-8 px-2.5 text-xs gap-1.5 font-medium",
              isInspectModeActive && "bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600",
            )}
            data-testid="toggle-inspect-coord-button"
            title={isInspectModeActive ? "Nonaktifkan mode pilih titik — klik peta tidak lagi mencatat koordinat" : "Aktifkan mode pilih titik — klik di peta untuk memilih koordinat"}
          >
            <MapPin className={cn("h-3.5 w-3.5", isInspectModeActive ? "text-white" : "text-emerald-500")} />
            <span className="hidden sm:inline">{isInspectModeActive ? "Batalkan Pilih" : "Pilih Titik"}</span>
            <span className="sm:hidden">
              <MapPin className="h-3.5 w-3.5" />
            </span>
          </Button>
        </div>
      </div>

      {/* Error State: Gagal Memuat Data Jaringan */}
      {loadError && !data && (
        <div
          className="absolute inset-0 z-[1050] flex flex-col items-center justify-center p-6 bg-background/90 backdrop-blur-sm text-center animate-in fade-in duration-200"
          data-testid="map-error-state"
          role="alert"
        >
          <div className="size-14 rounded-full bg-destructive/10 border border-destructive/20 flex items-center justify-center text-destructive mb-3 shadow-inner">
            <WifiOff className="size-7" />
          </div>
          <h3 className="text-base font-bold text-foreground">
            Gagal Menghubungkan ke Backend Jaringan
          </h3>
          <p className="text-xs text-muted-foreground max-w-md mt-1 mb-4 leading-relaxed">
            {loadError}. Sistem menolak menampilkan data tiruan palsu (*zero-dummy*) agar data operasional tidak tersamarkan.
          </p>
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={fetchData}
            disabled={isLoading}
            data-testid="map-error-retry-button"
            className="text-xs gap-1.5"
          >
            <RefreshCw className={cn("size-3.5", isLoading && "animate-spin")} />
            <span>Coba Lagi</span>
          </Button>
        </div>
      )}

      {/* Empty State: Belum Ada Perangkat atau Titik Jaringan */}
      {!isLoading && !loadError && data && data.customers.length === 0 && data.infrastructure.length === 0 && (
        <div
          className="absolute inset-0 z-[990] flex flex-col items-center justify-center p-6 bg-background/85 backdrop-blur-xs text-center"
          data-testid="map-empty-state"
        >
          <div className="size-14 rounded-full bg-muted border flex items-center justify-center text-muted-foreground mb-3">
            <MapPinOff className="size-7" />
          </div>
          <h3 className="text-base font-bold text-foreground">
            Belum Ada Perangkat atau Titik Terdaftar
          </h3>
          <p className="text-xs text-muted-foreground max-w-md mt-1 mb-4 leading-relaxed">
            Peta dasar satelit siap digunakan. Daftarkan router MikroTik atau OLT pada menu Setup agar topologi jaringan dan pelanggan dapat dipetakan secara nyata.
          </p>
          <Button asChild size="sm" variant="outline" className="text-xs">
            <Link href="/setup">Buka Setup Perangkat</Link>
          </Button>
        </div>
      )}

      {/* Floating Banner Mode Gambar Kabel */}
      {isDrawCableMode && !showDrawDialog && (
        <div className="absolute top-16 left-3 right-3 sm:right-auto sm:max-w-sm z-[1000] bg-violet-700/95 text-white backdrop-blur-md p-3 rounded-xl shadow-2xl border border-violet-400/30 animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              <Pencil className="size-3.5 shrink-0" />
              <p className="font-bold text-xs">Gambar Jalur Kabel</p>
              {drawWaypoints.length > 0 && (
                <span className="bg-white/20 text-[10px] px-1.5 py-0.5 rounded-full">{drawWaypoints.length} titik</span>
              )}
            </div>
            <div className="flex gap-1">
              {drawWaypoints.length > 0 && (
                <Button type="button" size="sm" variant="ghost"
                  className="text-white hover:bg-white/20 h-6 px-2 text-[10px]"
                  onClick={handleDrawUndo}>
                  ↩ Hapus
                </Button>
              )}
              {drawWaypoints.length >= 2 && (
                <Button type="button" size="sm" variant="ghost"
                  className="text-white hover:bg-green-500/30 h-6 px-2 text-[10px] font-semibold"
                  onClick={handleDrawFinish}>
                  Selesai ✓
                </Button>
              )}
              <Button type="button" size="sm" variant="ghost"
                className="text-white hover:bg-white/20 h-6 w-6 p-0"
                onClick={() => { setIsDrawCableMode(false); setDrawWaypoints([]); setDrawMousePos(null); }}>
                <X className="size-3" />
              </Button>
            </div>
          </div>
          <p className="text-[11px] opacity-80">
            {drawWaypoints.length === 0
              ? "Klik peta untuk mulai menggambar jalur kabel. Snap otomatis ke ODP/OLT terdekat."
              : "Klik peta untuk tambah titik belokan. Klik Selesai saat jalur siap."}
          </p>
        </div>
      )}

      {/* Floating Guide Banner Mode Geser Posisi Titik */}
      {isEditingLocation && selectedCustomer && (
        <div
          className="absolute top-16 left-3 right-3 sm:right-auto sm:max-w-lg z-[1000] bg-primary/95 text-primary-foreground backdrop-blur-md p-3 rounded-lg shadow-xl text-xs flex items-center justify-between gap-3 animate-in fade-in slide-in-from-top-2 duration-150"
          data-testid="edit-location-guide-banner"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <Move className="size-4 shrink-0 animate-bounce" />
            <div className="min-w-0">
              <p className="font-bold truncate">Mode Geser Titik: {selectedCustomer.name}</p>
              <p className="text-[11px] opacity-90 leading-tight">
                Tarik pin merah di peta atau klik lokasi target baru. Simpan posisi titik di panel detail.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-7 px-2.5 text-xs shrink-0 font-semibold shadow-xs"
            onClick={handleSaveLocation}
            disabled={isSavingLocation || !draftCoords}
            data-testid="banner-save-location-button"
          >
            {isSavingLocation ? (
              <>
                <Loader2 className="size-3 animate-spin mr-1" />
                <span>Menyimpan...</span>
              </>
            ) : (
              <>
                <Save className="size-3 mr-1" />
                <span>Simpan</span>
              </>
            )}
          </Button>
        </div>
      )}

      {/* Floating Guide Banner Mode Sambung Kabel */}
      {isConnectCableMode && !showConnectDialog && (
        <div className="absolute top-16 left-3 right-3 sm:right-auto sm:max-w-sm z-[1000] bg-indigo-700/95 text-white backdrop-blur-md p-3 rounded-xl shadow-2xl border border-indigo-400/30 animate-in fade-in slide-in-from-top-2 duration-150 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Share2 className="size-3.5 shrink-0" />
              <p className="font-bold text-xs">Sambung Kabel</p>
              {connectSavedSegments > 0 && (
                <span className="bg-green-400 text-green-900 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                  {connectSavedSegments} tersimpan
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {connectSavedSegments > 0 && (
                <Button type="button" size="sm" variant="ghost"
                  className="text-white hover:bg-green-500/30 h-6 px-2 text-[10px] font-semibold"
                  onClick={() => { setIsConnectCableMode(false); setConnectSource(null); setConnectTarget(null); setConnectSavedSegments(0); setConnectRouteName(""); }}>
                  Selesai
                </Button>
              )}
              <Button type="button" size="sm" variant="ghost" className="text-white hover:bg-white/20 h-6 w-6 p-0"
                onClick={() => { setIsConnectCableMode(false); setConnectSource(null); setConnectTarget(null); setConnectSavedSegments(0); setConnectRouteName(""); }}>
                <X className="size-3" />
              </Button>
            </div>
          </div>

          {/* Input nama rute — hanya saat belum ada source */}
          {!connectSource && (
            <div>
              <p className="text-[10px] opacity-70 mb-1">Nama rute (opsional):</p>
              <Input
                value={connectRouteName}
                onChange={(e) => setConnectRouteName(e.target.value)}
                placeholder="Jalur Desa PON1"
                className="h-6 text-[11px] bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:bg-white/20"
              />
            </div>
          )}

          <div className="flex items-center gap-2 text-[11px]">
            <div className={cn("flex items-center gap-1.5 px-2 py-1 rounded-md", !connectSource ? "bg-white/20 font-semibold" : "bg-white/5 opacity-60")}>
              <span className={cn("size-4 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0", !connectSource ? "bg-white text-indigo-700" : "bg-green-400 text-white")}>
                {connectSource ? "✓" : "1"}
              </span>
              <span className="truncate max-w-[100px]">{connectSource ? connectSource.name : "Klik SUMBER"}</span>
            </div>
            <span className="opacity-40 shrink-0">→</span>
            <div className={cn("flex items-center gap-1.5 px-2 py-1 rounded-md", connectSource ? "bg-white/20 font-semibold animate-pulse" : "bg-white/5 opacity-40")}>
              <span className="size-4 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 bg-white/30">2</span>
              Klik TUJUAN
            </div>
          </div>
        </div>
      )}

      {/* Floating Guide Banner Mode Penentuan Titik Koordinat Pelanggan */}
      {plottingCustomer && (
        <div
          className="absolute top-16 left-3 right-3 sm:right-auto sm:max-w-lg z-[1000] bg-emerald-600 text-white backdrop-blur-md p-3 rounded-lg shadow-xl text-xs flex items-center justify-between gap-3 animate-in fade-in slide-in-from-top-2 duration-150"
          data-testid="customer-plotting-banner"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <MapPin className="size-4 shrink-0 animate-bounce text-emerald-200" />
            <div className="min-w-0">
              <p className="font-bold truncate">
                Tentukan Titik: {plottingCustomer.name}
              </p>
              <p className="text-[11px] opacity-90 leading-tight">
                {draftCoords
                  ? "Geser pin merah ke atap rumah pelanggan, lalu klik Simpan ke Database."
                  : "Klik lokasi rumah pelanggan pada peta untuk menentukan koordinat."}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {draftCoords && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-7 px-2.5 text-xs font-semibold text-emerald-900 bg-white hover:bg-emerald-50 shadow-xs"
                onClick={handleSavePlottedCustomer}
                disabled={isSavingLocation}
                data-testid="banner-save-customer-coordinate-button"
              >
                {isSavingLocation ? (
                  <>
                    <Loader2 className="size-3 animate-spin mr-1" />
                    <span>Menyimpan...</span>
                  </>
                ) : (
                  <>
                    <Save className="size-3 mr-1 text-emerald-700" />
                    <span>Simpan</span>
                  </>
                )}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs border-emerald-400/50 text-white hover:bg-emerald-700/60"
              onClick={() => {
                setPlottingCustomer(null);
                setDraftCoords(null);
              }}
              data-testid="banner-cancel-customer-plotting-button"
            >
              Batal
            </Button>
          </div>
        </div>
      )}

      {/* Floating Guide Banner Mode Penempatan Titik Perangkat */}
      {placementType && !placementDraftCoords && (
        <div
          className="absolute top-16 left-3 right-3 sm:right-auto sm:max-w-lg z-[1000] bg-cyan-600 text-white backdrop-blur-md p-3 rounded-lg shadow-xl text-xs flex items-center justify-between gap-3 animate-in fade-in slide-in-from-top-2 duration-150"
          data-testid="device-placement-banner"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <MapPin className="size-4 shrink-0 animate-bounce" />
            <div className="min-w-0">
              <p className="font-bold truncate">
                Mode Penempatan: {placementType.toUpperCase()}
              </p>
              <p className="text-[11px] opacity-90 leading-tight">
                Klik lokasi pada peta untuk menentukan posisi titik perangkat ini.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-7 px-2.5 text-xs shrink-0 font-medium"
            onClick={() => {
              setPlacementType(null);
              setIsPlacementPickerOpen(false);
            }}
          >
            Batal
          </Button>
        </div>
      )}

      {/* Search Empty State */}
      {data && (data.customers.length > 0 || data.infrastructure.length > 0) && geocodedList.length === 0 && searchQuery && (
        <div
          className="absolute top-16 left-3 right-3 sm:right-auto sm:max-w-md z-[1000] bg-card/95 border backdrop-blur-md p-2.5 rounded-lg shadow-md text-xs flex items-center justify-between gap-2"
          data-testid="search-empty-state"
        >
          <span className="text-muted-foreground">
            Tidak ditemukan titik pelanggan untuk &ldquo;<strong className="text-foreground">{searchQuery}</strong>&rdquo;
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px]"
            data-testid="reset-search-button"
            onClick={() => setSearchQuery("")}
          >
            Reset
          </Button>
        </div>
      )}

      {/* Saringan Wilayah / Status Titik Kosong (Filter Empty State) */}
      {data && (data.customers.length > 0 || data.infrastructure.length > 0) && geocodedList.length === 0 && !searchQuery && (statusFilter !== "all" || regionFilter !== "all") && (
        <div
          className="absolute top-16 left-3 right-3 sm:right-auto sm:max-w-md z-[1000] bg-card/95 border backdrop-blur-md p-2.5 rounded-lg shadow-md text-xs flex items-center justify-between gap-2 animate-in fade-in duration-150"
          data-testid="filter-empty-state"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Filter className="size-3.5 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground text-xs leading-tight">
              Tidak ada titik pelanggan untuk saringan{" "}
              {regionFilter !== "all" && <strong className="text-foreground">Wilayah: {regionFilter}</strong>}
              {regionFilter !== "all" && statusFilter !== "all" && " dan "}
              {statusFilter !== "all" && <strong className="text-foreground">Status: {statusFilter}</strong>}
            </span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px] shrink-0"
            data-testid="reset-filter-button"
            onClick={() => {
              setStatusFilter("all");
              setRegionFilter("all");
            }}
          >
            Reset Saringan
          </Button>
        </div>
      )}

      {/* Seluruh Pelanggan Belum Memiliki Koordinat GPS (Unmapped Customers State) */}
      {data && data.customers.length > 0 && geocodedList.length === 0 && !searchQuery && statusFilter === "all" && regionFilter === "all" && !isUnmappedDismissed && (
        <div
          className="absolute inset-0 z-[990] flex flex-col items-center justify-center p-6 bg-background/85 backdrop-blur-xs text-center"
          data-testid="unmapped-customers-empty-state"
        >
          <div className="size-14 rounded-full bg-muted border flex items-center justify-center text-muted-foreground mb-3">
            <MapPinOff className="size-7 text-amber-500" />
          </div>
          <h3 className="text-base font-bold text-foreground">
            Semua Pelanggan Belum Memiliki Koordinat GPS
          </h3>
          <p className="text-xs text-muted-foreground max-w-md mt-1 mb-4 leading-relaxed">
            Terdapat {data.customers.length} data pelanggan terdaftar, namun belum ada yang memiliki koordinat latitude dan longitude di database PostgreSQL. Lengkapi koordinat GPS pada tabel pelanggan agar titik dapat dipetakan secara nyata.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="default"
              className="text-xs gap-1.5 font-semibold"
              data-testid="start-plot-customer-button"
              onClick={() => {
                setIsUnmappedDismissed(true);
                setIsCustomerPickerOpen(true);
              }}
            >
              <MapPin className="size-3.5" />
              <span>Tentukan Titik di Peta Sekarang</span>
            </Button>
            <Button asChild size="sm" variant="outline" className="text-xs gap-1.5" data-testid="open-customer-table-button">
              <Link href="/app/pelanggan">
                <span>Buka Data Pelanggan</span>
                <ExternalLink className="size-3.5" />
              </Link>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-xs text-muted-foreground"
              data-testid="dismiss-unmapped-banner-button"
              onClick={() => setIsUnmappedDismissed(true)}
            >
              Lihat Peta Saja
            </Button>
          </div>
        </div>
      )}

      {/* Mock Data Simulation Notification Badge/Banner */}
      {data && !data.dataSource.isRealData && (
        <div
          className="absolute top-16 left-3 right-3 sm:right-auto sm:max-w-md z-[1000] bg-blue-500/10 dark:bg-blue-950/40 border border-blue-500/30 backdrop-blur-md p-2.5 rounded-lg shadow-lg text-xs flex items-start gap-2 text-foreground"
          data-testid="mock-data-indicator"
        >
          <Database className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-semibold text-blue-600 dark:text-blue-400">
              Pratinjau Data Mock Lokal (Tiruan)
            </p>
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              Memuat simulasi titik pelanggan & topologi jaringan Mukomuko untuk pengujian interaktivitas UI tanpa server fisik.
            </p>
          </div>
        </div>
      )}

      {/* Zero-Dummy Status Notification Banner */}
      {data && data.dataSource.isRealData && data.summary.geocodedCustomers === 0 && data.summary.totalCustomers > 0 && (
        <div className="absolute top-16 left-3 right-3 sm:right-auto sm:max-w-md z-[1000] bg-amber-500/10 dark:bg-amber-950/40 border border-amber-500/30 backdrop-blur-md p-2.5 rounded-lg shadow-lg text-xs flex items-start gap-2 text-foreground">
          <Database className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-semibold text-amber-600 dark:text-amber-400">
              {data.summary.totalCustomers} Pelanggan Terdaftar di PostgreSQL
            </p>
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              Koordinat GPS pelanggan belum diisi pada database. Menampilkan titik sentral infrastruktur Core CIARA, OLT HSGQ, dan ODP distribusi.
            </p>
          </div>
        </div>
      )}

      {/* Penanda Saat Tile Gagal Dimuat */}
      {tileErrorCount > 0 && !isTileErrorDismissed && (
        <div
          className="absolute top-16 left-3 right-3 sm:right-auto sm:max-w-md z-[1000] bg-destructive/15 dark:bg-destructive/25 border border-destructive/40 backdrop-blur-md p-3 rounded-lg shadow-xl text-xs flex items-start gap-2.5 text-foreground animate-in fade-in slide-in-from-top-2 duration-150"
          data-testid="tile-error-banner"
          role="alert"
        >
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div className="space-y-1.5 flex-1">
            <div className="flex items-start justify-between gap-1">
              <p className="font-semibold text-destructive">
                Lapis Peta Dasar Terkendala ({tileErrorCount} tile gagal dimuat)
              </p>
              <button
                type="button"
                onClick={() => setIsTileErrorDismissed(true)}
                className="text-muted-foreground hover:text-foreground rounded p-0.5 transition-colors"
                data-testid="dismiss-tile-error"
                title="Tutup penanda galat tile"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              Penyedia tile <span className="font-medium text-foreground">{TILE_PROVIDERS[layerMode].name}</span> mengalami kendala koneksi atau batas akses. Titik dan jalur serat optik tetap aktif di atas kanvas.
            </p>
            <div className="flex items-center gap-2 pt-0.5">
              {layerMode !== "streets" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-[10px] bg-background/80 hover:bg-background"
                  data-testid="switch-to-streets-fallback"
                  onClick={() => handleLayerChange("streets")}
                >
                  Ganti ke Peta Jalan (OSM)
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-[10px] bg-background/80 hover:bg-background"
                  data-testid="switch-to-satellite-fallback"
                  onClick={() => handleLayerChange("satellite")}
                >
                  Ganti ke Satelit (Esri)
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px]"
                data-testid="retry-tiles-button"
                onClick={() => {
                  setTileErrorCount(0);
                  if (map) {
                    map.invalidateSize({ pan: false });
                  }
                }}
              >
                Coba Muat Ulang
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Geolocation status toast */}
      {geoStatus && (
        <div className="absolute top-16 right-3 z-[1000] bg-destructive/15 border border-destructive/30 backdrop-blur-md px-3 py-1.5 rounded-md text-xs text-destructive font-medium shadow-md">
          {geoStatus}
        </div>
      )}

      {/* Leaflet Map Canvas */}
      <div className="w-full h-full relative" ref={mapContainerRef}>
        <MapContainer
          center={DEFAULT_CENTER}
          zoom={DEFAULT_ZOOM}
          ref={handleMapRef}
          className="w-full h-full z-0"
          zoomControl={false}
        >
          {(() => {
            const provider = TILE_PROVIDERS[layerMode] || TILE_PROVIDERS.satellite;
            const subdomains =
              provider.subdomains && provider.subdomains.length > 0
                ? provider.subdomains
                : ["a", "b", "c"];
            return (
              <TileLayer
                key={layerMode}
                attribution={provider.attribution}
                url={provider.url}
                maxNativeZoom={provider.maxNativeZoom}
                maxZoom={provider.maxZoom}
                subdomains={subdomains}
                eventHandlers={{
                  tileerror: () => {
                    setTileErrorCount((prev) => prev + 1);
                  },
                }}
              />
            );
          })()}

          {/* Pelacak level zoom untuk ketajaman vektor dinamis */}
          <MapZoomTracker onZoomChange={setCurrentZoom} />
          {/* Pelacak area viewport untuk optimasi penyembunyian titik di luar layar (spatial culling) */}
          <MapViewportTracker onViewportChange={handleViewportChange} />

          {/* Jalur Kabel Serat Optik & Garis Penghubung Perangkat ke Induk (Ketajaman Adaptif Zoom & Optimasi Ribuan Kabel) */}
          {showCables &&
            visibleCableRoutes.map((cable) => {
              const style = resolveCableCapacityStyle({
                coreCapacity: cable.coreCapacity ?? (cable.type === "backbone" ? 48 : cable.type === "feeder" ? 16 : 2),
                type: cable.type,
                status: cable.status,
                isHighlighted: cable.isHighlighted,
              });
              const baseWeight = style.baseWeight;
              const scaledWeight = getZoomScaledLineWeight(baseWeight, currentZoom);
              const haloWeight = getZoomScaledLineWeight(
                cable.isHighlighted ? baseWeight + 3.5 : baseWeight + 2.5,
                currentZoom,
              );
              // Dynamic smoothFactor untuk optimasi titik kurva jalan Leaflet berdasarkan level zoom
              const dynamicSmoothFactor = currentZoom >= 16 ? 0.25 : currentZoom >= 13 ? 1.0 : 2.0;

              return (
                <span key={cable.id}>
                  {/* Glow/halo layer untuk kabel backbone atau yang sedang disorot (highlight) */}
                  {(cable.isHighlighted || cable.type === "backbone" || cable.id.startsWith("backbone")) && (
                    <Polyline
                      positions={cable.path}
                      pathOptions={{
                        className: "cable-halo-polyline",
                        color: cable.isHighlighted ? "#22d3ee" : (cable.color ? cable.color + "80" : style.haloColor),
                        weight: haloWeight,
                        opacity: cable.isHighlighted ? 0.6 : 0.35,
                        lineCap: "round",
                        lineJoin: "round",
                      }}
                      smoothFactor={dynamicSmoothFactor}
                    />
                  )}
                  <Polyline
                    positions={cable.path}
                    pathOptions={{
                      className: "sharp-cable-polyline",
                      color: cable.color || style.color,
                      weight: scaledWeight,
                      opacity: style.opacity,
                      dashArray: style.dashArray,
                      lineCap: "round",
                      lineJoin: "round",
                    }}
                    smoothFactor={dynamicSmoothFactor}
                  >
                  <Tooltip direction="center" opacity={0.95} sticky>
                    <div
                      className="flex flex-col gap-0.5 text-xs font-mono p-1"
                      data-testid={`cable-tooltip-${cable.id}`}
                    >
                      <div className="flex items-center gap-1.5 font-bold">
                        <span
                          className="size-2 rounded-full shrink-0"
                          style={{ backgroundColor: cable.color }}
                        />
                        <span className="truncate max-w-[220px]">{cable.name}</span>
                      </div>
                      {cable.sourceName && cable.targetName && (
                        <div className="text-[10px] text-muted-foreground flex items-center gap-1 pt-0.5">
                          <span className="font-semibold text-foreground">{cable.sourceName}</span>
                          <span>&rarr;</span>
                          <span className="font-semibold text-foreground">{cable.targetName}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-2 text-[10px] pt-0.5 text-muted-foreground">
                        <span className="uppercase font-semibold">Tipe: {cable.type}</span>
                        {cable.coreCapacity && <span>Kapasitas: {cable.coreCapacity} Core</span>}
                        {cable.status && (
                          <span
                            className={cn(
                              "font-medium",
                              cable.status === "offline" ? "text-rose-500" : "text-emerald-500",
                            )}
                          >
                            Status: {cable.status}
                          </span>
                        )}
                      </div>
                    </div>
                  </Tooltip>
                </Polyline>
              </span>
            );
          })}

          {/* Garis drop fiber: Pelanggan ke ODP */}
          {showCustomers && visibleCustomers
            .filter((c) => c.odpName && c.latitude !== null && c.longitude !== null)
            .map((cust) => {
              const odp = visibleInfrastructure.find(
                (i) => i.name.toLowerCase() === cust.odpName?.toLowerCase()
              );
              if (!odp) return null;
              return (
                <Polyline
                  key={`drop-${cust.id}`}
                  positions={[
                    [odp.latitude, odp.longitude],
                    [cust.latitude as number, cust.longitude as number],
                  ]}
                  pathOptions={{
                    color: cust.isOnline ? "#22c55e" : "#ef4444",
                    weight: 1,
                    opacity: 0.4,
                    dashArray: "3 5",
                  }}
                />
              );
            })}

          {/* Preview jalur gambar kabel (live saat draw mode) */}
          {isDrawCableMode && drawWaypoints.length > 0 && (
            <>
              <Polyline
                positions={[...drawWaypoints, ...(drawMousePos ? [drawMousePos] : [])]}
                pathOptions={{ color: drawCableColor, weight: 3, dashArray: "8 5", opacity: 0.8 }}
              />
              {drawWaypoints.map((pt, idx) => (
                <CircleMarker
                  key={`draw-pt-${idx}`}
                  center={pt}
                  radius={idx === 0 ? 7 : 5}
                  pathOptions={{
                    color: "#fff",
                    fillColor: idx === 0 ? "#8b5cf6" : drawCableColor,
                    fillOpacity: 1,
                    weight: 2,
                    interactive: false,
                  }}
                />
              ))}
            </>
          )}

          {/* Infrastruktur Jaringan: Core Router, OLT, ODP, ODC, Tiang (Vektor Tajam & Ikon) */}
          {showInfrastructure &&
            visibleInfrastructure.map((infra) => {
              const isRouter = infra.type === "router";
              const isOlt = infra.type === "olt";
              const isOdp = infra.type === "odp";
              const isOdc = infra.type === "odc";
              const isPole = infra.type === "pole";

              // Warna berbeda tiap jenis perangkat (Violet, Cyan, Blue, Amber, Slate)
              const color = isRouter
                ? "#8b5cf6"
                : isOlt
                  ? "#06b6d4"
                  : isOdc
                    ? "#3b82f6"
                    : isOdp
                      ? "#f59e0b"
                      : "#64748b";

              const radius = isRouter ? 12 : isOlt ? 10 : 8;
              const isHighlighted = selectedInfra?.id === infra.id || focusedNodeId === infra.id;
              const isConnectSource = isConnectCableMode && connectSource?.id === infra.id;
              const isConnectTarget = isConnectCableMode && !connectSource;

              return (
                <span key={infra.id} data-marker-type={infra.type} data-highlighted={isHighlighted ? "true" : undefined}>
                  {/* Ring pulse saat mode sambung kabel: source = hijau, semua node = indigo */}
                  {isConnectSource && (
                    <>
                      <CircleMarker
                        center={[infra.latitude, infra.longitude]}
                        radius={radius + 14}
                        pathOptions={{ color: "#22c55e", fillColor: "#22c55e", fillOpacity: 0.25, weight: 3, className: "animate-pulse", interactive: false }}
                      />
                      <CircleMarker
                        center={[infra.latitude, infra.longitude]}
                        radius={radius + 7}
                        pathOptions={{ color: "#22c55e", fillColor: "transparent", weight: 2, dashArray: "4,3", interactive: false }}
                      />
                    </>
                  )}
                  {isConnectTarget && !isConnectSource && (
                    <CircleMarker
                      center={[infra.latitude, infra.longitude]}
                      radius={radius + 8}
                      pathOptions={{ color: "#6366f1", fillColor: "#6366f1", fillOpacity: 0.2, weight: 2, className: "animate-pulse", interactive: false }}
                    />
                  )}
                  {/* Efek Sorot (Highlight Halo Rings) saat dipilih dari pohon atau peta */}
                  {isHighlighted && (
                    <>
                      <CircleMarker
                        center={[infra.latitude, infra.longitude]}
                        radius={radius + 12}
                        pathOptions={{
                          color: "#22d3ee",
                          fillColor: "#22d3ee",
                          fillOpacity: 0.35,
                          weight: 2.5,
                          className: "animate-pulse",
                        }}
                      />
                      <CircleMarker
                        center={[infra.latitude, infra.longitude]}
                        radius={radius + 6}
                        pathOptions={{
                          color: "#06b6d4",
                          fillColor: "transparent",
                          weight: 2,
                          dashArray: "4, 4",
                        }}
                      />
                    </>
                  )}
                  {/* Concentric halo untuk sentral router & OLT */}
                  {(isRouter || isOlt) && (
                    <CircleMarker
                      center={[infra.latitude, infra.longitude]}
                      radius={radius + 6}
                      pathOptions={{
                        color: color,
                        fillColor: color,
                        fillOpacity: 0.18,
                        weight: 1.5,
                        dashArray: "3, 3",
                      }}
                    />
                  )}
                  <CircleMarker
                    center={[infra.latitude, infra.longitude]}
                    radius={radius}
                    pathOptions={{
                      color: "#ffffff",
                      fillColor: color,
                      fillOpacity: 0.95,
                      weight: isRouter || isOlt ? 2.5 : 2,
                    }}
                    eventHandlers={{
                      click: () => {
                        handleSelectInfra(infra);
                      },
                    }}
                  >
                    <Tooltip direction="top" offset={[0, -radius]}>
                      <div className="text-xs space-y-0.5">
                        <span className="font-semibold block text-foreground">
                          {isRouter
                            ? "🖧 Router Gateway: "
                            : isOlt
                              ? "📡 OLT Fiber: "
                              : isOdc
                                ? "🗄️ ODC Sentral Feeder: "
                                : isOdp
                                  ? "📦 ODP Kotak: "
                                  : "📍 Tiang Fiber: "}
                          {infra.name}
                        </span>
                        {infra.host && <span className="text-[10px] text-muted-foreground block font-mono">{infra.host}</span>}
                        {isOdp && typeof infra.details?.connectedCustomers === "number" && (
                          <span className="text-[10px] text-muted-foreground block">
                            {infra.details.connectedCustomers} Pelanggan Terhubung
                          </span>
                        )}
                        {isPole && (
                          <span className="text-[10px] text-muted-foreground block">
                            Tiang Distribusi Fiber Aerial
                          </span>
                        )}
                        {isOdc && (
                          <span className="text-[10px] text-muted-foreground block">
                            Sentral Feeder &amp; Cross-Connect
                          </span>
                        )}
                      </div>
                    </Tooltip>
                  </CircleMarker>

                  {/* Ikon Vektor Penanda Perangkat (DivIcon tajam di tengah titik) */}
                  {infraIcons[infra.type] && (
                    <Marker
                      position={[infra.latitude, infra.longitude]}
                      icon={infraIcons[infra.type]}
                      interactive={false}
                    />
                  )}
                </span>
              );
            })}

          {/* Titik Pelanggan (Vektor Tajam dengan Indikator Optik & Tagihan) */}
          {showCustomers &&
            visibleCustomers.map((cust) => {
              if (cust.latitude === null || cust.longitude === null) return null;

              const isWeak = cust.opticalPower !== null && cust.opticalPower <= -24.5;
              const isIsolir = cust.billingStatus === "isolir";
              const color = !cust.isOnline
                ? "#ef4444"
                : isWeak
                  ? "#f59e0b"
                  : isIsolir
                    ? "#94a3b8"
                    : "#10b981";

              const isCustHighlighted = selectedCustomer?.id === cust.id || focusedNodeId === cust.id;

              return (
                <span key={cust.id} data-marker-type="customer" data-highlighted={isCustHighlighted ? "true" : undefined}>
                  {/* Efek Sorot (Highlight Halo Rings) saat dipilih dari pohon atau peta */}
                  {isCustHighlighted && (
                    <>
                      <CircleMarker
                        center={[cust.latitude, cust.longitude]}
                        radius={16}
                        pathOptions={{
                          color: "#22d3ee",
                          fillColor: "#22d3ee",
                          fillOpacity: 0.35,
                          weight: 2.5,
                          className: "animate-pulse",
                        }}
                      />
                      <CircleMarker
                        center={[cust.latitude, cust.longitude]}
                        radius={10}
                        pathOptions={{
                          color: "#06b6d4",
                          fillColor: "transparent",
                          weight: 2,
                          dashArray: "3, 3",
                        }}
                      />
                    </>
                  )}
                  {/* Halo peringatan sinyal optik lemah */}
                  {isWeak && (
                    <CircleMarker
                      center={[cust.latitude, cust.longitude]}
                      radius={8}
                      pathOptions={{
                        color: "#f59e0b",
                        fillColor: "#f59e0b",
                        fillOpacity: 0.25,
                        weight: 1,
                        dashArray: "2, 2",
                      }}
                    />
                  )}
                  {/* Cincin indikator isolir tagihan */}
                  {isIsolir && (
                    <CircleMarker
                      center={[cust.latitude, cust.longitude]}
                      radius={7.5}
                      pathOptions={{
                        color: "#f43f5e",
                        fillColor: "transparent",
                        weight: 1.5,
                        dashArray: "3, 2",
                      }}
                    />
                  )}
                  <CircleMarker
                    center={[cust.latitude, cust.longitude]}
                    radius={isWeak || isIsolir ? 6 : 5}
                    pathOptions={{
                      color: "#ffffff",
                      fillColor: color,
                      fillOpacity: 0.95,
                      weight: 1.5,
                    }}
                    eventHandlers={{
                      click: () => {
                        handleSelectCustomer(cust);
                      },
                    }}
                  >
                    <Tooltip direction="top" offset={[0, -6]}>
                      <div className="text-xs space-y-0.5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-semibold text-foreground">{cust.name}</p>
                          <span
                            className={cn(
                              "text-[9px] px-1 py-0.2 rounded font-medium uppercase tracking-wider",
                              isIsolir
                                ? "bg-rose-500/20 text-rose-600 dark:text-rose-400 font-bold"
                                : "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400",
                            )}
                          >
                            {cust.billingStatus}
                          </span>
                        </div>
                        <p className="font-mono text-[10px] text-muted-foreground">{cust.pppoeUsername}</p>
                        {cust.odpName && (
                          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <span>ODP:</span>
                            <span className="font-medium text-foreground">{cust.odpName}</span>
                          </p>
                        )}
                        <div className="flex items-center gap-1.5 pt-0.5 border-t border-border/50">
                          <span
                            className={cn(
                              "inline-block size-1.5 rounded-full",
                              cust.isOnline ? "bg-emerald-500" : "bg-red-500",
                            )}
                          />
                          <span className="text-[10px] font-medium">
                            {cust.isOnline ? "Online" : "Offline"}
                            {cust.opticalPower !== null && ` • ${cust.opticalPower} dBm`}
                          </span>
                        </div>
                      </div>
                    </Tooltip>
                  </CircleMarker>
                </span>
              );
            })}

          {/* Pemilih Lokasi Interaktif Saat Mode Geser Posisi / Penempatan / Pindah Perangkat / Plot Pelanggan Aktif */}
          <MapLocationPicker
            isEditing={isEditingLocation}
            isPlacing={placementType !== null && !placementDraftCoords}
            isMovingInfra={isMovingInfra}
            isPlottingCustomer={plottingCustomer !== null}
            onSelectLocation={(lat, lng) => {
              setDraftCoords({ lat, lng });
            }}
            onSelectPlacement={(lat, lng) => {
              setPlacementDraftCoords({ lat, lng });
            }}
            onSelectInfraMove={(lat, lng) => {
              setInfraMoveDraftCoords({ lat, lng });
            }}
            onSelectPlotting={(lat, lng) => {
              setDraftCoords({ lat, lng });
              setInspectedMapCoord(null);
            }}
            onInspectMapCoord={isInspectModeActive ? (lat, lng) => {
              setInspectedMapCoord({ lat, lng });
            } : undefined}
            isDrawCable={isDrawCableMode}
            onDrawCableAddPoint={handleDrawAddPoint}
            onDrawCableMouseMove={handleDrawMouseMove}
          />

          {/* Draggable Marker untuk Penempatan Titik Perangkat Baru */}
          {placementDraftCoords && (
            <Marker
              position={[placementDraftCoords.lat, placementDraftCoords.lng]}
              draggable={true}
              data-testid="draft-device-placement-marker"
              eventHandlers={{
                dragend: (e) => {
                  const marker = e.target;
                  const pos = marker.getLatLng();
                  setPlacementDraftCoords({ lat: pos.lat, lng: pos.lng });
                },
              }}
            >
              <Tooltip permanent direction="top" offset={[0, -32]}>
                <div className="text-xs space-y-0.5 text-center font-sans">
                  <span className="font-bold text-foreground block">
                    📍 Titik Baru {placementType?.toUpperCase() ?? "Perangkat"}
                  </span>
                  <span className="text-[10px] text-muted-foreground block font-mono">
                    {placementDraftCoords.lat.toFixed(6)}, {placementDraftCoords.lng.toFixed(6)}
                  </span>
                </div>
              </Tooltip>
            </Marker>
          )}

          {/* Draggable Marker untuk Mode Pindah Titik Perangkat Infrastruktur */}
          {isMovingInfra && infraMoveDraftCoords && selectedInfra && (
            <Marker
              position={[infraMoveDraftCoords.lat, infraMoveDraftCoords.lng]}
              draggable={true}
              data-testid="draggable-infra-marker"
              eventHandlers={{
                dragend: (e) => {
                  const marker = e.target;
                  const pos = marker.getLatLng();
                  setInfraMoveDraftCoords({ lat: pos.lat, lng: pos.lng });
                },
              }}
            >
              <Tooltip permanent direction="top" offset={[0, -28]}>
                <div className="text-xs space-y-0.5 text-center font-sans">
                  <span className="font-bold text-foreground block">
                    📍 Geser: {selectedInfra.name}
                  </span>
                  <span className="text-[10px] text-muted-foreground block font-mono">
                    {infraMoveDraftCoords.lat.toFixed(6)}, {infraMoveDraftCoords.lng.toFixed(6)}
                  </span>
                </div>
              </Tooltip>
            </Marker>
          )}

          {/* Draggable Marker untuk Geser Posisi Titik Pelanggan */}
          {isEditingLocation && draftCoords && (
            <Marker
              position={[draftCoords.lat, draftCoords.lng]}
              draggable={true}
              icon={dragPinIcon ?? undefined}
              data-testid="draggable-customer-marker"
              eventHandlers={{
                dragend: (e) => {
                  const marker = e.target;
                  const pos = marker.getLatLng();
                  setDraftCoords({ lat: pos.lat, lng: pos.lng });
                },
              }}
            >
              <Tooltip permanent direction="top" offset={[0, -42]}>
                <div className="text-xs space-y-0.5 text-center font-sans">
                  <span className="font-bold text-foreground block">
                    📍 Geser titik {selectedCustomer?.name}
                  </span>
                  <span className="text-[10px] text-muted-foreground block font-mono">
                    {draftCoords.lat.toFixed(6)}, {draftCoords.lng.toFixed(6)}
                  </span>
                </div>
              </Tooltip>
            </Marker>
          )}

          {/* Draggable Marker untuk Mode Penentuan / Plotting Titik Pelanggan Baru */}
          {plottingCustomer && draftCoords && (
            <Marker
              position={[draftCoords.lat, draftCoords.lng]}
              draggable={true}
              icon={dragPinIcon ?? undefined}
              data-testid="draft-customer-plotting-marker"
              eventHandlers={{
                dragend: (e) => {
                  const marker = e.target;
                  const pos = marker.getLatLng();
                  setDraftCoords({ lat: pos.lat, lng: pos.lng });
                },
              }}
            >
              <Tooltip permanent direction="top" offset={[0, -42]}>
                <div className="text-xs space-y-0.5 text-center font-sans">
                  <span className="font-bold text-foreground block">
                    📍 Titik: {plottingCustomer.name}
                  </span>
                  <span className="text-[10px] text-muted-foreground block font-mono">
                    {draftCoords.lat.toFixed(6)}, {draftCoords.lng.toFixed(6)}
                  </span>
                </div>
              </Tooltip>
            </Marker>
          )}

          {/* Marker Titik Inspeksi Koordinat Bebas */}
          {inspectedMapCoord && !plottingCustomer && !placementType && !isMovingInfra && !isEditingLocation && (
            <CircleMarker
              center={[inspectedMapCoord.lat, inspectedMapCoord.lng]}
              radius={8}
              pathOptions={{
                color: "#10b981",
                fillColor: "#10b981",
                fillOpacity: 0.35,
                weight: 2,
              }}
            >
              <Tooltip permanent direction="top" offset={[0, -10]}>
                <span className="font-mono text-[10px]">
                  {inspectedMapCoord.lat.toFixed(6)}, {inspectedMapCoord.lng.toFixed(6)}
                </span>
              </Tooltip>
            </CircleMarker>
          )}

          {/* Lokasi GPS Teknisi */}
          {userLocation && (
            <>
              <Circle
                center={[userLocation.lat, userLocation.lng]}
                radius={userLocation.accuracy}
                pathOptions={{
                  color: "#3b82f6",
                  fillColor: "#3b82f6",
                  fillOpacity: 0.15,
                  weight: 1,
                }}
              />
              <CircleMarker
                center={[userLocation.lat, userLocation.lng]}
                radius={7}
                pathOptions={{
                  color: "#ffffff",
                  fillColor: "#2563eb",
                  fillOpacity: 1,
                  weight: 2,
                }}
              >
                <Tooltip permanent direction="top" offset={[0, -7]}>
                  <span className="font-medium text-[11px]">Lokasi Anda (±{Math.round(userLocation.accuracy)}m)</span>
                </Tooltip>
              </CircleMarker>
            </>
          )}
        </MapContainer>
      </div>

      {/* Floating Action Card: Konfirmasi Simpan Titik Pelanggan yang Sedang Diplot */}
      {plottingCustomer && (
        <Card
          data-testid="customer-coordinate-confirmation-card"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[1050] w-[92vw] max-w-md p-4 bg-background/95 backdrop-blur-md border-primary/30 shadow-2xl space-y-3"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="flex size-2 rounded-full bg-emerald-500 animate-ping" />
                <span className="text-xs font-semibold uppercase tracking-wider text-primary">
                  Mode Plotting Titik Pelanggan
                </span>
              </div>
              <h4 className="font-bold text-sm text-foreground line-clamp-1">
                {plottingCustomer.name}
              </h4>
              <p className="text-xs text-muted-foreground font-mono">
                {plottingCustomer.pppoeUsername || "Tanpa PPPoE"} &bull; ODP: {plottingCustomer.odpName || "-"}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:text-foreground"
              onClick={() => {
                setPlottingCustomer(null);
                setDraftCoords(null);
                setSaveErrorMessage(null);
              }}
            >
              <X className="size-4" />
            </Button>
          </div>

          <div className="rounded-md border bg-muted/40 p-2.5 text-xs">
            {draftCoords ? (
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[11px] text-muted-foreground block">Koordinat Terpilih:</span>
                  <span className="font-mono font-medium text-foreground">
                    {draftCoords.lat.toFixed(6)}, {draftCoords.lng.toFixed(6)}
                  </span>
                </div>
                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px]">
                  Siap Simpan
                </Badge>
              </div>
            ) : (
              <p className="text-amber-600 dark:text-amber-400 font-medium">
                👉 Klik pada peta untuk menentukan posisi rumah/titik pelanggan ini.
              </p>
            )}
          </div>

          {saveErrorMessage && (
            <div className="p-2 rounded bg-destructive/10 border border-destructive/20 text-xs text-destructive flex items-center gap-1.5">
              <AlertTriangle className="size-4 shrink-0" />
              <span>{saveErrorMessage}</span>
            </div>
          )}

          {saveSuccessMessage && (
            <div className="p-2 rounded bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-600 flex items-center gap-1.5">
              <span>{saveSuccessMessage}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="cancel-customer-coordinate-button"
              onClick={() => {
                setPlottingCustomer(null);
                setDraftCoords(null);
                setSaveErrorMessage(null);
              }}
              disabled={isSavingLocation}
            >
              Batal
            </Button>
            <Button
              type="button"
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium gap-1.5"
              data-testid="save-customer-coordinate-button"
              onClick={handleSavePlottedCustomer}
              disabled={!draftCoords || isSavingLocation}
            >
              {isSavingLocation ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Menyimpan ke Database...
                </>
              ) : (
                <>
                  <Save className="size-3.5" />
                  Simpan ke Database
                </>
              )}
            </Button>
          </div>
        </Card>
      )}

      {/* Floating Card: Koordinat Terpilih dari Klik Peta Bebas */}
      {inspectedMapCoord && !plottingCustomer && !placementType && !isMovingInfra && !isEditingLocation && (
        <Card
          data-testid="inspected-map-coord-card"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[1040] w-[90vw] max-w-sm p-3.5 bg-background/95 backdrop-blur-md border-emerald-500/30 shadow-xl space-y-2.5"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
              <Crosshair className="size-3.5" />
              <span>Titik Koordinat Terpilih</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              data-testid="close-inspected-coord-button"
              className="size-6 text-muted-foreground hover:text-foreground"
              onClick={() => {
                setInspectedMapCoord(null);
                setIsInspectModeActive(false);
              }}
            >
              <X className="size-3.5" />
            </Button>
          </div>

          <div className="flex items-center justify-between gap-2 p-2 rounded bg-muted/50 border font-mono text-xs">
            <span>
              {inspectedMapCoord.lat.toFixed(6)}, {inspectedMapCoord.lng.toFixed(6)}
            </span>
            <Button
              variant="outline"
              size="icon"
              data-testid="copy-inspected-coord-button"
              className="size-6 text-muted-foreground hover:text-foreground shrink-0"
              title="Salin Koordinat"
              onClick={() => {
                navigator.clipboard.writeText(
                  `${inspectedMapCoord.lat.toFixed(6)}, ${inspectedMapCoord.lng.toFixed(6)}`
                );
                setIsCopiedCoord(true);
                setTimeout(() => setIsCopiedCoord(false), 2000);
              }}
            >
              {isCopiedCoord ? <span className="text-[10px] text-emerald-600 font-bold">✓</span> : <Copy className="size-3" />}
            </Button>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">Tautkan ke pelanggan:</span>
            <Button
              size="sm"
              className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
              data-testid="plot-inspected-customer-button"
              onClick={() => setIsCustomerPickerOpen(true)}
            >
              <MapPin className="size-3" />
              Plot Pelanggan
            </Button>
          </div>
        </Card>
      )}

      {/* Floating Card: Input Titik Koordinat GPS Manual */}
      {isManualCoordModalOpen && (
        <Card
          data-testid="manual-coord-input-card"
          className="fixed top-20 sm:top-24 left-1/2 -translate-x-1/2 z-[1060] w-[92vw] max-w-md p-4 bg-background/95 backdrop-blur-md border-primary/30 shadow-2xl space-y-3 animate-in fade-in slide-in-from-top-2 duration-150"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Crosshair className="size-4 text-emerald-500" />
                <h4 className="font-bold text-sm text-foreground">
                  Input Titik Koordinat GPS Manual
                </h4>
              </div>
              <p className="text-xs text-muted-foreground">
                Masukkan koordinat untuk melompat, menandai titik, atau menautkan ke pelanggan.
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              data-testid="close-manual-coord-button"
              className="size-7 text-muted-foreground hover:text-foreground"
              onClick={() => {
                setIsManualCoordModalOpen(false);
                setManualCoordError(null);
                setManualCoordSuccess(null);
              }}
            >
              <X className="size-4" />
            </Button>
          </div>

          <div className="space-y-2">
            <div className="relative">
              <Input
                type="text"
                value={manualCoordInput}
                onChange={(e) => {
                  setManualCoordInput(e.target.value);
                  if (manualCoordError) setManualCoordError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleApplyManualCoord();
                  }
                }}
                placeholder="contoh: -2.578556, 101.218500"
                className="font-mono text-xs pr-16 bg-background"
                data-testid="manual-coord-input-field"
                autoFocus
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                onClick={async () => {
                  try {
                    const text = await navigator.clipboard.readText();
                    if (text) {
                      setManualCoordInput(text.trim());
                      handleApplyManualCoord(text.trim());
                    }
                  } catch {}
                }}
                title="Tempel dari Clipboard"
              >
                Paste
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="font-medium">Format didukung:</span>
              <span className="px-1.5 py-0.5 rounded bg-muted font-mono text-[10px]">lat, lng</span>
              <span className="px-1.5 py-0.5 rounded bg-muted font-mono text-[10px]">lat lng</span>
              <span className="px-1.5 py-0.5 rounded bg-muted font-mono text-[10px]">Google Maps URL</span>
            </div>

            {manualCoordError && (
              <div
                className="p-2 rounded bg-destructive/10 border border-destructive/20 text-xs text-destructive flex items-center gap-1.5"
                data-testid="manual-coord-error-message"
              >
                <AlertTriangle className="size-3.5 shrink-0" />
                <span>{manualCoordError}</span>
              </div>
            )}

            {manualCoordSuccess && (
              <div
                className="p-2 rounded bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-600 flex items-center gap-1.5"
                data-testid="manual-coord-success-message"
              >
                <span>{manualCoordSuccess}</span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => {
                setManualCoordInput("-2.578556, 101.218500");
                handleApplyManualCoord("-2.578556, 101.218500");
              }}
            >
              Sentral Mukomuko
            </Button>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-xs"
                data-testid="plot-manual-coord-customer-button"
                onClick={() => {
                  const parsed = parseCoordinates(manualCoordInput);
                  if (parsed) {
                    setInspectedMapCoord(parsed);
                    setIsManualCoordModalOpen(false);
                    setIsCustomerPickerOpen(true);
                  } else {
                    setManualCoordError("Tentukan koordinat yang valid terlebih dahulu.");
                  }
                }}
              >
                <MapPin className="size-3.5 mr-1 text-emerald-500" />
                Plot Pelanggan
              </Button>

              <Button
                type="button"
                size="sm"
                className="bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold"
                data-testid="apply-manual-coord-button"
                onClick={() => handleApplyManualCoord()}
              >
                Terapkan Titik
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Modal Pemilihan Pelanggan untuk Plotting Koordinat */}
      <CustomerCoordinatePickerModal
        isOpen={isCustomerPickerOpen}
        onClose={() => setIsCustomerPickerOpen(false)}
        customers={data?.customers ?? []}
        onSelectCustomer={handleSelectCustomerForPlotting}
        prefilledCoord={inspectedMapCoord}
      />

      {/* Pemilih Jenis Perangkat & Form Konfirmasi Penempatan */}
      <DeviceTypePicker
        isOpen={isPlacementPickerOpen}
        suggestedName={
          placementType === "odp"
            ? `ODP-${String((fetchedData?.infrastructure?.filter((i) => i.type === "odp").length ?? 0) + 1).padStart(2, "0")}`
            : placementType === "odc"
              ? `ODC-${String((fetchedData?.infrastructure?.filter((i) => i.type === "odc").length ?? 0) + 1).padStart(2, "0")}`
              : undefined
        }
        onClose={() => {
          setIsPlacementPickerOpen(false);
          setPlacementType(null);
        }}
        selectedType={placementType}
        onSelectType={(type) => {
          setPlacementType(type);
          setIsPlacementPickerOpen(false);
        }}
        draftCoordinates={placementDraftCoords}
        onConfirmPlacement={handleConfirmDevicePlacement}
        onCancelPlacement={() => {
          setPlacementDraftCoords(null);
          setPlacementType(null);
          setIsPlacementPickerOpen(false);
        }}
        isSaving={isSavingPlacement}
        successMessage={placementSuccessMessage}
        errorMessage={placementErrorMessage}
      />

      {/* Layer Panel Inspeksi Detail Terpisah dari Layer Titik Kanvas Leaflet */}
      <MapDetailInspectorLayer
        selectedCustomer={selectedCustomer}
        selectedInfra={selectedInfra}
        customerEdit={customerEditState}
        infraMove={infraMoveState}
        allCustomers={data?.customers}
        map={map}
        onCloseCustomer={() => {
          setIsEditingLocation(false);
          setDraftCoords(null);
          setSelectedCustomer(null);
          handleSelectCustomer(null);
        }}
        onToggleCustomerEdit={handleToggleEditLocation}
        onSaveCustomerLocation={handleSaveLocation}
        onCancelCustomerEdit={handleCancelEditLocation}
        onDeleteCustomer={handleDeleteCustomer}
        isDeletingCustomer={isDeletingCustomer}
        onCloseInfra={() => {
          handleSelectInfra(null);
          setIsMovingInfra(false);
          setInfraMoveDraftCoords(null);
        }}
        onStartInfraMove={handleStartMoveInfra}
        onCancelInfraMove={handleCancelMoveInfra}
        onSaveInfraMove={handleSaveMoveInfra}
        onDeleteInfra={handleDeleteInfra}
        infraList={fetchedData?.infrastructure?.map((i) => ({ id: i.id, name: i.name, type: i.type })) || []}
        onSetParent={handleSetParent}
        isSettingParent={isSettingParent}
      />

      {/* Dialog Konfirmasi Buat Jalur Kabel */}
      {showConnectDialog && connectSource && connectTarget && (
        <Card className="fixed top-20 left-1/2 -translate-x-1/2 z-[1060] w-[92vw] max-w-sm p-4 bg-background/95 backdrop-blur-md border-indigo-500/30 shadow-2xl space-y-3 animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                <Share2 className="size-4 text-indigo-500" />
                Segmen {connectSavedSegments + 1}
                {connectRouteName && <span className="text-indigo-500 font-normal text-xs">— {connectRouteName}</span>}
              </h3>
              <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
                <span className="font-medium text-foreground">{connectSource.name}</span>
                <span>→</span>
                <span className="font-medium text-foreground">{connectTarget.name}</span>
              </p>
            </div>
            <Button type="button" size="icon" variant="ghost" className="size-6 shrink-0"
              onClick={() => { setShowConnectDialog(false); setConnectTarget(null); }}>
              <X className="size-3.5" />
            </Button>
          </div>
          <div className="space-y-2 text-xs">
            <div>
              <label className="text-muted-foreground block mb-1">Nama Jalur</label>
              <Input value={connectCableName} onChange={(e) => setConnectCableName(e.target.value)}
                className="h-7 text-xs" placeholder="Jalur Desa PON1 ➔ ODP1" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-muted-foreground block mb-1">Tipe</label>
                <select value={connectCableType} onChange={(e) => setConnectCableType(e.target.value)}
                  className="w-full h-7 text-xs rounded border border-border bg-background px-2">
                  <option value="backbone">Backbone</option>
                  <option value="feeder">Feeder</option>
                  <option value="distribution">Distribusi</option>
                  <option value="drop">Drop</option>
                </select>
              </div>
              <div>
                <label className="text-muted-foreground block mb-1">Core</label>
                <select value={connectCableCapacity} onChange={(e) => setConnectCableCapacity(Number(e.target.value))}
                  className="w-full h-7 text-xs rounded border border-border bg-background px-2">
                  {[6, 12, 24, 48, 96, 144].map(n => <option key={n} value={n}>{n} Core</option>)}
                </select>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-muted-foreground shrink-0">Warna:</label>
              <input type="color" value={connectCableColor} onChange={(e) => setConnectCableColor(e.target.value)}
                className="h-6 w-10 cursor-pointer rounded border border-border bg-transparent p-0.5" />
              <span className="text-[10px] text-muted-foreground">akan berlaku ke segmen berikutnya</span>
            </div>
            {connectCableError && <p className="text-destructive text-[11px]">{connectCableError}</p>}
          </div>
          <div className="flex gap-2 pt-1">
            <Button type="button" size="sm" variant="outline" className="h-7 text-xs px-3"
              onClick={() => { setShowConnectDialog(false); setConnectTarget(null); }}>
              Batal
            </Button>
            <Button type="button" size="sm" className="flex-1 h-7 text-xs gap-1 bg-indigo-600 hover:bg-indigo-700"
              disabled={!connectCableName.trim() || isSavingCable} onClick={handleSaveConnectCable}>
              {isSavingCable ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
              Simpan &amp; Lanjut
            </Button>
          </div>
        </Card>
      )}

      {/* Dialog Simpan Jalur Gambar Kabel */}
      {showDrawDialog && (
        <Card className="fixed top-20 left-1/2 -translate-x-1/2 z-[1060] w-[92vw] max-w-sm p-4 bg-background/95 backdrop-blur-md border-violet-500/30 shadow-2xl space-y-3 animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                <Pencil className="size-4 text-violet-500" /> Simpan Jalur Kabel
              </h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">{drawWaypoints.length} titik waypoint</p>
            </div>
            <Button type="button" size="icon" variant="ghost" className="size-6 shrink-0"
              onClick={() => setShowDrawDialog(false)}>
              <X className="size-3.5" />
            </Button>
          </div>
          <div className="space-y-2 text-xs">
            <div>
              <label className="text-muted-foreground block mb-1">Nama Jalur</label>
              <Input value={drawCableName} onChange={(e) => setDrawCableName(e.target.value)}
                className="h-7 text-xs" placeholder="Jalur Desa PON1" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-muted-foreground block mb-1">Tipe</label>
                <select value={drawCableType} onChange={(e) => setDrawCableType(e.target.value)}
                  className="w-full h-7 text-xs rounded border border-border bg-background px-2">
                  <option value="backbone">Backbone</option>
                  <option value="feeder">Feeder</option>
                  <option value="distribution">Distribusi</option>
                  <option value="drop">Drop</option>
                </select>
              </div>
              <div>
                <label className="text-muted-foreground block mb-1">Core</label>
                <select value={drawCableCapacity} onChange={(e) => setDrawCableCapacity(Number(e.target.value))}
                  className="w-full h-7 text-xs rounded border border-border bg-background px-2">
                  {[6, 12, 24, 48, 96, 144].map(n => <option key={n} value={n}>{n} Core</option>)}
                </select>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-muted-foreground shrink-0">Warna:</label>
              <input type="color" value={drawCableColor} onChange={(e) => setDrawCableColor(e.target.value)}
                className="h-6 w-10 cursor-pointer rounded border border-border bg-transparent p-0.5" />
            </div>
            {drawCableError && <p className="text-destructive text-[11px]">{drawCableError}</p>}
          </div>
          <div className="flex gap-2 pt-1">
            <Button type="button" size="sm" variant="outline" className="h-7 text-xs px-3"
              onClick={() => setShowDrawDialog(false)}>
              Lanjut Edit
            </Button>
            <Button type="button" size="sm" className="flex-1 h-7 text-xs gap-1 bg-violet-600 hover:bg-violet-700"
              disabled={!drawCableName.trim() || isSavingDraw} onClick={handleSaveDrawCable}>
              {isSavingDraw ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
              Simpan Kabel
            </Button>
          </div>
        </Card>
      )}

      {/* Panel Informasi & Legenda Posisi Tetap (Fixed Docked Legend) */}
      <NetworkMapLegend
        showCustomers={showCustomers}
        onToggleCustomers={() => setShowCustomers(!showCustomers)}
        customerCount={geocodedList.length}
        showInfrastructure={showInfrastructure}
        onToggleInfrastructure={() => setShowInfrastructure(!showInfrastructure)}
        infraCount={data?.infrastructure.length ?? 0}
        showCables={showCables}
        onToggleCables={() => setShowCables(!showCables)}
        cableCount={cableRoutes.length}
      />
    </div>
  );
}
