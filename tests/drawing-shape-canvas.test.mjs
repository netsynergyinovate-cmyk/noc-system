import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("Task: Implementasikan gambar bentuk dan panah di kanvas (Fase 5)", async (t) => {
  const overlayPath = path.join(
    process.cwd(),
    "src/components/map/leafer-canvas-overlay.tsx",
  );
  const boardPath = path.join(
    process.cwd(),
    "src/components/map/drawing-layer-map-board.tsx",
  );
  const schemaPath = path.join(
    process.cwd(),
    "src/db/schema/map-drawing-layers.ts",
  );

  assert.ok(fs.existsSync(overlayPath), "Berkas leafer-canvas-overlay.tsx wajib ada");
  assert.ok(fs.existsSync(boardPath), "Berkas drawing-layer-map-board.tsx wajib ada");

  const overlayContent = fs.readFileSync(overlayPath, "utf-8");
  const boardContent = fs.readFileSync(boardPath, "utf-8");
  const schemaContent = fs.readFileSync(schemaPath, "utf-8");

  await t.test("1. Dukungan Lengkap Bentuk Vektor (Rectangle, Circle, Arrow, Line, Polygon, Text)", () => {
    assert.match(
      schemaContent,
      /rectangle[\s\S]*?circle[\s\S]*?arrow[\s\S]*?line[\s\S]*?text[\s\S]*?polygon/,
      "Skema DrawingShapeType wajib mendukung seluruh tipe bentuk termasuk polygon",
    );
    assert.match(
      overlayContent,
      /shape\.type === "rectangle"/,
      "Overlay wajib merender bentuk rectangle",
    );
    assert.match(
      overlayContent,
      /shape\.type === "circle"/,
      "Overlay wajib merender bentuk circle",
    );
    assert.match(
      overlayContent,
      /shape\.type === "arrow"/,
      "Overlay wajib merender bentuk arrow",
    );
    assert.match(
      overlayContent,
      /shape\.type === "line"/,
      "Overlay wajib merender bentuk line",
    );
    assert.match(
      overlayContent,
      /shape\.type === "polygon"/,
      "Overlay wajib merender bentuk polygon",
    );
    assert.match(
      overlayContent,
      /shape\.type === "text"/,
      "Overlay wajib merender anotasi text",
    );
  });

  await t.test("2. Geometri Panah & Ujung Panah Terarah (Arrowhead Geometry)", () => {
    assert.match(
      overlayContent,
      /Math\.atan2\(toY - fromY,\s*toX - fromX\)/,
      "Perhitungan sudut panah wajib menggunakan Math.atan2",
    );
    assert.match(
      overlayContent,
      /headlen\s*\*\s*Math\.cos\(angle\s*-\s*Math\.PI\s*\/\s*6\)/,
      "Sayap panah wajib dihitung dengan proyeksi trigonometri Math.PI / 6",
    );
    assert.match(
      overlayContent,
      /ctx\.closePath\(\);\s*ctx\.fillStyle = ctx\.strokeStyle;\s*ctx\.fill\(\);/,
      "Ujung panah wajib digambar terisi penuh (solid filled arrowhead)",
    );
    assert.match(
      overlayContent,
      /selectedTool === "arrow"[\s\S]*?headlen/,
      "Pratinjau tarikan panah saat drag wajib menampilkan ujung panah",
    );
  });

  await t.test("3. Penggambaran Poligon Multi-Titik (Multi-Vertex Polygon)", () => {
    assert.match(
      overlayContent,
      /polygonVertices,\s*setPolygonVertices/,
      "Overlay wajib mengelola state verteks poligon",
    );
    assert.match(
      overlayContent,
      /selectedTool === "polygon"[\s\S]*?polygonVertices\.length >= 3/,
      "Poligon minimal memiliki 3 titik untuk diselesaikan",
    );
    assert.match(
      overlayContent,
      /handleDoubleClick/,
      "Klik ganda dapat menyelesaikan pembuatan poligon",
    );
    assert.match(
      overlayContent,
      /type:\s*"polygon",\s*coordinates:\s*polygonVertices\.map/,
      "Bentuk baru poligon wajib menyimpan seluruh koordinat verteks",
    );
  });

  await t.test("4. Mesin Hit-Testing & Deteksi Seleksi Objek (Point-in-Shape)", () => {
    assert.match(
      overlayContent,
      /function isPointInShape/,
      "Overlay wajib memiliki fungsi hit-test isPointInShape",
    );
    assert.match(
      overlayContent,
      /Ray casting point-in-polygon/,
      "Hit-test poligon wajib menggunakan algoritma ray casting point-in-polygon",
    );
    assert.match(
      overlayContent,
      /selectedTool === "select"[\s\S]*?isPointInShape/,
      "Mode seleksi wajib mendeteksi objek saat diklik",
    );
    assert.match(
      boardContent,
      /data-testid="selected-shape-inspector"/,
      "Board wajib menampilkan panel inspektur objek terpilih",
    );
  });

  await t.test("5. Pemindahan Objek (Drag-Move) & Sinkronisasi GPS Reaktif", () => {
    assert.match(
      overlayContent,
      /function moveShapeByOffset/,
      "Overlay wajib memiliki fungsi pemindahan koordinat moveShapeByOffset",
    );
    assert.match(
      overlayContent,
      /onShapeUpdated/,
      "Overlay wajib memanggil callback onShapeUpdated saat objek dipindahkan",
    );
    assert.match(
      boardContent,
      /handleShapeUpdated/,
      "Board wajib memperbarui state layer saat bentuk di-drag",
    );
  });

  await t.test("6. Alat Hapus (Delete Tool), Tombol Hapus & Pintasan Keyboard", () => {
    assert.match(
      overlayContent,
      /selectedTool === "delete"[\s\S]*?onShapeDeleted/,
      "Klik bentuk saat alat delete aktif wajib memicu onShapeDeleted",
    );
    assert.match(
      boardContent,
      /data-testid="delete-selected-shape-btn"/,
      "Panel inspektur wajib menyediakan tombol hapus bentuk",
    );
    assert.match(
      boardContent,
      /e\.key === "Delete" \|\| e\.key === "Backspace"/,
      "Keyboard shortcut Delete dan Backspace wajib menghapus bentuk terpilih",
    );
    assert.match(
      boardContent,
      /e\.key === "Escape"/,
      "Keyboard shortcut Escape wajib membatalkan seleksi bentuk",
    );
  });
});
