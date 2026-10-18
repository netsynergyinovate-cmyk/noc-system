"use client";

import React from "react";
import {
  Square,
  Circle,
  MoveRight,
  Minus,
  Pentagon,
  Type,
  Trash2,
  Copy,
  Edit3,
  X,
  Maximize2,
  MinusCircle,
  PlusCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DrawingShape } from "@/db/schema/map-drawing-layers";
import { DEFAULT_DRAWING_COLORS, STROKE_WIDTH_OPTIONS } from "@/components/map/drawing-toolbar";

import type L from "leaflet";

export interface SelectedShapeModifierPanelProps {
  selectedShape: DrawingShape | null;
  availableColors?: string[];
  onUpdateShapeProperties: (
    shapeId: string,
    updates: Partial<DrawingShape["properties"]>,
  ) => void;
  onDuplicateShape: (shapeId: string) => void;
  onDeleteShape: (shapeId: string) => void;
  onDeselect: () => void;
  onEditText?: (shape: DrawingShape) => void;
  leafletMapInstance?: L.Map | null;
  className?: string;
}

export function SelectedShapeModifierPanel({
  selectedShape,
  availableColors = DEFAULT_DRAWING_COLORS,
  onUpdateShapeProperties,
  onDuplicateShape,
  onDeleteShape,
  onDeselect,
  onEditText,
  leafletMapInstance = null,
  className = "",
}: SelectedShapeModifierPanelProps) {
  if (!selectedShape) return null;

  const shapeType = selectedShape.type;
  const currentColor = selectedShape.properties.color || "#3b82f6";
  const currentStrokeWidth = selectedShape.properties.strokeWidth || 3;
  const currentWidth = selectedShape.properties.width || 100;
  const currentHeight = selectedShape.properties.height || 60;
  const currentRadius = selectedShape.properties.radius || 35;

  // Sinkronisasi geografis saat dimensi kotak diubah
  const updateRectangleDimension = (newW: number, newH: number) => {
    let geoCoordinates = selectedShape.properties.geoCoordinates;
    if (leafletMapInstance && Array.isArray(selectedShape.coordinates)) {
      const x = typeof selectedShape.coordinates[0] === "number" ? selectedShape.coordinates[0] : 0;
      const y = typeof selectedShape.coordinates[1] === "number" ? selectedShape.coordinates[1] : 0;
      try {
        const nw = leafletMapInstance.containerPointToLatLng([x, y]);
        const se = leafletMapInstance.containerPointToLatLng([x + newW, y + newH]);
        geoCoordinates = [
          [nw.lat, nw.lng],
          [se.lat, se.lng],
        ];
      } catch {
        // Fallback
      }
    }
    onUpdateShapeProperties(selectedShape.id, {
      width: newW,
      height: newH,
      geoCoordinates,
    });
  };

  // Sinkronisasi radius geografis saat radius lingkaran diubah
  const updateCircleRadius = (newR: number) => {
    let geoRadius = selectedShape.properties.geoRadius;
    if (
      leafletMapInstance &&
      Array.isArray(selectedShape.coordinates) &&
      Array.isArray(selectedShape.properties.geoCoordinates) &&
      typeof selectedShape.properties.geoCoordinates[0] === "number" &&
      typeof selectedShape.properties.geoCoordinates[1] === "number"
    ) {
      try {
        const coords = selectedShape.coordinates;
        const cx =
          Array.isArray(coords) && typeof coords[0] === "number"
            ? coords[0]
            : 0;
        const cy =
          Array.isArray(coords) && typeof coords[1] === "number"
            ? coords[1]
            : 0;
        const centerLatLng = leafletMapInstance.containerPointToLatLng([cx, cy]);
        const edgeLatLng = leafletMapInstance.containerPointToLatLng([
          cx,
          cy + newR,
        ]);
        geoRadius = Math.round(centerLatLng.distanceTo(edgeLatLng));
      } catch {
        // Fallback
      }
    }
    onUpdateShapeProperties(selectedShape.id, {
      radius: newR,
      ...(geoRadius ? { geoRadius } : {}),
    });
  };

  const getShapeLabel = () => {
    switch (shapeType) {
      case "rectangle":
        return "Persegi Area";
      case "circle":
        return "Lingkaran ODP";
      case "arrow":
        return "Panah Tarikan";
      case "line":
        return "Garis Jalur";
      case "polygon":
        return "Poligon Wilayah";
      case "text":
        return "Catatan Teks";
      default:
        return "Bentuk Anotasi";
    }
  };

  const renderShapeIcon = () => {
    switch (shapeType) {
      case "rectangle":
        return <Square className="size-3.5 text-indigo-500" />;
      case "circle":
        return <Circle className="size-3.5 text-blue-500" />;
      case "arrow":
        return <MoveRight className="size-3.5 text-amber-500" />;
      case "line":
        return <Minus className="size-3.5 text-emerald-500" />;
      case "polygon":
        return <Pentagon className="size-3.5 text-purple-500" />;
      case "text":
        return <Type className="size-3.5 text-cyan-500" />;
      default:
        return <Maximize2 className="size-3.5 text-primary" />;
    }
  };

  return (
    <div
      className={`absolute bottom-3 left-3 z-30 p-2.5 bg-background/95 backdrop-blur-md rounded-lg border shadow-xl flex flex-col gap-2 max-w-[420px] transition-all text-xs ${className}`}
      data-testid="selected-shape-inspector"
    >
      {/* Baris 1: Header Objek (Tipe, ID, Tombol Tutup) */}
      <div className="flex items-center justify-between gap-2 border-b pb-1.5">
        <div className="flex items-center gap-1.5">
          {renderShapeIcon()}
          <span className="font-semibold text-foreground text-xs">
            {getShapeLabel()}
          </span>
          <span
            className="text-[10px] text-muted-foreground font-mono bg-muted/60 px-1 py-0.5 rounded"
            data-testid="shape-id-display"
          >
            #{selectedShape.id.slice(-6)}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
            onClick={onDeselect}
            title="Tutup Panel Seleksi (Esc)"
            data-testid="close-modifier-btn"
          >
            <X className="size-3.5" />
            <span className="sr-only">Tutup</span>
          </Button>
        </div>
      </div>

      {/* Baris 2: Pemilih Warna & Pengatur Ketebalan Garis */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Palet Warna */}
        <div className="flex items-center gap-1" data-testid="modifier-color-picker">
          <span className="text-[10px] text-muted-foreground mr-0.5">Warna:</span>
          {availableColors.map((color) => {
            const isSelected = currentColor.toLowerCase() === color.toLowerCase();
            return (
              <button
                key={color}
                type="button"
                className={`size-4 rounded-full border transition-transform ${
                  isSelected ? "scale-125 ring-2 ring-primary ring-offset-1" : "hover:scale-110"
                }`}
                style={{ backgroundColor: color }}
                onClick={() =>
                  onUpdateShapeProperties(selectedShape.id, {
                    color,
                    ...(selectedShape.properties.fillColor &&
                    selectedShape.properties.fillColor.includes("22")
                      ? { fillColor: `${color}22` }
                      : {}),
                  })
                }
                title={`Pilih warna ${color}`}
                data-testid={`modifier-color-${color.replace("#", "")}`}
              />
            );
          })}
        </div>

        {/* Ketebalan Garis (Stroke Width) */}
        {shapeType !== "text" && (
          <div
            className="flex items-center gap-1 border-l pl-2"
            data-testid="modifier-stroke-width-group"
          >
            <span className="text-[10px] text-muted-foreground mr-0.5">Tebal:</span>
            {STROKE_WIDTH_OPTIONS.map((w) => (
              <button
                key={w}
                type="button"
                className={`h-5 px-1.5 rounded text-[10px] font-semibold border ${
                  currentStrokeWidth === w
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted/40 hover:bg-muted text-muted-foreground"
                }`}
                onClick={() =>
                  onUpdateShapeProperties(selectedShape.id, { strokeWidth: w })
                }
                data-testid={`modifier-stroke-${w}`}
              >
                {w}px
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Baris 3: Pengatur Dimensi Khusus (Kotak: Lebar & Tinggi, Lingkaran: Radius) */}
      {(shapeType === "rectangle" || shapeType === "circle") && (
        <div className="flex items-center gap-3 border-t pt-1.5 text-[11px]">
          {shapeType === "rectangle" && (
            <>
              {/* Width Stepper */}
              <div
                className="flex items-center gap-1"
                data-testid="modifier-width-control"
              >
                <span className="text-muted-foreground">L:</span>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() =>
                    updateRectangleDimension(
                      Math.max(20, currentWidth - 10),
                      currentHeight,
                    )
                  }
                  title="Kurangi lebar (-10px)"
                >
                  <MinusCircle className="size-3" />
                </button>
                <span className="font-mono font-semibold">{currentWidth}px</span>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() =>
                    updateRectangleDimension(
                      currentWidth + 10,
                      currentHeight,
                    )
                  }
                  title="Tambah lebar (+10px)"
                >
                  <PlusCircle className="size-3" />
                </button>
              </div>

              {/* Height Stepper */}
              <div
                className="flex items-center gap-1 border-l pl-2"
                data-testid="modifier-height-control"
              >
                <span className="text-muted-foreground">T:</span>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() =>
                    updateRectangleDimension(
                      currentWidth,
                      Math.max(20, currentHeight - 10),
                    )
                  }
                  title="Kurangi tinggi (-10px)"
                >
                  <MinusCircle className="size-3" />
                </button>
                <span className="font-mono font-semibold">{currentHeight}px</span>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() =>
                    updateRectangleDimension(
                      currentWidth,
                      currentHeight + 10,
                    )
                  }
                  title="Tambah tinggi (+10px)"
                >
                  <PlusCircle className="size-3" />
                </button>
              </div>
            </>
          )}

          {shapeType === "circle" && (
            <div
              className="flex items-center gap-1"
              data-testid="modifier-radius-control"
            >
              <span className="text-muted-foreground">Radius:</span>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={() =>
                  updateCircleRadius(Math.max(10, currentRadius - 5))
                }
                title="Kurangi radius (-5px)"
              >
                <MinusCircle className="size-3" />
              </button>
              <span className="font-mono font-semibold">{currentRadius}px</span>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => updateCircleRadius(currentRadius + 5)}
                title="Tambah radius (+5px)"
              >
                <PlusCircle className="size-3" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Baris 4: Aksi Tombol (Edit Teks, Duplikasi, Hapus, Batal) */}
      <div className="flex items-center justify-between gap-1.5 border-t pt-1.5">
        <div className="flex items-center gap-1.5">
          {shapeType === "text" && onEditText && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[11px] gap-1 border-indigo-500/30 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/10"
              onClick={() => onEditText(selectedShape)}
              data-testid="edit-selected-text-btn"
            >
              <Edit3 className="size-3" />
              <span>Edit Teks</span>
            </Button>
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[11px] gap-1"
            onClick={() => onDuplicateShape(selectedShape.id)}
            data-testid="duplicate-selected-shape-btn"
            title="Duplikasi bentuk ini (Ctrl+D)"
          >
            <Copy className="size-3" />
            <span>Duplikasi</span>
          </Button>

          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="h-6 px-2 text-[11px] gap-1"
            onClick={() => onDeleteShape(selectedShape.id)}
            data-testid="delete-selected-shape-btn"
            title="Hapus bentuk ini (Delete / Backspace)"
          >
            <Trash2 className="size-3" />
            <span>Hapus</span>
          </Button>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px] text-muted-foreground"
          onClick={onDeselect}
        >
          Batal (Esc)
        </Button>
      </div>
    </div>
  );
}
