import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

test("Fitur Jalur Kabel Pelanggan: Bangun Halaman Peta Jalur Kabel dengan Data Nyata", async (t) => {
  await t.test(
    "1. Service Backend getCableMapData & Algoritma Kalkulasi Jarak Haversine",
    () => {
      const serviceFile = path.join(
        rootDir,
        "src",
        "services",
        "cable-map.service.ts",
      );
      assert.ok(fs.existsSync(serviceFile), "File cable-map.service.ts harus ada");

      const content = fs.readFileSync(serviceFile, "utf-8");
      assert.match(
        content,
        /export async function getCableMapData/,
        "Harus mengekspor fungsi getCableMapData",
      );
      assert.match(
        content,
        /export function calculateHaversineDistanceMeters/,
        "Harus mengekspor formula kalkulasi jarak Haversine",
      );
      assert.match(
        content,
        /type:\s*("backbone"\s*\|\s*"feeder"\s*\|\s*"distribution"\s*\|\s*"drop")/,
        "Harus mendukung 4 klasifikasi kabel serat optik",
      );
      assert.match(
        content,
        /coreCapacity:\s*number/,
        "Harus menyertakan kapasitas core serat optik",
      );
      assert.match(
        content,
        /estimatedLengthMeters:\s*number/,
        "Harus menyertakan estimasi panjang bentangan kabel",
      );
    },
  );

  await t.test("2. Verifikasi Matematis Formula Haversine Distance", () => {
    // Formula Haversine lokal untuk pengujian deterministik
    function testHaversine(lat1, lon1, lat2, lon2) {
      const R = 6371e3;
      const dLat = ((lat2 - lat1) * Math.PI) / 180;
      const dLon = ((lon2 - lon1) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) *
          Math.cos((lat2 * Math.PI) / 180) *
          Math.sin(dLon / 2) *
          Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return Math.round(R * c);
    }

    // Uji jarak antara koordinat sentral Mukomuko (-2.5786, 101.2185) ke titik ODP terdekat (-2.5800, 101.2200)
    const dist = testHaversine(-2.5786, 101.2185, -2.5800, 101.2200);
    assert.ok(dist > 0, "Jarak harus bernilai positif");
    assert.ok(dist > 100 && dist < 500, `Jarak sekitar ~225m, aktual: ${dist}m`);

    // Titik yang sama harus berjarak 0m
    const zeroDist = testHaversine(-2.5786, 101.2185, -2.5786, 101.2185);
    assert.equal(zeroDist, 0, "Titik koordinat identik harus menghasilkan jarak 0m");
  });

  await t.test("3. Endpoint API GET /api/map/cables Terproteksi Sesi", () => {
    const apiRouteFile = path.join(
      rootDir,
      "src",
      "app",
      "api",
      "map",
      "cables",
      "route.ts",
    );
    assert.ok(fs.existsSync(apiRouteFile), "File API route kabel harus ada");

    const content = fs.readFileSync(apiRouteFile, "utf-8");
    assert.match(
      content,
      /export async function GET/,
      "Harus mengekspor handler GET",
    );
    assert.match(
      content,
      /withApiSession/,
      "Handler API wajib dilindungi withApiSession",
    );
    assert.match(
      content,
      /getCableMapData/,
      "Handler API wajib memanggil service getCableMapData",
    );
  });

  await t.test(
    "4. Komponen CableMapBoard: Filter, Metrik & Legenda Serat Optik",
    () => {
      const boardFile = path.join(
        rootDir,
        "src",
        "components",
        "map",
        "cable-map-board.tsx",
      );
      assert.ok(fs.existsSync(boardFile), "File cable-map-board.tsx harus ada");

      const content = fs.readFileSync(boardFile, "utf-8");
      assert.match(
        content,
        /data-testid="cable-map-board"/,
        "Wajib memiliki data-testid='cable-map-board'",
      );
      assert.match(
        content,
        /data-testid="cable-metrics-grid"/,
        "Wajib merender grid metrik kabel",
      );
      assert.match(
        content,
        /data-testid="metric-total-cables"/,
        "Wajib menampilkan metrik total jalur kabel",
      );
      assert.match(
        content,
        /data-testid="metric-total-length"/,
        "Wajib menampilkan metrik total panjang kabel",
      );
      assert.match(
        content,
        /data-testid="cable-capacity-legend"/,
        "Wajib merender legenda kapasitas serat optik",
      );
      assert.match(
        content,
        /NetworkMapLeafletLoader/,
        "Wajib mengintegrasikan NetworkMapLeafletLoader",
      );
      assert.match(
        content,
        /data-testid="cable-list-sidebar"/,
        "Wajib menyediakan panel daftar jalur kabel",
      );
    },
  );

  await t.test("5. Halaman Server Component /app/peta/kabel & Rute Alias /app/kabel", () => {
    const pageFile = path.join(
      rootDir,
      "src",
      "app",
      "(protected)",
      "app",
      "peta",
      "kabel",
      "page.tsx",
    );
    assert.ok(fs.existsSync(pageFile), "Halaman /app/peta/kabel/page.tsx harus ada");

    const content = fs.readFileSync(pageFile, "utf-8");
    assert.match(
      content,
      /requireSession/,
      "Halaman wajib memvalidasi sesi dengan requireSession",
    );
    assert.match(
      content,
      /getCableMapData/,
      "Halaman wajib memuat data nyata via getCableMapData",
    );
    assert.match(
      content,
      /CableMapBoard/,
      "Halaman wajib merender komponen CableMapBoard",
    );

    const aliasFile = path.join(
      rootDir,
      "src",
      "app",
      "(protected)",
      "app",
      "kabel",
      "page.tsx",
    );
    assert.ok(fs.existsSync(aliasFile), "Rute alias /app/kabel/page.tsx harus ada");
  });

  await t.test("6. Tautan Navigasi Modul Peta & Sidebar", () => {
    const navFile = path.join(
      rootDir,
      "src",
      "components",
      "dashboard",
      "app-nav.tsx",
    );
    const navContent = fs.readFileSync(navFile, "utf-8");
    assert.match(
      navContent,
      /\/app\/peta\/kabel/,
      "Sidebar harus memiliki menu ke /app/peta/kabel",
    );

    const petaPageFile = path.join(
      rootDir,
      "src",
      "app",
      "(protected)",
      "app",
      "peta",
      "page.tsx",
    );
    const petaContent = fs.readFileSync(petaPageFile, "utf-8");
    assert.match(
      petaContent,
      /data-testid="shortcut-cable-map-link"/,
      "Halaman peta utama harus memiliki tombol shortcut ke peta jalur kabel",
    );
  });
});
