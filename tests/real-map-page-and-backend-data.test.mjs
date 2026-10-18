import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pagePath = path.resolve(__dirname, "../src/app/(protected)/app/peta/page.tsx");
const boardPath = path.resolve(__dirname, "../src/components/map/realtime-network-map-board.tsx");
const servicePath = path.resolve(__dirname, "../src/services/network-map.service.ts");
const routePath = path.resolve(__dirname, "../src/app/api/map/network/route.ts");

test("Task: Bangun Halaman Peta dengan Data Nyata dari Backend (Fase 4)", async (t) => {
  const pageContent = fs.readFileSync(pagePath, "utf8");
  const boardContent = fs.readFileSync(boardPath, "utf8");
  const serviceContent = fs.readFileSync(servicePath, "utf8");
  const routeContent = fs.readFileSync(routePath, "utf8");

  await t.test("1. Server Component Halaman Peta (/app/peta) Memuat Data Nyata Backend", () => {
    assert.match(
      pageContent,
      /requireSession\(\)/,
      "Halaman peta wajib memproteksi akses dengan requireSession",
    );
    assert.match(
      pageContent,
      /getNetworkMapData\(\)/,
      "Halaman peta wajib mengambil data operasional riil melalui getNetworkMapData",
    );
    assert.match(
      pageContent,
      /<RealtimeNetworkMapBoard[\s\S]*?initialData=\{mapData\}/,
      "Halaman peta wajib meneruskan initialData riil ke RealtimeNetworkMapBoard",
    );
    assert.doesNotMatch(
      pageContent,
      /dummyData|mockCustomers|sampleDevices/i,
      "Halaman peta dilarang menyematkan data dummy palsu",
    );
  });

  await t.test("2. Komponen RealtimeNetworkMapBoard: Kontrol Segarkan & Auto-Refresh", () => {
    assert.match(
      boardContent,
      /data-testid="realtime-network-map-board"/,
      "Wajib menyertakan container realtime-network-map-board",
    );
    assert.match(
      boardContent,
      /data-testid="refresh-map-button"/,
      "Wajib menyediakan tombol segarkan data manual",
    );
    assert.match(
      boardContent,
      /fetch\("\/api\/map\/network"/,
      "Penyegaran data wajib mengambil dari endpoint riil /api/map/network",
    );
    assert.match(
      boardContent,
      /data-testid="auto-refresh-toggle"/,
      "Wajib menyediakan kontrol toggle auto-refresh berkala",
    );
    assert.match(
      boardContent,
      /setInterval\([\s\S]*?30000\)/,
      "Auto-refresh wajib memiliki interval berkala otomatis",
    );
    assert.match(
      boardContent,
      /data-testid="last-sync-time"/,
      "Wajib menampilkan penanda waktu pembaruan terakhir yang diperbarui",
    );
  });

  await t.test("3. Penanganan Data Kosong (Empty State) & Gagal Muat (Error State)", () => {
    assert.match(
      boardContent,
      /data-testid="empty-map-state"/,
      "Wajib menyediakan tampilan informatif saat data peta di database kosong",
    );
    assert.match(
      boardContent,
      /data-testid="map-error-state"/,
      "Wajib menyediakan tampilan penanganan error saat fetch gagal",
    );
    assert.match(
      boardContent,
      /Coba Lagi/,
      "Wajib menyediakan tombol coba lagi pada saat terjadi kegagalan muat",
    );
    assert.doesNotMatch(
      boardContent,
      /sample_dummy|fake_node/i,
      "Dilarang menghasilkan data palsu diam-diam saat kondisi kosong",
    );
  });

  await t.test("4. Indikator Sumber Data & Metrik Infrastruktur Nyata", () => {
    assert.match(
      boardContent,
      /data-testid="data-source-badge"/,
      "Wajib memiliki badge penanda sumber data (PostgreSQL Live vs Mock)",
    );
    assert.match(
      boardContent,
      /data-testid="infra-metrics-grid"/,
      "Wajib menyertakan grid metrik ringkasan perangkat dan pelanggan",
    );
    assert.match(
      boardContent,
      /data-testid="infra-total-devices"/,
      "Wajib menyertakan metrik total perangkat",
    );
    assert.match(
      boardContent,
      /data-testid="infra-connected-clients"/,
      "Wajib menyertakan metrik pelanggan terpetakan",
    );
    assert.match(
      boardContent,
      /<NetworkMapLeafletLoader[\s\S]*?initialData=\{data\}/,
      "Kanvas Leaflet wajib menerima data operasional dinamis hasil pembaruan",
    );
  });

  await t.test("5. Service Backend getNetworkMapData Membaca PostgreSQL Operasional", () => {
    assert.match(
      serviceContent,
      /\.from\(customers\)/,
      "Service wajib membaca tabel customers",
    );
    assert.match(
      serviceContent,
      /\.from\(olts\)/,
      "Service wajib membaca tabel olts",
    );
    assert.match(
      serviceContent,
      /\.from\(routers\)/,
      "Service wajib membaca tabel routers",
    );
    assert.match(
      serviceContent,
      /\.from\(networkInfrastructure\)/,
      "Service wajib membaca tabel network_infrastructure",
    );
    assert.match(
      serviceContent,
      /isRealData:\s*true/,
      "Metadata wajib menyatakan isRealData true untuk data PostgreSQL",
    );
  });

  await t.test("6. Endpoint API GET /api/map/network", () => {
    assert.match(
      routeContent,
      /withApiSession\(request/,
      "Endpoint /api/map/network wajib diproteksi dengan withApiSession",
    );
    assert.match(
      routeContent,
      /getNetworkMapData/,
      "Endpoint wajib memanggil service getNetworkMapData",
    );
  });
});
