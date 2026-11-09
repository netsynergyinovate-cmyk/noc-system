import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  getPanelClearanceOffset,
  calculatePanelClearanceLatLng,
  flyToWithoutOcclusion,
} from "../src/lib/map-viewport-offset.ts";

test("Pencegahan Panel Detail Menutupi Titik Terpilih (Prevent Panel Occlusion)", async (t) => {
  const offsetUtilFile = path.resolve("src/lib/map-viewport-offset.ts");
  const layerFile = path.resolve(
    "src/components/map/map-detail-inspector-layer.tsx",
  );
  const mapFile = path.resolve("src/components/map/network-map.tsx");

  assert.equal(
    fs.existsSync(offsetUtilFile),
    true,
    "File map-viewport-offset.ts harus ada",
  );
  assert.equal(
    fs.existsSync(layerFile),
    true,
    "File map-detail-inspector-layer.tsx harus ada",
  );
  assert.equal(fs.existsSync(mapFile), true, "File network-map.tsx harus ada");

  const layerContent = fs.readFileSync(layerFile, "utf-8");
  const mapContent = fs.readFileSync(mapFile, "utf-8");

  await t.test(
    "getPanelClearanceOffset menghitung kompensasi piksel adaptif resolusi layar",
    () => {
      // Mobile (< 768px): panel di bawah penuh, geser titik ke atas (offsetY negatif, offsetX 0)
      const mobileOffset = getPanelClearanceOffset(480);
      assert.equal(mobileOffset.offsetX, 0, "OffsetX pada mobile harus 0");
      assert.equal(
        mobileOffset.offsetY,
        -130,
        "OffsetY pada mobile harus -130",
      );

      // Tablet (768px - 1023px): panel di pojok kanan bawah
      const tabletOffset = getPanelClearanceOffset(820);
      assert.equal(
        tabletOffset.offsetX,
        -110,
        "OffsetX pada tablet harus -110",
      );
      assert.equal(tabletOffset.offsetY, -70, "OffsetY pada tablet harus -70");

      // Desktop (>= 1024px): panel di pojok kanan bawah selebar 352px
      const desktopOffset = getPanelClearanceOffset(1440);
      assert.equal(
        desktopOffset.offsetX,
        -150,
        "OffsetX pada desktop harus -150",
      );
      assert.equal(
        desktopOffset.offsetY,
        -50,
        "OffsetY pada desktop harus -50",
      );
    },
  );

  await t.test(
    "calculatePanelClearanceLatLng dan flyToWithoutOcclusion memproyeksikan koordinat bebas rintangan",
    () => {
      let flyToCalledWith = null;

      // Mock objek Leaflet Map
      const mockMap = {
        getZoom: () => 17,
        project: (_latlng, _zoom) => ({ x: 1000, y: 1000 }),
        unproject: (point, _zoom) => ({
          lat: -6.2 + (point.y - 1000) * 0.0001,
          lng: 106.8 + (point.x - 1000) * 0.0001,
        }),
        flyTo: (center, zoom, options) => {
          flyToCalledWith = { center, zoom, options };
        },
      };

      const [adjLat, adjLng] = calculatePanelClearanceLatLng(
        mockMap,
        -6.2,
        106.8,
        17,
        1200,
      );
      assert.notEqual(
        adjLat,
        -6.2,
        "Latitude harus digeser untuk kompensasi panel",
      );
      assert.notEqual(
        adjLng,
        106.8,
        "Longitude harus digeser untuk kompensasi panel",
      );

      const success = flyToWithoutOcclusion(mockMap, -6.2, 106.8, 17);
      assert.equal(
        success,
        true,
        "flyToWithoutOcclusion harus mengembalikan true saat berhasil",
      );
      assert.ok(flyToCalledWith, "flyTo pada map harus dipanggil");
      assert.equal(flyToCalledWith.zoom, 17, "Zoom target harus sesuai");
    },
  );

  await t.test(
    "network-map.tsx menerapkan flyToWithoutOcclusion saat pemilihan titik dan navigasi fokus",
    () => {
      assert.match(
        mapContent,
        /import\s*\{[^}]*flyToWithoutOcclusion[^}]*\}\s*from\s*"[^"]*map-viewport-offset"/,
        "Harus mengimpor flyToWithoutOcclusion",
      );
      assert.match(
        mapContent,
        /flyToWithoutOcclusion\s*\(\s*map,\s*cust\.latitude,\s*cust\.longitude/,
        "handleSelectCustomer harus menggunakan flyToWithoutOcclusion",
      );
      assert.match(
        mapContent,
        /flyToWithoutOcclusion\s*\(\s*map,\s*infra\.latitude,\s*infra\.longitude/,
        "handleSelectInfra harus menggunakan flyToWithoutOcclusion",
      );
    },
  );

  await t.test(
    "map-detail-inspector-layer.tsx menerapkan flyToWithoutOcclusion pada tombol fokus panel",
    () => {
      assert.match(
        layerContent,
        /import\s*\{[^}]*flyToWithoutOcclusion[^}]*\}\s*from\s*"[^"]*map-viewport-offset"/,
        "Inspector layer harus mengimpor flyToWithoutOcclusion",
      );
      assert.match(
        layerContent,
        /flyToWithoutOcclusion\s*\(\s*map,\s*lat,\s*lng/,
        "handleFocus harus memanggil flyToWithoutOcclusion",
      );
    },
  );
});
