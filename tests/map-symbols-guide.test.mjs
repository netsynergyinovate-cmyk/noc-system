import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("Panel Panduan Singkat Simbol Peta & Navigasi Operasional (Map Symbols Quick Guide)", async (t) => {
  const guideFile = path.resolve("src/components/map/map-symbols-guide-dialog.tsx");
  const mapFile = path.resolve("src/components/map/network-map.tsx");

  assert.equal(fs.existsSync(guideFile), true, "File map-symbols-guide-dialog.tsx harus ada");
  assert.equal(fs.existsSync(mapFile), true, "File network-map.tsx harus ada");

  const guideContent = fs.readFileSync(guideFile, "utf-8");
  const mapContent = fs.readFileSync(mapFile, "utf-8");

  await t.test("Komponen MapSymbolsGuideDialog memiliki trigger dan modal dialog", () => {
    assert.match(guideContent, /export function MapSymbolsGuideDialog/, "Harus mengekspor MapSymbolsGuideDialog");
    assert.match(guideContent, /data-testid="open-map-symbols-guide"/, "Harus menyediakan tombol trigger buka panduan");
    assert.match(guideContent, /data-testid="map-symbols-guide-dialog"/, "Harus merender dialog modal panduan simbol");
    assert.match(guideContent, /data-testid="close-map-symbols-guide"/, "Harus menyediakan tombol tutup panduan");
  });

  await t.test("Tersedia tab pemilih topik (nodes, cables, gestures)", () => {
    assert.match(guideContent, /data-testid="guide-tab-nodes"/, "Harus ada tab Simbol Titik & Status");
    assert.match(guideContent, /data-testid="guide-tab-cables"/, "Harus ada tab Kapasitas Kabel Optik");
    assert.match(guideContent, /data-testid="guide-tab-gestures"/, "Harus ada tab Interaksi & Aksi Peta");
  });

  await t.test("Seksi titik dan status merinci pelanggan dan seluruh perangkat fisik", () => {
    assert.match(guideContent, /data-testid="guide-section-nodes"/, "Harus ada seksi titik dan status");
    assert.match(guideContent, /Pelanggan Online/, "Mencakup penjelasan status online");
    assert.match(guideContent, /Redaman Optik Kritis/, "Mencakup penjelasan redaman kritis");
    assert.match(guideContent, /Status Terisolir/, "Mencakup penjelasan status isolir");
    assert.match(guideContent, /Core Router Gateway/, "Mencakup penjelasan Core Router");
    assert.match(guideContent, /OLT \(Optical Line Terminal\)/, "Mencakup penjelasan OLT");
    assert.match(guideContent, /ODC \(Optical Distribution Cabinet\)/, "Mencakup penjelasan ODC");
    assert.match(guideContent, /ODP \(Optical Distribution Point\)/, "Mencakup penjelasan ODP");
    assert.match(guideContent, /Tiang Tumpu Fiber/, "Mencakup penjelasan Tiang");
  });

  await t.test("Seksi kapasitas kabel merinci hierarki serat dari Backbone hingga Drop Core", () => {
    assert.match(guideContent, /data-testid="guide-section-cables"/, "Harus ada seksi kabel optik");
    assert.match(guideContent, /Jalur Backbone Optik \(48 - 96 Core\)/, "Mencakup panduan backbone 48-96 core");
    assert.match(guideContent, /Jalur Feeder Distribusi \(16 - 24 Core\)/, "Mencakup panduan feeder 16-24 core");
    assert.match(guideContent, /Jalur Distribusi Cabang \(4 - 8 Core\)/, "Mencakup panduan cabang 4-8 core");
    assert.match(guideContent, /Kabel Drop Core Pelanggan \(1 - 2 Core\)/, "Mencakup panduan drop core 1-2 core");
  });

  await t.test("network-map.tsx memasang tombol panduan di bilah kontrol dan mengekspor komponen", () => {
    assert.match(mapContent, /import\s*\{[^}]*MapSymbolsGuideDialog[^}]*\}\s*from\s*"[^"]*map-symbols-guide-dialog"/, "Harus mengimpor MapSymbolsGuideDialog");
    assert.match(mapContent, /<MapSymbolsGuideDialog\s*\/>/, "Harus merender MapSymbolsGuideDialog di bilah kontrol mengambang");
    assert.match(mapContent, /export\s*\{[^}]*MapSymbolsGuideDialog[^}]*\}/, "Harus mengekspor MapSymbolsGuideDialog");
  });
});
