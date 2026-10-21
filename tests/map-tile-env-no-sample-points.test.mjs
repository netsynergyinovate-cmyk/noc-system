import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const mapConfigPath = path.resolve(__dirname, "../src/config/map.ts");
const networkMapPath = path.resolve(__dirname, "../src/components/map/network-map.tsx");
const petaPagePath = path.resolve(__dirname, "../src/app/(protected)/app/peta/page.tsx");

test("Muat tile peta dari env tanpa titik contoh di kode", async (t) => {
  const configContent = fs.readFileSync(mapConfigPath, "utf8");
  const mapContent = fs.readFileSync(networkMapPath, "utf8");
  const pageContent = fs.readFileSync(petaPagePath, "utf8");

  await t.test("1. Konfigurasi memuat URL tile dari variabel lingkungan (process.env)", () => {
    assert.match(
      configContent,
      /process\.env\.NEXT_PUBLIC_MAP_SATELLITE_URL/,
      "Tile satelit harus membaca NEXT_PUBLIC_MAP_SATELLITE_URL",
    );
    assert.match(
      configContent,
      /process\.env\.NEXT_PUBLIC_MAP_STREETS_URL/,
      "Tile jalan harus membaca NEXT_PUBLIC_MAP_STREETS_URL",
    );
    assert.match(
      configContent,
      /process\.env\.NEXT_PUBLIC_MAP_TOPO_URL/,
      "Tile topografi harus membaca NEXT_PUBLIC_MAP_TOPO_URL",
    );
  });

  await t.test("2. Konfigurasi sentral dan zoom membaca dari environment", () => {
    assert.match(
      configContent,
      /process\.env\.NEXT_PUBLIC_MAP_DEFAULT_LAT/,
      "Latitude sentral harus membaca NEXT_PUBLIC_MAP_DEFAULT_LAT",
    );
    assert.match(
      configContent,
      /process\.env\.NEXT_PUBLIC_MAP_DEFAULT_LNG/,
      "Longitude sentral harus membaca NEXT_PUBLIC_MAP_DEFAULT_LNG",
    );
    assert.match(
      configContent,
      /process\.env\.NEXT_PUBLIC_MAP_DEFAULT_ZOOM/,
      "Zoom default harus membaca NEXT_PUBLIC_MAP_DEFAULT_ZOOM",
    );
  });

  await t.test("3. Komponen NetworkMap bebas dari titik koordinat contoh hardcoded", () => {
    // Memastikan tidak ada array penanda contoh / dummy di file komponen UI
    assert.doesNotMatch(
      mapContent,
      /const (MOCK|DUMMY|SAMPLE)_(CUSTOMERS|POINTS|MARKERS)/i,
      "NetworkMap tidak boleh memuat konstanta penanda contoh hardcoded",
    );
    assert.doesNotMatch(
      mapContent,
      /pppoeUsername:\s*["'](user|budi|ahmad)/i,
      "NetworkMap tidak boleh memiliki data pelanggan contoh hardcoded",
    );
  });

  await t.test("4. Halaman peta /app/peta menyajikan UI data nyata tanpa data tiruan terselubung", () => {
    assert.match(pageContent, /<MapClient \/>/, "Halaman peta harus merender peta jaringan (MapClient)");
    assert.doesNotMatch(
      pageContent,
      /getLocalMockMapData/,
      "Halaman peta utama tidak boleh mengimpor atau memakai getLocalMockMapData",
    );
  });

  await t.test("5. Peta menampilkan empty state resmi jika database belum memiliki titik", () => {
    assert.match(
      mapContent,
      /data-testid="map-empty-state"/,
      "NetworkMap harus menyediakan container map-empty-state",
    );
    assert.match(
      mapContent,
      /Belum Ada Perangkat atau Titik Terdaftar/,
      "Peta harus menampilkan pesan empty state yang jelas saat data kosong",
    );
    assert.match(
      mapContent,
      /\/setup/,
      "Peta harus mengarahkan operator ke menu setup untuk mendaftarkan perangkat riil",
    );
  });
});
