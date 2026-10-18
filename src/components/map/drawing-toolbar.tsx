"use client";

import React, { useEffect } from "react";
import {
  MousePointer,
  Square,
  Circle,
  MoveRight,
  Minus,
  Type,
  Trash2,
  Pentagon,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DrawingShapeType } from "@/db/schema/map-drawing-layers";

export type DrawingToolType = "select" | DrawingShapeType | "delete";

export interface DrawingToolbarProps {
  selectedTool: DrawingToolType;
  onSelectTool: (tool: DrawingToolType) => void;
  selectedColor: string;
  onSelectColor: (color: string) => void;
  strokeWidth: number;
  onSelectStrokeWidth: (width: number) => void;
  availableColors?: string[];
  activeLayerName?: string;
  shapesCount?: number;
  onClearActiveLayerShapes?: () => void;
  className?: string;
}

export const DEFAULT_DRAWING_COLORS = [
  "#ef4444", // Merah (Kritis / Core 1)
  "#3b82f6", // Biru (Primer / Core 2)
  "#10b981", // Hijau (Normal / Core 3)
  "#f59e0b", // Kuning / Amber (Peringatan / Core 4)
  "#8b5cf6", // Ungu (Rencana Feeder)
  "#ec4899", // Pink (Catatan Lapangan)
  "#06b6d4", // Cyan (Jalur Drop)
  "#ffffff", // Putih (Kontras Satelit)
];

export const STROKE_WIDTH_OPTIONS = [1, 2, 3, 4, 6];

