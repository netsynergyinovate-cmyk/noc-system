import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const petaPelangganPath = path.resolve(
  __dirname,
  "../src/app/(protected)/app/pelanggan/peta/page.tsx",
);
const tabelPelangganPath = path.resolve(
  __dirname,
  "../src/app/(protected)/app/pelanggan/page.tsx",
);
const networkMapPath = path.resolve(__dirname, "../src/components/map/network-map.tsx");

test("Bangun halaman peta pelanggan dengan data nyata dari backend", async (t) => {
  const petaContent = fs.readFileSync(petaPelangganPath, "utf8");
  const tabelContent = fs.readFileSync(tabelPelangganPath, "utf8");
  const mapContent = fs.readFileSync(networkMapPath, "utf8");

  await t.test("Halaman /app/pelanggan/peta mengambil data nyata dari backend", () => {
    assert.match(
      petaContent,
      /getNetworkMapData\(\)/,
      "Halaman peta pelanggan harus memanggil getNetworkMapData()",
    );
    assert.match(
      petaContent,
      /requireSession\(\)/,
      "Halaman peta pelanggan harus terproteksi sesi",
    );
  });

  await t.test("Menyediakan badge sumber data nyata (PostgreSQL Live)", () => {
    assert.match(
      petaContent,
      /data-testid="data-source-badge"/,
      "Harus menyediakan data-source-badge",
    );
    assert.match(
      petaContent,
      /PostgreSQL Live/,
      "Badge harus menampilkan PostgreSQL Live saat data nyata aktif",
    );
  });

  await t.test("Menampilkan metrik ringkasan persebaran pelanggan (total, geocoded, unmapped)", () => {
    assert.match(petaContent, /Total Pelanggan/, "Harus menampilkan Total Pelanggan");
    assert.match(petaContent, /Terpetakan \(GPS\)/, "Harus menampilkan Pelanggan Terpetakan");
    assert.match(
      petaContent,
      /Belum Berkoordinat/,
      "Harus menampilkan Pelanggan Belum Berkoordinat",
    );
    assert.match(petaContent, /Pelanggan Online/, "Harus menampilkan Pelanggan Online");
    assert.match(petaContent, /Redaman Kritis/, "Harus menampilkan Redaman Kritis");
  });

  await t.test("Integrasi navigasi dua arah antara Tabel Pelanggan dan Peta Pelanggan", () => {
    assert.match(
      petaContent,
      /\/app\/pelanggan/,
      "Halaman peta harus memiliki tautan kembali ke tabel pelanggan",
    );
    assert.match(
      tabelContent,
      /\/app\/pelanggan\/peta/,
      "Halaman tabel harus memiliki tombol Lihat Peta Pelanggan",
    );
  });

  await t.test("Komponen NetworkMap mendukung initialFocusId untuk sorotan pelanggan dari URL", () => {
    assert.match(
      mapContent,
      /initialFocusId\?: string/,
      "NetworkMapProps harus mendukung initialFocusId",
    );
    assert.match(
      mapContent,
      /(?:map\.flyTo\(\[target\.latitude,\s*target\.longitude\]|flyToWithoutOcclusion\(\s*map,\s*targetCust\.latitude,\s*targetCust\.longitude)/,
      "Peta harus otomatis flyTo ke koordinat pelanggan yang disorot",
    );
  });
});
