"use client";

import React, { useState, useMemo, useCallback } from "react";
import Link from "next/link";
import {
  Layers,
  Database,
  Share2,
  Router,
  Network,
  Users,
  Search,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Eye,
  Filter,
  Maximize2,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Info,
  Pencil,
  Plus,
  Trash2,
  Save,
  RotateCcw,
  Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { NetworkMapLeafletLoader } from "./network-map-leaflet-loader";
import type { CableMapData, CableRouteSegment } from "@/services/cable-map.service";
import type { NetworkMapData } from "@/services/network-map.service";
import { CABLE_CAPACITY_TIERS } from "@/config/cable-capacity";
import { calculatePolylineTotalMeters } from "@/lib/cable-path-routing";

export interface CableMapBoardProps {
  initialData: CableMapData;
  initialFocusId?: string;
  className?: string;
}

export function CableMapBoard({
  initialData,
  initialFocusId,
  className = "",
}: CableMapBoardProps) {
  const [data, setData] = useState<CableMapData>(initialData);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedType, setSelectedType] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [selectedCable, setSelectedCable] = useState<CableRouteSegment | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isLegendOpen, setIsLegendOpen] = useState(true);
  const [isFloatingLegendOpen, setIsFloatingLegendOpen] = useState(false);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(initialFocusId ?? null);

  // Hapus kabel
  const [isDeletingCable, setIsDeletingCable] = useState(false);
  const [showCableDeleteConfirm, setShowCableDeleteConfirm] = useState(false);
  const [cableDeleteError, setCableDeleteError] = useState<string | null>(null);

  const handleDeleteCable = useCallback(async () => {
    if (!selectedCable) return;
    setIsDeletingCable(true);
    setCableDeleteError(null);
    try {
      const res = await fetch(`/api/map/cables/${selectedCable.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Gagal menghapus kabel.");
      const deletedId = selectedCable.id;
      setData((prev) => ({ ...prev, cables: prev.cables.filter((c) => c.id !== deletedId) }));
      setSelectedCable(null);
      setShowCableDeleteConfirm(false);
    } catch (err) {
      setCableDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsDeletingCable(false);
    }
  }, [selectedCable]);

  // Mode Editor Titik Belokan Kabel
  const [isEditingWaypoints, setIsEditingWaypoints] = useState(false);
  const [editableWaypoints, setEditableWaypoints] = useState<[number, number][]>([]);
  const [isSavingWaypoints, setIsSavingWaypoints] = useState(false);
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);

  // Masuk ke mode edit titik belokan
  const handleStartEditWaypoints = useCallback(() => {
    if (!selectedCable) return;
    setIsEditingWaypoints(true);
    setSaveSuccessMessage(null);
    setSaveErrorMessage(null);
    setEditableWaypoints([...selectedCable.coordinates]);
  }, [selectedCable]);

  // Tambah titik belokan baru di antara titik rute
  const handleAddWaypoint = useCallback(() => {
    if (editableWaypoints.length < 2) return;
    const midIdx = Math.floor(editableWaypoints.length / 2);
    const p1 = editableWaypoints[midIdx - 1];
    const p2 = editableWaypoints[midIdx];
    const newPoint: [number, number] = [
      Number(((p1[0] + p2[0]) / 2).toFixed(6)),
      Number(((p1[1] + p2[1]) / 2).toFixed(6)),
    ];
    const updated = [...editableWaypoints];
    updated.splice(midIdx, 0, newPoint);
    setEditableWaypoints(updated);
  }, [editableWaypoints]);

  // Geser titik belokan (update koordinat lat/lng pada indeks tertentu)
  const handleMoveWaypoint = useCallback((index: number, newLat: number, newLng: number) => {
    setEditableWaypoints((prev) => {
      const next = [...prev];
      if (index >= 0 && index < next.length) {
        next[index] = [Number(newLat.toFixed(6)), Number(newLng.toFixed(6))];
      }
      return next;
    });
  }, []);

  // Hapus titik belokan (titik perantara)
  const handleRemoveWaypoint = useCallback((index: number) => {
    setEditableWaypoints((prev) => {
      if (prev.length <= 2) return prev;
      if (index === 0 || index === prev.length - 1) return prev;
      const next = [...prev];
      next.splice(index, 1);
      return next;
    });
  }, []);

  // Simpan perubahan titik belokan ke backend
  const handleSaveWaypoints = useCallback(async () => {
    if (!selectedCable) return;
    setIsSavingWaypoints(true);
    setSaveSuccessMessage(null);
    setSaveErrorMessage(null);

    try {
      const intermediateWaypoints = editableWaypoints.slice(1, -1);
      const res = await fetch("/api/map/cables/waypoints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cableId: selectedCable.id,
          sourceId: selectedCable.sourceId,
          targetId: selectedCable.targetId,
          waypoints: intermediateWaypoints,
        }),
      });

      if (!res.ok) {
        throw new Error("Gagal menyimpan titik belokan ke server");
      }

      const newDistance = calculatePolylineTotalMeters(editableWaypoints);
      setSelectedCable((prev) =>
        prev
          ? {
              ...prev,
              coordinates: [...editableWaypoints],
              estimatedLengthMeters: newDistance,
            }
          : null,
      );

      setSaveSuccessMessage("Titik belokan rute kabel berhasil disimpan.");
      setIsEditingWaypoints(false);
    } catch (err) {
      setSaveErrorMessage(err instanceof Error ? err.message : "Terjadi kesalahan");
    } finally {
      setIsSavingWaypoints(false);
    }
  }, [selectedCable, editableWaypoints]);

  // Batal edit
  const handleCancelEditWaypoints = useCallback(() => {
    setIsEditingWaypoints(false);
    setSaveSuccessMessage(null);
    setSaveErrorMessage(null);
    if (selectedCable) {
      setEditableWaypoints([...selectedCable.coordinates]);
    }
  }, [selectedCable]);

  // Filter daftar jalur kabel berdasarkan pencarian, tipe, dan status
  const filteredCables = useMemo(() => {
    return data.cables.filter((cable) => {
      // Filter tipe
      if (selectedType !== "all" && cable.type !== selectedType) {
        return false;
      }
      // Filter status
      if (selectedStatus !== "all" && cable.status !== selectedStatus) {
        return false;
      }
      // Filter kata kunci pencarian
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = cable.name.toLowerCase().includes(q);
        const matchSource = cable.sourceName.toLowerCase().includes(q);
        const matchTarget = cable.targetName.toLowerCase().includes(q);
        return matchName || matchSource || matchTarget;
      }
      return true;
    });
  }, [data.cables, selectedType, selectedStatus, searchQuery]);

  // Siapkan data kompatibel untuk NetworkMapLeafletLoader
  const mapData: NetworkMapData = useMemo(() => {
    // Jika ada filter tipe aktif (misal hanya drop atau hanya backbone),
    // kita tetap berikan infrastruktur & pelanggan yang relevan
    return data.networkMapData;
  }, [data.networkMapData]);

  const handleSelectCable = useCallback((cable: CableRouteSegment) => {
    setSelectedCable(cable);
    // Fokuskan ke target simpul (ODP atau Pelanggan)
    setFocusedNodeId(cable.targetId);
  }, []);

  const formatDistance = (meters: number) => {
    if (meters >= 1000) {
      return `${(meters / 1000).toFixed(2)} km`;
    }
    return `${meters} m`;
  };

  return (
    <div
      className={`flex w-full flex-col gap-3.5 ${className}`}
      data-testid="cable-map-board"
    >
      {/* Header Bar Modul Peta Jalur Kabel */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl text-foreground flex items-center gap-2">
              <Share2 className="size-5 text-primary rotate-45" />
              Peta Jalur Kabel Jaringan
            </h1>
            {data.dataSource.isRealData ? (
              <Badge
                variant="outline"
                className="text-xs gap-1 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5 font-medium"
                data-testid="data-source-badge"
              >
                <Database className="size-3" />
                PostgreSQL Live
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="text-xs gap-1 border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10 font-medium"
                data-testid="data-source-badge"
              >
                <Database className="size-3" />
                Data Mock Lokal
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Visualisasi bentangan jalur kabel serat optik lapangan: Backbone BGP/OLT, Feeder ODC/ODP, Distribusi, dan Drop Kabel Pelanggan.
          </p>
        </div>

        {/* Action Controls & Navigation Shortcuts */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs font-medium"
            data-testid="shortcut-peta-infra-link"
          >
            <Link href="/app/peta" title="Buka peta peletakan fisik infrastruktur">
              <Layers className="size-3.5 text-primary" />
              <span>Peta Peletakan</span>
            </Link>
          </Button>

          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs font-medium"
            data-testid="shortcut-topologi-link"
          >
            <Link href="/app/topologi" title="Buka peta hierarki susunan bertingkat">
              <Share2 className="size-3.5 text-purple-500 rotate-90" />
              <span>Susunan Bertingkat</span>
            </Link>
          </Button>

          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs font-medium"
            data-testid="shortcut-customer-map-link"
          >
            <Link href="/app/pelanggan/peta" title="Buka peta sebaran pelanggan">
              <Users className="size-3.5 text-emerald-500" />
              <span>Peta Pelanggan</span>
            </Link>
          </Button>

          <div className="hidden xl:flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/60 px-2.5 py-1 rounded-md border">
            <span>Wilayah:</span>
            <span className="font-semibold text-foreground">Mukomuko / CIARA</span>
          </div>
        </div>
      </div>

      {/* Ringkasan Metrik Jalur Kabel Nyata */}
      <div
        className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-2.5"
        data-testid="cable-metrics-grid"
      >
        <Card className="p-3 bg-card/60 backdrop-blur-xs shadow-xs" data-testid="metric-total-cables">
          <CardContent className="p-0 flex items-center gap-2.5">
            <div className="p-2 rounded-md bg-primary/10 text-primary">
              <Share2 className="size-4 rotate-45" />
            </div>
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">Total Jalur Kabel</p>
              <p className="text-lg font-bold text-foreground leading-none mt-0.5">
                {data.summary.totalSegments}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="p-3 bg-card/60 backdrop-blur-xs shadow-xs" data-testid="metric-total-length">
          <CardContent className="p-0 flex items-center gap-2.5">
            <div className="p-2 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Maximize2 className="size-4" />
            </div>
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">Total Panjang Kabel</p>
              <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400 leading-none mt-0.5">
                {formatDistance(data.summary.totalEstimatedLengthMeters)}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="p-3 bg-card/60 backdrop-blur-xs shadow-xs" data-testid="metric-backbone-feeder">
          <CardContent className="p-0 flex items-center gap-2.5">
            <div className="p-2 rounded-md bg-purple-500/10 text-purple-600 dark:text-purple-400">
              <Router className="size-4" />
            </div>
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">Backbone & Feeder</p>
              <p className="text-lg font-bold text-purple-600 dark:text-purple-400 leading-none mt-0.5">
                {data.summary.totalBackboneSegments + data.summary.totalFeederSegments}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="p-3 bg-card/60 backdrop-blur-xs shadow-xs" data-testid="metric-drop-cables">
          <CardContent className="p-0 flex items-center gap-2.5">
            <div className="p-2 rounded-md bg-cyan-500/10 text-cyan-600 dark:text-cyan-400">
              <Network className="size-4" />
            </div>
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">Drop Pelanggan</p>
              <p className="text-lg font-bold text-cyan-600 dark:text-cyan-400 leading-none mt-0.5">
                {data.summary.totalDropSegments}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="p-3 bg-card/60 backdrop-blur-xs shadow-xs col-span-2 sm:col-span-1" data-testid="metric-cable-health">
          <CardContent className="p-0 flex items-center gap-2.5">
            <div className="p-2 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <CheckCircle2 className="size-4" />
            </div>
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">Kondisi Aktif / Normal</p>
              <p className="text-lg font-bold text-amber-600 dark:text-amber-400 leading-none mt-0.5">
                {data.summary.activeSegments} / {data.summary.totalSegments}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Container: Split Panel Daftar Jalur Kabel & Kanvas Peta Leaflet */}
      <div className="relative flex flex-col lg:flex-row gap-3 w-full h-[calc(100vh-210px)] min-h-[620px]">
        {/* Panel Samping: Filter & Daftar Jalur Kabel */}
        {isSidebarOpen && (
          <aside
            className="w-full lg:w-80 shrink-0 flex flex-col rounded-xl border bg-card/90 backdrop-blur-md shadow-xs overflow-hidden transition-all duration-200 z-10"
            data-testid="cable-list-sidebar"
          >
            {/* Header Sidebar & Pencarian */}
            <div className="p-3 border-b flex flex-col gap-2.5 bg-muted/20">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold tracking-tight text-foreground flex items-center gap-1.5">
                  <Filter className="size-3.5 text-primary" />
                  Daftar Jalur Kabel ({filteredCables.length})
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 text-muted-foreground hover:text-foreground"
                  onClick={() => setIsSidebarOpen(false)}
                  title="Sembunyikan panel daftar"
                  data-testid="close-cable-sidebar-button"
                >
                  <ChevronRight className="size-3.5" />
                </Button>
              </div>

              {/* Input Pencarian */}
              <div className="relative">
                <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Cari ODP, router, atau pelanggan..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-7 pl-8 text-xs bg-background/80"
                  data-testid="cable-search-input"
                />
              </div>

              {/* Filter Tipe Kabel */}
              <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
                {[
                  { id: "all", label: "Semua Tipe" },
                  { id: "backbone", label: "Backbone" },
                  { id: "feeder", label: "Feeder" },
                  { id: "drop", label: "Drop" },
                ].map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setSelectedType(item.id)}
                    className={`px-2 py-0.5 text-[10px] font-medium rounded-md whitespace-nowrap transition-colors ${
                      selectedType === item.id
                        ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                        : "bg-muted/60 text-muted-foreground hover:bg-muted"
                    }`}
                    data-testid={`filter-type-${item.id}`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {/* Filter Status Kabel */}
              <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
                {[
                  { id: "all", label: "Semua Kondisi" },
                  { id: "active", label: "Aktif" },
                  { id: "warning", label: "Peringatan" },
                  { id: "offline", label: "Putus" },
                ].map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setSelectedStatus(item.id)}
                    className={`px-1.5 py-0.5 text-[10px] font-medium rounded-md whitespace-nowrap transition-colors ${
                      selectedStatus === item.id
                        ? "bg-foreground text-background font-semibold shadow-xs"
                        : "bg-muted/40 text-muted-foreground hover:bg-muted"
                    }`}
                    data-testid={`filter-status-${item.id}`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* List Jalur Kabel */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5 divide-y divide-border/20">
              {filteredCables.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground">
                  Tidak ada jalur kabel yang cocok dengan filter.
                </div>
              ) : (
                filteredCables.map((cable) => {
                  const isSelected = selectedCable?.id === cable.id;
                  return (
                    <div
                      key={cable.id}
                      onClick={() => handleSelectCable(cable)}
                      className={`p-2 rounded-lg cursor-pointer transition-all border text-xs flex flex-col gap-1 ${
                        isSelected
                          ? "bg-primary/10 border-primary/40 shadow-xs"
                          : "hover:bg-muted/50 border-transparent"
                      }`}
                      data-testid={`cable-item-${cable.id}`}
                      data-cable-type={cable.type}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-foreground truncate max-w-[190px]">
                          {cable.name}
                        </span>
                        <span
                          className={`size-2 rounded-full shrink-0 ${
                            cable.status === "active"
                              ? "bg-emerald-500"
                              : cable.status === "warning"
                                ? "bg-amber-500"
                                : "bg-red-500"
                          }`}
                          title={`Status: ${cable.status}`}
                        />
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-muted-foreground font-mono">
                        <span>{cable.coreCapacity} Core</span>
                        <span>{formatDistance(cable.estimatedLengthMeters)}</span>
                      </div>

                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <span className="truncate max-w-[100px] text-foreground font-medium">
                          {cable.sourceName}
                        </span>
                        <span>➔</span>
                        <span className="truncate max-w-[100px] text-foreground font-medium">
                          {cable.targetName}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Legenda Kapasitas Serat Optik (Bisa Dibuka/Tutup) */}
            <div
              className="border-t bg-muted/10 text-[11px]"
              data-testid="cable-capacity-legend"
            >
              <button
                type="button"
                onClick={() => setIsLegendOpen((prev) => !prev)}
                className="w-full p-2.5 flex items-center justify-between text-left hover:bg-muted/30 transition-colors"
                data-testid="toggle-legend-button"
                aria-expanded={isLegendOpen}
                title={isLegendOpen ? "Tutup legenda kapasitas serat" : "Buka legenda kapasitas serat"}
              >
                <span className="font-semibold text-foreground flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <Info className="size-3 text-primary" />
                  Legenda Kapasitas Serat
                </span>
                {isLegendOpen ? (
                  <ChevronDown className="size-3.5 text-muted-foreground" />
                ) : (
                  <ChevronUp className="size-3.5 text-muted-foreground" />
                )}
              </button>

              {isLegendOpen && (
                <div
                  className="px-2.5 pb-2.5 flex flex-col gap-1.5 text-[10px] animate-in fade-in"
                  data-testid="legend-content-panel"
                >
                  {CABLE_CAPACITY_TIERS.map((tier) => (
                    <div
                      key={tier.label}
                      onClick={() => setSelectedType(tier.category)}
                      className={`flex items-center justify-between p-1 rounded-md cursor-pointer transition-colors ${
                        selectedType === tier.category
                          ? "bg-primary/10 text-primary font-semibold"
                          : "hover:bg-muted/40 text-muted-foreground"
                      }`}
                      data-testid={`legend-tier-${tier.category}`}
                      title={`Klik untuk memfilter rute ${tier.label}`}
                    >
                      <div className="flex items-center gap-1.5 truncate max-w-[170px]">
                        <span
                          className="size-2 rounded-full shrink-0"
                          style={{ backgroundColor: tier.color }}
                        />
                        <span className="truncate">{tier.label}</span>
                      </div>
                      <span className="text-[9px] font-mono shrink-0">
                        {tier.baseWeight}px
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>
        )}

        {/* Tombol Buka Panel jika sedang tertutup */}
        {!isSidebarOpen && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setIsSidebarOpen(true)}
            className="absolute left-3 top-3 z-20 shadow-md bg-card/90 backdrop-blur-md border text-xs gap-1.5 h-8 font-medium"
            data-testid="open-cable-sidebar-button"
          >
            <Filter className="size-3.5 text-primary" />
            <span>Buka Daftar Jalur Kabel</span>
          </Button>
        )}

        {/* Area Kanvas Peta Leaflet */}
        <div className="flex-1 relative rounded-xl border overflow-hidden shadow-xs">
          <NetworkMapLeafletLoader
            initialData={mapData}
            initialFocusId={focusedNodeId ?? undefined}
            focusedNodeId={focusedNodeId}
          />

          {/* Floating Detail Kabel Terpilih di Peta */}
          {selectedCable && (
            <div
              className="absolute right-3 top-3 z-20 max-w-sm rounded-xl border bg-card/95 backdrop-blur-md p-3.5 shadow-lg text-xs space-y-2 animate-in fade-in"
              data-testid="selected-cable-detail-panel"
            >
              <div className="flex items-center justify-between border-b pb-1.5">
                <span className="font-bold text-foreground text-sm flex items-center gap-1.5">
                  <Share2 className="size-4 text-primary rotate-45" />
                  Detail Jalur Kabel
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-5 text-muted-foreground hover:text-foreground"
                  onClick={() => setSelectedCable(null)}
                >
                  <XCircle className="size-3.5" />
                </Button>
              </div>

              <div className="space-y-1">
                <p className="font-semibold text-foreground text-xs">{selectedCable.name}</p>
                <div className="grid grid-cols-2 gap-1.5 pt-1 text-[11px] text-muted-foreground">
                  <div>
                    <span className="block text-[10px] uppercase">Tipe Jalur:</span>
                    <span className="font-medium text-foreground uppercase">{selectedCable.type}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase">Kapasitas:</span>
                    <span className="font-medium text-foreground font-mono">{selectedCable.coreCapacity} Core</span>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase">Estimasi Panjang:</span>
                    <span className="font-medium text-foreground font-mono">
                      {formatDistance(selectedCable.estimatedLengthMeters)}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase">Kondisi Jalur:</span>
                    <span className="font-medium text-foreground capitalize flex items-center gap-1">
                      {selectedCable.status === "active" ? (
                        <CheckCircle2 className="size-3 text-emerald-500" />
                      ) : (
                        <AlertTriangle className="size-3 text-amber-500" />
                      )}
                      {selectedCable.status}
                    </span>
                  </div>
                </div>

                {/* Bagian Editor Titik Belokan (Waypoints Editor) */}
                <div className="pt-2 border-t mt-2 flex flex-col gap-2">
                  {!isEditingWaypoints ? (
                    <div className="flex flex-col gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={handleStartEditWaypoints}
                        className="h-7 text-xs gap-1.5 font-medium w-full"
                        data-testid="edit-cable-waypoints-button"
                      >
                        <Pencil className="size-3 text-primary" />
                        <span>Edit Titik Belokan ({selectedCable.coordinates.length} Titik)</span>
                      </Button>
                      {!showCableDeleteConfirm ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => { setShowCableDeleteConfirm(true); setCableDeleteError(null); }}
                          className="h-7 text-xs gap-1.5 font-medium w-full text-destructive border-destructive/40 hover:bg-destructive/10"
                          data-testid="delete-cable-button"
                        >
                          <Trash2 className="size-3" />
                          <span>Hapus Jalur Kabel</span>
                        </Button>
                      ) : (
                        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-2 space-y-1.5">
                          <p className="text-[11px] text-destructive font-medium">Hapus &quot;{selectedCable.name}&quot;?</p>
                          {cableDeleteError && (
                            <p className="text-[11px] text-destructive">{cableDeleteError}</p>
                          )}
                          <div className="flex gap-1.5">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => setShowCableDeleteConfirm(false)}
                              className="h-6 text-[10px] flex-1"
                              disabled={isDeletingCable}
                            >
                              Batal
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              onClick={handleDeleteCable}
                              className="h-6 text-[10px] flex-1 gap-1"
                              disabled={isDeletingCable}
                              data-testid="confirm-delete-cable-button"
                            >
                              {isDeletingCable ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
                              Ya Hapus
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div
                      className="p-2 rounded-lg border bg-muted/40 space-y-2"
                      data-testid="waypoints-editor-form"
                    >
                      <div className="flex items-center justify-between">
                        <Badge
                          variant="outline"
                          className="text-[10px] gap-1 border-primary/40 text-primary bg-primary/5"
                          data-testid="cable-edit-mode-badge"
                        >
                          <Pencil className="size-3" />
                          Mode Edit Titik Belokan
                        </Badge>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleAddWaypoint}
                          className="h-6 px-2 text-[10px] gap-1"
                          data-testid="add-waypoint-button"
                          title="Tambah titik belokan baru di antara titik rute"
                        >
                          <Plus className="size-3 text-emerald-500" />
                          <span>Tambah Titik</span>
                        </Button>
                      </div>

                      {/* Daftar Titik Waypoint (Koordinat & Aksi Geser/Hapus) */}
                      <div className="max-h-36 overflow-y-auto space-y-1 divide-y divide-border/20 pr-1">
                        {editableWaypoints.map((pt, idx) => {
                          const isStart = idx === 0;
                          const isEnd = idx === editableWaypoints.length - 1;
                          const isIntermediate = !isStart && !isEnd;

                          return (
                            <div
                              key={`${idx}-${pt[0]}-${pt[1]}`}
                              className="pt-1 flex items-center justify-between gap-1 text-[10px]"
                              data-testid={`waypoint-item-${idx}`}
                            >
                              <div className="flex items-center gap-1 font-mono text-muted-foreground truncate">
                                <span className="size-4 rounded-full bg-muted flex items-center justify-center font-bold text-[9px] shrink-0">
                                  {idx + 1}
                                </span>
                                <span className="truncate max-w-[150px]">
                                  {isStart ? "Awal (Induk)" : isEnd ? "Ujung (Target)" : `Belokan ${idx}`}
                                </span>
                              </div>

                              <div className="flex items-center gap-1 shrink-0">
                                {isIntermediate ? (
                                  <div className="flex items-center gap-0.5">
                                    <input
                                      type="number"
                                      step="0.0001"
                                      value={pt[0]}
                                      onChange={(e) =>
                                        handleMoveWaypoint(idx, parseFloat(e.target.value) || pt[0], pt[1])
                                      }
                                      className="w-14 h-5 px-1 bg-background border rounded text-[9px] font-mono text-foreground"
                                      data-testid={`input-lat-waypoint-${idx}`}
                                      title="Geser Latitude titik belokan"
                                    />
                                    <input
                                      type="number"
                                      step="0.0001"
                                      value={pt[1]}
                                      onChange={(e) =>
                                        handleMoveWaypoint(idx, pt[0], parseFloat(e.target.value) || pt[1])
                                      }
                                      className="w-14 h-5 px-1 bg-background border rounded text-[9px] font-mono text-foreground"
                                      data-testid={`input-lng-waypoint-${idx}`}
                                      title="Geser Longitude titik belokan"
                                    />
                                  </div>
                                ) : (
                                  <span className="font-mono text-[9px] text-foreground">
                                    {pt[0].toFixed(4)}, {pt[1].toFixed(4)}
                                  </span>
                                )}
                                {isIntermediate && (
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="size-5 text-rose-500 hover:text-rose-600 hover:bg-rose-500/10"
                                    onClick={() => handleRemoveWaypoint(idx)}
                                    title={`Hapus titik belokan ${idx}`}
                                    data-testid={`remove-waypoint-button-${idx}`}
                                  >
                                    <Trash2 className="size-3" />
                                  </Button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Tombol Simpan & Batal Edit */}
                      <div className="flex items-center gap-1.5 pt-1 border-t">
                        <Button
                          size="sm"
                          onClick={handleSaveWaypoints}
                          disabled={isSavingWaypoints}
                          className="h-7 text-[11px] gap-1 flex-1 font-semibold"
                          data-testid="save-waypoints-button"
                        >
                          {isSavingWaypoints ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <Save className="size-3" />
                          )}
                          <span>Simpan Belokan</span>
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={handleCancelEditWaypoints}
                          disabled={isSavingWaypoints}
                          className="h-7 text-[11px] gap-1"
                          data-testid="cancel-edit-waypoints-button"
                        >
                          <RotateCcw className="size-3" />
                          <span>Batal</span>
                        </Button>
                      </div>
                    </div>
                  )}

                  {saveSuccessMessage && (
                    <div
                      className="p-1.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1"
                      data-testid="waypoint-save-success-badge"
                    >
                      <CheckCircle2 className="size-3 shrink-0" />
                      <span>{saveSuccessMessage}</span>
                    </div>
                  )}

                  {saveErrorMessage && (
                    <div
                      className="p-1.5 rounded-md bg-rose-500/10 border border-rose-500/30 text-[10px] text-rose-600 dark:text-rose-400 font-medium flex items-center gap-1"
                      data-testid="waypoint-save-error-badge"
                    >
                      <AlertTriangle className="size-3 shrink-0" />
                      <span>{saveErrorMessage}</span>
                    </div>
                  )}
                </div>

                <div className="pt-2 border-t mt-2 flex items-center justify-between">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1"
                    onClick={() => setFocusedNodeId(selectedCable.sourceId)}
                  >
                    <Eye className="size-3" />
                    <span>Lihat Induk ({selectedCable.sourceName})</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1"
                    onClick={() => setFocusedNodeId(selectedCable.targetId)}
                  >
                    <Eye className="size-3" />
                    <span>Lihat Ujung ({selectedCable.targetName})</span>
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Widget Legenda Terapung di Peta (Bisa Dibuka/Tutup Langsung di Atas Kanvas) */}
          <div
            className="absolute bottom-4 right-4 z-20 flex flex-col items-end"
            data-testid="floating-cable-legend"
          >
            {isFloatingLegendOpen && (
              <div
                className="mb-2 p-2.5 rounded-xl border bg-card/95 backdrop-blur-md shadow-lg text-[10px] space-y-1.5 min-w-[210px] animate-in fade-in"
                data-testid="floating-legend-content"
              >
                <div className="flex items-center justify-between border-b pb-1">
                  <span className="font-bold text-foreground text-[11px] flex items-center gap-1">
                    <Info className="size-3 text-primary" />
                    Kapasitas Serat Optik
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsFloatingLegendOpen(false)}
                    className="text-muted-foreground hover:text-foreground"
                    title="Tutup legenda terapung"
                    data-testid="close-floating-legend-button"
                  >
                    <ChevronDown className="size-3" />
                  </button>
                </div>
                <div className="flex flex-col gap-1">
                  {CABLE_CAPACITY_TIERS.map((tier) => (
                    <div
                      key={tier.label}
                      onClick={() => setSelectedType(tier.category)}
                      className={`flex items-center justify-between p-1 rounded-md cursor-pointer transition-colors ${
                        selectedType === tier.category
                          ? "bg-primary/10 text-primary font-semibold"
                          : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                      }`}
                      data-testid={`floating-legend-tier-${tier.category}`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className="size-2 rounded-full shrink-0"
                          style={{ backgroundColor: tier.color }}
                        />
                        <span>{tier.label}</span>
                      </div>
                      <span className="font-mono text-[9px]">{tier.baseWeight}px</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIsFloatingLegendOpen((prev) => !prev)}
              className="h-7 px-2.5 text-[11px] shadow-md bg-card/90 backdrop-blur-md border gap-1 font-medium text-foreground hover:bg-card"
              data-testid="toggle-floating-legend-button"
              title="Buka / tutup legenda kapasitas di atas peta"
            >
              <Info className="size-3 text-primary" />
              <span>Legenda Serat</span>
              {isFloatingLegendOpen ? (
                <ChevronDown className="size-3 text-muted-foreground" />
              ) : (
                <ChevronUp className="size-3 text-muted-foreground" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
