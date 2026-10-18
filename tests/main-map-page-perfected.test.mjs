import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const PAGE_PATH = path.resolve(
  process.cwd(),
  "src/app/(protected)/app/peta/page.tsx",
);
const BOARD_PATH = path.resolve(
  process.cwd(),
  "src/components/map/realtime-network-map-board.tsx",
);
const SERVICE_PATH = path.resolve(
  process.cwd(),
  "src/services/network-map.service.ts",
);

test("Task: Bangun halaman peta utama dengan data nyata dari backend (Penyempurnaan Tampilan Peta)", async (t) => {
  const pageContent = fs.readFileSync(PAGE_PATH, "utf8");
  const boardContent = fs.readFileSync(BOARD_PATH, "utf8");
  const serviceContent = fs.readFileSync(SERVICE_PATH, "utf8");

  await t.test("1. Server Component Halaman Peta (/app/peta) Mengambil Data Nyata PostgreSQL Secara Defensif", () => {
    assert.match(
      pageContent,
      /requireSession\(\)/,
      "Wajib memanggil requireSession() untuk autentikasi",
    );
    assert.match(
      pageContent,
      /getNetworkMapData\(\)/,
      "Wajib memanggil getNetworkMapData() dari backend service nyata",
    );
    assert.match(
      pageContent,
      /try\s*\{[\s\S]*getNetworkMapData\(\)[\s\S]*\}\s*catch\s*\(err\)/,
      "Wajib membungkus pengambilan data dengan try/catch defensif",
    );
    assert.match(
      pageContent,
      /readFocusId/,
      "Wajib mendukung fokus perangkat via URL searchParams",
    );
    assert.match(
      pageContent,
      /<RealtimeNetworkMapBoard[\s\S]*?initialData=\{mapData\}[\s\S]*?embeddedInPage/,
      "Wajib meneruskan initialData dan embeddedInPage ke RealtimeNetworkMapBoard",
    );
  });

  await t.test("2. RealtimeNetworkMapBoard Mendukung embeddedInPage & Mencegah Duplikasi Render", () => {
    assert.match(
      boardContent,
      /embeddedInPage\?: boolean/,
      "RealtimeNetworkMapBoardProps harus memiliki prop embeddedInPage",
    );
    assert.match(
      boardContent,
      /if\s*\(embeddedInPage\)\s*\{/,
      "RealtimeNetworkMapBoard harus memiliki percabangan render untuk mode embeddedInPage",
    );
    assert.match(
      boardContent,
      /data-testid="last-sync-time"/,
      "Wajib memiliki penanda waktu pembaruan terakhir",
    );
    assert.match(
      boardContent,
      /data-testid="auto-refresh-toggle"/,
      "Wajib memiliki kontrol toggle auto-refresh",
    );
    assert.match(
      boardContent,
      /data-testid="refresh-map-button"/,
      "Wajib memiliki tombol segarkan data",
    );
    assert.match(
      boardContent,
      /<NetworkMapLeafletLoader[\s\S]*?initialData=\{data\}/,
      "Wajib merender peta Leaflet dinamis dengan data operasional",
    );
  });

  await t.test("3. Backend Service Membaca PostgreSQL Nyata (Zero-Dummy)", () => {
    assert.match(
      serviceContent,
      /\.from\(customers\)/,
      "Service wajib membaca tabel database customers",
    );
    assert.match(
      serviceContent,
      /\.from\(olts\)/,
      "Service wajib membaca tabel database olts",
    );
    assert.match(
      serviceContent,
      /\.from\(routers\)/,
      "Service wajib membaca tabel database routers",
    );
    assert.match(
      serviceContent,
      /\.from\(networkInfrastructure\)/,
      "Service wajib membaca tabel database network_infrastructure",
    );
    assert.match(
      serviceContent,
      /isRealData:\s*true/,
      "Metadata dataSource wajib menyatakan isRealData: true",
    );
  });
});
