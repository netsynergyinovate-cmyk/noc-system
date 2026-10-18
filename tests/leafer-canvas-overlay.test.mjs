import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("Task: Integrasikan kanvas LeaferJS di atas peta Leaflet (Fase 5)", async (t) => {
  const overlayPath = path.join(
    process.cwd(),
    "src/components/map/leafer-canvas-overlay.tsx",
  );
  const boardPath = path.join(
    process.cwd(),
    "src/components/map/drawing-layer-map-board.tsx",
  );

  assert.ok(fs.existsSync(overlayPath), "Berkas leafer-canvas-overlay.tsx wajib tersedia");
  assert.ok(fs.existsSync(boardPath), "Berkas drawing-layer-map-board.tsx wajib tersedia");

  const overlayContent = fs.readFileSync(overlayPath, "utf-8");
  const boardContent = fs.readFileSync(boardPath, "utf-8");

  await t.test("1. Komponen LeaferCanvasOverlay Menyediakan Elemen Kanvas & Kontainer Resmi", () => {
    assert.match(
      overlayContent,
      /export function LeaferCanvasOverlay/,
      "Komponen wajib mengekspor LeaferCanvasOverlay",
    );
    assert.match(
      overlayContent,
      /data-testid="leafer-canvas-overlay"/,
      "Wajib menyertakan kontainer leafer-canvas-overlay",
    );
    assert.match(
      overlayContent,
      /data-testid="leafer-view-container"/,
      "Wajib menyertakan view container leafer-view-container",
    );
    assert.match(
      overlayContent,
      /data-testid="leafer-surface-canvas"/,
      "Wajib menyertakan kanvas permukaan leafer-surface-canvas",
    );
  });

  await t.test("2. Pengendalian Interaksi Dragging Leaflet Sesuai Mode Alat Aktif", () => {
    assert.match(
      overlayContent,
      /leafletMapInstance\.dragging\.disable\(\)/,
      "Wajib menonaktifkan dragging peta saat mode alat gambar aktif",
    );
    assert.match(
      overlayContent,
      /leafletMapInstance\.dragging\.enable\(\)/,
      "Wajib mengaktifkan kembali dragging peta saat mode pointer/select aktif",
    );
  });

  await t.test("3. Sinkronisasi Transformasi Kanvas dengan Event Peta Leaflet", () => {
    assert.match(
      overlayContent,
      /leafletMapInstance\.on\(["']move["']/,
      "Wajib memasang listener event 'move' peta Leaflet",
    );
    assert.match(
      overlayContent,
      /leafletMapInstance\.on\(["']zoom["']/,
      "Wajib memasang listener event 'zoom' peta Leaflet",
    );
    assert.match(
      overlayContent,
      /leafletMapInstance\.on\(["']resize["']/,
      "Wajib memasang listener event 'resize' peta Leaflet",
    );
  });

  await t.test("4. Integrasi Kanvas LeaferJS di Dalam DrawingLayerMapBoard di Atas Kanvas Leaflet", () => {
    assert.match(
      boardContent,
      /<LeaferCanvasOverlay/,
      "DrawingLayerMapBoard wajib menyematkan LeaferCanvasOverlay",
    );
    assert.match(
      boardContent,
      /<NetworkMapLeafletLoader[\s\S]*?<LeaferCanvasOverlay/,
      "LeaferCanvasOverlay wajib ditempatkan di atas kanvas NetworkMapLeafletLoader",
    );
    assert.match(
      boardContent,
      /onShapeCreated/,
      "DrawingLayerMapBoard wajib menyambungkan callback onShapeCreated dari LeaferCanvasOverlay",
    );
  });
});
