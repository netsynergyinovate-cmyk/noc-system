import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("Task: Tampilkan Status Kosong dan Galat Muat Peta", async (t) => {
  const emptyStatePath = path.join(
    process.cwd(),
    "src/components/map/map-empty-state.tsx",
  );
  const errorStatePath = path.join(
    process.cwd(),
    "src/components/map/map-error-state.tsx",
  );
  const boardPath = path.join(
    process.cwd(),
    "src/components/map/realtime-network-map-board.tsx",
  );

  const emptyStateContent = fs.readFileSync(emptyStatePath, "utf-8");
  const errorStateContent = fs.readFileSync(errorStatePath, "utf-8");
  const boardContent = fs.readFileSync(boardPath, "utf-8");

  await t.test("1. Komponen MapEmptyState: Struktur, Aksesibilitas & Zero-Dummy", () => {
    assert.match(
      emptyStateContent,
      /data-testid="map-empty-state"/,
      "MapEmptyState wajib menyediakan container map-empty-state",
    );
    assert.match(
      emptyStateContent,
      /data-testid="empty-map-state"/,
      "MapEmptyState wajib kompatibel dengan selector empty-map-state",
    );
    assert.match(
      emptyStateContent,
      /zero-dummy/,
      "MapEmptyState wajib menegaskan prinsip zero-dummy bahwa sistem menolak koordinat palsu",
    );
    assert.match(
      emptyStateContent,
      /href="\/setup"/,
      "MapEmptyState wajib menyediakan tautan cepat ke setup perangkat",
    );
    assert.match(
      emptyStateContent,
      /href="\/app\/router"/,
      "MapEmptyState wajib menyediakan tautan ke manajemen router",
    );
    assert.match(
      emptyStateContent,
      /href="\/app\/pelanggan"/,
      "MapEmptyState wajib menyediakan tautan ke data pelanggan",
    );
  });

  await t.test("2. MapEmptyState Varian Pencarian (Search Empty State)", () => {
    assert.match(
      emptyStateContent,
      /data-testid="search-empty-state"/,
      "MapEmptyState wajib mendukung tampilan filter/search-empty-state",
    );
    assert.match(
      emptyStateContent,
      /data-testid="reset-search-button"/,
      "Search empty state wajib menyediakan tombol reset pencarian",
    );
  });

  await t.test("3. Komponen MapErrorState: Aksesibilitas, Tombol Retry & Zero-Dummy", () => {
    assert.match(
      errorStateContent,
      /data-testid="map-error-state"/,
      "MapErrorState wajib menyediakan container map-error-state",
    );
    assert.match(
      errorStateContent,
      /role="alert"/,
      "MapErrorState wajib memiliki atribut role='alert' untuk screen reader",
    );
    assert.match(
      errorStateContent,
      /data-testid="map-error-retry-button"/,
      "MapErrorState wajib menyediakan tombol retry dengan test-id map-error-retry-button",
    );
    assert.match(
      errorStateContent,
      /Coba Lagi/,
      "MapErrorState wajib menyediakan tombol retry bertuliskan 'Coba Lagi'",
    );
    assert.match(
      errorStateContent,
      /zero-dummy/,
      "MapErrorState wajib menjelaskan penolakan data palsu saat terjadi kegagalan backend",
    );
  });

  await t.test("4. Integrasi MapEmptyState & MapErrorState ke RealtimeNetworkMapBoard", () => {
    assert.match(
      boardContent,
      /import\s*\{\s*MapEmptyState\s*\}\s*from\s*"\.\/map-empty-state"/,
      "RealtimeNetworkMapBoard wajib mengimpor MapEmptyState",
    );
    assert.match(
      boardContent,
      /import\s*\{\s*MapErrorState\s*\}\s*from\s*"\.\/map-error-state"/,
      "RealtimeNetworkMapBoard wajib mengimpor MapErrorState",
    );
    assert.match(
      boardContent,
      /<MapEmptyState[\s\S]*?\/>/,
      "RealtimeNetworkMapBoard wajib merender MapEmptyState saat data kosong",
    );
    assert.match(
      boardContent,
      /<MapErrorState[\s\S]*?\/>/,
      "RealtimeNetworkMapBoard wajib merender MapErrorState saat fetch gagal",
    );
  });
});
