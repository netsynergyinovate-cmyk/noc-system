import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { EXPORT_DATASETS, getExportPreview, generateExportData } =
  await import("../src/lib/dashboard/export.ts");
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

const NOW = Date.UTC(2026, 5, 15, 12, 0, 0) / 1000;
const EMPTY_NOW = Date.UTC(2024, 5, 1) / 1000; // sebelum data tiruan audit dimulai

test("getExportPreview: headers dan sampel untuk kelima dataset", () => {
  for (const d of EXPORT_DATASETS) {
    const p = getExportPreview(d.id, NOW, "all");
    assert.ok(p.headers.length > 0, d.id);
    assert.equal(
      p.totalRows,
      generateExportData(d.id, "csv", NOW, "all").rowCount,
      d.id,
    );
    assert.equal(p.isEmpty, p.totalRows === 0, d.id);
    assert.ok(
      p.sampleRows.length <= 3 && p.sampleRows.length <= p.totalRows,
      d.id,
    );
    for (const r of p.sampleRows)
      assert.equal(r.length, p.headers.length, d.id);
    assert.ok(p.estimatedSizeKb >= 0, d.id);
  }
});

test("getExportPreview: previewLimit dibatasi 0..5", () => {
  const p99 = getExportPreview("customers", NOW, "all", 99);
  assert.ok(p99.sampleRows.length <= 5);
  assert.equal(
    getExportPreview("customers", NOW, "all", 0).sampleRows.length,
    0,
  );
});

test("getExportPreview: kosong bila tidak ada data", () => {
  const p = getExportPreview("audit-log", EMPTY_NOW, "24h");
  assert.equal(p.totalRows, 0);
  assert.equal(p.isEmpty, true);
  assert.deepEqual(p.sampleRows, []);
  assert.ok(p.headers.length > 0);
});

test("getExportPreview: ukuran realistis (sama dengan byte CSV)", () => {
  const p = getExportPreview("customers", NOW, "all");
  const bytes = Buffer.byteLength(
    generateExportData("customers", "csv", NOW, "all").content,
  );
  assert.ok(Math.abs(p.estimatedSizeKb - bytes / 1024) < 0.06);
});

test("ExportBoard memuat state pratinjau, kosong, dan unduh", () => {
  const src = read("../src/components/dashboard/export-board.tsx");
  for (const id of [
    "export-board",
    "export-range-select",
    "download-export-btn",
    "export-preview-table",
    "export-empty-state",
    "export-success-notice",
  ]) {
    assert.ok(src.includes(`data-testid="${id}"`), id);
  }
  assert.match(src, /Menyiapkan data laporan\.\.\./);
  assert.match(src, /Tidak ada data dalam rentang waktu yang dipilih\./);
  assert.match(src, /Pilih Rentang Lebih Luas/);
  assert.match(src, /setSelectedRange\("all"\)/);
});
