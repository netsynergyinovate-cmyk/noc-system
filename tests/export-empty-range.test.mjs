import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";

process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:5432/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3101";

const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

register();

const { generateRealExportData } =
  await import("../src/services/export.service.ts");
const { getExportPreview } = await import("../src/lib/dashboard/export.ts");

// Gunakan waktu masa lalu sebelum data tiruan dimulai (mis. tahun 2020)
const EMPTY_NOW = Date.UTC(2020, 0, 1, 0, 0, 0) / 1000;

test("ekspor kosong: generateRealExportData menghasilkan file dengan header CSV valid walau 0 baris", async () => {
  const csv = await generateRealExportData(
    "audit-log",
    "csv",
    "24h",
    EMPTY_NOW,
  );
  assert.equal(csv.rowCount, 0);
  assert.equal(csv.isEmpty, true);
  assert.ok(
    csv.content.includes("ID,Waktu"),
    "Header harus tetap ada di CSV kosong",
  );
  // Hanya satu baris (header)
  assert.equal(csv.content.split("\r\n").length, 1);
});

test("ekspor kosong: generateRealExportData format JSON menghasilkan array kosong []", async () => {
  const json = await generateRealExportData(
    "audit-log",
    "json",
    "24h",
    EMPTY_NOW,
  );
  assert.equal(json.rowCount, 0);
  assert.equal(json.isEmpty, true);
  assert.equal(json.content, "[]");
  assert.deepEqual(JSON.parse(json.content), []);
});

test("ekspor kosong: getExportPreview mendeteksi status isEmpty dan tidak melempar error", () => {
  const preview = getExportPreview("audit-log", EMPTY_NOW, "24h");
  assert.equal(preview.totalRows, 0);
  assert.equal(preview.isEmpty, true);
  assert.deepEqual(preview.sampleRows, []);
  assert.ok(preview.headers.length > 0);
});
