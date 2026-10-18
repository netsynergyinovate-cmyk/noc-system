"use client";

import React from "react";
import {
  MousePointer,
  Square,
  Circle,
  MoveRight,
  Minus,
  Pentagon,
  Type,
  Trash2,
  X,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DrawingToolType } from "@/components/map/drawing-toolbar";

export interface DrawingActiveToolIndicatorProps {
  selectedTool: DrawingToolType;
  onSelectTool: (tool: DrawingToolType) => void;
  activeLayerName?: string;
  selectedColor?: string;
  strokeWidth?: number;
  cursorCoordinates?: {
    x: number;
    y: number;
    lat?: number;
    lng?: number;
  } | null;
  drawingDimensions?: {
    width?: number;
    height?: number;
    radius?: number;
    length?: number;
  } | null;
  className?: string;
}

export function DrawingActiveToolIndicator({
  selectedTool,
  onSelectTool,
  activeLayerName,
  selectedColor = "#3b82f6",
  strokeWidth = 3,
  cursorCoordinates = null,
  drawingDimensions = null,
  className = "",
}: DrawingActiveToolIndicatorProps) {
  const getToolMeta = () => {
    switch (selectedTool) {
      case "select":
        return {
          label: "Navigasi & Seleksi",
          shortcut: "V",
          description:
            "Klik objek untuk memilih/geser, atau geser peta untuk navigasi",
          icon: <MousePointer className="size-4 text-primary" />,
          isDrawingTool: false,
        };
      case "rectangle":
        return {
          label: "Persegi Area Feeder",
          shortcut: "R",
          description: "Klik & geser untuk menandai kotak area cakupan",
          icon: <Square className="size-4 text-indigo-500" />,
          isDrawingTool: true,
        };
      case "circle":
        return {
          label: "Lingkaran Cakupan ODP",
          shortcut: "C",
          description: "Klik & geser untuk membuat radius cakupan ODP",
          icon: <Circle className="size-4 text-blue-500" />,
          isDrawingTool: true,
        };
      case "arrow":
        return {
          label: "Panah Tarikan Kabel",
          shortcut: "A",
          description: "Klik & geser untuk menarik panah arah fiber",
          icon: <MoveRight className="size-4 text-amber-500" />,
          isDrawingTool: true,
        };
      case "line":
        return {
          label: "Garis Jalur Optik",
          shortcut: "L",
          description: "Klik & geser untuk menggambar segmen garis kabel",
          icon: <Minus className="size-4 text-emerald-500" />,
          isDrawingTool: true,
        };
      case "polygon":
        return {
          label: "Poligon Wilayah Layanan",
          shortcut: "P",
          description:
            "Klik titik area di peta. Klik titik awal untuk menutup area",
          icon: <Pentagon className="size-4 text-purple-500" />,
          isDrawingTool: true,
        };
      case "text":
        return {
          label: "Catatan Teks Lapangan",
          shortcut: "T",
          description: "Klik kanvas peta untuk menempatkan label catatan",
          icon: <Type className="size-4 text-cyan-500" />,
          isDrawingTool: true,
        };
      case "delete":
        return {
          label: "Penghapus Objek",
          shortcut: "D",
          description: "Klik objek gambar pada kanvas untuk menghapusnya",
          icon: <Trash2 className="size-4 text-red-500" />,
          isDrawingTool: false,
        };
      default:
        return {
          label: "Alat Anotasi",
          shortcut: "",
          description: "Pilih alat gambar dari toolbar",
          icon: <MousePointer className="size-4 text-muted-foreground" />,
          isDrawingTool: false,
        };
    }
  };

  const meta = getToolMeta();

  return (
    <>
      {/* Banner Indikator Alat Aktif di Atas Kanvas */}
      <div
        className={`absolute top-2.5 left-2.5 z-20 flex flex-wrap items-center gap-2 p-1.5 px-2.5 bg-background/95 backdrop-blur-md rounded-lg border shadow-md text-xs transition-all ${className}`}
        data-testid="active-tool-banner"
      >
        <div className="flex items-center gap-1.5" data-testid="active-tool-indicator">
          {meta.icon}
          <div className="flex items-center gap-1">
            <span className="font-semibold text-foreground">
              {meta.label}
            </span>
            {meta.shortcut && (
              <kbd className="hidden sm:inline-block px-1.5 py-0.2 rounded bg-muted text-[10px] font-mono text-muted-foreground border">
                {meta.shortcut}
              </kbd>
            )}
          </div>
        </div>

        {/* Separator */}
        <div className="h-3.5 w-px bg-border hidden sm:block" />

        {/* Info Lapisan Aktif */}
        {activeLayerName && (
          <div
            className="hidden md:flex items-center gap-1 text-[11px] text-muted-foreground"
            data-testid="banner-layer-info"
          >
            <Layers className="size-3 text-indigo-400" />
            <span className="truncate max-w-[130px]">{activeLayerName}</span>
          </div>
        )}

        {/* Indikator Warna & Ketebalan Garis saat Menggambar */}
        {meta.isDrawingTool && (
          <div
            className="flex items-center gap-1.5 border-l pl-2 text-[11px]"
            data-testid="banner-brush-spec"
          >
            <div
              className="size-3 rounded-full border shadow-2xs"
              style={{ backgroundColor: selectedColor }}
              title={`Warna kuas: ${selectedColor}`}
            />
            {selectedTool !== "text" && (
              <span className="font-mono text-muted-foreground">
                {strokeWidth}px
              </span>
            )}
          </div>
        )}

        {/* Tombol Cepat Beralih ke Navigasi Peta (Esc / V) */}
        {selectedTool !== "select" && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-[11px] gap-1 text-muted-foreground hover:text-foreground ml-1"
            onClick={() => onSelectTool("select")}
            title="Kembali ke Mode Navigasi Peta (Esc)"
            data-testid="switch-to-select-btn"
          >
            <X className="size-3" />
            <span className="hidden sm:inline">Selesai (Esc)</span>
          </Button>
        )}
      </div>

      {/* HUD Pelacak Koordinat Kursor & Dimensi Real-time di Pojok Bawah */}
      {cursorCoordinates && (
        <div
          className="absolute bottom-2.5 right-2.5 z-20 px-2 py-1 bg-background/90 backdrop-blur-md rounded border shadow-sm text-[10px] font-mono flex items-center gap-2.5 text-muted-foreground pointer-events-none"
          data-testid="cursor-coordinates-hud"
        >
          {/* Dimensi Interaktif Saat Menggambar */}
          {drawingDimensions && (
            <div
              className="flex items-center gap-1 text-primary font-semibold border-r pr-2"
              data-testid="cursor-drawing-dimension"
            >
              {typeof drawingDimensions.width === "number" &&
                typeof drawingDimensions.height === "number" && (
                  <span>
                    {Math.round(drawingDimensions.width)} ×{" "}
                    {Math.round(drawingDimensions.height)} px
                  </span>
                )}
              {typeof drawingDimensions.radius === "number" && (
                <span>R: {Math.round(drawingDimensions.radius)} px</span>
              )}
              {typeof drawingDimensions.length === "number" && (
                <span>P: {Math.round(drawingDimensions.length)} px</span>
              )}
            </div>
          )}

          {/* Posisi Koordinat Piksel */}
          <div className="flex items-center gap-1">
            <span>
              X: {Math.round(cursorCoordinates.x)}, Y: {Math.round(cursorCoordinates.y)}
            </span>
          </div>

          {/* Posisi Koordinat GPS Satelit */}
          {typeof cursorCoordinates.lat === "number" &&
            typeof cursorCoordinates.lng === "number" && (
              <div
                className="hidden sm:flex items-center gap-1 border-l pl-2 text-foreground/80"
                data-testid="cursor-gps-position"
              >
                <span>
                  {cursorCoordinates.lat.toFixed(5)}, {cursorCoordinates.lng.toFixed(5)}
                </span>
              </div>
            )}
        </div>
      )}
    </>
  );
}
