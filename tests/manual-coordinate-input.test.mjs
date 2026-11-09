import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const networkMapPath = path.resolve(
  __dirname,
  "../src/components/map/network-map.tsx",
);

test("Fitur Input Titik Koordinat GPS Manual di Peta Jaringan", async (t) => {
  const content = fs.readFileSync(networkMapPath, "utf8");

  await t.test(
    "1. Tombol Buka Input Koordinat GPS Manual Tersedia di Bilah Aksi Peta",
    () => {
      assert.match(
        content,
        /data-testid="open-manual-coord-input-button"/,
        "Harus ada tombol pembuka input koordinat dengan data-testid='open-manual-coord-input-button'",
      );
      assert.match(
        content,
        /Input GPS/,
        "Tombol harus memuat label 'Input GPS'",
      );
    },
  );

  await t.test(
    "2. Floating Card Input Koordinat GPS Manual Memiliki Kontrol & Form Validasi Lengkap",
    () => {
      assert.match(
        content,
        /data-testid="manual-coord-input-card"/,
        "Harus menyediakan kartu dialog floating dengan data-testid='manual-coord-input-card'",
      );
      assert.match(
        content,
        /data-testid="manual-coord-input-field"/,
        "Harus menyediakan input teks koordinat dengan data-testid='manual-coord-input-field'",
      );
      assert.match(
        content,
        /data-testid="apply-manual-coord-button"/,
        "Harus menyediakan tombol terapkan titik dengan data-testid='apply-manual-coord-button'",
      );
      assert.match(
        content,
        /data-testid="close-manual-coord-button"/,
        "Harus menyediakan tombol tutup dialog dengan data-testid='close-manual-coord-button'",
      );
      assert.match(
        content,
        /data-testid="plot-manual-coord-customer-button"/,
        "Harus menyediakan tombol pintasan tautkan ke pelanggan dengan data-testid='plot-manual-coord-customer-button'",
      );
    },
  );

  await t.test(
    "3. Logika Parser Mendukung Beragam Format Koordinat (lat-lng, Google Maps URL, Spasi)",
    () => {
      assert.match(
        content,
        /parseCoordinates/,
        "Komponen harus memiliki fungsi parseCoordinates",
      );
      assert.match(
        content,
        /@\(-?\(\\d|\?|\\.\)\+\),\(-?\(\\d|\?|\\.\)\+\)|googleMapsMatch/,
        "Parser harus mendukung ekstraksi koordinat dari Google Maps URL",
      );
      assert.match(
        content,
        /lat\s*>=\s*-90\s*&&\s*lat\s*<=\s*90/,
        "Parser harus memvalidasi batas latitude antara -90 dan 90",
      );
      assert.match(
        content,
        /lng\s*>=\s*-180\s*&&\s*lng\s*<=\s*180/,
        "Parser harus memvalidasi batas longitude antara -180 dan 180",
      );
    },
  );

  await t.test(
    "4. Aksi Terapkan Mengarahkan Kamera Peta & Menandai Titik Inspeksi",
    () => {
      assert.match(
        content,
        /handleApplyManualCoord/,
        "Harus memiliki fungsi handleApplyManualCoord",
      );
      assert.match(
        content,
        /flyToWithoutOcclusion\([\s\S]*?parsed\.lat,\s*parsed\.lng/,
        "Harus menerbangkan viewport peta ke titik koordinat tanpa tertutup panel",
      );
      assert.match(
        content,
        /setInspectedMapCoord\(parsed\)/,
        "Harus menandai titik inspectedMapCoord agar marker visual hijau tampil di peta",
      );
    },
  );
});
