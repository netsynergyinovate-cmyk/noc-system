import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const seedServicePath = path.resolve(__dirname, "../src/services/seed-data.service.ts");
const verifyScriptPath = path.resolve(__dirname, "../scripts/verify-zero-dummy.mjs");

test("Hapus seed data contoh dari sumber produksi", async (t) => {
  const seedContent = fs.readFileSync(seedServicePath, "utf8");
  const verifyContent = fs.readFileSync(verifyScriptPath, "utf8");

  await t.test("Menyediakan fungsi purgeSampleSeedDataFromProduction dan checkSampleSeedDataInProduction", () => {
    assert.match(
      seedContent,
      /export async function purgeSampleSeedDataFromProduction/,
      "Harus mengekspor purgeSampleSeedDataFromProduction",
    );
    assert.match(
      seedContent,
      /export async function checkSampleSeedDataInProduction/,
      "Harus mengekspor checkSampleSeedDataInProduction",
    );
  });

  await t.test("Menghapus router dummy bawaan 10.10.0.1:8728 saat pembersihan", () => {
    assert.match(
      seedContent,
      /delete\(routers\)[\s\S]*where\(eq\(routers\.host,\s*"10\.10\.0\.1:8728"\)\)/,
      "Purge harus menghapus router dummy bawaan",
    );
  });

  await t.test("Menghapus kontak dummy WhatsApp saat pembersihan", () => {
    assert.match(
      seedContent,
      /6281200000001/,
      "Purge harus menargetkan kontak dummy 6281200000001",
    );
    assert.match(
      seedContent,
      /6281200000002/,
      "Purge harus menargetkan kontak dummy 6281200000002",
    );
  });

  await t.test("Mencegah penyemaian otomatis data contoh saat mode live/produksi aktif", () => {
    assert.match(
      seedContent,
      /process\.env\.NODE_ENV === "production"/,
      "Harus memeriksa NODE_ENV production",
    );
    assert.match(
      seedContent,
      /status:\s*"skipped"/,
      "Harus mengembalikan status skipped saat live/produksi",
    );
  });

  await t.test("verify-zero-dummy.mjs memeriksa bendera DUMMY_MAP untuk modul peta", () => {
    assert.match(
      verifyContent,
      /DUMMY_MAP/,
      "verify-zero-dummy harus memeriksa bendera DUMMY_MAP",
    );
    assert.match(
      verifyContent,
      /\/app\/peta/,
      "verify-zero-dummy harus mereferensikan halaman /app/peta",
    );
  });
});
