import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

test("Task: Buat Legenda Kapasitas Serat yang Bisa Dibuka Tutup", async (t) => {
  const boardFile = path.join(
    rootDir,
    "src",
    "components",
    "map",
    "cable-map-board.tsx",
  );
  assert.ok(fs.existsSync(boardFile), "File cable-map-board.tsx harus ada");
  const content = fs.readFileSync(boardFile, "utf-8");

  await t.test("1. State Kontrol Buka-Tutup Legenda (Sidebar & Floating Widget)", () => {
    assert.match(
      content,
      /const\s*\[isLegendOpen,\s*setIsLegendOpen\]\s*=\s*useState\(\s*true\s*\)/,
      "Harus menyediakan state isLegendOpen dengan nilai bawaan true",
    );
    assert.match(
      content,
      /const\s*\[isFloatingLegendOpen,\s*setIsFloatingLegendOpen\]\s*=\s*useState\(\s*false\s*\)/,
      "Harus menyediakan state isFloatingLegendOpen untuk widget mengambang di kanvas peta",
    );
  });

  await t.test("2. Tombol Toggle Legenda Sidebar & Atribut Aksesibilitas aria-expanded", () => {
    assert.match(
      content,
      /data-testid="toggle-legend-button"/,
      "Tombol toggle legenda di sidebar harus memiliki data-testid='toggle-legend-button'",
    );
    assert.match(
      content,
      /aria-expanded=\{isLegendOpen\}/,
      "Tombol toggle harus mencerminkan status aksesibilitas aria-expanded",
    );
    assert.match(
      content,
      /onClick=\{\(\)\s*=>\s*setIsLegendOpen\(\(prev\)\s*=>\s*!prev\)\}/,
      "Tombol toggle harus membalikkan state buka/tutup",
    );
  });

  await t.test("3. Visibilitas Konten Legenda yang Kolapsibel di Sidebar", () => {
    assert.match(
      content,
      /\{isLegendOpen\s*&&\s*\(/,
      "Konten rincian kapasitas serat harus dibungkus kondisi isLegendOpen",
    );
    assert.match(
      content,
      /data-testid="legend-content-panel"/,
      "Panel rincian kapasitas serat harus memiliki data-testid='legend-content-panel'",
    );
    assert.match(
      content,
      /CABLE_CAPACITY_TIERS\.map\(/,
      "Panel legenda harus me-render seluruh tingkatan CABLE_CAPACITY_TIERS",
    );
  });

  await t.test("4. Widget Legenda Terapung di Atas Kanvas Peta Satelit", () => {
    assert.match(
      content,
      /data-testid="floating-cable-legend"/,
      "Kanvas peta harus menyediakan kontainer widget legenda terapung",
    );
    assert.match(
      content,
      /data-testid="toggle-floating-legend-button"/,
      "Harus ada tombol toggle legenda terapung di atas peta",
    );
    assert.match(
      content,
      /data-testid="floating-legend-content"/,
      "Konten popup legenda terapung harus memiliki data-testid='floating-legend-content'",
    );
    assert.match(
      content,
      /data-testid="close-floating-legend-button"/,
      "Harus ada tombol tutup di dalam popup legenda terapung",
    );
  });

  await t.test("5. Interaktivitas Klik Tier Legenda: Memfilter Tipe Kabel Langsung", () => {
    assert.match(
      content,
      /onClick=\{\(\)\s*=>\s*setSelectedType\(tier\.category\)\}/,
      "Mengklik baris kapasitas serat di legenda harus memfilter rute kabel sesuai kategori (backbone/feeder/drop)",
    );
  });
});
