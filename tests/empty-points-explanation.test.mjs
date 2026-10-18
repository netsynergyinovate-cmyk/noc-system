import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const networkMapPath = path.resolve(__dirname, "../src/components/map/network-map.tsx");

test("Tampilkan keterangan saat hasil titik kosong", async (t) => {
  const content = fs.readFileSync(networkMapPath, "utf8");

  await t.test("Menampilkan keterangan saat hasil saringan filter menghasilkan titik kosong", () => {
    assert.match(
      content,
      /data-testid="filter-empty-state"/,
      "Peta harus menampilkan kontainer filter-empty-state saat saringan menghasilkan 0 titik",
    );
    assert.match(
      content,
      /Tidak ada titik pelanggan untuk saringan/,
      "Harus memuat keterangan teks yang jelas mengenai kriteria saringan aktif",
    );
    assert.match(
      content,
      /data-testid="reset-filter-button"/,
      "Harus menyediakan tombol reset saringan dengan data-testid='reset-filter-button'",
    );
  });

  await t.test("Menampilkan keterangan saat seluruh pelanggan di database belum memiliki koordinat GPS", () => {
    assert.match(
      content,
      /data-testid="unmapped-customers-empty-state"/,
      "Peta harus menampilkan unmapped-customers-empty-state saat semua pelanggan belum berkoordinat",
    );
    assert.match(
      content,
      /Semua Pelanggan Belum Memiliki Koordinat GPS/,
      "Harus ada judul yang menjelaskan kondisi belum adanya koordinat GPS",
    );
    assert.match(
      content,
      /data-testid="open-customer-table-button"/,
      "Harus menyediakan tombol aksi langsung menuju tabel pelanggan",
    );
    assert.match(
      content,
      /href="\/app\/pelanggan"/,
      "Tombol aksi harus mengarahkan ke /app/pelanggan untuk pengisian koordinat",
    );
  });

  await t.test("Menampilkan keterangan saat kata kunci pencarian tidak menemukan titik", () => {
    assert.match(
      content,
      /data-testid="search-empty-state"/,
      "Peta harus menampilkan search-empty-state saat query tidak menemukan titik",
    );
    assert.match(
      content,
      /Tidak ditemukan titik pelanggan untuk/,
      "Harus menjelaskan bahwa query yang dicari tidak ditemukan",
    );
    assert.match(
      content,
      /data-testid="reset-search-button"/,
      "Harus menyediakan tombol reset pencarian",
    );
  });

  await t.test("Menampilkan empty state saat perangkat dan titik sama sekali belum terdaftar di sistem", () => {
    assert.match(
      content,
      /data-testid="map-empty-state"/,
      "Peta harus menampilkan map-empty-state saat belum ada perangkat/titik",
    );
    assert.match(
      content,
      /href="\/setup"/,
      "Harus ada link menuju setup perangkat",
    );
  });
});
