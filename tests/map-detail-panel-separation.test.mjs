import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("Pemisahan State Panel Detail dari Layer Titik Peta (Decoupled Inspector Layer)", async (t) => {
  const hookFile = path.resolve("src/components/map/use-map-detail-panel.ts");
  const layerFile = path.resolve("src/components/map/map-detail-inspector-layer.tsx");
  const mapFile = path.resolve("src/components/map/network-map.tsx");

  assert.equal(fs.existsSync(hookFile), true, "File use-map-detail-panel.ts harus ada");
  assert.equal(fs.existsSync(layerFile), true, "File map-detail-inspector-layer.tsx harus ada");
  assert.equal(fs.existsSync(mapFile), true, "File network-map.tsx harus ada");

  const hookContent = fs.readFileSync(hookFile, "utf-8");
  const layerContent = fs.readFileSync(layerFile, "utf-8");
  const mapContent = fs.readFileSync(mapFile, "utf-8");

  await t.test("Hook useMapDetailPanel mengelola state inspeksi secara terisolasi dan modular", () => {
    assert.match(hookContent, /export function useMapDetailPanel/, "Harus mengekspor hook useMapDetailPanel");
    assert.match(hookContent, /selectedCustomer,\s*setSelectedCustomer/, "Harus mengelola selectedCustomer secara mandiri");
    assert.match(hookContent, /selectedInfra,\s*setSelectedInfra/, "Harus mengelola selectedInfra secara mandiri");
    assert.match(hookContent, /customerEdit,\s*setCustomerEdit/, "Harus mengelola state mode edit lokasi pelanggan");
    assert.match(hookContent, /infraMove,\s*setInfraMove/, "Harus mengelola state pemindahan & penghapusan perangkat infrastruktur");
  });

  await t.test("Komponen MapDetailInspectorLayer merender panel detail di luar kanvas render Leaflet", () => {
    assert.match(layerContent, /data-testid="map-inspector-container"/, "Harus membungkus panel inspeksi dalam kontainer terpisah");
    assert.match(layerContent, /data-testid="customer-detail-panel"/, "Harus merender CustomerDetailPanel");
    assert.match(layerContent, /data-testid="infra-action-success-message"/, "Harus merender banner sukses aksi");
    assert.match(layerContent, /data-testid="infra-action-error-message"/, "Harus merender banner error aksi");
    assert.match(layerContent, /DeviceDetailPanel/, "Harus merender DeviceDetailPanel");
  });

  await t.test("network-map.tsx mengintegrasikan MapDetailInspectorLayer dengan memoized inspector state", () => {
    assert.match(mapContent, /import\s*\{[^}]*MapDetailInspectorLayer[^}]*\}\s*from\s*"[^"]*map-detail-inspector-layer"/, "Harus mengimpor MapDetailInspectorLayer");
    assert.match(mapContent, /const customerEditState = useMemo\(/, "Harus memisahkan objek customerEditState dengan useMemo");
    assert.match(mapContent, /const infraMoveState = useMemo\(/, "Harus memisahkan objek infraMoveState dengan useMemo");
    assert.match(mapContent, /<MapDetailInspectorLayer/, "Harus merender MapDetailInspectorLayer di template");
  });

  await t.test("Barrel export network-map mengekspor modul inspector layer untuk integrasi modular", () => {
    assert.match(mapContent, /export\s*\{[^}]*MapDetailInspectorLayer[^}]*\}/, "Harus mengekspor MapDetailInspectorLayer");
    assert.match(mapContent, /export\s*\{[^}]*useMapDetailPanel[^}]*\}/, "Harus mengekspor useMapDetailPanel");
  });
});
