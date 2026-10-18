import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const boardPath = path.resolve(__dirname, "../src/components/map/hierarchy-map-board.tsx");
const mapPath = path.resolve(__dirname, "../src/components/map/network-map.tsx");

test("Task: Sediakan Tutup Buka Panel Tanpa Muat Ulang (No Remount / No Reload)", async (t) => {
  const boardContent = fs.readFileSync(boardPath, "utf8");
  const mapContent = fs.readFileSync(mapPath, "utf8");

  await t.test("1. Persistensi Elemen Peta di DOM: Kanvas Peta Tidak Pernah Ter-unmount", () => {
    // Pastikan NetworkMapLeafletLoader berada di luar blok isTreeOpen
    assert.match(
      boardContent,
      /\{isTreeOpen && \([\s\S]*?<\/Card>\s*\)\}[\s\S]*?<div className="flex-1 relative w-full h-full[\s\S]*?<NetworkMapLeafletLoader/,
      "NetworkMapLeafletLoader wajib berada di luar blok kondisional isTreeOpen agar tidak ter-remount",
    );
  });

  await t.test("2. Buka-Tutup Panel Hanya Mengubah State Lokal (Tanpa Trigger Fetch atau Reload)", () => {
    // Tombol close-tree-panel-button hanya mengubah setIsTreeOpen(false)
    assert.match(
      boardContent,
      /onClick=\{\(\) => setIsTreeOpen\(false\)\}/,
      "Tombol tutup panel pohon murni mengubah state isTreeOpen ke false",
    );

    // Tombol floating-open-tree-button hanya mengubah setIsTreeOpen(true)
    assert.match(
      boardContent,
      /onClick=\{\(\) => setIsTreeOpen\(true\)\}/,
      "Tombol buka panel pohon terapung murni mengubah state isTreeOpen ke true",
    );

    // Toggle bar tombol
    assert.match(
      boardContent,
      /onClick=\{\(\) => setIsTreeOpen\(!isTreeOpen\)\}/,
      "Tombol bar kontrol murni membalikkan nilai isTreeOpen",
    );

    // Tidak ada panggilan window.location.reload di dalam aksi toggle panel
    const toggleSnippet = boardContent.slice(
      boardContent.indexOf("toggle-hierarchy-tree-button") - 200,
      boardContent.indexOf("toggle-hierarchy-tree-button") + 200,
    );
    assert.doesNotMatch(
      toggleSnippet,
      /location\.reload/,
      "Aksi toggle panel dilarang memicu reload halaman",
    );
  });

  await t.test("3. Adaptasi Ukuran Kanvas Leaflet Real-time (ResizeObserver & InvalidateSize)", () => {
    // Pastikan ResizeObserver aktif memantau kontainer peta
    assert.match(
      mapContent,
      /const observer = new ResizeObserver\(\(\) => \{[\s\S]*?map\.invalidateSize\(\{ pan: false \}\);/,
      "ResizeObserver wajib memanggil map.invalidateSize saat ukuran kanvas berubah",
    );
    assert.match(
      mapContent,
      /ref=\{mapContainerRef\}/,
      "mapContainerRef wajib dipasangkan pada kontainer elemen kanvas Leaflet",
    );
  });

  await t.test("4. Penutupan Panel Detail Simpul Tanpa Mereset Peta", () => {
    assert.match(
      boardContent,
      /data-testid="selected-hierarchy-node-panel"[\s\S]*?onClick=\{\(\) => setSelectedNode\(null\)\}/,
      "Panel detail simpul wajib memiliki tombol penutup yang menyetel setSelectedNode(null)",
    );
  });

  await t.test("5. Geometri Peta Terjaga saat Item Detail Dibuka/Ditutup", () => {
    assert.match(
      mapContent,
      /map\.invalidateSize\(\{ pan: false \}\);[\s\S]*?\}, \[map, selectedCustomer, selectedInfra\]\);/,
      "Ukuran kanvas peta Leaflet wajib di-invalidateSize saat simpul dibuka atau ditutup tanpa mereset posisi",
    );
  });
});
