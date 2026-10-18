import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("Task: Tambahkan Penanda Sumber Data Aktif Peta", async (t) => {
  const indicatorPath = path.join(
    process.cwd(),
    "src/components/map/map-data-source-indicator.tsx",
  );
  const boardPath = path.join(
    process.cwd(),
    "src/components/map/realtime-network-map-board.tsx",
  );
  const pagePath = path.join(
    process.cwd(),
    "src/app/(protected)/app/peta/page.tsx",
  );

  const indicatorContent = fs.readFileSync(indicatorPath, "utf-8");
  const boardContent = fs.readFileSync(boardPath, "utf-8");
  const pageContent = fs.readFileSync(pagePath, "utf-8");

  await t.test("1. Komponen MapDataSourceIndicator: Label Sumber Data & Aksesibilitas", () => {
    assert.match(
      indicatorContent,
      /data-testid="active-data-source-container"/,
      "Indicator wajib menyediakan kontainer penanda sumber data aktif",
    );
    assert.match(
      indicatorContent,
      /data-testid="data-source-badge"/,
      "Indicator wajib menyediakan badge data-source-badge",
    );
    assert.match(
      indicatorContent,
      /PostgreSQL Live/,
      "Indicator wajib menampilkan label PostgreSQL Live saat isRealData bernilai true",
    );
    assert.match(
      indicatorContent,
      /Data Mock Lokal/,
      "Indicator wajib menampilkan label Data Mock Lokal saat isRealData bernilai false",
    );
    assert.match(
      indicatorContent,
      /data-testid="live-data-indicator-dot"/,
      "Indicator wajib memiliki titik visual hijau berdenyut saat terhubung ke database live",
    );
  });

  await t.test("2. Panel Detail Entitas Sumber Data (Popover Detail)", () => {
    assert.match(
      indicatorContent,
      /data-testid="toggle-data-source-detail-button"/,
      "Indicator wajib menyediakan tombol aksi toggle detail sumber data",
    );
    assert.match(
      indicatorContent,
      /data-testid="data-source-detail-panel"/,
      "Indicator wajib menyediakan panel detail sumber data",
    );
    assert.match(
      indicatorContent,
      /Zero-dummy validated/i,
      "Panel detail wajib menegaskan prinsip transparansi operasional zero-dummy",
    );
    assert.match(
      indicatorContent,
      /totalRouters/,
      "Panel detail wajib merangkum jumlah router riil",
    );
    assert.match(
      indicatorContent,
      /totalOlts/,
      "Panel detail wajib merangkum jumlah OLT riil",
    );
    assert.match(
      indicatorContent,
      /totalOdps/,
      "Panel detail wajib merangkum jumlah ODP riil",
    );
    assert.match(
      indicatorContent,
      /geocodedCustomers/,
      "Panel detail wajib merangkum jumlah pelanggan riil berkoordinat",
    );
  });

  await t.test("3. Integrasi Penanda Sumber Data pada RealtimeNetworkMapBoard", () => {
    assert.match(
      boardContent,
      /import\s*\{\s*MapDataSourceIndicator\s*\}\s*from\s*"\.\/map-data-source-indicator"/,
      "RealtimeNetworkMapBoard wajib mengimpor MapDataSourceIndicator",
    );
    assert.match(
      boardContent,
      /<MapDataSourceIndicator[\s\S]*?\/>/,
      "RealtimeNetworkMapBoard wajib menyematkan MapDataSourceIndicator di header",
    );
    assert.match(
      boardContent,
      /data-testid="data-source-badge"/,
      "RealtimeNetworkMapBoard wajib menyediakan badge penanda data-source-badge",
    );
  });

  await t.test("4. Integrasi Penanda Sumber Data pada Halaman Server Component Peta", () => {
    assert.match(
      pageContent,
      /data-testid="data-source-badge"/,
      "Halaman server peta wajib menyediakan penanda data-source-badge di server HTML",
    );
    assert.match(
      pageContent,
      /PostgreSQL Live/,
      "Halaman server peta wajib menampilkan teks PostgreSQL Live",
    );
    assert.match(
      pageContent,
      /Data Mock Lokal/,
      "Halaman server peta wajib menampilkan teks Data Mock Lokal",
    );
  });
});
