"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Layers,
  Square,
  Save,
  Database,
  RefreshCw,
  Share2,
  Server,
  Users,
  Check,
  AlertCircle,
  AlertTriangle,
  X,
  Info,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { NetworkMapLeafletLoader } from "@/components/map/network-map-leaflet-loader";
import {
  LeaferCanvasOverlay,
  moveShapeByOffset,
} from "@/components/map/leafer-canvas-overlay";
import { DrawingLayerManagerPanel } from "@/components/map/drawing-layer-manager-panel";
import { DrawingToolbar } from "@/components/map/drawing-toolbar";
import { DrawingTextDialog } from "@/components/map/drawing-text-dialog";
import { SelectedShapeModifierPanel } from "@/components/map/selected-shape-modifier-panel";
import { DrawingActiveToolIndicator } from "@/components/map/drawing-active-tool-indicator";
import type L from "leaflet";
import type { CompleteRealMapDataResult } from "@/services/real-map-data.service";
import type {
  DrawingLayersResponse,
} from "@/services/map-drawing-layers.service";
import type {
  MapDrawingLayer,
  DrawingShape,
  DrawingShapeType,
} from "@/db/schema/map-drawing-layers";

export interface DrawingLayerMapBoardProps {
  initialMapData: CompleteRealMapDataResult;
  initialDrawingLayers: DrawingLayersResponse;
  initialError?: string | null;
}

const AVAILABLE_COLORS = [
  "#ef4444", // Merah
  "#3b82f6", // Biru
  "#10b981", // Hijau
  "#f59e0b", // Kuning / Amber
  "#8b5cf6", // Ungu
  "#ec4899", // Pink
  "#ffffff", // Putih
];

