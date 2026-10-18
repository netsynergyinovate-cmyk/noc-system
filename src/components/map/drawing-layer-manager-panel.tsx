"use client";

import React, { useState, useMemo } from "react";
import {
  Sliders,
  Plus,
  Eye,
  EyeOff,
  Trash2,
  Copy,
  Edit2,
  Check,
  X,
  ChevronUp,
  ChevronDown,
  ChevronsUp,
  ChevronsDown,
  Search,
  Layers,
  Shapes,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { MapDrawingLayer } from "@/db/schema/map-drawing-layers";

export interface DrawingLayerManagerPanelProps {
  layers: MapDrawingLayer[];
  activeLayerId: string | null;
  onSelectActiveLayer: (layerId: string) => void;
  onUpdateLayer: (layerId: string, updates: Partial<MapDrawingLayer>) => void;
  onCreateLayer: (name: string, description?: string) => Promise<void>;
  onDeleteLayer: (layerId: string) => Promise<void>;
  onDuplicateLayer?: (layerId: string) => Promise<void>;
  onToggleAllVisibility?: (visible: boolean) => void;
  onReorderLayers?: (reorderedLayers: MapDrawingLayer[]) => void;
  loadError?: string | null;
  onRetryLoad?: () => void;
  isReloading?: boolean;
  className?: string;
}

export function DrawingLayerManagerPanel({
  layers,
  activeLayerId,
  onSelectActiveLayer,
  onUpdateLayer,
  onCreateLayer,
  onDeleteLayer,
  onDuplicateLayer,
  onToggleAllVisibility,
  onReorderLayers,
  loadError = null,
  onRetryLoad,
  isReloading = false,
  className = "",
}: DrawingLayerManagerPanelProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newLayerName, setNewLayerName] = useState("");
  const [newLayerDesc, setNewLayerDesc] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  // Filter and sort layers by zIndex descending (top-most layer on top)
  const filteredSortedLayers = useMemo(() => {
    return [...layers]
      .filter((layer) =>
        searchQuery.trim()
          ? layer.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (layer.description &&
              layer.description.toLowerCase().includes(searchQuery.toLowerCase()))
          : true,
      )
      .sort((a, b) => b.zIndex - a.zIndex);
  }, [layers, searchQuery]);

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLayerName.trim() || isSubmitting) return;

    try {
      setIsSubmitting(true);
      await onCreateLayer(newLayerName.trim(), newLayerDesc.trim() || undefined);
      setNewLayerName("");
      setNewLayerDesc("");
      setShowAddForm(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStartRename = (layer: MapDrawingLayer) => {
    setEditingLayerId(layer.id);
    setEditingName(layer.name);
  };

  const handleSaveRename = (layerId: string) => {
    if (editingName.trim()) {
      onUpdateLayer(layerId, { name: editingName.trim() });
    }
    setEditingLayerId(null);
    setEditingName("");
  };

  const handleCancelRename = () => {
    setEditingLayerId(null);
    setEditingName("");
  };

  // Pengatur urutan tumpukan lapisan: naik, turun, paling atas, dan paling bawah
  const handleReorderLayer = (
    layerId: string,
    action: "up" | "down" | "top" | "bottom",
  ) => {
    // Salin urutan saat ini dari atas ke bawah (zIndex terbesar ke terkecil)
    const currentSorted = [...layers].sort((a, b) => b.zIndex - a.zIndex);
    const index = currentSorted.findIndex((l) => l.id === layerId);
    if (index === -1) return;

    const newSorted = [...currentSorted];
    if (action === "up" && index > 0) {
      // Tukar posisi dengan lapisan di atasnya
      const temp = newSorted[index];
      newSorted[index] = newSorted[index - 1];
      newSorted[index - 1] = temp;
    } else if (action === "down" && index < newSorted.length - 1) {
      // Tukar posisi dengan lapisan di bawahnya
      const temp = newSorted[index];
      newSorted[index] = newSorted[index + 1];
      newSorted[index + 1] = temp;
    } else if (action === "top" && index > 0) {
      // Pindahkan langsung ke paling atas
      const [moved] = newSorted.splice(index, 1);
      newSorted.unshift(moved);
    } else if (action === "bottom" && index < newSorted.length - 1) {
      // Pindahkan langsung ke paling bawah
      const [moved] = newSorted.splice(index, 1);
      newSorted.push(moved);
    } else {
      return;
    }

    // Normalisasikan zIndex: lapisan teratas (index 0) mendapatkan zIndex terbesar
    const total = newSorted.length;
    const reorderedWithZ = newSorted.map((l, i) => ({
      ...l,
      zIndex: total - i,
    }));

    if (onReorderLayers) {
      onReorderLayers(reorderedWithZ);
    } else {
      reorderedWithZ.forEach((l) => {
        onUpdateLayer(l.id, { zIndex: l.zIndex });
      });
    }
  };


  const allVisible = layers.length > 0 && layers.every((l) => l.isVisible);
  const totalShapes = layers.reduce(
    (acc, l) => acc + (Array.isArray(l.shapes) ? l.shapes.length : 0),
    0,
  );

  return (
    <div
      className={`flex flex-col gap-3 p-3.5 rounded-lg border bg-card/60 backdrop-blur-xs shadow-xs ${className}`}
      data-testid="layer-management-panel"
    >
      {/* Panel Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Sliders className="size-4 text-indigo-500" />
          <h2 className="text-sm font-semibold text-foreground">
            Kelola Lapisan Gambar
          </h2>
          <Badge
            variant="secondary"
            className="text-[10px] px-1.5 py-0 h-4 font-mono font-medium"
            data-testid="layer-count-badge"
          >
            {layers.length}
          </Badge>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs font-medium"
          onClick={() => setShowAddForm((prev) => !prev)}
          data-testid="add-layer-button"
        >
          <Plus className="size-3" />
          <span>Tambah</span>
        </Button>
      </div>

      {/* Form Tambah Lapisan Baru */}
      {showAddForm && (
        <form
          onSubmit={handleCreateSubmit}
          className="p-3 rounded-md border bg-muted/40 flex flex-col gap-2.5 transition-all"
          data-testid="create-layer-form"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground flex items-center gap-1">
              <Layers className="size-3 text-indigo-500" /> Lapisan Baru
            </span>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setShowAddForm(false)}
            >
              <X className="size-3.5" />
            </button>
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="new-layer-name-input"
              className="text-[11px] font-medium text-muted-foreground"
            >
              Nama Lapisan <span className="text-red-500">*</span>
            </label>
            <input
              id="new-layer-name-input"
              type="text"
              className="w-full h-8 px-2.5 text-xs rounded-md border bg-background text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary"
              placeholder="mis. Rencana Tarikan Feeder ODP 04"
              value={newLayerName}
              onChange={(e) => setNewLayerName(e.target.value)}
              autoFocus
              data-testid="new-layer-name-input"
              required
            />
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="new-layer-description-input"
              className="text-[11px] font-medium text-muted-foreground"
            >
              Keterangan (Opsional)
            </label>
            <input
              id="new-layer-description-input"
              type="text"
              className="w-full h-7 px-2.5 text-xs rounded-md border bg-background text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary"
              placeholder="mis. Catatan teknisi survei lapangan"
              value={newLayerDesc}
              onChange={(e) => setNewLayerDesc(e.target.value)}
              data-testid="new-layer-description-input"
            />
          </div>

          <div className="flex justify-end gap-1.5 mt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2.5 text-xs"
              onClick={() => setShowAddForm(false)}
            >
              Batal
            </Button>
            <Button
              type="submit"
              variant="default"
              size="sm"
              className="h-7 px-3 text-xs bg-indigo-600 hover:bg-indigo-700 text-white"
              disabled={!newLayerName.trim() || isSubmitting}
              data-testid="submit-new-layer-button"
            >
              {isSubmitting ? "Menyimpan..." : "Simpan Lapisan"}
            </Button>
          </div>
        </form>
      )}

      {/* Filter / Search & Batch Actions Bar */}
      {layers.length > 0 && (
        <div className="flex flex-col gap-2">
          {layers.length > 2 && (
            <div className="relative">
              <Search className="absolute left-2 top-2 size-3 text-muted-foreground" />
              <input
                type="text"
                placeholder="Cari nama lapisan..."
                className="w-full h-7 pl-7 pr-2 text-xs rounded border bg-background text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-1 focus:ring-primary"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                data-testid="search-layers-input"
              />
            </div>
          )}

          {/* Quick Batch Controls */}
          <div className="flex items-center justify-between text-[11px] text-muted-foreground px-0.5">
            <span className="flex items-center gap-1">
              <Shapes className="size-3 text-purple-500" />
              Total {totalShapes} objek
            </span>

            {onToggleAllVisibility && (
              <button
                type="button"
                className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
                onClick={() => onToggleAllVisibility(!allVisible)}
                data-testid={allVisible ? "hide-all-layers-btn" : "show-all-layers-btn"}
              >
                {allVisible ? (
                  <>
                    <EyeOff className="size-3" /> Sembunyikan Semua
                  </>
                ) : (
                  <>
                    <Eye className="size-3" /> Tampilkan Semua
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Daftar Lapisan Tersimpan */}
      <div className="flex flex-col gap-2 max-h-[460px] overflow-y-auto pr-1">
        {/* Peringatan Gagal Sinkronisasi Jika Sudah Ada Lapisan Tersimpan */}
        {loadError && layers.length > 0 && (
          <div
            className="px-2.5 py-1.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[11px] flex items-center justify-between gap-1.5"
            data-testid="layer-list-warning-sync"
          >
            <div className="flex items-center gap-1.5 truncate">
              <AlertTriangle className="size-3 text-amber-500 shrink-0" />
              <span className="truncate">Gagal sinkronisasi data server terbaru</span>
            </div>
            {onRetryLoad && (
              <button
                type="button"
                className="font-medium underline hover:text-foreground text-[10px] shrink-0"
                onClick={onRetryLoad}
                disabled={isReloading}
              >
                {isReloading ? "Memuat..." : "Ulangi"}
              </button>
            )}
          </div>
        )}

        {loadError && layers.length === 0 ? (
          <div
            className="p-4 text-center text-xs border border-red-500/30 bg-red-500/5 rounded-md flex flex-col items-center gap-2"
            data-testid="layer-list-error-state"
          >
            <AlertTriangle className="size-6 text-red-500 stroke-1" />
            <div className="flex flex-col gap-0.5">
              <p className="font-semibold text-red-600 dark:text-red-400">
                Gagal Memuat Lapisan Gambar
              </p>
              <p className="text-[11px] text-muted-foreground line-clamp-2">
                {loadError}
              </p>
            </div>
            {onRetryLoad && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 text-[11px] border-red-500/40 text-red-600 hover:bg-red-500/10 flex items-center gap-1.5 mt-1"
                onClick={onRetryLoad}
                disabled={isReloading}
                data-testid="layer-list-retry-btn"
              >
                <RefreshCw
                  className={`size-2.5 ${isReloading ? "animate-spin" : ""}`}
                />
                <span>{isReloading ? "Memuat..." : "Coba Muat Ulang"}</span>
              </Button>
            )}
          </div>
        ) : layers.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground border border-dashed rounded-md flex flex-col items-center gap-1.5">
            <Layers className="size-6 text-muted-foreground/60 stroke-1" />
            <p>Belum ada lapisan gambar anotasi.</p>
            <p className="text-[11px] text-muted-foreground/80">
              Klik <strong>+ Tambah</strong> untuk membuat lapisan pertama.
            </p>
          </div>
        ) : filteredSortedLayers.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground border border-dashed rounded-md">
            Tidak ada lapisan yang cocok dengan kata kunci &quot;{searchQuery}&quot;.
          </div>
        ) : (
          filteredSortedLayers.map((layer) => {
            const isActive = layer.id === activeLayerId;
            const shapesCount = Array.isArray(layer.shapes)
              ? layer.shapes.length
              : 0;
            const isEditing = editingLayerId === layer.id;

            return (
              <div
                key={layer.id}
                className={`p-2.5 rounded-md border transition-all flex flex-col gap-2 ${
                  isActive
                    ? "bg-indigo-500/10 border-indigo-500/40 shadow-xs ring-1 ring-indigo-500/20"
                    : "bg-background/80 hover:bg-muted/40"
                }`}
                data-testid={`layer-card-${layer.id}`}
              >
                {/* Header Lapisan: Nama, Rename, Visibilitas, Duplikasi, Hapus */}
                <div className="flex items-center justify-between gap-1.5">
                  {isEditing ? (
                    <div className="flex items-center gap-1 flex-1">
                      <input
                        type="text"
                        className="w-full h-6 px-1.5 text-xs rounded border bg-background text-foreground"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveRename(layer.id);
                          if (e.key === "Escape") handleCancelRename();
                        }}
                        data-testid={`rename-input-${layer.id}`}
                      />
                      <button
                        type="button"
                        className="p-1 text-emerald-500 hover:text-emerald-600"
                        onClick={() => handleSaveRename(layer.id)}
                        title="Simpan nama"
                      >
                        <Check className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        className="p-1 text-muted-foreground hover:text-foreground"
                        onClick={handleCancelRename}
                        title="Batal"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                      <button
                        type="button"
                        className={`text-xs font-semibold text-left truncate hover:underline flex-1 ${
                          isActive
                            ? "text-indigo-600 dark:text-indigo-400"
                            : "text-foreground"
                        }`}
                        onClick={() => onSelectActiveLayer(layer.id)}
                        title="Klik untuk memilih sebagai lapisan kanvas aktif"
                        data-testid={`select-layer-${layer.id}`}
                      >
                        {layer.name}
                      </button>

                      <button
                        type="button"
                        className="p-0.5 text-muted-foreground hover:text-foreground opacity-60 hover:opacity-100"
                        onClick={() => handleStartRename(layer)}
                        title="Ubah nama lapisan"
                        data-testid={`rename-layer-${layer.id}`}
                      >
                        <Edit2 className="size-3" />
                      </button>
                    </div>
                  )}

                  {/* Action Icons */}
                  <div className="flex items-center gap-0.5 shrink-0">
                    {/* Toggle Visibility */}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                      onClick={() =>
                        onUpdateLayer(layer.id, { isVisible: !layer.isVisible })
                      }
                      title={layer.isVisible ? "Sembunyikan lapisan" : "Tampilkan lapisan"}
                      data-testid={`toggle-visibility-${layer.id}`}
                    >
                      {layer.isVisible ? (
                        <Eye className="size-3.5 text-emerald-500" />
                      ) : (
                        <EyeOff className="size-3.5 text-muted-foreground" />
                      )}
                    </Button>

                    {/* Duplicate Layer */}
                    {onDuplicateLayer && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                        onClick={() => onDuplicateLayer(layer.id)}
                        title="Duplikasi lapisan ini"
                        data-testid={`duplicate-layer-${layer.id}`}
                      >
                        <Copy className="size-3.5" />
                      </Button>
                    )}

                    {/* Delete Layer */}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-red-500 hover:text-red-700"
                      onClick={() => onDeleteLayer(layer.id)}
                      title="Hapus lapisan"
                      data-testid={`delete-layer-${layer.id}`}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Deskripsi jika ada */}
                {layer.description && !isEditing && (
                  <p className="text-[10px] text-muted-foreground italic truncate">
                    {layer.description}
                  </p>
                )}

                {/* Kontrol Opasitas & Urutan Z-Index */}
                <div className="flex flex-col gap-1.5 pt-1.5 border-t text-[11px] text-muted-foreground">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 font-medium text-muted-foreground">
                      <Sliders className="size-3 text-indigo-500" />
                      <span>Transparansi:</span>
                      <span
                        className="inline-block size-3 rounded-xs border border-muted-foreground/30 shadow-2xs"
                        style={{
                          backgroundColor: "#6366f1",
                          opacity: Number(layer.opacity) ?? 1.0,
                        }}
                        title={`Pratinjau opasitas lapisan ${Math.round((Number(layer.opacity) ?? 1.0) * 100)}%`}
                        data-testid={`opacity-preview-${layer.id}`}
                      />
                    </span>
                    <span
                      className="font-mono text-foreground font-semibold px-1 rounded bg-muted/50 text-[10px]"
                      data-testid={`opacity-value-${layer.id}`}
                    >
                      {Math.round((Number(layer.opacity) ?? 1.0) * 100)}%
                    </span>
                  </div>

                  <input
                    type="range"
                    min="0"
                    max="1.0"
                    step="0.05"
                    value={Number(layer.opacity) ?? 1.0}
                    onChange={(e) => {
                      const raw = parseFloat(e.target.value);
                      const val = Math.max(0, Math.min(1, Math.round(raw * 100) / 100));
                      onUpdateLayer(layer.id, { opacity: val });
                    }}
                    className="w-full accent-indigo-500 h-1.5 bg-muted rounded cursor-pointer"
                    aria-label={`Transparansi lapisan ${layer.name}`}
                    aria-valuenow={Math.round((Number(layer.opacity) ?? 1.0) * 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    data-testid={`opacity-slider-${layer.id}`}
                  />

                  {/* Tombol Preset Cepat Opasitas Lapisan */}
                  <div className="flex items-center justify-between gap-1 pt-0.5">
                    {[25, 50, 75, 100].map((preset) => {
                      const isCurrent =
                        Math.round((Number(layer.opacity) ?? 1.0) * 100) === preset;
                      return (
                        <button
                          key={preset}
                          type="button"
                          className={`flex-1 py-0.5 text-[10px] rounded border transition-colors ${
                            isCurrent
                              ? "bg-indigo-600 text-white border-indigo-600 font-semibold"
                              : "bg-background/80 hover:bg-muted text-muted-foreground border-border/60"
                          }`}
                          onClick={() =>
                            onUpdateLayer(layer.id, {
                              opacity: preset / 100,
                            })
                          }
                          title={`Set transparansi lapisan ke ${preset}%`}
                          data-testid={`opacity-preset-${preset}-${layer.id}`}
                        >
                          {preset}%
                        </button>
                      );
                    })}
                  </div>

                  {/* Pengaturan Urutan Z-Index (Stacking Order: Naik, Turun, Paling Atas, Paling Bawah) */}
                  <div className="flex items-center justify-between pt-1">
                    <div className="flex items-center gap-1">
                      <span>Urutan:</span>
                      <span
                        className="font-mono text-[10px] bg-muted/60 px-1 rounded text-foreground font-semibold"
                        data-testid={`layer-stack-level-${layer.id}`}
                      >
                        #{filteredSortedLayers.findIndex((l) => l.id === layer.id) + 1}
                      </span>
                    </div>

                    <div className="flex items-center gap-0.5">
                      {/* Pindah ke Paling Atas */}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
                        onClick={() => handleReorderLayer(layer.id, "top")}
                        disabled={
                          filteredSortedLayers.findIndex((l) => l.id === layer.id) === 0
                        }
                        title="Pindah ke Paling Atas (Bring to Front)"
                        data-testid={`move-layer-top-${layer.id}`}
                      >
                        <ChevronsUp className="size-3" />
                      </Button>

                      {/* Naik Satu Tingkat */}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
                        onClick={() => handleReorderLayer(layer.id, "up")}
                        disabled={
                          filteredSortedLayers.findIndex((l) => l.id === layer.id) === 0
                        }
                        title="Naikkan urutan tumpukan satu tingkat (Bring Forward)"
                        data-testid={`zindex-up-${layer.id}`}
                      >
                        <ChevronUp className="size-3" />
                      </Button>

                      {/* Input Nilai Z-Index */}
                      <input
                        type="number"
                        min="1"
                        max="99"
                        value={layer.zIndex}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10) || 1;
                          onUpdateLayer(layer.id, { zIndex: val });
                        }}
                        className="w-9 h-5 px-0.5 text-center font-mono text-[11px] rounded border bg-background"
                        data-testid={`zindex-input-${layer.id}`}
                        title="Nilai Z-Index urutan tumpukan"
                      />

                      {/* Turun Satu Tingkat */}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
                        onClick={() => handleReorderLayer(layer.id, "down")}
                        disabled={
                          filteredSortedLayers.findIndex((l) => l.id === layer.id) ===
                          filteredSortedLayers.length - 1
                        }
                        title="Turunkan urutan tumpukan satu tingkat (Send Backward)"
                        data-testid={`zindex-down-${layer.id}`}
                      >
                        <ChevronDown className="size-3" />
                      </Button>

                      {/* Pindah ke Paling Bawah */}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
                        onClick={() => handleReorderLayer(layer.id, "bottom")}
                        disabled={
                          filteredSortedLayers.findIndex((l) => l.id === layer.id) ===
                          filteredSortedLayers.length - 1
                        }
                        title="Pindah ke Paling Bawah (Send to Back)"
                        data-testid={`move-layer-bottom-${layer.id}`}
                      >
                        <ChevronsDown className="size-3" />
                      </Button>
                    </div>
                  </div>

                  {/* Status Objek & Kanvas Aktif */}
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-0.5">
                    <span data-testid={`layer-shapes-count-${layer.id}`}>
                      Objek: {shapesCount} bentuk
                    </span>
                    {isActive ? (
                      <span className="text-indigo-600 dark:text-indigo-400 font-semibold flex items-center gap-1">
                        ● Kanvas Aktif
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="text-[10px] text-muted-foreground hover:text-foreground hover:underline"
                        onClick={() => onSelectActiveLayer(layer.id)}
                      >
                        Pilih Aktif
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
