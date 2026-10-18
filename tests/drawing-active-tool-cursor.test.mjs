import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

describe("Active Tool Indicator & Contextual Cursor Suite (Fase 5)", () => {
  const indicatorPath = path.resolve(
    process.cwd(),
    "src/components/map/drawing-active-tool-indicator.tsx",
  );
  const toolbarPath = path.resolve(
    process.cwd(),
    "src/components/map/drawing-toolbar.tsx",
  );
  const overlayPath = path.resolve(
    process.cwd(),
    "src/components/map/leafer-canvas-overlay.tsx",
  );
  const boardPath = path.resolve(
    process.cwd(),
    "src/components/map/drawing-layer-map-board.tsx",
  );

  it("1. Komponen DrawingActiveToolIndicator harus ada dan mengekspor interface serta komponen dengan benar", () => {
    assert.ok(
      fs.existsSync(indicatorPath),
      "Berkas drawing-active-tool-indicator.tsx harus ada",
    );

    const content = fs.readFileSync(indicatorPath, "utf-8");
    assert.match(
      content,
      /export interface DrawingActiveToolIndicatorProps/,
      "Wajib mengekspor interface DrawingActiveToolIndicatorProps",
    );
    assert.match(
      content,
      /export function DrawingActiveToolIndicator/,
      "Wajib mengekspor fungsi komponen DrawingActiveToolIndicator",
    );
  });

  it("2. Indikator alat aktif harus menyediakan banner status, label alat operasional ISP, dan spesifikasi kuas", () => {
    const content = fs.readFileSync(indicatorPath, "utf-8");

    assert.match(
      content,
      /data-testid="active-tool-banner"/,
      "Wajib memiliki banner kontainer status alat aktif",
    );
    assert.match(
      content,
      /data-testid="active-tool-indicator"/,
      "Wajib memiliki indikator ikon dan nama alat aktif",
    );
    assert.match(
      content,
      /Persegi Area Feeder/,
      "Wajib memuat label alat Persegi Area Feeder",
    );
    assert.match(
      content,
      /Lingkaran Cakupan ODP/,
      "Wajib memuat label alat Lingkaran Cakupan ODP",
    );
    assert.match(
      content,
      /Panah Tarikan Kabel/,
      "Wajib memuat label alat Panah Tarikan Kabel",
    );
    assert.match(
      content,
      /Garis Jalur Optik/,
      "Wajib memuat label alat Garis Jalur Optik",
    );
    assert.match(
      content,
      /Poligon Wilayah Layanan/,
      "Wajib memuat label alat Poligon Wilayah Layanan",
    );
    assert.match(
      content,
      /Catatan Teks Lapangan/,
      "Wajib memuat label alat Catatan Teks Lapangan",
    );
    assert.match(
      content,
      /Penghapus Objek/,
      "Wajib memuat label alat Penghapus Objek",
    );
    assert.match(
      content,
      /data-testid="banner-brush-spec"/,
      "Wajib menampilkan pratinjau spesifikasi kuas (warna & stroke px)",
    );
    assert.match(
      content,
      /data-testid="switch-to-select-btn"/,
      "Wajib menyediakan tombol cepat kembali ke mode navigasi peta (Esc)",
    );
  });

  it("3. Harus menyediakan HUD pelacak koordinat kursor (piksel & GPS) dan dimensi gambar real-time", () => {
    const content = fs.readFileSync(indicatorPath, "utf-8");

    assert.match(
      content,
      /data-testid="cursor-coordinates-hud"/,
      "Wajib memiliki HUD pelacak koordinat kursor",
    );
    assert.match(
      content,
      /data-testid="cursor-drawing-dimension"/,
      "Wajib menampilkan dimensi interaktif saat menggambar (W x H, R, atau P)",
    );
    assert.match(
      content,
      /data-testid="cursor-gps-position"/,
      "Wajib menampilkan koordinat geografis GPS satelit aktual",
    );
  });

  it("4. DrawingToolbar harus memiliki badge status alat aktif", () => {
    const content = fs.readFileSync(toolbarPath, "utf-8");

    assert.match(
      content,
      /data-testid="toolbar-active-tool-status"/,
      "Toolbar wajib menampilkan badge status alat aktif",
    );
  });

  it("5. LeaferCanvasOverlay harus mendukung kursor dinamis (default, move, grabbing, text, not-allowed, crosshair)", () => {
    const content = fs.readFileSync(overlayPath, "utf-8");

    assert.match(
      content,
      /cursor-grabbing/,
      "Kanvas wajib menggunakan cursor-grabbing saat objek di-drag",
    );
    assert.match(
      content,
      /cursor-move/,
      "Kanvas wajib menggunakan cursor-move saat mouse melayang di atas objek bentuk",
    );
    assert.match(
      content,
      /cursor-text/,
      "Kanvas wajib menggunakan cursor-text saat alat teks aktif",
    );
    assert.match(
      content,
      /cursor-not-allowed/,
      "Kanvas wajib menggunakan cursor-not-allowed saat alat penghapus aktif",
    );
    assert.match(
      content,
      /cursor-crosshair/,
      "Kanvas wajib menggunakan cursor-crosshair saat alat gambar bentuk aktif",
    );
    assert.match(
      content,
      /onCursorCoordinatesChange/,
      "Overlay wajib mendukung callback koordinat kursor",
    );
    assert.match(
      content,
      /onDrawingDimensionsChange/,
      "Overlay wajib mendukung callback dimensi gambar interaktif",
    );
    assert.match(
      content,
      /onMouseLeave=\{handleMouseLeave\}/,
      "Kanvas wajib mereset kursor dan koordinat saat mouse meninggalkan kanvas",
    );
  });

  it("6. DrawingLayerMapBoard harus mengintegrasikan DrawingActiveToolIndicator dan state koordinat kursor", () => {
    const content = fs.readFileSync(boardPath, "utf-8");

    assert.match(
      content,
      /import\s*\{\s*DrawingActiveToolIndicator\s*\}\s*from\s*"@\/components\/map\/drawing-active-tool-indicator"/,
      "Board wajib mengimpor DrawingActiveToolIndicator",
    );
    assert.match(
      content,
      /<DrawingActiveToolIndicator/,
      "Board wajib merender komponen DrawingActiveToolIndicator",
    );
    assert.match(
      content,
      /onCursorCoordinatesChange=\{setCursorCoordinates\}/,
      "Board wajib menyambungkan state cursorCoordinates",
    );
    assert.match(
      content,
      /onDrawingDimensionsChange=\{setDrawingDimensions\}/,
      "Board wajib menyambungkan state drawingDimensions",
    );
  });
});
