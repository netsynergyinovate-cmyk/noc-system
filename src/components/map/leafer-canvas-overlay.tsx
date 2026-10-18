"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import type L from "leaflet";
import type {
  MapDrawingLayer,
  DrawingShape,
  DrawingShapeType,
} from "@/db/schema/map-drawing-layers";

export interface LeaferCanvasOverlayProps {
  layers: MapDrawingLayer[];
  activeLayerId: string | null;
  selectedTool: "select" | DrawingShapeType | "delete";
  selectedColor?: string;
  strokeWidth?: number;
  leafletMapInstance?: L.Map | null;
  onShapeCreated?: (shape: DrawingShape) => void;
  onShapeUpdated?: (shape: DrawingShape) => void;
  onShapeDeleted?: (shapeId: string) => void;
  selectedShapeId?: string | null;
  onSelectShape?: (shapeId: string | null) => void;
  onRequestCreateText?: (pos: {
    x: number;
    y: number;
    latLng?: [number, number];
  }) => void;
  onEditShape?: (shape: DrawingShape) => void;
  onCursorCoordinatesChange?: (
    coords: { x: number; y: number; lat?: number; lng?: number } | null,
  ) => void;
  onDrawingDimensionsChange?: (
    dimensions: {
      width?: number;
      height?: number;
      radius?: number;
      length?: number;
    } | null,
  ) => void;
}

/**
 * Helper deteksi apakah titik layar (px, py) menyentuh atau berada di dalam bentuk tertentu
 */
function isPointInShape(
  px: number,
  py: number,
  shape: DrawingShape,
  leafletMap: L.Map | null,
  tolerance = 8,
): boolean {
  const coords = shape.coordinates;

  if (shape.type === "rectangle" && Array.isArray(coords)) {
    let x = typeof coords[0] === "number" ? coords[0] : 0;
    let y = typeof coords[1] === "number" ? coords[1] : 0;
    let w = shape.properties.width || 100;
    let h = shape.properties.height || 60;

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

    return (
      px >= x - tolerance &&
      px <= x + w + tolerance &&
      py >= y - tolerance &&
      py <= y + h + tolerance
    );
  }

  if (shape.type === "circle" && Array.isArray(coords)) {
    let cx = typeof coords[0] === "number" ? coords[0] : 0;
    let cy = typeof coords[1] === "number" ? coords[1] : 0;
    let r = shape.properties.radius || 35;

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
        cx = centerPt.x;
        cy = centerPt.y;

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

    const dist = Math.hypot(px - cx, py - cy);
    return dist <= r + tolerance;
  }

  if (
    (shape.type === "line" || shape.type === "arrow") &&
    Array.isArray(coords) &&
    coords.length >= 2
  ) {
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

      const lineLenSq = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
      if (lineLenSq === 0) return Math.hypot(px - x1, py - y1) <= tolerance;
      let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / lineLenSq;
      t = Math.max(0, Math.min(1, t));
      const projX = x1 + t * (x2 - x1);
      const projY = y1 + t * (y2 - y1);
      return Math.hypot(px - projX, py - projY) <= tolerance + (shape.properties.strokeWidth || 3);
    }
  }

  if (shape.type === "polygon" && Array.isArray(coords)) {
    let pts: [number, number][] = [];
    if (
      leafletMap &&
      Array.isArray(shape.properties.geoCoordinates) &&
      shape.properties.geoCoordinates.length >= 3
    ) {
      for (const g of shape.properties.geoCoordinates) {
        if (Array.isArray(g) && g.length >= 2) {
          try {
            const pt = leafletMap.latLngToContainerPoint([g[0], g[1]]);
            pts.push([pt.x, pt.y]);
          } catch {
            // Fallback
          }
        }
      }
    }
    if (pts.length < 3) {
      pts = coords.filter(
        (c): c is [number, number] => Array.isArray(c) && c.length >= 2,
      );
    }
    if (pts.length < 3) return false;

    // Ray casting point-in-polygon algorithm
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i][0],
        yi = pts[i][1];
      const xj = pts[j][0],
        yj = pts[j][1];
      const intersect =
        yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    if (inside) return true;

    // Proximity to any polygon edge
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const x1 = pts[j][0],
        y1 = pts[j][1];
      const x2 = pts[i][0],
        y2 = pts[i][1];
      const lineLenSq = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
      if (lineLenSq > 0) {
        let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / lineLenSq;
        t = Math.max(0, Math.min(1, t));
        if (
          Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1))) <=
          tolerance
        ) {
          return true;
        }
      }
    }
    return false;
  }

  if (shape.type === "text" && Array.isArray(coords)) {
    let x = typeof coords[0] === "number" ? coords[0] : 0;
    let y = typeof coords[1] === "number" ? coords[1] : 0;

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

    const textLen = (shape.properties.text || "Anotasi").length;
    const fontSize = shape.properties.fontSize || 14;
    const textWidth = textLen * fontSize * 0.65;
    return (
      px >= x - tolerance &&
      px <= x + textWidth + tolerance &&
      py >= y - fontSize - tolerance &&
      py <= y + tolerance
    );
  }

  return false;
}

