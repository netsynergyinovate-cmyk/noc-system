import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const {
  EXPORT_DATA_MOCK_ENTRY,
  EXPORT_DATASETS,
  EXPORT_TIME_RANGES,
  generateExportData,
  escapeCsvCell,
} = await import("../src/lib/dashboard/export.ts");
const { SETUP_DATA_SOURCE_REGISTRY } = await import(
  "../src/lib/dashboard/setup-extended.ts"
);
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

const NOW = Date.UTC(2026, 5, 15, 12, 0, 0) / 1000;

test("EXPORT_DATA_MOCK_ENTRY terdaftar di registry", () => {
  assert.ok(SETUP_DATA_SOURCE_REGISTRY.length >= 14);
  assert.equal(EXPORT_DATA_MOCK_ENTRY.status, "dummy");
  assert.equal(EXPORT_DATA_MOCK_ENTRY.envKey, "DASHBOARD_DATA");
  assert.match(EXPORT_DATA_MOCK_ENTRY.notes, /Fase 5/);
  const found = SETUP_DATA_SOURCE_REGISTRY.find((e) => e.id === "export-reports-data");
  assert.deepEqual(found, EXPORT_DATA_MOCK_ENTRY);
});

test("EXPORT_TIME_RANGES: 4 pilihan dengan detik benar", () => {
  assert.deepEqual(
    EXPORT_TIME_RANGES.map((r) => [r.id, r.seconds]),
    [
      ["24h", 86_400],
      ["7d", 604_800],
      ["30d", 2_592_000],
      ["all", Infinity],
    ],
  );
});

test("generateExportData: CSV dan JSON untuk kelima dataset", () => {
  assert.equal(EXPORT_DATASETS.length, 5);
  for (const d of EXPORT_DATASETS) {
    const csv = generateExportData(d.id, "csv", NOW);
    assert.match(csv.filename, /\.csv$/);
    assert.match(csv.mimeType, /text\/csv/);
    assert.equal(csv.content.split("\r\n").length - 1, csv.rowCount, d.id);
    const json = generateExportData(d.id, "json", NOW);
    assert.match(json.filename, /\.json$/);
    assert.doesNotThrow(() => JSON.parse(json.content), d.id);
    assert.equal(json.rowCount, csv.rowCount, d.id);
  }
});

test("generateExportData: rentang waktu menyaring data berbasis waktu", () => {
  for (const id of ["alerts-history", "anomalies", "audit-log"]) {
    const n = (r) => generateExportData(id, "csv", NOW, r).rowCount;
    const [h24, d7, d30, all] = [n("24h"), n("7d"), n("30d"), n("all")];
    assert.ok(h24 <= d7 && d7 <= d30 && d30 <= all, `${id} monoton`);
    assert.ok(h24 < d7, `${id}: 24h lebih sedikit dari 7d`);
    assert.equal(n(undefined), d7, `${id}: bawaan 7d`);
    assert.equal(
      EXPORT_DATASETS.find((d) => d.id === id).recordCount(NOW, "24h"),
      h24,
      `${id}: recordCount konsisten`,
    );
  }
  // audit 30 hari harus lebih banyak dari 7 hari
  assert.ok(
    generateExportData("audit-log", "csv", NOW, "30d").rowCount >
      generateExportData("audit-log", "csv", NOW, "7d").rowCount,
  );
  // dataset snapshot tidak terpengaruh
  for (const id of ["customers", "billing"]) {
    assert.equal(
      generateExportData(id, "csv", NOW, "24h").rowCount,
      generateExportData(id, "csv", NOW, "all").rowCount,
    );
  }
});

test("escapeCsvCell: sanitasi formula injection dan kutip", () => {
  for (const c of ["=", "+", "-", "@"]) {
    assert.equal(escapeCsvCell(`${c}cmd`), `'${c}cmd`);
  }
  assert.equal(escapeCsvCell("=1+1"), "'=1+1");
  assert.equal(escapeCsvCell("a,b"), '"a,b"');
  assert.equal(escapeCsvCell('say "hi"'), '"say ""hi"""');
  assert.equal(escapeCsvCell(null), "");
  assert.equal(escapeCsvCell(undefined), "");
  assert.equal(escapeCsvCell(42), "42");
});

test("ExportBoard memuat data-testid yang diwajibkan", () => {
  const src = read("../src/components/dashboard/export-board.tsx");
  for (const id of [
    "export-board",
    "export-mock-badge",
    "download-export-btn",
    "export-range-select",
    "export-success-notice",
  ]) {
    assert.ok(src.includes(`data-testid="${id}"`), id);
  }
  assert.match(src, /Data Tiruan Ekspor \(Fase 2\)/);
  assert.match(src, /generator laporan nyata di Fase 5/);
});
