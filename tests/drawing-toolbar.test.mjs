import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("Task: Buat toolbar alat gambar bentuk dan panah (Fase 5)", async (t) => {
  const toolbarPath = path.join(
    process.cwd(),
    "src/components/map/drawing-toolbar.tsx",
  );
  const boardPath = path.join(
    process.cwd(),
    "src/components/map/drawing-layer-map-board.tsx",
  );

  const toolbarContent = fs.readFileSync(toolbarPath, "utf-8");
  const boardContent = fs.readFileSync(boardPath, "utf-8");

  await t.test("1. Struktur Dasar Komponen DrawingToolbar", () => {
    assert.match(
      toolbarContent,
      /export function DrawingToolbar/,
      "Wajib mengekspor komponen DrawingToolbar",
    );
    assert.match(
      toolbarContent,
      /data-testid="drawing-toolbar"/,
      "Wajib menyertakan kontainer drawing-toolbar",
    );
    assert.match(
      toolbarContent,
      /export const DEFAULT_DRAWING_COLORS/,
      "Wajib menyediakan konstanta palet warna default",
    );
    assert.match(
      toolbarContent,
      /export const STROKE_WIDTH_OPTIONS/,
      "Wajib menyediakan konstanta pilihan ketebalan garis",
    );
  });

  await t.test("2. Tombol Alat Gambar Bentuk (Rectangle, Circle, Polygon, Select)", () => {
    assert.match(
      toolbarContent,
      /data-testid="tool-select"/,
      "Wajib menyediakan tombol alat pemilih/pointer (Select)",
    );
    assert.match(
      toolbarContent,
      /data-testid="tool-rectangle"/,
      "Wajib menyediakan tombol alat gambar persegi/kotak (Rectangle)",
    );
    assert.match(
      toolbarContent,
      /data-testid="tool-circle"/,
      "Wajib menyediakan tombol alat gambar lingkaran cakupan (Circle)",
    );
    assert.match(
      toolbarContent,
      /data-testid="tool-polygon"/,
      "Wajib menyediakan tombol alat gambar poligon area bebas (Polygon)",
    );
  });

  await t.test("3. Tombol Alat Panah & Garis (Arrow & Line)", () => {
    assert.match(
      toolbarContent,
      /data-testid="tool-arrow"/,
      "Wajib menyediakan tombol alat gambar panah petunjuk arah kabel (Arrow)",
    );
    assert.match(
      toolbarContent,
      /data-testid="tool-line"/,
      "Wajib menyediakan tombol alat gambar garis penghubung jalur (Line)",
    );
  });

  await t.test("4. Tombol Alat Teks Anotasi & Penghapus (Text & Delete/Clear)", () => {
    assert.match(
      toolbarContent,
      /data-testid="tool-text"/,
      "Wajib menyediakan tombol alat teks anotasi lapangan (Text)",
    );
    assert.match(
      toolbarContent,
      /data-testid="tool-delete"/,
      "Wajib menyediakan tombol mode penghapus bentuk (Delete)",
    );
    assert.match(
      toolbarContent,
      /data-testid="clear-layer-shapes-btn"/,
      "Wajib menyediakan tombol pembersih seluruh objek bentuk pada lapisan aktif",
    );
  });

  await t.test("5. Palet Warna & Pengatur Ketebalan Garis Vektor", () => {
    assert.match(
      toolbarContent,
      /data-testid="color-picker-group"/,
      "Wajib menyediakan kontainer grup pemilih warna",
    );
    assert.match(
      toolbarContent,
      /data-testid=\{`color-picker-\$\{color\}`\}/,
      "Wajib menyediakan tombol warna interaktif untuk tiap kode hex",
    );
    assert.match(
      toolbarContent,
      /data-testid="stroke-width-group"/,
      "Wajib menyediakan kontainer pilihan ketebalan garis",
    );
    assert.match(
      toolbarContent,
      /data-testid=\{`stroke-width-\$\{w\}`\}/,
      "Wajib menyediakan tombol pilihan ketebalan garis (1px, 2px, 3px, dst)",
    );
  });

  await t.test("6. Pintasan Keyboard Responsif & Aksesibilitas", () => {
    assert.match(
      toolbarContent,
      /window\.addEventListener\("keydown",\s*handleKeyDown\)/,
      "Wajib mendengarkan event keyboard shortcut",
    );
    assert.match(
      toolbarContent,
      /case "v":\s*onSelectTool\("select"\)/,
      "Pintasan V wajib mengaktifkan mode select",
    );
    assert.match(
      toolbarContent,
      /case "r":\s*onSelectTool\("rectangle"\)/,
      "Pintasan R wajib mengaktifkan mode rectangle",
    );
    assert.match(
      toolbarContent,
      /case "c":\s*onSelectTool\("circle"\)/,
      "Pintasan C wajib mengaktifkan mode circle",
    );
    assert.match(
      toolbarContent,
      /case "a":\s*onSelectTool\("arrow"\)/,
      "Pintasan A wajib mengaktifkan mode arrow",
    );
    assert.match(
      toolbarContent,
      /case "l":\s*onSelectTool\("line"\)/,
      "Pintasan L wajib mengaktifkan mode line",
    );
    assert.match(
      toolbarContent,
      /case "t":\s*onSelectTool\("text"\)/,
      "Pintasan T wajib mengaktifkan mode text",
    );
    assert.match(
      toolbarContent,
      /case "d":\s*onSelectTool\("delete"\)/,
      "Pintasan D wajib mengaktifkan mode delete",
    );
  });

  await t.test("7. Integrasi di DrawingLayerMapBoard", () => {
    assert.match(
      boardContent,
      /import\s*\{\s*DrawingToolbar\s*\}\s*from\s*["']@\/components\/map\/drawing-toolbar["']/,
      "DrawingLayerMapBoard wajib mengimpor DrawingToolbar",
    );
    assert.match(
      boardContent,
      /<DrawingToolbar[\s\S]*?selectedTool=\{selectedTool\}[\s\S]*?onSelectTool=\{setSelectedTool\}[\s\S]*?selectedColor=\{selectedColor\}[\s\S]*?onSelectColor=\{setSelectedColor\}[\s\S]*?strokeWidth=\{strokeWidth\}[\s\S]*?onSelectStrokeWidth=\{setStrokeWidth\}/,
      "DrawingLayerMapBoard wajib memasang DrawingToolbar dengan state lengkap",
    );
  });
});