/**
 * Komponen Integrasi Kanvas LeaferJS di Atas Peta Leaflet (Fase 5 - Lapisan Gambar LeaferJS)
 * Menempatkan kanvas anotasi vektor 2D di atas lapisan peta geografis,
 * mensinkronisasikan dragging/zoom Leaflet, menggambar bentuk (rectangle, circle, polygon, arrow, line, text),
 * serta mendukung seleksi objek, pemindahan (drag-move), dan penghapusan bentuk.
 */
export function LeaferCanvasOverlay({
  layers,
  activeLayerId,
  selectedTool,
  selectedColor = "#3b82f6",
  strokeWidth = 3,
  leafletMapInstance = null,
  onShapeCreated,
  onShapeUpdated,
  onShapeDeleted,
  selectedShapeId = null,
  onSelectShape,
  onRequestCreateText,
  onEditShape,
  onCursorCoordinatesChange,
  onDrawingDimensionsChange,
}: LeaferCanvasOverlayProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isLeaferLoaded, setIsLeaferLoaded] = useState(false);

  // State proses menggambar interaktif
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null);
  const [currentPoint, setCurrentPoint] = useState<{ x: number; y: number } | null>(null);

  // State menggambar poligon multi-titik
  const [polygonVertices, setPolygonVertices] = useState<{ x: number; y: number }[]>([]);
  const [polygonGeoVertices, setPolygonGeoVertices] = useState<[number, number][]>([]);

  // State pemindahan objek (drag-move)
  const [isDraggingShape, setIsDraggingShape] = useState(false);
  const [dragStartPoint, setDragStartPoint] = useState<{ x: number; y: number } | null>(null);
  const [initialDragShape, setInitialDragShape] = useState<DrawingShape | null>(null);

  // State hover penghapusan
  const [hoveredShapeId, setHoveredShapeId] = useState<string | null>(null);

  // 1. Kelola interaksi Dragging Leaflet berdasarkan alat aktif
  useEffect(() => {
    if (!leafletMapInstance) return;

    if (selectedTool !== "select") {
      // Saat teknisi menggunakan alat gambar atau hapus, matikan dragging peta agar kanvas dapat digambar
      try {
        leafletMapInstance.dragging.disable();
        if (leafletMapInstance.touchZoom) leafletMapInstance.touchZoom.disable();
        if (leafletMapInstance.doubleClickZoom) leafletMapInstance.doubleClickZoom.disable();
      } catch {
        // Abaikan jika map belum terinisialisasi penuh
      }
    } else {
      // Saat alat pointer/select aktif, hidupkan kembali navigasi peta
      try {
        leafletMapInstance.dragging.enable();
        if (leafletMapInstance.touchZoom) leafletMapInstance.touchZoom.enable();
        if (leafletMapInstance.doubleClickZoom) leafletMapInstance.doubleClickZoom.enable();
      } catch {
        // Abaikan
      }
    }
  }, [leafletMapInstance, selectedTool]);

  // Reset polygon vertices saat ganti tool (state adjustment during render)
  const [prevSelectedTool, setPrevSelectedTool] = useState(selectedTool);
  if (prevSelectedTool !== selectedTool) {
    setPrevSelectedTool(selectedTool);
    if (selectedTool !== "polygon") {
      setPolygonVertices([]);
      setPolygonGeoVertices([]);
    }
  }

  // 2. Inisialisasi Dinamis Pustaka LeaferJS di Sisi Klien
  useEffect(() => {
    let isMounted = true;

    async function loadLeafer() {
      if (typeof window === "undefined" || !containerRef.current) return;

      try {
        const leaferModule = await import("leafer-ui");
        if (isMounted && leaferModule?.Leafer) {
          setIsLeaferLoaded(true);
        }
      } catch (err) {
        console.warn("[LeaferCanvasOverlay] Menjalankan canvas 2D fallback renderer:", err);
        if (isMounted) setIsLeaferLoaded(true);
      }
    }

    loadLeafer();

    return () => {
      isMounted = false;
    };
  }, []);

  // 3. Render Kanvas 2D Vektor Anotasi LeaferJS
  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width;
      canvas.height = rect.height;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Urutkan layer berdasarkan z-index
    const sortedLayers = [...layers]
      .filter((l) => l.isVisible)
      .sort((a, b) => a.zIndex - b.zIndex);

    for (const layer of sortedLayers) {
      ctx.save();
      ctx.globalAlpha = Number(layer.opacity ?? 1.0);

      const shapes: DrawingShape[] = Array.isArray(layer.shapes) ? layer.shapes : [];

      for (const shape of shapes) {
        const isSelected = shape.id === selectedShapeId;
        const isHoveredForDelete = shape.id === hoveredShapeId && selectedTool === "delete";

        ctx.strokeStyle = isHoveredForDelete
          ? "#ef4444"
          : isSelected
          ? "#06b6d4"
          : shape.properties.color || "#3b82f6";
        ctx.fillStyle = isHoveredForDelete
          ? "rgba(239, 68, 68, 0.25)"
          : shape.properties.fillColor || "transparent";
        ctx.lineWidth = isSelected
          ? (shape.properties.strokeWidth || 3) + 2
          : shape.properties.strokeWidth || 3;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        const coords = shape.coordinates;

        if (shape.type === "rectangle" && Array.isArray(coords)) {
          let x = typeof coords[0] === "number" ? coords[0] : 50;
          let y = typeof coords[1] === "number" ? coords[1] : 50;
          let w = shape.properties.width || 100;
          let h = shape.properties.height || 60;

          // Proyeksikan koordinat GPS geografis ke piksel kontainer kanvas saat ini
          if (
            leafletMapInstance &&
            Array.isArray(shape.properties.geoCoordinates) &&
            shape.properties.geoCoordinates.length >= 2
          ) {
            const [g1, g2] = shape.properties.geoCoordinates;
            if (Array.isArray(g1) && Array.isArray(g2)) {
              try {
                const p1 = leafletMapInstance.latLngToContainerPoint([g1[0], g1[1]]);
                const p2 = leafletMapInstance.latLngToContainerPoint([g2[0], g2[1]]);
                x = Math.min(p1.x, p2.x);
                y = Math.min(p1.y, p2.y);
                w = Math.max(2, Math.abs(p2.x - p1.x));
                h = Math.max(2, Math.abs(p2.y - p1.y));
              } catch {
                // Gunakan koordinat piksel fallback jika proyeksi belum siap
              }
            }
          }

          if (shape.properties.fillColor || isHoveredForDelete) {
            ctx.fillRect(x, y, w, h);
          }
          ctx.strokeRect(x, y, w, h);

          // Gambar indikator seleksi aktif
          if (isSelected) {
            ctx.save();
            ctx.strokeStyle = "#06b6d4";
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 4]);
            ctx.strokeRect(x - 4, y - 4, w + 8, h + 8);
            // Titik handel sudut
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(x - 7, y - 7, 6, 6);
            ctx.fillRect(x + w + 1, y - 7, 6, 6);
            ctx.fillRect(x - 7, y + h + 1, 6, 6);
            ctx.fillRect(x + w + 1, y + h + 1, 6, 6);
            ctx.restore();
          }
        } else if (shape.type === "circle" && Array.isArray(coords)) {
          let x = typeof coords[0] === "number" ? coords[0] : 80;
          let y = typeof coords[1] === "number" ? coords[1] : 80;
          let r = shape.properties.radius || 35;

          // Proyeksikan titik pusat GPS dan radius meter ke kanvas saat ini
          if (
            leafletMapInstance &&
            Array.isArray(shape.properties.geoCoordinates) &&
            typeof shape.properties.geoCoordinates[0] === "number" &&
            typeof shape.properties.geoCoordinates[1] === "number"
          ) {
            try {
              const centerPt = leafletMapInstance.latLngToContainerPoint([
                shape.properties.geoCoordinates[0],
                shape.properties.geoCoordinates[1],
              ]);
              x = centerPt.x;
              y = centerPt.y;

              if (shape.properties.geoRadius && shape.properties.geoRadius > 0) {
                const offsetLat =
                  shape.properties.geoCoordinates[0] +
                  shape.properties.geoRadius / 111320;
                const edgePt = leafletMapInstance.latLngToContainerPoint([
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
          if (shape.properties.fillColor || isHoveredForDelete) ctx.fill();
          ctx.stroke();

          if (isSelected) {
            ctx.save();
            ctx.strokeStyle = "#06b6d4";
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.arc(x, y, r + 5, 0, 2 * Math.PI);
            ctx.stroke();
            ctx.restore();
          }
        } else if (shape.type === "line" && Array.isArray(coords) && coords.length >= 2) {
          const p1 = coords[0];
          const p2 = coords[1];
          if (Array.isArray(p1) && Array.isArray(p2)) {
            let fromX = p1[0];
            let fromY = p1[1];
            let toX = p2[0];
            let toY = p2[1];

            // Proyeksikan koordinat GPS titik awal dan akhir garis
            if (
              leafletMapInstance &&
              Array.isArray(shape.properties.geoCoordinates) &&
              shape.properties.geoCoordinates.length >= 2
            ) {
              const [g1, g2] = shape.properties.geoCoordinates;
              if (Array.isArray(g1) && Array.isArray(g2)) {
                try {
                  const pt1 = leafletMapInstance.latLngToContainerPoint([g1[0], g1[1]]);
                  const pt2 = leafletMapInstance.latLngToContainerPoint([g2[0], g2[1]]);
                  fromX = pt1.x;
                  fromY = pt1.y;
                  toX = pt2.x;
                  toY = pt2.y;
                } catch {
                  // Fallback
                }
              }
            }

            ctx.beginPath();
            ctx.moveTo(fromX, fromY);
            ctx.lineTo(toX, toY);
            ctx.stroke();

            if (isSelected) {
              ctx.save();
              ctx.fillStyle = "#06b6d4";
              ctx.beginPath();
              ctx.arc(fromX, fromY, 5, 0, 2 * Math.PI);
              ctx.arc(toX, toY, 5, 0, 2 * Math.PI);
              ctx.fill();
              ctx.restore();
            }
          }
        } else if (shape.type === "arrow" && Array.isArray(coords) && coords.length >= 2) {
          const p1 = coords[0];
          const p2 = coords[1];
          if (Array.isArray(p1) && Array.isArray(p2)) {
            let fromX = p1[0];
            let fromY = p1[1];
            let toX = p2[0];
            let toY = p2[1];

            // Proyeksikan koordinat GPS panah petunjuk arah
            if (
              leafletMapInstance &&
              Array.isArray(shape.properties.geoCoordinates) &&
              shape.properties.geoCoordinates.length >= 2
            ) {
              const [g1, g2] = shape.properties.geoCoordinates;
              if (Array.isArray(g1) && Array.isArray(g2)) {
                try {
                  const pt1 = leafletMapInstance.latLngToContainerPoint([g1[0], g1[1]]);
                  const pt2 = leafletMapInstance.latLngToContainerPoint([g2[0], g2[1]]);
                  fromX = pt1.x;
                  fromY = pt1.y;
                  toX = pt2.x;
                  toY = pt2.y;
                } catch {
                  // Fallback
                }
              }
            }

            // Garis badan panah
            ctx.beginPath();
            ctx.moveTo(fromX, fromY);
            ctx.lineTo(toX, toY);
            ctx.stroke();

            // Ujung panah tajam & terisi (solid filled arrowhead)
            const headlen = 14;
            const angle = Math.atan2(toY - fromY, toX - fromX);
            ctx.beginPath();
            ctx.moveTo(toX, toY);
            ctx.lineTo(
              toX - headlen * Math.cos(angle - Math.PI / 6),
              toY - headlen * Math.sin(angle - Math.PI / 6),
            );
            ctx.lineTo(
              toX - headlen * Math.cos(angle + Math.PI / 6),
              toY - headlen * Math.sin(angle + Math.PI / 6),
            );
            ctx.closePath();
            ctx.fillStyle = ctx.strokeStyle;
            ctx.fill();
            ctx.stroke();

            if (isSelected) {
              ctx.save();
              ctx.fillStyle = "#06b6d4";
              ctx.beginPath();
              ctx.arc(fromX, fromY, 5, 0, 2 * Math.PI);
              ctx.fill();
              ctx.restore();
            }
          }
        } else if (shape.type === "polygon" && Array.isArray(coords)) {
          let pts: { x: number; y: number }[] = [];

          if (
            leafletMapInstance &&
            Array.isArray(shape.properties.geoCoordinates) &&
            shape.properties.geoCoordinates.length >= 3
          ) {
            for (const g of shape.properties.geoCoordinates) {
              if (Array.isArray(g) && g.length >= 2) {
                try {
                  const pt = leafletMapInstance.latLngToContainerPoint([g[0], g[1]]);
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
            if (shape.properties.fillColor || isHoveredForDelete) {
              ctx.fill();
            }
            ctx.stroke();

            if (isSelected) {
              ctx.save();
              ctx.fillStyle = "#06b6d4";
              for (const p of pts) {
                ctx.beginPath();
                ctx.arc(p.x, p.y, 4.5, 0, 2 * Math.PI);
                ctx.fill();
              }
              ctx.restore();
            }
          }
        } else if (shape.type === "text" && Array.isArray(coords)) {
          let x = typeof coords[0] === "number" ? coords[0] : 60;
          let y = typeof coords[1] === "number" ? coords[1] : 60;

          // Proyeksikan koordinat GPS teks catatan lapangan
          if (
            leafletMapInstance &&
            Array.isArray(shape.properties.geoCoordinates) &&
            typeof shape.properties.geoCoordinates[0] === "number" &&
            typeof shape.properties.geoCoordinates[1] === "number"
          ) {
            try {
              const pt = leafletMapInstance.latLngToContainerPoint([
                shape.properties.geoCoordinates[0],
                shape.properties.geoCoordinates[1],
              ]);
              x = pt.x;
              y = pt.y;
            } catch {
              // Fallback
            }
          }

          const text = shape.properties.text || "Anotasi";
          const fontSize = shape.properties.fontSize || 14;

          ctx.font = `bold ${fontSize}px sans-serif`;
          const textMetrics = ctx.measureText(text);
          const textWidth = textMetrics.width;
          const paddingX = 6;
          const paddingY = 4;
          const boxX = x - paddingX;
          const boxY = y - fontSize - paddingY;
          const boxW = textWidth + paddingX * 2;
          const boxH = fontSize + paddingY * 2;

          // Render latar badge kotak teks jika ada fillColor
          const fillColor = shape.properties.fillColor;
          if (fillColor && fillColor !== "transparent") {
            ctx.fillStyle = isHoveredForDelete
              ? "rgba(239, 68, 68, 0.45)"
              : fillColor;
            ctx.strokeStyle = isSelected
              ? "#06b6d4"
              : isHoveredForDelete
              ? "#ef4444"
              : shape.properties.color || "rgba(255, 255, 255, 0.25)";
            ctx.lineWidth = isSelected ? 2 : 1;
            ctx.beginPath();
            if (typeof ctx.roundRect === "function") {
              ctx.roundRect(boxX, boxY, boxW, boxH, 4);
            } else {
              ctx.rect(boxX, boxY, boxW, boxH);
            }
            ctx.fill();
            ctx.stroke();
          }

          ctx.fillStyle = shape.properties.color || "#ffffff";
          ctx.shadowColor = "rgba(0,0,0,0.85)";
          ctx.shadowBlur = 4;
          ctx.fillText(text, x, y);
          ctx.shadowBlur = 0;

          if (isSelected) {
            ctx.save();
            ctx.strokeStyle = "#06b6d4";
            ctx.lineWidth = 1.5;
            ctx.setLineDash([3, 3]);
            ctx.strokeRect(boxX - 2, boxY - 2, boxW + 4, boxH + 4);
            ctx.restore();
          }
        }
      }
      ctx.restore();
    }

    // 4. Gambar pratinjau bentuk saat proses drag menggambar
    if (isDrawing && startPoint && currentPoint && selectedTool !== "select") {
      ctx.save();
      ctx.strokeStyle = selectedColor;
      ctx.lineWidth = strokeWidth;
      ctx.setLineDash([4, 4]);

      const x = Math.min(startPoint.x, currentPoint.x);
      const y = Math.min(startPoint.y, currentPoint.y);
      const w = Math.abs(currentPoint.x - startPoint.x);
      const h = Math.abs(currentPoint.y - startPoint.y);

      if (selectedTool === "rectangle") {
        ctx.strokeRect(x, y, w, h);
      } else if (selectedTool === "circle") {
        const radius = Math.sqrt(w * w + h * h) / 2;
        ctx.beginPath();
        ctx.arc(
          (startPoint.x + currentPoint.x) / 2,
          (startPoint.y + currentPoint.y) / 2,
          radius,
          0,
          2 * Math.PI,
        );
        ctx.stroke();
      } else if (selectedTool === "line") {
        ctx.beginPath();
        ctx.moveTo(startPoint.x, startPoint.y);
        ctx.lineTo(currentPoint.x, currentPoint.y);
        ctx.stroke();
      } else if (selectedTool === "arrow") {
        ctx.beginPath();
        ctx.moveTo(startPoint.x, startPoint.y);
        ctx.lineTo(currentPoint.x, currentPoint.y);
        ctx.stroke();

        // Ujung panah pratinjau
        const headlen = 14;
        const angle = Math.atan2(
          currentPoint.y - startPoint.y,
          currentPoint.x - startPoint.x,
        );
        ctx.beginPath();
        ctx.moveTo(currentPoint.x, currentPoint.y);
        ctx.lineTo(
          currentPoint.x - headlen * Math.cos(angle - Math.PI / 6),
          currentPoint.y - headlen * Math.sin(angle - Math.PI / 6),
        );
        ctx.lineTo(
          currentPoint.x - headlen * Math.cos(angle + Math.PI / 6),
          currentPoint.y - headlen * Math.sin(angle + Math.PI / 6),
        );
        ctx.closePath();
        ctx.stroke();
      }
      ctx.restore();
    }

    // 5. Gambar pratinjau poligon multi-titik yang sedang disusun
    if (selectedTool === "polygon" && polygonVertices.length > 0) {
      ctx.save();
      ctx.strokeStyle = selectedColor;
      ctx.lineWidth = strokeWidth;
      ctx.setLineDash([4, 4]);

      ctx.beginPath();
      ctx.moveTo(polygonVertices[0].x, polygonVertices[0].y);
      for (let i = 1; i < polygonVertices.length; i++) {
        ctx.lineTo(polygonVertices[i].x, polygonVertices[i].y);
      }
      if (currentPoint) {
        ctx.lineTo(currentPoint.x, currentPoint.y);
      }
      ctx.stroke();

      // Titik-titik verteks poligon
      ctx.fillStyle = selectedColor;
      for (let i = 0; i < polygonVertices.length; i++) {
        const v = polygonVertices[i];
        ctx.beginPath();
        ctx.arc(v.x, v.y, i === 0 ? 6 : 4, 0, 2 * Math.PI);
        ctx.fill();
        if (i === 0) {
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }, [
    layers,
    isDrawing,
    startPoint,
    currentPoint,
    selectedTool,
    selectedColor,
    strokeWidth,
    leafletMapInstance,
    selectedShapeId,
    hoveredShapeId,
    polygonVertices,
  ]);

  // Pasang listener saat peta Leaflet bergerak / zoom untuk sinkronisasi render posisi
  useEffect(() => {
    redrawCanvas();

    if (!leafletMapInstance) return;

    const handleMapTransform = () => {
      redrawCanvas();
    };

    leafletMapInstance.on("move", handleMapTransform);
    leafletMapInstance.on("zoom", handleMapTransform);
    leafletMapInstance.on("viewreset", handleMapTransform);
    leafletMapInstance.on("resize", handleMapTransform);

    return () => {
      leafletMapInstance.off("move", handleMapTransform);
      leafletMapInstance.off("zoom", handleMapTransform);
      leafletMapInstance.off("viewreset", handleMapTransform);
      leafletMapInstance.off("resize", handleMapTransform);
    };
  }, [leafletMapInstance, redrawCanvas]);

  // Dapatkan seluruh objek bentuk di lapisan aktif
  const activeLayer = layers.find((l) => l.id === activeLayerId);
  const activeShapes = activeLayer?.shapes || [];

  // 6. Mouse Event Handlers untuk Kanvas Interaktif
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!activeLayerId) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Mode Seleksi: Hit test objek yang diklik teknisi
    if (selectedTool === "select") {
      let hitShape: DrawingShape | null = null;
      for (let i = activeShapes.length - 1; i >= 0; i--) {
        if (isPointInShape(x, y, activeShapes[i], leafletMapInstance)) {
          hitShape = activeShapes[i];
          break;
        }
      }

      if (hitShape) {
        if (onSelectShape) onSelectShape(hitShape.id);
        setIsDraggingShape(true);
        setDragStartPoint({ x, y });
        setInitialDragShape(JSON.parse(JSON.stringify(hitShape)));
      } else {
        if (onSelectShape) onSelectShape(null);
      }
      return;
    }

    // Mode Penghapus: Hapus bentuk yang diklik
    if (selectedTool === "delete") {
      let hitShape: DrawingShape | null = null;
      for (let i = activeShapes.length - 1; i >= 0; i--) {
        if (isPointInShape(x, y, activeShapes[i], leafletMapInstance)) {
          hitShape = activeShapes[i];
          break;
        }
      }

      if (hitShape && onShapeDeleted) {
        onShapeDeleted(hitShape.id);
        if (selectedShapeId === hitShape.id && onSelectShape) {
          onSelectShape(null);
        }
      }
      return;
    }

    // Mode Poligon: Menambahkan titik verteks berurutan
    if (selectedTool === "polygon") {
      // Jika klik dekat dengan titik pertama (>= 3 titik), selesaikan poligon
      if (polygonVertices.length >= 3) {
        const first = polygonVertices[0];
        if (Math.hypot(x - first.x, y - first.y) < 18) {
          finishPolygon();
          return;
        }
      }

      let geoPoint: [number, number] | undefined = undefined;
      if (leafletMapInstance) {
        try {
          const latLng = leafletMapInstance.containerPointToLatLng([x, y]);
          geoPoint = [latLng.lat, latLng.lng];
        } catch {
          // Fallback
        }
      }

      setPolygonVertices((prev) => [...prev, { x, y }]);
      if (geoPoint) {
        setPolygonGeoVertices((prev) => [...prev, geoPoint!]);
      }
      return;
    }

    // Mode Menggambar Bentuk Standar (Rectangle, Circle, Line, Arrow, Text)
    setIsDrawing(true);
    setStartPoint({ x, y });
    setCurrentPoint({ x, y });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Pelacakan koordinat kursor (layar & GPS)
    let lat: number | undefined;
    let lng: number | undefined;
    if (leafletMapInstance) {
      try {
        const latLng = leafletMapInstance.containerPointToLatLng([x, y]);
        lat = latLng.lat;
        lng = latLng.lng;
      } catch {
        // Fallback
      }
    }

    if (onCursorCoordinatesChange) {
      onCursorCoordinatesChange({ x, y, lat, lng });
    }

    // Hover hit-test untuk mode delete
    if (selectedTool === "delete") {
      let hit: DrawingShape | null = null;
      for (let i = activeShapes.length - 1; i >= 0; i--) {
        if (isPointInShape(x, y, activeShapes[i], leafletMapInstance)) {
          hit = activeShapes[i];
          break;
        }
      }
      setHoveredShapeId(hit?.id || null);
      return;
    }

    // Hover hit-test untuk mode select (mengubah kursor menjadi cursor-move saat di atas objek)
    if (selectedTool === "select" && !isDraggingShape) {
      let hit: DrawingShape | null = null;
      for (let i = activeShapes.length - 1; i >= 0; i--) {
        if (isPointInShape(x, y, activeShapes[i], leafletMapInstance)) {
          hit = activeShapes[i];
          break;
        }
      }
      setHoveredShapeId(hit?.id || null);
    }

    // Pemindahan bentuk yang sedang di-drag
    if (isDraggingShape && initialDragShape && dragStartPoint && onShapeUpdated) {
      const dx = x - dragStartPoint.x;
      const dy = y - dragStartPoint.y;

      const updated = moveShapeByOffset(
        initialDragShape,
        dx,
        dy,
        leafletMapInstance,
      );
      onShapeUpdated(updated);
      return;
    }

    // Update posisi dan dimensi saat menggambar aktif
    if (isDrawing && startPoint && onDrawingDimensionsChange) {
      const dx = x - startPoint.x;
      const dy = y - startPoint.y;
      if (selectedTool === "rectangle") {
        onDrawingDimensionsChange({
          width: Math.abs(dx),
          height: Math.abs(dy),
        });
      } else if (selectedTool === "circle") {
        onDrawingDimensionsChange({
          radius: Math.round(Math.hypot(dx, dy)),
        });
      } else if (selectedTool === "arrow" || selectedTool === "line") {
        onDrawingDimensionsChange({
          length: Math.round(Math.hypot(dx, dy)),
        });
      }
    }

    // Update posisi saat menggambar aktif atau menggambar poligon
    if (isDrawing || selectedTool === "polygon") {
      setCurrentPoint({ x, y });
    }
  };

  // Selesaikan gambar poligon
  const finishPolygon = () => {
    if (polygonVertices.length < 3 || !activeLayerId || !onShapeCreated) return;

    const shapeId = `shape-${Date.now()}`;
    const newShape: DrawingShape = {
      id: shapeId,
      type: "polygon",
      coordinates: polygonVertices.map((v) => [v.x, v.y] as [number, number]),
      properties: {
        color: selectedColor,
        fillColor: `${selectedColor}22`,
        strokeWidth,
        geoCoordinates:
          polygonGeoVertices.length === polygonVertices.length
            ? polygonGeoVertices
            : undefined,
      },
    };

    onShapeCreated(newShape);
    if (onSelectShape) onSelectShape(newShape.id);
    setPolygonVertices([]);
    setPolygonGeoVertices([]);
    setCurrentPoint(null);
  };

  const handleDoubleClick = () => {
    if (selectedTool === "polygon" && polygonVertices.length >= 3) {
      finishPolygon();
    } else if (selectedTool === "select" && onEditShape && currentPoint) {
      for (let i = activeShapes.length - 1; i >= 0; i--) {
        if (
          activeShapes[i].type === "text" &&
          isPointInShape(
            currentPoint.x,
            currentPoint.y,
            activeShapes[i],
            leafletMapInstance,
          )
        ) {
          onEditShape(activeShapes[i]);
          break;
        }
      }
    }
  };

  const handleMouseUp = () => {
    // Selesaikan dragging bentuk
    if (isDraggingShape) {
      setIsDraggingShape(false);
      setDragStartPoint(null);
      setInitialDragShape(null);
      return;
    }

    if (!isDrawing || !startPoint || !currentPoint || !activeLayerId) {
      setIsDrawing(false);
      return;
    }

    const w = Math.abs(currentPoint.x - startPoint.x);
    const h = Math.abs(currentPoint.y - startPoint.y);

    let newShape: DrawingShape | null = null;
    const shapeId = `shape-${Date.now()}`;

    if (selectedTool === "rectangle" && (w > 5 || h > 5)) {
      const minX = Math.min(startPoint.x, currentPoint.x);
      const minY = Math.min(startPoint.y, currentPoint.y);
      let geoCoordinates: [number, number][] | undefined = undefined;

      if (leafletMapInstance) {
        try {
          const nw = leafletMapInstance.containerPointToLatLng([minX, minY]);
          const se = leafletMapInstance.containerPointToLatLng([minX + w, minY + h]);
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
      const cx = (startPoint.x + currentPoint.x) / 2;
      const cy = (startPoint.y + currentPoint.y) / 2;
      const radius = Math.round(Math.sqrt(w * w + h * h) / 2);
      let geoCoordinates: [number, number] | undefined = undefined;
      let geoRadius: number | undefined = undefined;

      if (leafletMapInstance) {
        try {
          const centerLatLng = leafletMapInstance.containerPointToLatLng([cx, cy]);
          const edgeLatLng = leafletMapInstance.containerPointToLatLng([cx + radius, cy]);
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

      if (leafletMapInstance) {
        try {
          const p1 = leafletMapInstance.containerPointToLatLng([startPoint.x, startPoint.y]);
          const p2 = leafletMapInstance.containerPointToLatLng([currentPoint.x, currentPoint.y]);
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
          [startPoint.x, startPoint.y],
          [currentPoint.x, currentPoint.y],
        ],
        properties: {
          color: selectedColor,
          strokeWidth,
          geoCoordinates,
        },
      };
    } else if (selectedTool === "arrow") {
      let geoCoordinates: [number, number][] | undefined = undefined;

      if (leafletMapInstance) {
        try {
          const p1 = leafletMapInstance.containerPointToLatLng([startPoint.x, startPoint.y]);
          const p2 = leafletMapInstance.containerPointToLatLng([currentPoint.x, currentPoint.y]);
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
          [startPoint.x, startPoint.y],
          [currentPoint.x, currentPoint.y],
        ],
        properties: {
          color: selectedColor,
          strokeWidth,
          geoCoordinates,
        },
      };
    } else if (selectedTool === "text") {
      let geoCoordinates: [number, number] | undefined = undefined;

      if (leafletMapInstance) {
        try {
          const pt = leafletMapInstance.containerPointToLatLng([startPoint.x, startPoint.y]);
          geoCoordinates = [pt.lat, pt.lng];
        } catch {
          // Fallback
        }
      }

      if (onRequestCreateText) {
        onRequestCreateText({
          x: startPoint.x,
          y: startPoint.y,
          latLng: geoCoordinates,
        });
      } else {
        const labelText = prompt("Catatan teks lapangan:", "Catatan Jalur ODP");
        if (labelText) {
          newShape = {
            id: shapeId,
            type: "text",
            coordinates: [startPoint.x, startPoint.y],
            properties: {
              text: labelText,
              color: selectedColor,
              fontSize: 14,
              geoCoordinates,
            },
          };
        }
      }
    }

    if (newShape && onShapeCreated) {
      onShapeCreated(newShape);
      if (onSelectShape) onSelectShape(newShape.id);
    }

    setIsDrawing(false);
    setStartPoint(null);
    setCurrentPoint(null);
    if (onDrawingDimensionsChange) {
      onDrawingDimensionsChange(null);
    }
  };

  const handleMouseLeave = () => {
    setHoveredShapeId(null);
    if (onCursorCoordinatesChange) {
      onCursorCoordinatesChange(null);
    }
    if (onDrawingDimensionsChange) {
      onDrawingDimensionsChange(null);
    }
  };

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 z-20 pointer-events-none"
      data-testid="leafer-canvas-overlay"
    >
      <div
        className="relative w-full h-full"
        data-testid="leafer-view-container"
        data-leafer-ready={isLeaferLoaded ? "true" : "false"}
      >
        <canvas
          ref={canvasRef}
          className={`absolute inset-0 w-full h-full ${
            selectedTool === "select"
              ? isDraggingShape
                ? "cursor-grabbing pointer-events-auto"
                : hoveredShapeId
                ? "cursor-move pointer-events-auto"
                : "cursor-default pointer-events-auto"
              : selectedTool === "delete"
              ? "cursor-not-allowed pointer-events-auto"
              : selectedTool === "text"
              ? "cursor-text pointer-events-auto"
              : "cursor-crosshair pointer-events-auto"
          }`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onDoubleClick={handleDoubleClick}
          onMouseLeave={handleMouseLeave}
          data-testid="leafer-surface-canvas"
        />
      </div>
    </div>
  );
}

/**
 * Pindahkan koordinat bentuk sesuai delta piksel layar dan hitung ulang geoCoordinates
 */
export function moveShapeByOffset(
  shape: DrawingShape,
  dx: number,
  dy: number,
  leafletMap: L.Map | null,
): DrawingShape {
  const cloned: DrawingShape = JSON.parse(JSON.stringify(shape));
  const coords = cloned.coordinates;

  if (cloned.type === "rectangle" && Array.isArray(coords)) {
    const origX = typeof coords[0] === "number" ? coords[0] : 0;
    const origY = typeof coords[1] === "number" ? coords[1] : 0;
    const newX = origX + dx;
    const newY = origY + dy;
    const w = cloned.properties.width || 100;
    const h = cloned.properties.height || 60;

    cloned.coordinates = [newX, newY];
    if (leafletMap) {
      try {
        const nw = leafletMap.containerPointToLatLng([newX, newY]);
        const se = leafletMap.containerPointToLatLng([newX + w, newY + h]);
        cloned.properties.geoCoordinates = [
          [nw.lat, nw.lng],
          [se.lat, se.lng],
        ];
      } catch {
        // Fallback
      }
    }
  } else if (cloned.type === "circle" && Array.isArray(coords)) {
    const origCx = typeof coords[0] === "number" ? coords[0] : 0;
    const origCy = typeof coords[1] === "number" ? coords[1] : 0;
    const newCx = origCx + dx;
    const newCy = origCy + dy;

    cloned.coordinates = [newCx, newCy];
    if (leafletMap) {
      try {
        const centerLatLng = leafletMap.containerPointToLatLng([newCx, newCy]);
        cloned.properties.geoCoordinates = [centerLatLng.lat, centerLatLng.lng];
      } catch {
        // Fallback
      }
    }
  } else if (
    (cloned.type === "line" || cloned.type === "arrow") &&
    Array.isArray(coords) &&
    coords.length >= 2
  ) {
    const p1 = coords[0];
    const p2 = coords[1];
    if (Array.isArray(p1) && Array.isArray(p2)) {
      const newP1: [number, number] = [p1[0] + dx, p1[1] + dy];
      const newP2: [number, number] = [p2[0] + dx, p2[1] + dy];
      cloned.coordinates = [newP1, newP2];

      if (leafletMap) {
        try {
          const latLng1 = leafletMap.containerPointToLatLng(newP1);
          const latLng2 = leafletMap.containerPointToLatLng(newP2);
          cloned.properties.geoCoordinates = [
            [latLng1.lat, latLng1.lng],
            [latLng2.lat, latLng2.lng],
          ];
        } catch {
          // Fallback
        }
      }
    }
  } else if (cloned.type === "polygon" && Array.isArray(coords)) {
    const newCoords: [number, number][] = [];
    const newGeo: [number, number][] = [];

    for (const c of coords) {
      if (Array.isArray(c) && c.length >= 2) {
        const pt: [number, number] = [c[0] + dx, c[1] + dy];
        newCoords.push(pt);
        if (leafletMap) {
          try {
            const latLng = leafletMap.containerPointToLatLng(pt);
            newGeo.push([latLng.lat, latLng.lng]);
          } catch {
            // Fallback
          }
        }
      }
    }

    cloned.coordinates = newCoords;
    if (newGeo.length === newCoords.length) {
      cloned.properties.geoCoordinates = newGeo;
    }
  } else if (cloned.type === "text" && Array.isArray(coords)) {
    const origX = typeof coords[0] === "number" ? coords[0] : 0;
    const origY = typeof coords[1] === "number" ? coords[1] : 0;
    const newX = origX + dx;
    const newY = origY + dy;

    cloned.coordinates = [newX, newY];
    if (leafletMap) {
      try {
        const latLng = leafletMap.containerPointToLatLng([newX, newY]);
        cloned.properties.geoCoordinates = [latLng.lat, latLng.lng];
      } catch {
        // Fallback
      }
    }
  }

  return cloned;
}
