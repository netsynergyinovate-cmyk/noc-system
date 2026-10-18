import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

describe("Drawing Shape Modifier & Duplication Tool Suite", () => {
  const modifierPanelPath = path.resolve(
    process.cwd(),
    "src/components/map/selected-shape-modifier-panel.tsx",
  );
  const boardPath = path.resolve(
    process.cwd(),
    "src/components/map/drawing-layer-map-board.tsx",
  );
  const overlayPath = path.resolve(
    process.cwd(),
    "src/components/map/leafer-canvas-overlay.tsx",
  );

  it("1. Harus memastikan komponen SelectedShapeModifierPanel ada dan mengekspor interface serta komponen dengan benar", () => {
    assert.ok(
      fs.existsSync(modifierPanelPath),
      "Berkas selected-shape-modifier-panel.tsx harus ada",
    );

    const content = fs.readFileSync(modifierPanelPath, "utf-8");
    assert.match(
      content,
      /export interface SelectedShapeModifierPanelProps/,
      "Harus mengekspor SelectedShapeModifierPanelProps",
    );
    assert.match(
      content,
      /export function SelectedShapeModifierPanel/,
      "Harus mengekspor SelectedShapeModifierPanel",
    );
    assert.match(
      content,
      /if \(!selectedShape\) return null;/,
      "Harus merender null jika selectedShape tidak ada",
    );
  });

  it("2. Harus memiliki kontrol modifikasi lengkap: palet warna, ketebalan stroke, dan stepper dimensi", () => {
    const content = fs.readFileSync(modifierPanelPath, "utf-8");

    // Color picker
    assert.match(
      content,
      /data-testid="modifier-color-picker"/,
      "Harus memiliki palet pemilih warna",
    );
    // Stroke width group
    assert.match(
      content,
      /data-testid="modifier-stroke-width-group"/,
      "Harus memiliki grup pengatur ketebalan garis",
    );
    // Dimension controls
    assert.match(
      content,
      /data-testid="modifier-width-control"/,
      "Harus memiliki kontrol lebar untuk persegi",
    );
    assert.match(
      content,
      /data-testid="modifier-height-control"/,
      "Harus memiliki kontrol tinggi untuk persegi",
    );
    assert.match(
      content,
      /data-testid="modifier-radius-control"/,
      "Harus memiliki kontrol radius untuk lingkaran",
    );
  });

  it("3. Harus memiliki aksi manipulasi bentuk: duplikasi, hapus, edit teks, dan tutup", () => {
    const content = fs.readFileSync(modifierPanelPath, "utf-8");

    assert.match(
      content,
      /data-testid="duplicate-selected-shape-btn"/,
      "Harus memiliki tombol duplikasi bentuk",
    );
    assert.match(
      content,
      /data-testid="delete-selected-shape-btn"/,
      "Harus memiliki tombol hapus bentuk",
    );
    assert.match(
      content,
      /data-testid="edit-selected-text-btn"/,
      "Harus memiliki tombol edit teks",
    );
    assert.match(
      content,
      /data-testid="close-modifier-btn"/,
      "Harus memiliki tombol tutup / escape",
    );
  });

  it("4. Harus mengekspor fungsi pemindahan & duplikasi geometri moveShapeByOffset dari leafer-canvas-overlay", () => {
    const content = fs.readFileSync(overlayPath, "utf-8");

    assert.match(
      content,
      /export function moveShapeByOffset\(/,
      "Harus mengekspor fungsi moveShapeByOffset",
    );
    assert.match(
      content,
      /cloned\.type === "rectangle"/,
      "Harus menangani pergeseran rectangle",
    );
    assert.match(
      content,
      /cloned\.type === "circle"/,
      "Harus menangani pergeseran circle",
    );
    assert.match(
      content,
      /cloned\.type === "polygon"/,
      "Harus menangani pergeseran polygon",
    );
    assert.match(
      content,
      /cloned\.type === "text"/,
      "Harus menangani pergeseran text",
    );
  });

  it("5. Harus mengintegrasikan SelectedShapeModifierPanel dan moveShapeByOffset di DrawingLayerMapBoard", () => {
    const content = fs.readFileSync(boardPath, "utf-8");

    assert.match(
      content,
      /import\s*\{\s*SelectedShapeModifierPanel\s*\}\s*from\s*"@\/components\/map\/selected-shape-modifier-panel"/,
      "DrawingLayerMapBoard harus mengimpor SelectedShapeModifierPanel",
    );
    assert.match(
      content,
      /moveShapeByOffset/,
      "DrawingLayerMapBoard harus mengimpor moveShapeByOffset",
    );
    assert.match(
      content,
      /const handleUpdateShapeProperties = useCallback/,
      "Harus mengimplementasikan handleUpdateShapeProperties dengan useCallback",
    );
    assert.match(
      content,
      /const handleDuplicateShape = useCallback/,
      "Harus mengimplementasikan handleDuplicateShape dengan useCallback",
    );
    assert.match(
      content,
      /<SelectedShapeModifierPanel/,
      "Harus menyematkan komponen SelectedShapeModifierPanel di template JSX",
    );
  });

  it("6. Harus mendukung pintasan keyboard Delete, Backspace, Escape, dan Ctrl+D / Cmd+D", () => {
    const content = fs.readFileSync(boardPath, "utf-8");

    assert.match(
      content,
      /\(e\.ctrlKey \|\| e\.metaKey\) && e\.key\.toLowerCase\(\) === "d"/,
      "Harus mendeteksi shortcut Ctrl+D atau Cmd+D untuk duplikasi",
    );
    assert.match(
      content,
      /e\.key === "Delete" \|\| e\.key === "Backspace"/,
      "Harus mendeteksi tombol Delete dan Backspace untuk hapus objek",
    );
    assert.match(
      content,
      /e\.key === "Escape"/,
      "Harus mendeteksi tombol Escape untuk membatalkan seleksi",
    );
  });
});
