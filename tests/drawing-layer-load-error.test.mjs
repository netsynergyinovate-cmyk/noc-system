import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const PAGE_PATH = path.resolve(
  process.cwd(),
  "src/app/(protected)/app/peta/gambar/page.tsx",
);
const BOARD_PATH = path.resolve(
  process.cwd(),
  "src/components/map/drawing-layer-map-board.tsx",
);
const PANEL_PATH = path.resolve(
  process.cwd(),
  "src/components/map/drawing-layer-manager-panel.tsx",
);

test("1. PetaLapisanGambarPage menangani kegagalan pengambilan data awal secara defensif", () => {
  const content = fs.readFileSync(PAGE_PATH, "utf8");

  // Harus membungkus fetch awal dalam try/catch
  assert.match(
    content,
    /try\s*\{[\s\S]*getMapDrawingLayers\(\)[\s\S]*\}\s*catch\s*\(err\)/,
    "Halaman harus membungkus getMapDrawingLayers dalam blok try/catch",
  );

  // Harus menangkap error dan menginisialisasi loadError
  assert.ok(
    content.includes("loadError ="),
    "Halaman harus mencatat pesan kesalahan ke variabel loadError",
  );

  // Harus meneruskan initialError ke DrawingLayerMapBoard
  assert.ok(
    content.includes("initialError={loadError}"),
    "Halaman harus meneruskan initialError ke DrawingLayerMapBoard",
  );
});

test("2. DrawingLayerMapBoard merender banner kesalahan muat lapisan dan tombol coba lagi", () => {
  const content = fs.readFileSync(BOARD_PATH, "utf8");

  // Periksa deklarasi prop initialError
  assert.match(
    content,
    /initialError\?:\s*string\s*\|\s*null/,
    "DrawingLayerMapBoardProps harus memiliki prop initialError",
  );

  // Periksa banner error layer-load-error-banner
  assert.ok(
    content.includes('data-testid="layer-load-error-banner"'),
    "Harus ada banner role alert dengan data-testid layer-load-error-banner",
  );

  // Periksa tombol coba muat ulang & dismiss
  assert.ok(
    content.includes('data-testid="retry-load-layers-button"'),
    "Harus ada tombol coba muat ulang data-testid retry-load-layers-button",
  );
  assert.ok(
    content.includes('data-testid="dismiss-load-error-button"'),
    "Harus ada tombol dismiss data-testid dismiss-load-error-button",
  );

  // Periksa sinkronisasi loadError di handleReloadLayers
  assert.ok(
    content.includes("setLoadError(errMsg)"),
    "handleReloadLayers harus mencatat errMsg ke loadError saat gagal",
  );
  assert.ok(
    content.includes("setLoadError(null)"),
    "handleReloadLayers harus membersihkan loadError saat berhasil",
  );
});

test("3. DrawingLayerManagerPanel merender status error kosong dan peringatan sinkronisasi", () => {
  const content = fs.readFileSync(PANEL_PATH, "utf8");

  // Periksa deklarasi prop loadError dan onRetryLoad
  assert.match(
    content,
    /loadError\?:\s*string\s*\|\s*null/,
    "DrawingLayerManagerPanelProps harus memiliki loadError",
  );
  assert.match(
    content,
    /onRetryLoad\?:\s*\(\)\s*=>\s*void/,
    "DrawingLayerManagerPanelProps harus memiliki onRetryLoad",
  );

  // Periksa elemen error state saat daftar kosong
  assert.ok(
    content.includes('data-testid="layer-list-error-state"'),
    "Harus ada elemen data-testid layer-list-error-state saat loadError dan layers kosong",
  );
  assert.ok(
    content.includes('data-testid="layer-list-retry-btn"'),
    "Harus ada tombol coba muat ulang data-testid layer-list-retry-btn",
  );

  // Periksa banner warning saat lapisan sudah ada namun sinkronisasi terbaru gagal
  assert.ok(
    content.includes('data-testid="layer-list-warning-sync"'),
    "Harus ada banner data-testid layer-list-warning-sync saat reload gagal namun lapisan ada di memori",
  );
});