export function DrawingToolbar({
  selectedTool,
  onSelectTool,
  selectedColor,
  onSelectColor,
  strokeWidth,
  onSelectStrokeWidth,
  availableColors = DEFAULT_DRAWING_COLORS,
  activeLayerName,
  shapesCount = 0,
  onClearActiveLayerShapes,
  className = "",
}: DrawingToolbarProps) {
  // Pintasan Keyboard Global (V: Select, R: Rect, C: Circle, A: Arrow, L: Line, T: Text, D: Delete)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Abaikan jika fokus sedang berada pada input atau textarea teks
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      ) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case "v":
          onSelectTool("select");
          break;
        case "r":
          onSelectTool("rectangle");
          break;
        case "c":
          onSelectTool("circle");
          break;
        case "a":
          onSelectTool("arrow");
          break;
        case "l":
          onSelectTool("line");
          break;
        case "t":
          onSelectTool("text");
          break;
        case "d":
          onSelectTool("delete");
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onSelectTool]);

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2.5 p-2 rounded-lg border bg-card/80 backdrop-blur-xs shadow-xs transition-all ${className}`}
      data-testid="drawing-toolbar"
    >
      {/* Grup Alat Seleksi & Geometri Bentuk 2D */}
      <div className="flex items-center gap-1">
        {/* Pointer / Select Tool */}
        <Button
          type="button"
          variant={selectedTool === "select" ? "default" : "outline"}
          size="sm"
          className={`h-8 w-8 p-0 ${
            selectedTool === "select"
              ? "bg-primary text-primary-foreground shadow-xs ring-1 ring-primary"
              : ""
          }`}
          onClick={() => onSelectTool("select")}
          title="Pilih / Geser Peta (V)"
          data-testid="tool-select"
        >
          <MousePointer className="size-3.5" />
          <span className="sr-only">Pilih</span>
        </Button>

        {/* Kotak / Persegi Area */}
        <Button
          type="button"
          variant={selectedTool === "rectangle" ? "default" : "outline"}
          size="sm"
          className={`h-8 w-8 p-0 ${
            selectedTool === "rectangle"
              ? "bg-primary text-primary-foreground shadow-xs ring-1 ring-primary"
              : ""
          }`}
          onClick={() => onSelectTool("rectangle")}
          title="Kotak / Persegi Area Feeder (R)"
          data-testid="tool-rectangle"
        >
          <Square className="size-3.5" />
          <span className="sr-only">Kotak</span>
        </Button>

        {/* Lingkaran Cakupan Area */}
        <Button
          type="button"
          variant={selectedTool === "circle" ? "default" : "outline"}
          size="sm"
          className={`h-8 w-8 p-0 ${
            selectedTool === "circle"
              ? "bg-primary text-primary-foreground shadow-xs ring-1 ring-primary"
              : ""
          }`}
          onClick={() => onSelectTool("circle")}
          title="Lingkaran Cakupan Sinyal / ODP (C)"
          data-testid="tool-circle"
        >
          <Circle className="size-3.5" />
          <span className="sr-only">Lingkaran</span>
        </Button>

        {/* Panah Petunjuk Arah Kabel */}
        <Button
          type="button"
          variant={selectedTool === "arrow" ? "default" : "outline"}
          size="sm"
          className={`h-8 w-8 p-0 ${
            selectedTool === "arrow"
              ? "bg-primary text-primary-foreground shadow-xs ring-1 ring-primary"
              : ""
          }`}
          onClick={() => onSelectTool("arrow")}
          title="Panah Petunjuk Arah Tarikan (A)"
          data-testid="tool-arrow"
        >
          <MoveRight className="size-3.5" />
          <span className="sr-only">Panah</span>
        </Button>

        {/* Garis Penghubung Segment Kabel */}
        <Button
          type="button"
          variant={selectedTool === "line" ? "default" : "outline"}
          size="sm"
          className={`h-8 w-8 p-0 ${
            selectedTool === "line"
              ? "bg-primary text-primary-foreground shadow-xs ring-1 ring-primary"
              : ""
          }`}
          onClick={() => onSelectTool("line")}
          title="Garis Penghubung / Tarikan Kabel (L)"
          data-testid="tool-line"
        >
          <Minus className="size-3.5" />
          <span className="sr-only">Garis</span>
        </Button>

        {/* Poligon Area Bebas */}
        <Button
          type="button"
          variant={selectedTool === "polygon" ? "default" : "outline"}
          size="sm"
          className={`h-8 w-8 p-0 ${
            selectedTool === "polygon"
              ? "bg-primary text-primary-foreground shadow-xs ring-1 ring-primary"
              : ""
          }`}
          onClick={() => onSelectTool("polygon")}
          title="Poligon Area Bebas Multi-Titik (P)"
          data-testid="tool-polygon"
        >
          <Pentagon className="size-3.5" />
          <span className="sr-only">Poligon</span>
        </Button>

        {/* Label Teks Catatan Lapangan */}
        <Button
          type="button"
          variant={selectedTool === "text" ? "default" : "outline"}
          size="sm"
          className={`h-8 w-8 p-0 ${
            selectedTool === "text"
              ? "bg-primary text-primary-foreground shadow-xs ring-1 ring-primary"
              : ""
          }`}
          onClick={() => onSelectTool("text")}
          title="Label Catatan Teks Lapangan (T)"
          data-testid="tool-text"
        >
          <Type className="size-3.5" />
          <span className="sr-only">Teks</span>
        </Button>

        {/* Alat Hapus Objek (Delete / Erase) */}
        <Button
          type="button"
          variant={selectedTool === "delete" ? "destructive" : "outline"}
          size="sm"
          className={`h-8 w-8 p-0 ${
            selectedTool === "delete"
              ? "bg-red-600 text-white shadow-xs ring-1 ring-red-500"
              : "text-red-500 hover:text-red-600"
          }`}
          onClick={() => onSelectTool("delete")}
          title="Mode Hapus Objek (D)"
          data-testid="tool-delete"
        >
          <Trash2 className="size-3.5" />
          <span className="sr-only">Hapus Objek</span>
        </Button>
      </div>

      {/* Palet Warna, Ketebalan Garis & Utilitas */}
      <div className="flex flex-wrap items-center gap-2.5">
        {/* Pemilih Warna Vektor */}
        <div
          className="flex items-center gap-1 px-1.5 py-1 rounded-md border bg-muted/40"
          data-testid="color-picker-group"
        >
          {availableColors.map((color) => {
            const isSelected = selectedColor.toLowerCase() === color.toLowerCase();
            return (
              <button
                key={color}
                type="button"
                className={`size-4 rounded-full border transition-transform ${
                  isSelected
                    ? "scale-125 ring-2 ring-primary ring-offset-1"
                    : "hover:scale-110 opacity-85 hover:opacity-100"
                }`}
                style={{ backgroundColor: color }}
                onClick={() => onSelectColor(color)}
                title={`Pilih warna ${color}`}
                data-testid={`color-picker-${color}`}
              />
            );
          })}
        </div>

        {/* Pemilih Ketebalan Garis */}
        <div
          className="flex items-center gap-0.5 rounded-md border bg-muted/40 p-0.5"
          data-testid="stroke-width-group"
        >
          {STROKE_WIDTH_OPTIONS.map((w) => (
            <Button
              key={w}
              type="button"
              variant={strokeWidth === w ? "secondary" : "ghost"}
              size="sm"
              className={`h-6 px-1.5 text-[11px] font-mono ${
                strokeWidth === w ? "bg-background shadow-xs font-semibold" : ""
              }`}
              onClick={() => onSelectStrokeWidth(w)}
              title={`Tebal garis ${w}px`}
              data-testid={`stroke-width-${w}`}
            >
              {w}px
            </Button>
          ))}
        </div>

        {/* Tombol Bersihkan Objek Lapisan Aktif (Opsional) */}
        {onClearActiveLayerShapes && shapesCount > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-red-500 hover:text-red-700 hover:bg-red-500/10 gap-1"
            onClick={() => {
              if (
                confirm(
                  `Kosongkan seluruh ${shapesCount} objek bentuk pada lapisan "${
                    activeLayerName || "aktif"
                  }"?`,
                )
              ) {
                onClearActiveLayerShapes();
              }
            }}
            title="Hapus semua objek di lapisan ini"
            data-testid="clear-layer-shapes-btn"
          >
            <Trash2 className="size-3" />
            <span className="hidden sm:inline">Bersihkan ({shapesCount})</span>
          </Button>
        )}

        {/* Indikator Status Alat Aktif di Toolbar */}
        <div
          className="flex items-center gap-1.5 px-2 py-0.5 rounded border bg-background/60 text-xs font-medium text-foreground"
          data-testid="toolbar-active-tool-status"
        >
          <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="capitalize">{selectedTool}</span>
        </div>

        {/* Indikator Lapisan Aktif Ringkas */}
        {activeLayerName && (
          <div
            className="hidden xl:flex items-center gap-1 text-[11px] text-muted-foreground px-2 py-0.5 rounded border bg-background/50"
            data-testid="active-layer-indicator"
          >
            <Layers className="size-3 text-indigo-500" />
            <span className="truncate max-w-[140px] font-medium text-foreground">
              {activeLayerName}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
