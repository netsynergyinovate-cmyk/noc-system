"use client";

import { useState } from "react";
import {
  X,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Square,
  Circle,
  Tag,
  ArrowUpRight,
  Palette,
  Check,
  AlertCircle,
  Loader2,
  ChevronLeft,
  MapPin,
  Save,
  Sliders,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { AnnotationShape, MapLayerItem } from "@/services/map/types";

export type AnnotationToolType = "rect" | "circle" | "arrow" | "label" | null;

interface AnnotationPanelProps {
  layers: MapLayerItem[];
  onClose: () => void;
  onRefreshLayers: () => Promise<void>;
  onGetCenterCoords?: () => [number, number];
  activeTool: AnnotationToolType;
  onSelectTool: (tool: AnnotationToolType) => void;
  collectedPoints: [number, number][];
  onClearPoints: () => void;
  /** Daftarkan id undo dari aksi lapisan yang berhasil (Ctrl+Z di peta) */
  onUndoable?: (undoId: unknown) => void;
}

const PRESET_COLORS = [
  "#3b82f6", // blue
  "#ef4444", // red
  "#22c55e", // green
  "#f59e0b", // amber
  "#a855f7", // purple
  "#06b6d4", // cyan
  "#f43f5e", // rose
  "#ffffff", // white
];

function generateShapeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `shp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
}

export function AnnotationPanel({
  layers,
  onClose,
  onRefreshLayers,
  onGetCenterCoords,
  activeTool,
  onSelectTool,
  collectedPoints,
  onClearPoints,
  onUndoable,
}: AnnotationPanelProps) {
  // clone: badan respons tetap bisa dibaca handler di bawahnya
  const track = async (res: Response) => {
    if (!res.ok || !onUndoable) return;
    const json = await res.clone().json().catch(() => null);
    onUndoable(json?.data?.undoId ?? json?.undoId);
  };
  // Navigation: null = list view, string = editing a specific layer's shapes
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);

  // New layer creation state
  const [isCreatingLayer, setIsCreatingLayer] = useState(false);
  const [newLayerName, setNewLayerName] = useState("");
  const [newLayerOpacity, setNewLayerOpacity] = useState(0.8);
  const [newLayerVisible, setNewLayerVisible] = useState(true);

  // Editing layer metadata state
  const [editingLayerName, setEditingLayerName] = useState("");
  const [editingLayerOpacity, setEditingLayerOpacity] = useState(0.8);
  const [editingLayerVisible, setEditingLayerVisible] = useState(true);

  // Shape creation state
  const [shapeColor, setShapeColor] = useState("#3b82f6");
  const [shapeText, setShapeText] = useState("");
  const [shapeRadiusM, setShapeRadiusM] = useState(250);
  const [manualPoint1, setManualPoint1] = useState<{ lat: string; lng: string }>({
    lat: "",
    lng: "",
  });
  const [manualPoint2, setManualPoint2] = useState<{ lat: string; lng: string }>({
    lat: "",
    lng: "",
  });

  // Action status
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const selectedLayer = layers.find((l) => l.id === selectedLayerId) || null;

  // Selected layer switch handler without useEffect
  const handleSelectLayer = (layer: MapLayerItem) => {
    setSelectedLayerId(layer.id);
    setEditingLayerName(layer.name);
    setEditingLayerOpacity(layer.opacity);
    setEditingLayerVisible(layer.visible);
    setManualPoint1({ lat: "", lng: "" });
    setManualPoint2({ lat: "", lng: "" });
    onClearPoints();
  };

  const showFeedback = (success?: string, error?: string) => {
    if (success) {
      setSuccessMsg(success);
      setErrorMsg(null);
      setTimeout(() => setSuccessMsg(null), 3000);
    }
    if (error) {
      setErrorMsg(error);
      setSuccessMsg(null);
    }
  };

  // 1. Create New Layer
  const handleCreateLayer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLayerName.trim()) {
      showFeedback(undefined, "Nama lapisan wajib diisi.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/peta/layers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newLayerName.trim(),
          opacity: newLayerOpacity,
          visible: newLayerVisible,
          shapes: [],
        }),
      });
      await track(res);

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error?.message || "Gagal membuat lapisan baru.");
      }

      await onRefreshLayers();
      setNewLayerName("");
      setIsCreatingLayer(false);
      handleSelectLayer(json.data);
      showFeedback("Lapisan baru berhasil dibuat.");
    } catch (err) {
      showFeedback(
        undefined,
        err instanceof Error ? err.message : "Gagal membuat lapisan.",
      );
    } finally {
      setLoading(false);
    }
  };

  // 2. Toggle Visibility of a Layer
  const handleToggleVisibility = async (layer: MapLayerItem) => {
    try {
      const res = await fetch(`/api/peta/layers/${layer.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visible: !layer.visible }),
      });
      await track(res);
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json?.error?.message || "Gagal mengubah visibilitas.");
      }
      await onRefreshLayers();
    } catch (err) {
      showFeedback(
        undefined,
        err instanceof Error ? err.message : "Gagal mengubah visibilitas.",
      );
    }
  };

  // 3. Update Layer Opacity
  const handleUpdateOpacity = async (layerId: string, opacity: number) => {
    try {
      const res = await fetch(`/api/peta/layers/${layerId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opacity }),
      });
      await track(res);
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json?.error?.message || "Gagal mengubah transparansi.");
      }
      await onRefreshLayers();
    } catch (err) {
      showFeedback(
        undefined,
        err instanceof Error ? err.message : "Gagal mengubah transparansi.",
      );
    }
  };

  // 3b. Pindah urutan lapisan; urutan dinormalisasi ke indeks agar nilai sama (bawaan 0) tetap bisa ditukar
  const handleMoveLayer = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= layers.length) return;
    const reordered = [...layers];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    try {
      setLoading(true);
      for (const [order, layer] of reordered.entries()) {
        if (layer.layerOrder === order) continue;
        const res = await fetch(`/api/peta/layers/${layer.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ layerOrder: order }),
        });
        await track(res);
        if (!res.ok) {
          const json = await res.json().catch(() => null);
          throw new Error(json?.error?.message || "Gagal mengubah urutan lapisan.");
        }
      }
    } catch (err) {
      showFeedback(
        undefined,
        err instanceof Error ? err.message : "Gagal mengubah urutan lapisan.",
      );
    } finally {
      await onRefreshLayers();
      setLoading(false);
    }
  };

  // 4. Save Layer Metadata Changes
  const handleSaveLayerMetadata = async () => {
    if (!selectedLayer) return;
    if (!editingLayerName.trim()) {
      showFeedback(undefined, "Nama lapisan tidak boleh kosong.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/peta/layers/${selectedLayer.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editingLayerName.trim(),
          opacity: editingLayerOpacity,
          visible: editingLayerVisible,
        }),
      });
      await track(res);
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error?.message || "Gagal memperbarui lapisan.");
      }
      await onRefreshLayers();
      showFeedback("Pengaturan lapisan tersimpan.");
    } catch (err) {
      showFeedback(
        undefined,
        err instanceof Error ? err.message : "Gagal menyimpan perubahan.",
      );
    } finally {
      setLoading(false);
    }
  };

  // 5. Delete Layer
  const handleDeleteLayer = async (layerId: string) => {
    if (!confirm("Hapus seluruh lapisan ini beserta semua bentuk anotasi di dalamnya?")) {
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/peta/layers/${layerId}`, {
        method: "DELETE",
      });
      await track(res);
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json?.error?.message || "Gagal menghapus lapisan.");
      }
      if (selectedLayerId === layerId) {
        setSelectedLayerId(null);
        onSelectTool(null);
        onClearPoints();
      }
      await onRefreshLayers();
      showFeedback("Lapisan berhasil dihapus.");
    } catch (err) {
      showFeedback(
        undefined,
        err instanceof Error ? err.message : "Gagal menghapus lapisan.",
      );
    } finally {
      setLoading(false);
    }
  };

  // Effective coordinates combining collectedPoints from map clicks or manual inputs
  const currentP1Lat =
    manualPoint1.lat !== ""
      ? manualPoint1.lat
      : collectedPoints[0]
        ? collectedPoints[0][0].toFixed(6)
        : "";
  const currentP1Lng =
    manualPoint1.lng !== ""
      ? manualPoint1.lng
      : collectedPoints[0]
        ? collectedPoints[0][1].toFixed(6)
        : "";
  const currentP2Lat =
    manualPoint2.lat !== ""
      ? manualPoint2.lat
      : collectedPoints[1]
        ? collectedPoints[1][0].toFixed(6)
        : "";
  const currentP2Lng =
    manualPoint2.lng !== ""
      ? manualPoint2.lng
      : collectedPoints[1]
        ? collectedPoints[1][1].toFixed(6)
        : "";

  // 6. Add Shape to Selected Layer
  const handleAddShape = async () => {
    if (!selectedLayer || !activeTool) return;

    let coords: [number, number][] = [];

    const p1Lat = parseFloat(currentP1Lat);
    const p1Lng = parseFloat(currentP1Lng);
    const p2Lat = parseFloat(currentP2Lat);
    const p2Lng = parseFloat(currentP2Lng);

    if (isNaN(p1Lat) || isNaN(p1Lng) || p1Lat < -90 || p1Lat > 90 || p1Lng < -180 || p1Lng > 180) {
      showFeedback(undefined, "Titik koordinat pertama tidak valid.");
      return;
    }

    if (activeTool === "circle" || activeTool === "label") {
      coords = [[p1Lat, p1Lng]];
      if (activeTool === "label" && !shapeText.trim()) {
        showFeedback(undefined, "Teks label wajib diisi.");
        return;
      }
    } else if (activeTool === "rect" || activeTool === "arrow") {
      if (isNaN(p2Lat) || isNaN(p2Lng) || p2Lat < -90 || p2Lat > 90 || p2Lng < -180 || p2Lng > 180) {
        showFeedback(undefined, "Titik koordinat kedua tidak valid.");
        return;
      }
      coords = [
        [p1Lat, p1Lng],
        [p2Lat, p2Lng],
      ];
    }

    const newShape: AnnotationShape = {
      id: generateShapeId(),
      type: activeTool,
      coordinates: coords,
      properties: {
        color: shapeColor,
        text: shapeText.trim() || undefined,
        radiusM: activeTool === "circle" ? Math.max(10, shapeRadiusM) : undefined,
        strokeWidth: activeTool === "arrow" ? 3 : 2,
      },
    };

    const updatedShapes = [...selectedLayer.shapes, newShape];

    setLoading(true);
    try {
      const res = await fetch(`/api/peta/layers/${selectedLayer.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shapes: updatedShapes }),
      });
      await track(res);
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error?.message || "Gagal menambahkan bentuk.");
      }

      await onRefreshLayers();
      onSelectTool(null);
      onClearPoints();
      setShapeText("");
      setManualPoint1({ lat: "", lng: "" });
      setManualPoint2({ lat: "", lng: "" });
      showFeedback("Bentuk anotasi berhasil ditambahkan.");
    } catch (err) {
      showFeedback(
        undefined,
        err instanceof Error ? err.message : "Gagal menambahkan bentuk.",
      );
    } finally {
      setLoading(false);
    }
  };

  // 7. Delete Shape from Selected Layer
  const handleDeleteShape = async (shapeId: string) => {
    if (!selectedLayer) return;
    const updatedShapes = selectedLayer.shapes.filter((s) => s.id !== shapeId);

    setLoading(true);
    try {
      const res = await fetch(`/api/peta/layers/${selectedLayer.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shapes: updatedShapes }),
      });
      await track(res);
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json?.error?.message || "Gagal menghapus bentuk.");
      }
      await onRefreshLayers();
      showFeedback("Bentuk anotasi berhasil dihapus.");
    } catch (err) {
      showFeedback(
        undefined,
        err instanceof Error ? err.message : "Gagal menghapus bentuk.",
      );
    } finally {
      setLoading(false);
    }
  };

  // Use current map center to quickly populate point
  const handleFillCenter = (targetPoint: 1 | 2) => {
    const center = onGetCenterCoords ? onGetCenterCoords() : [-6.2088, 106.8456];
    if (targetPoint === 1) {
      setManualPoint1({
        lat: center[0].toFixed(6),
        lng: center[1].toFixed(6),
      });
    } else {
      setManualPoint2({
        lat: (center[0] + 0.002).toFixed(6),
        lng: (center[1] + 0.002).toFixed(6),
      });
    }
  };

  return (
    <div className="fixed inset-x-0 bottom-0 md:bottom-auto md:top-[calc(var(--map-toolbar-bottom,4rem)_+_0.5rem)] md:right-4 md:left-auto z-[1050] w-full md:w-96 md:max-w-[45vw] bg-card/95 backdrop-blur-md text-card-foreground border border-border shadow-2xl rounded-t-2xl md:rounded-2xl max-h-[60dvh] md:max-h-[calc(100dvh_-_var(--map-toolbar-bottom,4rem)_-_1.5rem)] flex flex-col overflow-hidden animate-in fade-in slide-in-from-right-4 duration-200">
      {/* Mobile drag handle */}
      <div className="md:hidden w-12 h-1 bg-muted-foreground/30 rounded-full mx-auto my-2 shrink-0" />

      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          {selectedLayer && (
            <button
              onClick={() => {
                setSelectedLayerId(null);
                onSelectTool(null);
                onClearPoints();
              }}
              className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Kembali ke Daftar Lapisan"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
          <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
            <Sliders className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-foreground">
              {selectedLayer ? selectedLayer.name : "Lapisan Gambar & Anotasi"}
            </h3>
            <p className="text-[10px] text-muted-foreground">
              {selectedLayer
                ? `${selectedLayer.shapes.length} bentuk pada lapisan ini`
                : `${layers.length} lapisan terdaftar`}
            </p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          title="Tutup Panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Feedback Banners */}
      {errorMsg && (
        <div className="mx-3 mt-2 p-2 rounded-xl bg-destructive/15 border border-destructive/30 text-destructive text-[11px] flex items-center gap-2 animate-in fade-in">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="flex-1">{errorMsg}</span>
        </div>
      )}
      {successMsg && (
        <div className="mx-3 mt-2 p-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-[11px] flex items-center gap-2 animate-in fade-in">
          <Check className="w-3.5 h-3.5 shrink-0" />
          <span className="flex-1">{successMsg}</span>
        </div>
      )}

      {/* Main Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
        {/* VIEW 1: LAYER LIST & CREATION */}
        {!selectedLayer ? (
          <>
            {/* Create New Layer Toggle/Form */}
            {!isCreatingLayer ? (
              <button
                onClick={() => setIsCreatingLayer(true)}
                className="w-full py-2 px-3 rounded-xl border border-dashed border-border hover:border-primary text-foreground hover:text-primary transition-colors flex items-center justify-center gap-2 font-medium bg-muted/20"
              >
                <Plus className="w-4 h-4" />
                <span>Tambah Lapisan Baru</span>
              </button>
            ) : (
              <form
                onSubmit={handleCreateLayer}
                className="p-3 rounded-xl border border-border bg-muted/30 space-y-3"
              >
                <div className="flex items-center justify-between font-semibold text-foreground">
                  <span>Buat Lapisan Gambar</span>
                  <button
                    type="button"
                    onClick={() => setIsCreatingLayer(false)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div>
                  <label className="text-[10px] font-medium text-muted-foreground block mb-1">
                    Nama Lapisan
                  </label>
                  <input
                    type="text"
                    value={newLayerName}
                    onChange={(e) => setNewLayerName(e.target.value)}
                    placeholder="mis. Zona Cakupan ODP, Rencana FO"
                    className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary"
                    required
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                    <span className="font-medium">Transparansi (Opacity)</span>
                    <span>{Math.round(newLayerOpacity * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.1"
                    max="1.0"
                    step="0.05"
                    value={newLayerOpacity}
                    onChange={(e) => setNewLayerOpacity(parseFloat(e.target.value))}
                    className="w-full accent-primary cursor-pointer"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="newLayerVis"
                    checked={newLayerVisible}
                    onChange={(e) => setNewLayerVisible(e.target.checked)}
                    className="rounded text-primary focus:ring-primary cursor-pointer"
                  />
                  <label htmlFor="newLayerVis" className="text-[11px] cursor-pointer">
                    Tampilkan langsung di atas peta
                  </label>
                </div>

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setIsCreatingLayer(false)}
                    className="px-2.5 py-1.5 rounded-lg border border-border text-muted-foreground hover:bg-muted"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {loading && <Loader2 className="w-3 h-3 animate-spin" />}
                    <span>Simpan Lapisan</span>
                  </button>
                </div>
              </form>
            )}

            {/* List of Existing Layers */}
            <div className="space-y-2">
              <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase block">
                Daftar Lapisan Peta
              </span>

              {layers.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground border border-dashed border-border rounded-xl">
                  Belum ada lapisan gambar yang dibuat.
                </div>
              ) : (
                [...layers].reverse().map((layer, revIndex) => {
                  const index = layers.length - 1 - revIndex;
                  return (
                  <div
                    key={layer.id}
                    className="p-3 rounded-xl border border-border bg-card hover:border-primary/50 transition-colors flex flex-col gap-2.5 shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <button
                          onClick={() => handleToggleVisibility(layer)}
                          className={`p-1 rounded-md transition-colors ${
                            layer.visible
                              ? "text-primary hover:bg-primary/10"
                              : "text-muted-foreground/60 hover:bg-muted"
                          }`}
                          title={layer.visible ? "Sembunyikan lapisan" : "Tampilkan lapisan"}
                        >
                          {layer.visible ? (
                            <Eye className="w-4 h-4" />
                          ) : (
                            <EyeOff className="w-4 h-4" />
                          )}
                        </button>
                        <div className="truncate">
                          <span className="font-semibold text-foreground truncate block">
                            {layer.name}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {layer.shapes.length} bentuk
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => handleMoveLayer(index, 1)}
                          disabled={loading || index === layers.length - 1}
                          className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted disabled:opacity-30"
                          title="Pindah ke lapis atas"
                          aria-label={`Pindah ${layer.name} ke lapis atas`}
                        >
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleMoveLayer(index, -1)}
                          disabled={loading || index === 0}
                          className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted disabled:opacity-30"
                          title="Pindah ke lapis bawah"
                          aria-label={`Pindah ${layer.name} ke lapis bawah`}
                        >
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleSelectLayer(layer)}
                          className="px-2.5 py-1 rounded-lg bg-secondary text-secondary-foreground text-[11px] font-medium hover:bg-secondary/80 transition-colors"
                        >
                          Kelola Bentuk
                        </button>
                        <button
                          onClick={() => handleDeleteLayer(layer.id)}
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          title="Hapus Lapisan"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Quick Opacity Slider */}
                    <div className="flex items-center gap-2 pt-1 border-t border-border/50 text-[10px] text-muted-foreground">
                      <span className="shrink-0">Transparansi:</span>
                      {/* Simpan saat slider dilepas: satu PUT, bukan satu per pergeseran */}
                      <input
                        key={layer.opacity}
                        type="range"
                        min="0.1"
                        max="1.0"
                        step="0.05"
                        defaultValue={layer.opacity}
                        aria-label={`Transparansi ${layer.name}`}
                        onPointerUp={(e) =>
                          handleUpdateOpacity(layer.id, Number(e.currentTarget.value))
                        }
                        onKeyUp={(e) =>
                          handleUpdateOpacity(layer.id, Number(e.currentTarget.value))
                        }
                        className="w-full accent-primary h-1.5 cursor-pointer"
                      />
                      <span className="w-8 text-right shrink-0">
                        {Math.round(layer.opacity * 100)}%
                      </span>
                    </div>
                  </div>
                  );
                })
              )}
            </div>
          </>
        ) : (
          /* VIEW 2: LAYER EDITOR & SHAPE DRAWING TOOLS */
          <div className="space-y-4">
            {/* Layer Settings Collapsible/Summary */}
            <div className="p-3 rounded-xl border border-border bg-muted/20 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase">
                  Pengaturan Lapisan
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setEditingLayerVisible(!editingLayerVisible)}
                    className={`flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md ${
                      editingLayerVisible
                        ? "bg-primary/10 text-primary"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {editingLayerVisible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                    <span>{editingLayerVisible ? "Tampak" : "Tersembunyi"}</span>
                  </button>
                </div>
              </div>

              <div>
                <input
                  type="text"
                  value={editingLayerName}
                  onChange={(e) => setEditingLayerName(e.target.value)}
                  className="w-full bg-background border border-border rounded-lg px-2 py-1 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary"
                  placeholder="Nama Lapisan"
                />
              </div>

              <div>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                  <span>Transparansi</span>
                  <span>{Math.round(editingLayerOpacity * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="1.0"
                  step="0.05"
                  value={editingLayerOpacity}
                  onChange={(e) => setEditingLayerOpacity(parseFloat(e.target.value))}
                  className="w-full accent-primary h-1.5 cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-border/50">
                <button
                  type="button"
                  onClick={() => selectedLayer && handleDeleteLayer(selectedLayer.id)}
                  className="text-[11px] text-destructive hover:underline flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Hapus Lapisan</span>
                </button>

                <button
                  type="button"
                  onClick={handleSaveLayerMetadata}
                  disabled={loading}
                  className="px-2.5 py-1 rounded-lg bg-primary text-primary-foreground text-[11px] font-medium hover:opacity-90 flex items-center gap-1"
                >
                  <Save className="w-3 h-3" />
                  <span>Simpan Pengaturan</span>
                </button>
              </div>
            </div>

            {/* Shape Drawing Tool Selector */}
            <div className="space-y-2">
              <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase block">
                Tambah Bentuk Anotasi
              </span>

              <div className="grid grid-cols-4 gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    onSelectTool(activeTool === "rect" ? null : "rect");
                    onClearPoints();
                  }}
                  className={`p-2 rounded-xl border flex flex-col items-center gap-1 text-center transition-all ${
                    activeTool === "rect"
                      ? "bg-primary text-primary-foreground border-primary shadow-md"
                      : "bg-card border-border hover:bg-muted text-foreground"
                  }`}
                  title="Kotak / Zona Wilayah"
                >
                  <Square className="w-4 h-4" />
                  <span className="text-[10px] font-medium leading-none">Kotak</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onSelectTool(activeTool === "circle" ? null : "circle");
                    onClearPoints();
                  }}
                  className={`p-2 rounded-xl border flex flex-col items-center gap-1 text-center transition-all ${
                    activeTool === "circle"
                      ? "bg-primary text-primary-foreground border-primary shadow-md"
                      : "bg-card border-border hover:bg-muted text-foreground"
                  }`}
                  title="Radius Sinyal / Jangkauan"
                >
                  <Circle className="w-4 h-4" />
                  <span className="text-[10px] font-medium leading-none">Radius</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onSelectTool(activeTool === "label" ? null : "label");
                    onClearPoints();
                  }}
                  className={`p-2 rounded-xl border flex flex-col items-center gap-1 text-center transition-all ${
                    activeTool === "label"
                      ? "bg-primary text-primary-foreground border-primary shadow-md"
                      : "bg-card border-border hover:bg-muted text-foreground"
                  }`}
                  title="Tanda / Label Keterangan"
                >
                  <Tag className="w-4 h-4" />
                  <span className="text-[10px] font-medium leading-none">Label</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onSelectTool(activeTool === "arrow" ? null : "arrow");
                    onClearPoints();
                  }}
                  className={`p-2 rounded-xl border flex flex-col items-center gap-1 text-center transition-all ${
                    activeTool === "arrow"
                      ? "bg-primary text-primary-foreground border-primary shadow-md"
                      : "bg-card border-border hover:bg-muted text-foreground"
                  }`}
                  title="Panah / Garis Arah"
                >
                  <ArrowUpRight className="w-4 h-4" />
                  <span className="text-[10px] font-medium leading-none">Panah</span>
                </button>
              </div>

              {/* Active Tool Configuration Form */}
              {activeTool && (
                <div className="p-3 rounded-xl border border-primary/40 bg-primary/5 space-y-3 animate-in fade-in">
                  <div className="flex items-center justify-between border-b border-border/50 pb-1.5">
                    <span className="font-semibold text-foreground text-[11px] flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-primary" />
                      Mode Gambar:{" "}
                      {activeTool === "rect"
                        ? "Zona Kotak"
                        : activeTool === "circle"
                          ? "Radius Sinyal"
                          : activeTool === "label"
                            ? "Tanda Label"
                            : "Panah Arah"}
                    </span>
                    <button
                      onClick={() => {
                        onSelectTool(null);
                        onClearPoints();
                      }}
                      className="text-[10px] text-muted-foreground hover:text-foreground"
                    >
                      Batal
                    </button>
                  </div>

                  <p className="text-[10px] text-muted-foreground">
                    {activeTool === "rect"
                      ? "Klik 2 titik sudut (Barat-Daya & Timur-Laut) pada peta atau isi koordinat di bawah."
                      : activeTool === "circle"
                        ? "Klik 1 titik pusat pada peta atau gunakan koordinat pusat."
                        : activeTool === "label"
                          ? "Klik 1 titik lokasi pada peta dan berikan teks label."
                          : "Klik 2 titik (Awal & Akhir) pada peta untuk menarik panah."}
                  </p>

                  {/* Color Palette Selector */}
                  <div>
                    <label className="text-[10px] font-medium text-muted-foreground flex items-center gap-1 mb-1">
                      <Palette className="w-3 h-3" />
                      <span>Warna Bentuk</span>
                    </label>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {PRESET_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setShapeColor(c)}
                          style={{ backgroundColor: c }}
                          className={`w-5 h-5 rounded-full border border-black/20 flex items-center justify-center transition-transform ${
                            shapeColor === c ? "scale-125 ring-2 ring-primary ring-offset-1" : ""
                          }`}
                        >
                          {shapeColor === c && (
                            <Check className={`w-3 h-3 ${c === "#ffffff" ? "text-black" : "text-white"}`} />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Specific Shape Properties */}
                  {activeTool === "circle" && (
                    <div>
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                        <span className="font-medium">Radius (Meter)</span>
                        <span>{shapeRadiusM} meter</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min="10"
                          max="10000"
                          step="10"
                          value={shapeRadiusM}
                          onChange={(e) => setShapeRadiusM(Math.max(10, parseInt(e.target.value) || 10))}
                          className="w-24 bg-background border border-border rounded-lg px-2 py-1 text-xs text-foreground outline-none"
                        />
                        <div className="flex items-center gap-1">
                          {[50, 100, 250, 500].map((r) => (
                            <button
                              key={r}
                              type="button"
                              onClick={() => setShapeRadiusM(r)}
                              className={`px-2 py-0.5 rounded text-[10px] border ${
                                shapeRadiusM === r
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "bg-background border-border text-muted-foreground hover:bg-muted"
                              }`}
                            >
                              {r}m
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Label / Note Text */}
                  <div>
                    <label className="text-[10px] font-medium text-muted-foreground block mb-1">
                      {activeTool === "label" ? "Teks Label (Wajib)" : "Keterangan (Opsional)"}
                    </label>
                    <input
                      type="text"
                      value={shapeText}
                      onChange={(e) => setShapeText(e.target.value)}
                      placeholder={
                        activeTool === "label"
                          ? "mis. Titik Rawan Putus"
                          : "Keterangan bentuk..."
                      }
                      className="w-full bg-background border border-border rounded-lg px-2.5 py-1 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>

                  {/* Coordinates Point 1 */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="font-medium text-foreground">
                        {activeTool === "rect"
                          ? "Titik Sudut 1 (Barat-Daya)"
                          : activeTool === "arrow"
                            ? "Titik Awal"
                            : "Titik Pusat / Lokasi"}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleFillCenter(1)}
                        className="text-primary hover:underline flex items-center gap-0.5"
                      >
                        <MapPin className="w-2.5 h-2.5" />
                        <span>Pusat Peta</span>
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <input
                        type="number"
                        step="any"
                        value={currentP1Lat}
                        onChange={(e) =>
                          setManualPoint1((p) => ({ ...p, lat: e.target.value }))
                        }
                        placeholder="Latitude"
                        className="bg-background border border-border rounded-lg px-2 py-1 text-xs text-foreground outline-none"
                      />
                      <input
                        type="number"
                        step="any"
                        value={currentP1Lng}
                        onChange={(e) =>
                          setManualPoint1((p) => ({ ...p, lng: e.target.value }))
                        }
                        placeholder="Longitude"
                        className="bg-background border border-border rounded-lg px-2 py-1 text-xs text-foreground outline-none"
                      />
                    </div>
                  </div>

                  {/* Coordinates Point 2 for Rect & Arrow */}
                  {(activeTool === "rect" || activeTool === "arrow") && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="font-medium text-foreground">
                          {activeTool === "rect"
                            ? "Titik Sudut 2 (Timur-Laut)"
                            : "Titik Akhir"}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleFillCenter(2)}
                          className="text-primary hover:underline flex items-center gap-0.5"
                        >
                          <MapPin className="w-2.5 h-2.5" />
                          <span>Offset Pusat</span>
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        <input
                          type="number"
                          step="any"
                          value={currentP2Lat}
                          onChange={(e) =>
                            setManualPoint2((p) => ({ ...p, lat: e.target.value }))
                          }
                          placeholder="Latitude 2"
                          className="bg-background border border-border rounded-lg px-2 py-1 text-xs text-foreground outline-none"
                        />
                        <input
                          type="number"
                          step="any"
                          value={currentP2Lng}
                          onChange={(e) =>
                            setManualPoint2((p) => ({ ...p, lng: e.target.value }))
                          }
                          placeholder="Longitude 2"
                          className="bg-background border border-border rounded-lg px-2 py-1 text-xs text-foreground outline-none"
                        />
                      </div>
                    </div>
                  )}

                  {/* Add Shape Submit Button */}
                  <button
                    type="button"
                    onClick={handleAddShape}
                    disabled={
                      loading ||
                      !currentP1Lat ||
                      !currentP1Lng ||
                      ((activeTool === "rect" || activeTool === "arrow") &&
                        (!currentP2Lat || !currentP2Lng))
                    }
                    className="w-full py-2 rounded-xl bg-primary text-primary-foreground font-medium text-xs hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center justify-center gap-1.5 shadow-sm"
                  >
                    {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>+ Simpan Bentuk ke Lapisan</span>
                  </button>
                </div>
              )}
            </div>

            {/* List of Shapes in Current Layer */}
            <div className="space-y-2">
              <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase block">
                Daftar Bentuk di Lapisan Ini ({selectedLayer.shapes.length})
              </span>

              {selectedLayer.shapes.length === 0 ? (
                <div className="py-6 text-center text-muted-foreground border border-dashed border-border rounded-xl">
                  Belum ada bentuk di lapisan ini. Pilih alat di atas untuk menggambar.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {selectedLayer.shapes.map((shape, idx) => (
                    <div
                      key={shape.id || idx}
                      className="p-2.5 rounded-xl border border-border bg-card flex items-center justify-between gap-2 shadow-sm"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-3 h-3 rounded-full shrink-0 border border-black/20"
                          style={{
                            backgroundColor: shape.properties?.color || "#3b82f6",
                          }}
                        />
                        <div className="truncate">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-foreground text-[11px] capitalize">
                              {shape.type === "rect"
                                ? "Zona Kotak"
                                : shape.type === "circle"
                                  ? `Radius (${shape.properties?.radiusM || 100}m)`
                                  : shape.type === "label"
                                    ? "Label"
                                    : "Panah Arah"}
                            </span>
                          </div>
                          <span className="text-[10px] text-muted-foreground truncate block">
                            {shape.properties?.text ||
                              `${shape.coordinates[0][0].toFixed(4)}, ${shape.coordinates[0][1].toFixed(4)}`}
                          </span>
                        </div>
                      </div>

                      <button
                        onClick={() => handleDeleteShape(shape.id)}
                        className="p-1 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                        title="Hapus Bentuk"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
