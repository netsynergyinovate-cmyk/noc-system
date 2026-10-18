import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("Task: Tambahkan alat label teks pada lapisan (Fase 5)", async (t) => {
  const dialogPath = path.join(
    process.cwd(),
    "src/components/map/drawing-text-dialog.tsx",
  );
  const overlayPath = path.join(
    process.cwd(),
    "src/components/map/leafer-canvas-overlay.tsx",
  );
  const boardPath = path.join(
    process.cwd(),
    "src/components/map/drawing-layer-map-board.tsx",
  );

  assert.ok(fs.existsSync(dialogPath), "Berkas drawing-text-dialog.tsx wajib ada");
  assert.ok(fs.existsSync(overlayPath), "Berkas leafer-canvas-overlay.tsx wajib ada");
  assert.ok(fs.existsSync(boardPath), "Berkas drawing-layer-map-board.tsx wajib ada");

  const dialogContent = fs.readFileSync(dialogPath, "utf-8");
  const overlayContent = fs.readFileSync(overlayPath, "utf-8");
  const boardContent = fs.readFileSync(boardPath, "utf-8");

  await t.test("1. Struktur & Elemen Komponen DrawingTextDialog", () => {
    assert.match(
      dialogContent,
      /export function DrawingTextDialog/,
      "Wajib mengekspor komponen DrawingTextDialog",
    );
    assert.match(
      dialogContent,
      /data-testid="drawing-text-dialog"/,
      "Wajib memiliki kontainer drawing-text-dialog",
    );
    assert.match(
      dialogContent,
      /data-testid="text-annotation-input"/,
      "Wajib menyediakan input teks label catatan",
    );
    assert.match(
      dialogContent,
      /data-testid="text-preset-tags"/,
      "Wajib menyediakan kontainer tag preset operasional ISP",
    );
    assert.match(
      dialogContent,
      /data-testid="text-font-size-group"/,
      "Wajib menyediakan grup pilihan ukuran font",
    );
    assert.match(
      dialogContent,
      /data-testid="text-bg-style-group"/,
      "Wajib menyediakan pilihan gaya latar belakang badge",
    );
    assert.match(
      dialogContent,
      /data-testid="text-live-preview"/,
      "Wajib menampilkan pratinjau langsung label teks",
    );
    assert.match(
      dialogContent,
      /data-testid="cancel-text-btn"/,
      "Wajib menyediakan tombol batal",
    );
    assert.match(
      dialogContent,
      /data-testid="save-text-btn"/,
      "Wajib menyediakan tombol simpan teks",
    );
  });

  await t.test("2. Tag Preset Operasional Lapangan ISP", () => {
    assert.match(
      dialogContent,
      /export const ISP_TEXT_PRESETS/,
      "Wajib mengekspor konstanta ISP_TEXT_PRESETS",
    );
    assert.match(dialogContent, /ODP Baru/, "Preset wajib memuat ODP Baru");
    assert.match(dialogContent, /Kabel Fiber Putus/, "Preset wajib memuat Kabel Fiber Putus");
    assert.match(dialogContent, /Redaman Tinggi/, "Preset wajib memuat Redaman Tinggi");
    assert.match(dialogContent, /Pelanggan VIP/, "Preset wajib memuat Pelanggan VIP");
  });

  await t.test("3. Ukuran Font & Pilihan Gaya Badge", () => {
    assert.match(
      dialogContent,
      /export const FONT_SIZE_OPTIONS/,
      "Wajib mengekspor konstanta FONT_SIZE_OPTIONS",
    );
    assert.match(dialogContent, /data-testid="bg-style-dark"/, "Wajib ada pilihan badge gelap");
    assert.match(dialogContent, /data-testid="bg-style-accent"/, "Wajib ada pilihan badge aksen");
    assert.match(dialogContent, /data-testid="bg-style-none"/, "Wajib ada pilihan transparan");
  });

  await t.test("4. Render Kanvas Teks dengan Kotak Badge Kontras Tinggi", () => {
    assert.match(
      overlayContent,
      /shape\.type === "text"/,
      "Overlay wajib merender bentuk bertipe text",
    );
    assert.match(
      overlayContent,
      /ctx\.measureText\(text\)/,
      "Overlay wajib mengukur dimensi lebar teks",
    );
    assert.match(
      overlayContent,
      /ctx\.shadowColor = "rgba\(0,0,0,0\.85\)"/,
      "Overlay wajib menambahkan bayangan kontras untuk keterbacaan di atas satelit",
    );
    assert.match(
      overlayContent,
      /ctx\.fillText\(text,\s*x,\s*y\)/,
      "Overlay wajib menggambar teks pada koordinat hasil proyeksi",
    );
  });

  await t.test("5. Integrasi Dialog & Tombol Edit Teks di DrawingLayerMapBoard", () => {
    assert.match(
      boardContent,
      /<DrawingTextDialog/,
      "DrawingLayerMapBoard wajib menyematkan DrawingTextDialog",
    );
    assert.match(
      boardContent,
      /onRequestCreateText=\{handleRequestCreateText\}/,
      "DrawingLayerMapBoard wajib menyambungkan handler pembuatan teks",
    );
    assert.match(
      boardContent,
      /onEditShape=\{handleRequestEditText\}/,
      "DrawingLayerMapBoard wajib menyambungkan handler pengeditan teks",
    );
    assert.match(
      boardContent,
      /data-testid="edit-selected-text-btn"/,
      "Inspektur objek wajib menampilkan tombol Edit Teks jika objek terpilih adalah teks",
    );
  });
});