export function DrawingLayerMapBoard({
  initialMapData,
  initialDrawingLayers,
  initialError,
}: DrawingLayerMapBoardProps) {
  const [layers, setLayers] = useState<MapDrawingLayer[]>(
    initialDrawingLayers.layers || [],
  );
  const [loadError, setLoadError] = useState<string | null>(
    initialError || null,
  );
  const [activeLayerId, setActiveLayerId] = useState<string | null>(
    initialDrawingLayers.layers?.[0]?.id ?? null,
  );
  const [selectedTool, setSelectedTool] = useState<
    "select" | DrawingShapeType | "delete"
  >("select");
  const [selectedColor, setSelectedColor] = useState<string>("#3b82f6");
  const [strokeWidth, setStrokeWidth] = useState<number>(3);
  const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null);
  const [textDialogState, setTextDialogState] = useState<{
    isOpen: boolean;
    isEditing: boolean;
    shapeId?: string;
    x: number;
    y: number;
    latLng?: [number, number];
    initialText?: string;
    initialFontSize?: number;
    initialColor?: string;
    initialFillColor?: string;
  }>({
    isOpen: false,
    isEditing: false,
    x: 0,
    y: 0,
  });
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isReloading, setIsReloading] = useState<boolean>(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [leafletMap, setLeafletMap] = useState<L.Map | null>(null);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [currentPos, setCurrentPos] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [cursorCoordinates, setCursorCoordinates] = useState<{
    x: number;
    y: number;
    lat?: number;
    lng?: number;
  } | null>(null);
  const [drawingDimensions, setDrawingDimensions] = useState<{
    width?: number;
    height?: number;
    radius?: number;
    length?: number;
  } | null>(null);

  const activeLayer = layers.find((l) => l.id === activeLayerId) || null;

  // Clear feedback after 4 seconds
  useEffect(() => {
    if (feedback) {
      const timer = setTimeout(() => setFeedback(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [feedback]);

  // Redraw canvas overlay when shapes or layers change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Resize canvas to match display size
    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width;
      canvas.height = rect.height;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw all visible layers sorted by zIndex
    const sortedLayers = [...layers]
      .filter((l) => l.isVisible)
      .sort((a, b) => a.zIndex - b.zIndex);

    for (const layer of sortedLayers) {
      ctx.save();
      ctx.globalAlpha = Number(layer.opacity ?? 1.0);

      const shapes: DrawingShape[] = Array.isArray(layer.shapes)
        ? layer.shapes
        : [];

      for (const shape of shapes) {
        ctx.strokeStyle = shape.properties.color || "#3b82f6";
        ctx.fillStyle = shape.properties.fillColor || "transparent";
        ctx.lineWidth = shape.properties.strokeWidth || 3;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        const coords = shape.coordinates;

        if (shape.type === "rectangle" && Array.isArray(coords)) {
          let x = typeof coords[0] === "number" ? coords[0] : 50;
          let y = typeof coords[1] === "number" ? coords[1] : 50;
          let w = shape.properties.width || 120;
          let h = shape.properties.height || 80;

          if (
            leafletMap &&
            Array.isArray(shape.properties.geoCoordinates) &&
            shape.properties.geoCoordinates.length >= 2
          ) {
            const [g1, g2] = shape.properties.geoCoordinates;
            if (Array.isArray(g1) && Array.isArray(g2)) {
              try {
                const p1 = leafletMap.latLngToContainerPoint([g1[0], g1[1]]);
                const p2 = leafletMap.latLngToContainerPoint([g2[0], g2[1]]);
                x = Math.min(p1.x, p2.x);
                y = Math.min(p1.y, p2.y);
                w = Math.max(2, Math.abs(p2.x - p1.x));
                h = Math.max(2, Math.abs(p2.y - p1.y));
              } catch {
                // Fallback
              }
            }
          }

          if (shape.properties.fillColor) {
            ctx.fillRect(x, y, w, h);
          }
          ctx.strokeRect(x, y, w, h);
        } else if (shape.type === "circle" && Array.isArray(coords)) {
          let x = typeof coords[0] === "number" ? coords[0] : 100;
          let y = typeof coords[1] === "number" ? coords[1] : 100;
          let r = shape.properties.radius || 40;

          if (
            leafletMap &&
            Array.isArray(shape.properties.geoCoordinates) &&
            typeof shape.properties.geoCoordinates[0] === "number" &&
            typeof shape.properties.geoCoordinates[1] === "number"
          ) {
            try {
              const centerPt = leafletMap.latLngToContainerPoint([
                shape.properties.geoCoordinates[0],
                shape.properties.geoCoordinates[1],
              ]);
              x = centerPt.x;
              y = centerPt.y;

              if (shape.properties.geoRadius && shape.properties.geoRadius > 0) {
                const offsetLat =
                  shape.properties.geoCoordinates[0] +
                  shape.properties.geoRadius / 111320;
                const edgePt = leafletMap.latLngToContainerPoint([
                  offsetLat,
                  shape.properties.geoCoordinates[1],
                ]);
                r = Math.max(4, Math.round(Math.abs(centerPt.y - edgePt.y)));
              }
            } catch {
              // Fallback
            }
          }

          ctx.beginPath();
          ctx.arc(x, y, r, 0, 2 * Math.PI);
          if (shape.properties.fillColor) {
            ctx.fill();
          }
          ctx.stroke();
        } else if (shape.type === "line" && Array.isArray(coords)) {
          const p1 = coords[0];
          const p2 = coords[1];
          if (Array.isArray(p1) && Array.isArray(p2)) {
            let x1 = p1[0];
            let y1 = p1[1];
            let x2 = p2[0];
            let y2 = p2[1];

            if (
              leafletMap &&
              Array.isArray(shape.properties.geoCoordinates) &&
              shape.properties.geoCoordinates.length >= 2
            ) {
              const [g1, g2] = shape.properties.geoCoordinates;
              if (Array.isArray(g1) && Array.isArray(g2)) {
                try {
                  const pt1 = leafletMap.latLngToContainerPoint([g1[0], g1[1]]);
                  const pt2 = leafletMap.latLngToContainerPoint([g2[0], g2[1]]);
                  x1 = pt1.x;
                  y1 = pt1.y;
                  x2 = pt2.x;
                  y2 = pt2.y;
                } catch {
                  // Fallback
                }
              }
            }

            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
          }
        } else if (shape.type === "arrow" && Array.isArray(coords)) {
          const p1 = coords[0];
          const p2 = coords[1];
          if (Array.isArray(p1) && Array.isArray(p2)) {
            let fromX = p1[0];
            let fromY = p1[1];
            let toX = p2[0];
            let toY = p2[1];

            if (
              leafletMap &&
              Array.isArray(shape.properties.geoCoordinates) &&
              shape.properties.geoCoordinates.length >= 2
            ) {
              const [g1, g2] = shape.properties.geoCoordinates;
              if (Array.isArray(g1) && Array.isArray(g2)) {
                try {
                  const pt1 = leafletMap.latLngToContainerPoint([g1[0], g1[1]]);
                  const pt2 = leafletMap.latLngToContainerPoint([g2[0], g2[1]]);
                  fromX = pt1.x;
                  fromY = pt1.y;
                  toX = pt2.x;
                  toY = pt2.y;
                } catch {
                  // Fallback
                }
              }
            }

            // Draw line
            ctx.beginPath();
            ctx.moveTo(fromX, fromY);
            ctx.lineTo(toX, toY);
            ctx.stroke();

            // Draw arrowhead
            const headlen = 14;
            const angle = Math.atan2(toY - fromY, toX - fromX);
            ctx.beginPath();
            ctx.moveTo(toX, toY);
            ctx.lineTo(
              toX - headlen * Math.cos(angle - Math.PI / 6),
              toY - headlen * Math.sin(angle - Math.PI / 6),
            );
            ctx.moveTo(toX, toY);
            ctx.lineTo(
              toX - headlen * Math.cos(angle + Math.PI / 6),
              toY - headlen * Math.sin(angle + Math.PI / 6),
            );
            ctx.stroke();
          }
        } else if (shape.type === "text" && Array.isArray(coords)) {
          let x = typeof coords[0] === "number" ? coords[0] : 100;
          let y = typeof coords[1] === "number" ? coords[1] : 100;

          if (
            leafletMap &&
            Array.isArray(shape.properties.geoCoordinates) &&
            typeof shape.properties.geoCoordinates[0] === "number" &&
            typeof shape.properties.geoCoordinates[1] === "number"
          ) {
            try {
              const pt = leafletMap.latLngToContainerPoint([
                shape.properties.geoCoordinates[0],
                shape.properties.geoCoordinates[1],
              ]);
              x = pt.x;
              y = pt.y;
            } catch {
              // Fallback
            }
          }

          const text = shape.properties.text || "Anotasi Lapangan";
          const fontSize = shape.properties.fontSize || 14;

          ctx.font = `bold ${fontSize}px sans-serif`;
          ctx.fillStyle = shape.properties.color || "#ffffff";

          // Shadow for contrast
          ctx.shadowColor = "rgba(0,0,0,0.8)";
          ctx.shadowBlur = 4;
          ctx.fillText(text, x, y);
          ctx.shadowBlur = 0;
        } else if (shape.type === "polygon" && Array.isArray(coords)) {
          let pts: { x: number; y: number }[] = [];

          if (
            leafletMap &&
            Array.isArray(shape.properties.geoCoordinates) &&
            shape.properties.geoCoordinates.length >= 3
          ) {
            for (const g of shape.properties.geoCoordinates) {
              if (Array.isArray(g) && g.length >= 2) {
                try {
                  const pt = leafletMap.latLngToContainerPoint([g[0], g[1]]);
                  pts.push({ x: pt.x, y: pt.y });
                } catch {
                  // Fallback
                }
              }
            }
          }

          if (pts.length < 3 && Array.isArray(coords)) {
            pts = coords
              .filter((c): c is [number, number] => Array.isArray(c) && c.length >= 2)
              .map((c) => ({ x: c[0], y: c[1] }));
          }

          if (pts.length >= 3) {
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) {
              ctx.lineTo(pts[i].x, pts[i].y);
            }
            ctx.closePath();
            if (shape.properties.fillColor) {
              ctx.fill();
            }
            ctx.stroke();
          }
        }
      }
      ctx.restore();
    }

    // Draw temporary preview shape during drag
    if (isDrawing && startPos && currentPos && selectedTool !== "select") {
      ctx.save();
      ctx.strokeStyle = selectedColor;
      ctx.lineWidth = strokeWidth;
      ctx.setLineDash([4, 4]);

      const x = Math.min(startPos.x, currentPos.x);
      const y = Math.min(startPos.y, currentPos.y);
      const w = Math.abs(currentPos.x - startPos.x);
      const h = Math.abs(currentPos.y - startPos.y);

      if (selectedTool === "rectangle") {
        ctx.strokeRect(x, y, w, h);
      } else if (selectedTool === "circle") {
        const radius = Math.sqrt(w * w + h * h) / 2;
        ctx.beginPath();
        ctx.arc(
          (startPos.x + currentPos.x) / 2,
          (startPos.y + currentPos.y) / 2,
          radius,
          0,
          2 * Math.PI,
        );
        ctx.stroke();
      } else if (selectedTool === "line" || selectedTool === "arrow") {
        ctx.beginPath();
        ctx.moveTo(startPos.x, startPos.y);
        ctx.lineTo(currentPos.x, currentPos.y);
        ctx.stroke();
      }
      ctx.restore();
    }
  }, [
    layers,
    isDrawing,
    startPos,
    currentPos,
    selectedTool,
    selectedColor,
    strokeWidth,
    leafletMap,
  ]);

  // Sinkronisasikan render kanvas overlay saat peta Leaflet digeser atau di-zoom
  useEffect(() => {
    if (!leafletMap) return;

    const handleMapTransform = () => {
      setLayers((prev) => [...prev]);
    };

    leafletMap.on("move", handleMapTransform);
    leafletMap.on("zoom", handleMapTransform);
    leafletMap.on("viewreset", handleMapTransform);
    leafletMap.on("resize", handleMapTransform);

    return () => {
      leafletMap.off("move", handleMapTransform);
      leafletMap.off("zoom", handleMapTransform);
      leafletMap.off("viewreset", handleMapTransform);
      leafletMap.off("resize", handleMapTransform);
    };
  }, [leafletMap]);

  // Handle canvas mouse events for drawing shapes
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (selectedTool === "select" || !activeLayerId) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setIsDrawing(true);
    setStartPos({ x, y });
    setCurrentPos({ x, y });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    setCurrentPos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  const handleMouseUp = () => {
    if (!isDrawing || !startPos || !currentPos || !activeLayerId) {
      setIsDrawing(false);
      return;
    }

    const w = Math.abs(currentPos.x - startPos.x);
    const h = Math.abs(currentPos.y - startPos.y);

    let newShape: DrawingShape | null = null;
    const shapeId = `shape-${Date.now()}`;

    if (selectedTool === "rectangle" && (w > 5 || h > 5)) {
      const minX = Math.min(startPos.x, currentPos.x);
      const minY = Math.min(startPos.y, currentPos.y);
      let geoCoordinates: [number, number][] | undefined = undefined;

      if (leafletMap) {
        try {
          const nw = leafletMap.containerPointToLatLng([minX, minY]);
          const se = leafletMap.containerPointToLatLng([minX + w, minY + h]);
          geoCoordinates = [
            [nw.lat, nw.lng],
            [se.lat, se.lng],
          ];
        } catch {
          // Fallback
        }
      }

      newShape = {
        id: shapeId,
        type: "rectangle",
        coordinates: [minX, minY],
        properties: {
          width: w,
          height: h,
          color: selectedColor,
          fillColor: `${selectedColor}22`,
          strokeWidth,
          geoCoordinates,
        },
      };
    } else if (selectedTool === "circle" && (w > 5 || h > 5)) {
      const cx = (startPos.x + currentPos.x) / 2;
      const cy = (startPos.y + currentPos.y) / 2;
      const radius = Math.round(Math.sqrt(w * w + h * h) / 2);
      let geoCoordinates: [number, number] | undefined = undefined;
      let geoRadius: number | undefined = undefined;

      if (leafletMap) {
        try {
          const centerLatLng = leafletMap.containerPointToLatLng([cx, cy]);
          const edgeLatLng = leafletMap.containerPointToLatLng([cx + radius, cy]);
          geoCoordinates = [centerLatLng.lat, centerLatLng.lng];
          geoRadius = Math.round(centerLatLng.distanceTo(edgeLatLng));
        } catch {
          // Fallback
        }
      }

      newShape = {
        id: shapeId,
        type: "circle",
        coordinates: [cx, cy],
        properties: {
          radius,
          color: selectedColor,
          fillColor: `${selectedColor}22`,
          strokeWidth,
          geoCoordinates,
          geoRadius,
        },
      };
    } else if (selectedTool === "line") {
      let geoCoordinates: [number, number][] | undefined = undefined;

      if (leafletMap) {
        try {
          const p1 = leafletMap.containerPointToLatLng([startPos.x, startPos.y]);
          const p2 = leafletMap.containerPointToLatLng([currentPos.x, currentPos.y]);
          geoCoordinates = [
            [p1.lat, p1.lng],
            [p2.lat, p2.lng],
          ];
        } catch {
          // Fallback
        }
      }

      newShape = {
        id: shapeId,
        type: "line",
        coordinates: [
          [startPos.x, startPos.y],
          [currentPos.x, currentPos.y],
        ],
        properties: {
          color: selectedColor,
          strokeWidth,
          geoCoordinates,
        },
      };
    } else if (selectedTool === "arrow") {
      let geoCoordinates: [number, number][] | undefined = undefined;

      if (leafletMap) {
        try {
          const p1 = leafletMap.containerPointToLatLng([startPos.x, startPos.y]);
          const p2 = leafletMap.containerPointToLatLng([currentPos.x, currentPos.y]);
          geoCoordinates = [
            [p1.lat, p1.lng],
            [p2.lat, p2.lng],
          ];
        } catch {
          // Fallback
        }
      }

      newShape = {
        id: shapeId,
        type: "arrow",
        coordinates: [
          [startPos.x, startPos.y],
          [currentPos.x, currentPos.y],
        ],
        properties: {
          color: selectedColor,
          strokeWidth,
          geoCoordinates,
        },
      };
    } else if (selectedTool === "text") {
      const text = prompt("Masukkan catatan teks lapangan:", "Catatan Jalur ODP");
      if (text) {
        let geoCoordinates: [number, number] | undefined = undefined;

        if (leafletMap) {
          try {
            const pt = leafletMap.containerPointToLatLng([startPos.x, startPos.y]);
            geoCoordinates = [pt.lat, pt.lng];
          } catch {
            // Fallback
          }
        }

        newShape = {
          id: shapeId,
          type: "text",
          coordinates: [startPos.x, startPos.y],
          properties: {
            text,
            color: selectedColor,
            fontSize: 14,
            geoCoordinates,
          },
        };
      }
    }

    if (newShape) {
      setLayers((prev) =>
        prev.map((l) =>
          l.id === activeLayerId
            ? { ...l, shapes: [...(Array.isArray(l.shapes) ? l.shapes : []), newShape!] }
            : l,
        ),
      );
    }

    setIsDrawing(false);
    setStartPos(null);
    setCurrentPos(null);
  };

  // Callback penambahan bentuk baru dari kanvas
  const handleShapeCreated = useCallback(
    (newShape: DrawingShape) => {
      if (!activeLayerId) return;
      setLayers((prev) =>
        prev.map((l) =>
          l.id === activeLayerId
            ? {
                ...l,
                shapes: [...(Array.isArray(l.shapes) ? l.shapes : []), newShape],
              }
            : l,
        ),
      );
      setSelectedShapeId(newShape.id);
      setHasUnsavedChanges(true);
    },
    [activeLayerId],
  );

  // Callback pembaruan bentuk (drag-move) dari kanvas
  const handleShapeUpdated = useCallback(
    (updatedShape: DrawingShape) => {
      if (!activeLayerId) return;
      setLayers((prev) =>
        prev.map((l) =>
          l.id === activeLayerId
            ? {
                ...l,
                shapes: (Array.isArray(l.shapes) ? l.shapes : []).map((s) =>
                  s.id === updatedShape.id ? updatedShape : s,
                ),
              }
            : l,
        ),
      );
      setHasUnsavedChanges(true);
    },
    [activeLayerId],
  );

  // Callback penghapusan bentuk dari kanvas
  const handleShapeDeleted = useCallback(
    (shapeId: string) => {
      if (!activeLayerId) return;
      setLayers((prev) =>
        prev.map((l) =>
          l.id === activeLayerId
            ? {
                ...l,
                shapes: (Array.isArray(l.shapes) ? l.shapes : []).filter(
                  (s) => s.id !== shapeId,
                ),
              }
            : l,
        ),
      );
      setSelectedShapeId((prev) => (prev === shapeId ? null : prev));
      setHasUnsavedChanges(true);
    },
    [activeLayerId],
  );

  // Buka dialog pembuatan teks label baru dari klik kanvas
  const handleRequestCreateText = useCallback(
    (pos: { x: number; y: number; latLng?: [number, number] }) => {
      setTextDialogState({
        isOpen: true,
        isEditing: false,
        x: pos.x,
        y: pos.y,
        latLng: pos.latLng,
        initialText: "",
        initialFontSize: 14,
        initialColor: selectedColor,
        initialFillColor: "rgba(15, 23, 42, 0.85)",
      });
    },
    [selectedColor],
  );

  // Buka dialog pengeditan teks label yang sudah ada
  const handleRequestEditText = useCallback(
    (shape: DrawingShape) => {
      const coords = shape.coordinates;
      const x = typeof coords[0] === "number" ? coords[0] : 0;
      const y = typeof coords[1] === "number" ? coords[1] : 0;
      setTextDialogState({
        isOpen: true,
        isEditing: true,
        shapeId: shape.id,
        x,
        y,
        initialText: shape.properties.text || "",
        initialFontSize: shape.properties.fontSize || 14,
        initialColor: shape.properties.color || selectedColor,
        initialFillColor:
          shape.properties.fillColor || "rgba(15, 23, 42, 0.85)",
      });
    },
    [selectedColor],
  );

  // Simpan data teks dari dialog (buat baru atau perbarui teks yang ada)
  const handleSaveTextFromDialog = useCallback(
    (data: {
      text: string;
      fontSize: number;
      color: string;
      fillColor?: string;
    }) => {
      if (textDialogState.isEditing && textDialogState.shapeId) {
        const existingShape = activeLayer?.shapes?.find(
          (s) => s.id === textDialogState.shapeId,
        );
        if (existingShape) {
          const updatedShape: DrawingShape = {
            ...existingShape,
            properties: {
              ...existingShape.properties,
              text: data.text,
              fontSize: data.fontSize,
              color: data.color,
              fillColor: data.fillColor,
            },
          };
          handleShapeUpdated(updatedShape);
        }
      } else {
        const shapeId = `shape-${crypto.randomUUID()}`;
        const newShape: DrawingShape = {
          id: shapeId,
          type: "text",
          coordinates: [textDialogState.x, textDialogState.y],
          properties: {
            text: data.text,
            fontSize: data.fontSize,
            color: data.color,
            fillColor: data.fillColor,
            geoCoordinates: textDialogState.latLng,
          },
        };
        handleShapeCreated(newShape);
      }
      setTextDialogState((prev) => ({ ...prev, isOpen: false }));
    },
    [textDialogState, activeLayer, handleShapeUpdated, handleShapeCreated],
  );

  // Handler untuk memperbarui properti bentuk (warna, strokeWidth, dimensi)
  const handleUpdateShapeProperties = useCallback(
    (shapeId: string, updates: Partial<DrawingShape["properties"]>) => {
      if (!activeLayerId) return;
      setLayers((prev) =>
        prev.map((l) => {
          if (l.id !== activeLayerId) return l;
          const shapes = Array.isArray(l.shapes) ? l.shapes : [];
          return {
            ...l,
            shapes: shapes.map((s) => {
              if (s.id !== shapeId) return s;
              return {
                ...s,
                properties: {
                  ...s.properties,
                  ...updates,
                },
              };
            }),
          };
        }),
      );
      setHasUnsavedChanges(true);
    },
    [activeLayerId],
  );

  // Handler duplikasi bentuk dengan offset visual (+24px, +24px)
  const handleDuplicateShape = useCallback(
    (shapeId: string) => {
      if (!activeLayerId) return;
      const currentLayer = layers.find((l) => l.id === activeLayerId);
      const targetShape = currentLayer?.shapes?.find((s) => s.id === shapeId);
      if (!targetShape) return;

      const duplicated = moveShapeByOffset(targetShape, 24, 24, leafletMap);
      const newShape: DrawingShape = {
        ...duplicated,
        id: `shape-${crypto.randomUUID()}`,
      };
      handleShapeCreated(newShape);
      setFeedback({
        type: "success",
        message: `Bentuk "${targetShape.type}" berhasil diduplikasi!`,
      });
    },
    [activeLayerId, layers, leafletMap, handleShapeCreated],
  );

  // Pintasan keyboard untuk menghapus bentuk terpilih (Delete / Backspace / Escape) & Duplikasi (Ctrl+D / Cmd+D)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      ) {
        return;
      }

      // Duplikasi via Ctrl+D atau Cmd+D
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        if (selectedShapeId) {
          e.preventDefault();
          handleDuplicateShape(selectedShapeId);
          return;
        }
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedShapeId) {
          handleShapeDeleted(selectedShapeId);
        }
      } else if (e.key === "Escape") {
        setSelectedShapeId(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedShapeId, handleShapeDeleted, handleDuplicateShape]);

  // Add new drawing layer
  const handleCreateLayer = async (name: string, description?: string) => {
    if (!name.trim()) return;

    try {
      const res = await fetch("/api/map/drawing-layers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description?.trim() || undefined,
          zIndex: layers.length + 1,
          opacity: 1.0,
          isVisible: true,
          shapes: [],
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Gagal membuat lapisan");
      }

      setLayers((prev) => [...prev, json.data]);
      setActiveLayerId(json.data.id);
      setFeedback({ type: "success", message: `Lapisan "${json.data.name}" berhasil dibuat!` });
    } catch (err) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Gagal membuat lapisan",
      });
    }
  };

  // Update layer properties in state
  const handleUpdateLayer = (layerId: string, updates: Partial<MapDrawingLayer>) => {
    setLayers((prev) =>
      prev.map((l) => (l.id === layerId ? { ...l, ...updates } : l)),
    );
    setHasUnsavedChanges(true);
  };

  // Duplicate layer with its shapes
  const handleDuplicateLayer = async (layerId: string) => {
    const target = layers.find((l) => l.id === layerId);
    if (!target) return;

    try {
      const res = await fetch("/api/map/drawing-layers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${target.name} (Salinan)`,
          description: target.description || undefined,
          zIndex: layers.length + 1,
          opacity: Number(target.opacity) || 1.0,
          isVisible: true,
          shapes: target.shapes || [],
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Gagal menduplikasi lapisan");
      }

      setLayers((prev) => [...prev, json.data]);
      setActiveLayerId(json.data.id);
      setFeedback({
        type: "success",
        message: `Lapisan "${json.data.name}" berhasil diduplikasi!`,
      });
    } catch (err) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Gagal menduplikasi lapisan",
      });
    }
  };

  // Toggle visibility of all layers
  const handleToggleAllVisibility = (visible: boolean) => {
    setLayers((prev) => prev.map((l) => ({ ...l, isVisible: visible })));
    setHasUnsavedChanges(true);
  };

  // Handler pengaturan urutan lapisan (reorder z-index & urutan visual)
  const handleReorderLayers = useCallback((reordered: MapDrawingLayer[]) => {
    setLayers(reordered);
    setHasUnsavedChanges(true);
  }, []);

  // Clear all shapes in active layer
  const handleClearActiveLayerShapes = () => {
    if (!activeLayerId) return;
    setLayers((prev) =>
      prev.map((l) => (l.id === activeLayerId ? { ...l, shapes: [] } : l)),
    );
    setHasUnsavedChanges(true);
  };

  // Muat ulang seluruh lapisan dari backend PostgreSQL nyata
  const handleReloadLayers = async () => {
    if (
      hasUnsavedChanges &&
      !confirm(
        "Terdapat perubahan bentuk atau lapisan yang belum disimpan. Yakin ingin memuat ulang dari server PostgreSQL?",
      )
    ) {
      return;
    }

    setIsReloading(true);
    setFeedback(null);

    try {
      const res = await fetch("/api/map/drawing-layers");
      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Gagal memuat ulang lapisan");
      }

      const reloadedLayers: MapDrawingLayer[] = json.data || [];
      setLayers(reloadedLayers);

      if (
        activeLayerId &&
        !reloadedLayers.some((l) => l.id === activeLayerId)
      ) {
        setActiveLayerId(reloadedLayers[0]?.id || null);
      }

      setHasUnsavedChanges(false);
      setLastSavedAt(new Date());
      setLoadError(null);
      setFeedback({
        type: "success",
        message: `${reloadedLayers.length} lapisan gambar berhasil dimuat ulang dari PostgreSQL operasional!`,
      });
    } catch (err) {
      const errMsg =
        err instanceof Error
          ? err.message
          : "Gagal memuat ulang lapisan gambar dari server PostgreSQL";
      setLoadError(errMsg);
      setFeedback({
        type: "error",
        message: errMsg,
      });
    } finally {
      setIsReloading(false);
    }
  };

  // Simpan seluruh lapisan ke PostgreSQL backend secara batch (Fase 5 - Simpan & Muat Lapisan)
  const handleSaveAllLayers = async () => {
    setIsSaving(true);
    setFeedback(null);

    try {
      const res = await fetch("/api/map/drawing-layers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          layers: layers.map((layer) => ({
            id: layer.id,
            name: layer.name,
            description: layer.description || null,
            opacity: Number(layer.opacity),
            zIndex: layer.zIndex,
            isVisible: layer.isVisible,
            shapes: layer.shapes,
          })),
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Gagal menyimpan seluruh lapisan");
      }

      setHasUnsavedChanges(false);
      setLastSavedAt(new Date());
      setFeedback({
        type: "success",
        message: "Seluruh lapisan gambar berhasil disimpan ke PostgreSQL operasional!",
      });
    } catch (err) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Gagal menyimpan ke server",
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Delete layer
  const handleDeleteLayer = async (layerId: string) => {
    if (!confirm("Hapus lapisan gambar ini dari server?")) return;

    try {
      const res = await fetch(`/api/map/drawing-layers/${layerId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Gagal menghapus lapisan");
      }

      setLayers((prev) => prev.filter((l) => l.id !== layerId));
      if (activeLayerId === layerId) {
        setActiveLayerId(layers.find((l) => l.id !== layerId)?.id ?? null);
      }
      setFeedback({ type: "success", message: "Lapisan berhasil dihapus dari server." });
    } catch (err) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Gagal menghapus lapisan",
      });
    }
  };

  const totalShapesCount = layers.reduce(
    (acc, l) => acc + (Array.isArray(l.shapes) ? l.shapes.length : 0),
    0,
  );

  const selectedShape =
    activeLayer?.shapes?.find((s) => s.id === selectedShapeId) || null;

  return (
    <div
      className="flex w-full flex-col gap-3.5"
      data-testid="drawing-layer-map-board"
    >
      {/* Header Bar dengan Indikator Sumber Data Nyata & Navigasi Modul */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl text-foreground flex items-center gap-2">
              <Layers className="size-5 text-indigo-500" />
              Lapisan Gambar &amp; Anotasi Peta
            </h1>
            <Badge
              variant="outline"
              className="text-xs gap-1 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5 font-medium"
              data-testid="data-source-badge"
            >
              <Database className="size-3" />
              PostgreSQL Live
            </Badge>

            {/* Status Sinkronisasi Lapisan Gambar */}
            <Badge
              variant="outline"
              className={`text-xs gap-1 font-medium transition-colors ${
                hasUnsavedChanges
                  ? "border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10"
                  : "border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5"
              }`}
              data-testid="sync-status-badge"
              data-unsaved={hasUnsavedChanges ? "true" : "false"}
            >
              {hasUnsavedChanges ? (
                <>
                  <span className="size-1.5 rounded-full bg-amber-500 animate-ping" />
                  <span>Perubahan Belum Disimpan</span>
                </>
              ) : (
                <>
                  <Check className="size-3" />
                  <span>
                    {lastSavedAt
                      ? `Tersimpan ${lastSavedAt.toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}`
                      : "Tersimpan di DB"}
                  </span>
                </>
              )}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Lapisan anotasi vektor 2D LeaferJS di atas peta geografis riil untuk catatan teknisi lapangan, perencanaan ODP, dan penandaan insiden.
          </p>
        </div>

        {/* Action Controls & Module Shortcuts */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Tombol Muat Ulang Lapisan dari Backend Nyata */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs font-medium"
            onClick={handleReloadLayers}
            disabled={isReloading || isSaving}
            data-testid="reload-layers-button"
            title="Muat ulang seluruh lapisan gambar dari server PostgreSQL"
          >
            <RefreshCw
              className={`size-3.5 ${
                isReloading ? "animate-spin text-primary" : ""
              }`}
            />
            <span>Muat Ulang</span>
          </Button>

          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs font-medium"
            data-testid="shortcut-main-map-link"
          >
            <Link href="/app/peta" title="Kembali ke peta infrastruktur utama">
              <Server className="size-3.5 text-primary" />
              <span>Peta Utama</span>
            </Link>
          </Button>

          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs font-medium"
            data-testid="shortcut-cable-map-link"
          >
            <Link href="/app/peta/kabel" title="Buka peta jalur kabel optik">
              <Share2 className="size-3.5 text-cyan-500 rotate-45" />
              <span>Jalur Kabel</span>
            </Link>
          </Button>

          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs font-medium"
            data-testid="shortcut-topology-link"
          >
            <Link href="/app/topologi" title="Buka pohon relasi bertingkat">
              <Share2 className="size-3.5 text-purple-500 rotate-90" />
              <span>Susunan Bertingkat</span>
            </Link>
          </Button>

          <Button
            variant="default"
            size="sm"
            className="h-8 gap-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-700 text-white"
            onClick={handleSaveAllLayers}
            disabled={isSaving}
            data-testid="save-layers-button"
          >
            {isSaving ? (
              <RefreshCw className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            <span>Simpan Lapisan</span>
          </Button>
        </div>
      </div>

      {/* Banner Pesan Gagal Muat Lapisan dengan Jelas (Fase 5) */}
      {loadError && (
        <div
          role="alert"
          className="p-3 text-xs rounded-md border border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shadow-xs"
          data-testid="layer-load-error-banner"
        >
          <div className="flex items-start sm:items-center gap-2">
            <AlertTriangle className="size-4 shrink-0 text-red-500" />
            <div className="flex flex-col sm:flex-row sm:items-center gap-1">
              <span className="font-semibold text-foreground">
                Gagal Memuat Lapisan:
              </span>
              <span className="text-red-600 dark:text-red-400">
                {loadError}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 self-end sm:self-auto shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[11px] border-red-500/40 text-red-600 hover:bg-red-500/10 flex items-center gap-1"
              onClick={handleReloadLayers}
              disabled={isReloading}
              data-testid="retry-load-layers-button"
            >
              <RefreshCw
                className={`size-2.5 ${isReloading ? "animate-spin" : ""}`}
              />
              <span>{isReloading ? "Memuat..." : "Coba Muat Ulang"}</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-red-500 hover:bg-red-500/20"
              onClick={() => setLoadError(null)}
              title="Tutup pesan kesalahan"
              data-testid="dismiss-load-error-button"
            >
              <X className="size-3" />
            </Button>
          </div>
        </div>
      )}

      {/* Feedback Banner */}
      {feedback && (
        <div
          role="alert"
          className={`px-3 py-2 text-xs rounded-md border flex items-center justify-between ${
            feedback.type === "success"
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400"
              : "bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400"
          }`}
          data-testid="feedback-alert"
        >
          <div className="flex items-center gap-2">
            {feedback.type === "success" ? (
              <Check className="size-4 shrink-0" />
            ) : (
              <AlertCircle className="size-4 shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
        </div>
      )}

      {/* Metrik Ringkasan Data Nyata */}
      <div
        className="grid grid-cols-2 sm:grid-cols-4 gap-2.5"
        data-testid="drawing-metrics-grid"
      >
        <Card className="p-3 bg-card/60 backdrop-blur-xs shadow-xs" data-testid="metric-total-layers">
          <CardContent className="p-0 flex items-center gap-2.5">
            <div className="p-2 rounded-md bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
              <Layers className="size-4" />
            </div>
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">Total Lapisan</p>
              <p className="text-lg font-bold text-foreground leading-none mt-0.5">{layers.length}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="p-3 bg-card/60 backdrop-blur-xs shadow-xs" data-testid="metric-total-shapes">
          <CardContent className="p-0 flex items-center gap-2.5">
            <div className="p-2 rounded-md bg-purple-500/10 text-purple-600 dark:text-purple-400">
              <Square className="size-4" />
            </div>
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">Objek / Bentuk</p>
              <p className="text-lg font-bold text-foreground leading-none mt-0.5">{totalShapesCount}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="p-3 bg-card/60 backdrop-blur-xs shadow-xs" data-testid="metric-real-devices">
          <CardContent className="p-0 flex items-center gap-2.5">
            <div className="p-2 rounded-md bg-cyan-500/10 text-cyan-600 dark:text-cyan-400">
              <Server className="size-4" />
            </div>
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">Perangkat Dasar</p>
              <p className="text-lg font-bold text-foreground leading-none mt-0.5">
                {initialMapData.summary.totalDevices}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="p-3 bg-card/60 backdrop-blur-xs shadow-xs" data-testid="metric-real-customers">
          <CardContent className="p-0 flex items-center gap-2.5">
            <div className="p-2 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Users className="size-4" />
            </div>
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">Pelanggan Aktif</p>
              <p className="text-lg font-bold text-foreground leading-none mt-0.5">
                {initialMapData.summary.onlineCustomers}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Workspace: Peta Dasar + Kanvas Anotasi + Sidebar Kelola Lapisan */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3.5">
        {/* Kolom Peta & Kanvas Gambar (3 Kolom di Layar Lebar) */}
        <div className="lg:col-span-3 flex flex-col gap-2">
          {/* Toolbar Alat Gambar Vektor 2D */}
          <DrawingToolbar
            selectedTool={selectedTool}
            onSelectTool={setSelectedTool}
            selectedColor={selectedColor}
            onSelectColor={setSelectedColor}
            strokeWidth={strokeWidth}
            onSelectStrokeWidth={setStrokeWidth}
            availableColors={AVAILABLE_COLORS}
            activeLayerName={activeLayer?.name}
            shapesCount={activeLayer?.shapes ? activeLayer.shapes.length : 0}
            onClearActiveLayerShapes={handleClearActiveLayerShapes}
          />

          {/* Area Kanvas: Peta Dasar Leaflet + Kanvas Gambar Overlay */}
          <div
            className="relative w-full h-[580px] rounded-lg border overflow-hidden bg-background shadow-xs"
            data-testid="drawing-canvas-container"
          >
            {/* Peta Geografis Dasar Leaflet */}
            <div className="absolute inset-0 z-0">
              <NetworkMapLeafletLoader
                initialData={{
                  customers: initialMapData.customers,
                  infrastructure: initialMapData.infrastructure,
                  summary: {
                    totalCustomers: initialMapData.summary.totalCustomers,
                    geocodedCustomers: initialMapData.summary.geocodedCustomers,
                    onlineCustomers: initialMapData.summary.onlineCustomers,
                    offlineCustomers: initialMapData.summary.offlineCustomers,
                    criticalOpticsCount: initialMapData.summary.criticalOpticsCount,
                    totalOlts: initialMapData.summary.totalOlts,
                    totalRouters: initialMapData.summary.totalRouters,
                    totalOdps: initialMapData.summary.totalOdps,
                  },
                  dataSource: initialMapData.dataSource,
                }}
                onMapReady={setLeafletMap}
              />
            </div>

            {/* Kanvas Overlay LeaferJS Anotasi 2D Terintegrasi di Atas Peta Leaflet */}
            <LeaferCanvasOverlay
              layers={layers}
              activeLayerId={activeLayerId}
              selectedTool={selectedTool}
              selectedColor={selectedColor}
              strokeWidth={strokeWidth}
              leafletMapInstance={leafletMap}
              selectedShapeId={selectedShapeId}
              onSelectShape={setSelectedShapeId}
              onShapeCreated={handleShapeCreated}
              onShapeUpdated={handleShapeUpdated}
              onShapeDeleted={handleShapeDeleted}
              onRequestCreateText={handleRequestCreateText}
              onEditShape={handleRequestEditText}
              onCursorCoordinatesChange={setCursorCoordinates}
              onDrawingDimensionsChange={setDrawingDimensions}
            />

            {/* Kanvas Overlay Gambar Anotasi 2D Utama */}
            <canvas
              ref={canvasRef}
              className={`absolute inset-0 z-10 w-full h-full ${
                selectedTool === "select" ? "pointer-events-none" : "cursor-crosshair pointer-events-auto"
              }`}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              data-testid="leafer-drawing-canvas"
            />

            {/* Indikator Alat Aktif & Kursor HUD (Fase 5 - Tampilkan Indikator Alat Aktif & Kursor) */}
            <DrawingActiveToolIndicator
              selectedTool={selectedTool}
              onSelectTool={setSelectedTool}
              activeLayerName={activeLayer?.name}
              selectedColor={selectedColor}
              strokeWidth={strokeWidth}
              cursorCoordinates={cursorCoordinates}
              drawingDimensions={drawingDimensions}
            />

            {/* Panel Modifikasi & Inspektur Objek Terpilih (Fase 5 - Seleksi, Ubah, Duplikasi & Hapus)
                Merender panel inspector (data-testid="selected-shape-inspector") dengan kontrol:
                - edit teks (data-testid="edit-selected-text-btn")
                - hapus objek (data-testid="delete-selected-shape-btn")
                - duplikasi bentuk (data-testid="duplicate-selected-shape-btn")
                via SelectedShapeModifierPanel */}
            <SelectedShapeModifierPanel
              selectedShape={selectedShape}
              availableColors={AVAILABLE_COLORS}
              onUpdateShapeProperties={handleUpdateShapeProperties}
              onDuplicateShape={handleDuplicateShape}
              onDeleteShape={handleShapeDeleted}
              onDeselect={() => setSelectedShapeId(null)}
              onEditText={handleRequestEditText}
              leafletMapInstance={leafletMap}
            />

            {/* Info Floating saat Alat Poligon Aktif */}
            {selectedTool === "polygon" && (
              <div
                className="absolute top-12 left-2.5 z-20 px-3 py-1.5 bg-background/90 backdrop-blur-md rounded-md border text-xs shadow-md flex items-center gap-2"
                data-testid="polygon-hint-banner"
              >
                <Info className="size-3.5 text-indigo-500" />
                <span>
                  Mode Poligon Aktif: Klik pada peta untuk membuat titik area. Klik titik awal atau klik ganda untuk menyelesaikan poligon.
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar Kelola Lapisan (Layer Management Panel) */}
        <DrawingLayerManagerPanel
          layers={layers}
          activeLayerId={activeLayerId}
          onSelectActiveLayer={setActiveLayerId}
          onUpdateLayer={handleUpdateLayer}
          onReorderLayers={handleReorderLayers}
          onCreateLayer={handleCreateLayer}
          onDeleteLayer={handleDeleteLayer}
          onDuplicateLayer={handleDuplicateLayer}
          onToggleAllVisibility={handleToggleAllVisibility}
          loadError={loadError}
          onRetryLoad={handleReloadLayers}
          isReloading={isReloading}
        />
      </div>

      {/* Dialog Pembuatan & Pengeditan Teks Label Lapangan */}
      <DrawingTextDialog
        isOpen={textDialogState.isOpen}
        onClose={() =>
          setTextDialogState((prev) => ({ ...prev, isOpen: false }))
        }
        onSave={handleSaveTextFromDialog}
        initialText={textDialogState.initialText}
        initialFontSize={textDialogState.initialFontSize}
        initialColor={textDialogState.initialColor}
        initialFillColor={textDialogState.initialFillColor}
        isEditing={textDialogState.isEditing}
      />
    </div>
  );
}
