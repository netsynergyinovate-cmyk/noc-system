import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("Task: Buat halaman lapisan gambar peta dengan data nyata dari backend (Fase 5)", async (t) => {
  const pagePath = path.join(
    process.cwd(),
    "src/app/(protected)/app/peta/gambar/page.tsx",
  );
  const boardPath = path.join(
    process.cwd(),
    "src/components/map/drawing-layer-map-board.tsx",
  );
  const servicePath = path.join(
    process.cwd(),
    "src/services/map-drawing-layers.service.ts",
  );
  const routePath = path.join(
    process.cwd(),
    "src/app/api/map/drawing-layers/route.ts",
  );
  const itemRoutePath = path.join(
    process.cwd(),
    "src/app/api/map/drawing-layers/[id]/route.ts",
  );
  const schemaPath = path.join(
    process.cwd(),
    "src/db/schema/map-drawing-layers.ts",
  );
  const panelPath = path.join(
    process.cwd(),
    "src/components/map/drawing-layer-manager-panel.tsx",
  );
  const toolbarPath = path.join(
    process.cwd(),
    "src/components/map/drawing-toolbar.tsx",
  );

  const pageContent = fs.readFileSync(pagePath, "utf-8");
  const boardContent = fs.readFileSync(boardPath, "utf-8");
  const serviceContent = fs.readFileSync(servicePath, "utf-8");
  const routeContent = fs.readFileSync(routePath, "utf-8");
  const itemRouteContent = fs.readFileSync(itemRoutePath, "utf-8");
  const schemaContent = fs.readFileSync(schemaPath, "utf-8");
  const panelContent = fs.existsSync(panelPath) ? fs.readFileSync(panelPath, "utf-8") : "";
  const toolbarContent = fs.existsSync(toolbarPath) ? fs.readFileSync(toolbarPath, "utf-8") : "";

  await t.test("1. Server Component Halaman Lapisan Gambar (/app/peta/gambar) Memuat Data Nyata Backend", () => {
    assert.match(
      pageContent,
      /requireSession\(\)/,
      "Halaman wajib memproteksi autentikasi dengan requireSession",
    );
    assert.match(
      pageContent,
      /getCompleteRealMapData/,
      "Halaman wajib mengambil data peta riil melalui getCompleteRealMapData",
    );
    assert.match(
      pageContent,
      /getMapDrawingLayers/,
      "Halaman wajib mengambil data lapisan gambar melalui getMapDrawingLayers",
    );
    assert.match(
      pageContent,
      /<DrawingLayerMapBoard[\s\S]*?initialMapData=\{mapData\}[\s\S]*?initialDrawingLayers=\{drawingLayers\}/,
      "Halaman wajib meneruskan data operasional riil ke DrawingLayerMapBoard",
    );
    assert.doesNotMatch(
      pageContent,
      /dummyData|mockCustomers|sampleLayers/i,
      "Halaman dilarang menyematkan data tiruan terselubung",
    );
  });

  await t.test("2. Komponen DrawingLayerMapBoard: Kanvas Gambar 2D & Toolbar Lengkap", () => {
    const fullToolbarContent = boardContent + "\n" + toolbarContent;
    assert.match(
      boardContent,
      /data-testid="drawing-layer-map-board"/,
      "Komponen wajib memiliki kontainer drawing-layer-map-board",
    );
    assert.match(
      boardContent,
      /data-testid="leafer-drawing-canvas"/,
      "Wajib menyertakan elemen kanvas gambar anotasi 2D",
    );
    assert.match(
      fullToolbarContent,
      /data-testid="tool-select"/,
      "Wajib menyediakan alat pemilih (pointer)",
    );
    assert.match(
      fullToolbarContent,
      /data-testid="tool-rectangle"/,
      "Wajib menyediakan alat gambar persegi/kotak",
    );
    assert.match(
      fullToolbarContent,
      /data-testid="tool-circle"/,
      "Wajib menyediakan alat gambar lingkaran",
    );
    assert.match(
      fullToolbarContent,
      /data-testid="tool-arrow"/,
      "Wajib menyediakan alat gambar panah petunjuk arah",
    );
    assert.match(
      fullToolbarContent,
      /data-testid="tool-line"/,
      "Wajib menyediakan alat gambar garis",
    );
    assert.match(
      fullToolbarContent,
      /data-testid="tool-text"/,
      "Wajib menyediakan alat penambahan label teks lapangan",
    );
  });

  await t.test("3. Komponen DrawingLayerMapBoard: Manajemen Lapisan & Tombol Simpan", () => {
    const fullContent = boardContent + "\n" + panelContent;
    assert.match(
      fullContent,
      /data-testid="layer-management-panel"/,
      "Wajib menyediakan panel kelola lapisan gambar",
    );
    assert.match(
      fullContent,
      /data-testid="add-layer-button"/,
      "Wajib menyediakan tombol tambah lapisan gambar baru",
    );
    assert.match(
      boardContent,
      /data-testid="save-layers-button"/,
      "Wajib menyediakan tombol simpan seluruh lapisan ke server",
    );
    assert.match(
      fullContent,
      /opacity-slider-/,
      "Wajib menyediakan kontrol pengatur transparansi (opacity)",
    );
    assert.match(
      fullContent,
      /zindex-input-/,
      "Wajib menyediakan kontrol pengatur urutan (z-index)",
    );
    assert.match(
      fullContent,
      /toggle-visibility-/,
      "Wajib menyediakan kontrol tombol sembunyikan/tampilkan visibilitas",
    );
    assert.match(
      boardContent,
      /data-testid="data-source-badge"/,
      "Wajib menyertakan badge sumber data riil PostgreSQL",
    );
  });

  await t.test("4. Endpoint API Lapisan Gambar (/api/map/drawing-layers)", () => {
    assert.match(
      routeContent,
      /withApiSession\(request/,
      "Endpoint API /api/map/drawing-layers wajib diproteksi withApiSession",
    );
    assert.match(
      routeContent,
      /export const runtime\s*=\s*"nodejs"/,
      "Endpoint API wajib menggunakan runtime nodejs",
    );
    assert.match(
      routeContent,
      /getMapDrawingLayers/,
      "Handler GET wajib memanggil service getMapDrawingLayers",
    );
    assert.match(
      routeContent,
      /createMapDrawingLayer/,
      "Handler POST wajib memanggil service createMapDrawingLayer",
    );

    // Item detail endpoint
    assert.match(
      itemRouteContent,
      /withApiSession\(request/,
      "Endpoint detail [id] wajib diproteksi withApiSession",
    );
    assert.match(
      itemRouteContent,
      /updateMapDrawingLayer/,
      "Handler PATCH wajib memanggil updateMapDrawingLayer",
    );
    assert.match(
      itemRouteContent,
      /deleteMapDrawingLayer/,
      "Handler DELETE wajib memanggil deleteMapDrawingLayer",
    );
  });

  await t.test("5. Service Backend & Skema Database PostgreSQL Riil", () => {
    assert.match(
      serviceContent,
      /\.from\(mapDrawingLayers\)/,
      "Service wajib membaca dari tabel mapDrawingLayers",
    );
    assert.match(
      serviceContent,
      /isRealData:\s*true/,
      "Service wajib menandai isRealData: true secara transparan",
    );
    assert.match(
      schemaContent,
      /export const mapDrawingLayers\s*=\s*pgTable\(/,
      "Skema wajib mengekspor tabel mapDrawingLayers Drizzle",
    );
    assert.match(
      schemaContent,
      /numeric\("opacity"/,
      "Tabel wajib memiliki kolom opacity",
    );
    assert.match(
      schemaContent,
      /integer\("z_index"\)/,
      "Tabel wajib memiliki kolom z_index",
    );
    assert.match(
      schemaContent,
      /boolean\("is_visible"\)/,
      "Tabel wajib memiliki kolom is_visible",
    );
    assert.match(
      schemaContent,
      /jsonb\("shapes"\)/,
      "Tabel wajib menyimpan objek bentuk pada kolom jsonb shapes",
    );
  });
});
