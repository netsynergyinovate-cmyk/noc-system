import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const networkMapPath = path.resolve(__dirname, "../src/components/map/network-map.tsx");
const hierarchyBoardPath = path.resolve(__dirname, "../src/components/map/hierarchy-map-board.tsx");
const loaderPath = path.resolve(__dirname, "../src/components/map/network-map-leaflet-loader.tsx");

test("Fitur Penyorotan Titik Peta dari Panel Pohon Relasi", async (t) => {
  const mapContent = fs.readFileSync(networkMapPath, "utf8");
  const boardContent = fs.readFileSync(hierarchyBoardPath, "utf8");
  const loaderContent = fs.readFileSync(loaderPath, "utf8");

  await t.test("1. Deklarasi Interface NetworkMapProps: focusedNodeId", () => {
    assert.match(
      mapContent,
      /focusedNodeId\?:\s*string\s*\|\s*null/,
      "NetworkMapProps wajib mendeklarasikan focusedNodeId?: string | null",
    );
    assert.match(
      mapContent,
      /export function NetworkMap\(\{[\s\S]*?focusedNodeId[\s\S]*?\}\s*:\s*NetworkMapProps\)/,
      "Komponen NetworkMap wajib menerima properti focusedNodeId",
    );
  });

  await t.test("2. Navigasi Kamera Peta (flyTo) Otomatis Berdasarkan focusedNodeId", () => {
    assert.match(
      mapContent,
      /useEffect\(\(\)\s*=>\s*\{[\s\S]*?if\s*\(!focusedNodeId\s*\|\|\s*!data\)\s*return;/,
      "Wajib ada useEffect yang mendengarkan perubahan focusedNodeId",
    );
    assert.match(
      mapContent,
      /data\.infrastructure\?\.find\(\(inf\)\s*=>\s*inf\.id\s*===\s*focusedNodeId\)/,
      "Wajib mencari simpul infrastruktur yang cocok dengan focusedNodeId",
    );
    assert.match(
      mapContent,
      /data\.customers\?\.find\([\s\S]*?focusedNodeId\)/,
      "Wajib mencari simpul pelanggan yang cocok dengan focusedNodeId",
    );
    assert.match(
      mapContent,
      /(?:map\.flyTo\(\[targetInfra\.latitude,\s*targetInfra\.longitude\]|flyToWithoutOcclusion\(\s*map,\s*targetInfra\.latitude,\s*targetInfra\.longitude)/,
      "Wajib mengarahkan kamera peta ke koordinat infrastruktur",
    );
    assert.match(
      mapContent,
      /(?:map\.flyTo\(\[targetCust\.latitude,\s*targetCust\.longitude\]|flyToWithoutOcclusion\(\s*map,\s*targetCust\.latitude,\s*targetCust\.longitude)/,
      "Wajib mengarahkan kamera peta ke koordinat pelanggan",
    );
  });

  await t.test("3. Efek Visual Penyorotan Simpul Infrastruktur (Highlight Halo Rings)", () => {
    assert.match(
      mapContent,
      /const isHighlighted\s*=\s*selectedInfra\?\.id\s*===\s*infra\.id\s*\|\|\s*focusedNodeId\s*===\s*infra\.id/,
      "Wajib menentukan status isHighlighted pada simpul infrastruktur",
    );
    assert.match(
      mapContent,
      /data-highlighted=\{isHighlighted\s*\?\s*"true"\s*:\s*undefined\}/,
      "Marker infrastruktur wajib menyematkan atribut data-highlighted='true' saat disorot",
    );
    assert.match(
      mapContent,
      /className:\s*"animate-pulse"/,
      "Cincin sorotan wajib memiliki animasi denyut pulsasi (animate-pulse)",
    );
  });

  await t.test("4. Efek Visual Penyorotan Simpul Pelanggan (Highlight Halo Rings)", () => {
    assert.match(
      mapContent,
      /const isCustHighlighted\s*=\s*selectedCustomer\?\.id\s*===\s*cust\.id\s*\|\|\s*focusedNodeId\s*===\s*cust\.id/,
      "Wajib menentukan status isCustHighlighted pada simpul pelanggan",
    );
    assert.match(
      mapContent,
      /data-highlighted=\{isCustHighlighted\s*\?\s*"true"\s*:\s*undefined\}/,
      "Marker pelanggan wajib menyematkan atribut data-highlighted='true' saat disorot",
    );
  });

  await t.test("5. Integrasi HierarchyMapBoard: Meneruskan focusedNodeId ke NetworkMapLeafletLoader", () => {
    assert.match(
      boardContent,
      /<NetworkMapLeafletLoader[\s\S]*?focusedNodeId=\{selectedNode\?\.id\}/,
      "HierarchyMapBoard wajib meneruskan focusedNodeId={selectedNode?.id} ke NetworkMapLeafletLoader",
    );
  });

  await t.test("6. Integrasi Panel Pohon Relasi: Seluruh Tingkatan Memilih & Menyorot Simpul", () => {
    // T1 Root Core/OLT
    assert.match(
      boardContent,
      /handleSelectInfra\(\{[\s\S]*?id:\s*root\.id/,
      "Klik simpul Root wajib memanggil handleSelectInfra untuk memilih dan menyorot titik di peta",
    );
    assert.match(
      boardContent,
      /data-testid=\{`tree-node-\$\{root\.id\}`\}/,
      "Simpul Root wajib memiliki data-testid",
    );

    // T2 ODC
    assert.match(
      boardContent,
      /handleSelectInfra\(\{[\s\S]*?id:\s*odc\.id/,
      "Klik simpul ODC wajib memanggil handleSelectInfra untuk memilih dan menyorot titik di peta",
    );
    assert.match(
      boardContent,
      /data-testid=\{`tree-node-\$\{odc\.id\}`\}/,
      "Simpul ODC wajib memiliki data-testid",
    );

    // T3 ODP
    assert.match(
      boardContent,
      /handleSelectInfra\(\{[\s\S]*?id:\s*odp\.id/,
      "Klik simpul ODP wajib memanggil handleSelectInfra untuk memilih dan menyorot titik di peta",
    );
    assert.match(
      boardContent,
      /data-testid=\{`tree-node-\$\{odp\.id\}`\}/,
      "Simpul ODP wajib memiliki data-testid",
    );

    // T4 Customer
    assert.match(
      boardContent,
      /handleSelectCustomer\(\{[\s\S]*?id:\s*c\.id/,
      "Klik simpul Pelanggan wajib memanggil handleSelectCustomer untuk memilih dan menyorot titik di peta",
    );
    assert.match(
      boardContent,
      /data-testid=\{`tree-node-\$\{c\.id\}`\}/,
      "Simpul Pelanggan wajib memiliki data-testid",
    );
  });
});
