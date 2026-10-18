import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("Task: Sinkronkan posisi lapisan gambar dengan peta (Fase 5)", async (t) => {
  const overlayPath = path.join(
    process.cwd(),
    "src/components/map/leafer-canvas-overlay.tsx",
  );
  const boardPath = path.join(
    process.cwd(),
    "src/components/map/drawing-layer-map-board.tsx",
  );
  const mapPath = path.join(
    process.cwd(),
    "src/components/map/network-map.tsx",
  );
  const schemaPath = path.join(
    process.cwd(),
    "src/db/schema/map-drawing-layers.ts",
  );
  const validatorPath = path.join(
    process.cwd(),
    "src/validators/map-drawing-layers.ts",
  );

  const overlayContent = fs.readFileSync(overlayPath, "utf-8");
  const boardContent = fs.readFileSync(boardPath, "utf-8");
  const mapContent = fs.readFileSync(mapPath, "utf-8");
  const schemaContent = fs.readFileSync(schemaPath, "utf-8");
  const validatorContent = fs.readFileSync(validatorPath, "utf-8");

  await t.test("1. Skema Database & Validator Mendukung Koordinat Geografis (geoCoordinates & geoRadius)", () => {
    assert.match(
      schemaContent,
      /geoCoordinates\?:\s*\[number,\s*number\]\s*\|\s*\[number,\s*number\]\[\]/,
      "Skema DrawingShape wajib menyertakan properti geoCoordinates opsional",
    );
    assert.match(
      schemaContent,
      /geoRadius\?:\s*number/,
      "Skema DrawingShape wajib menyertakan properti geoRadius opsional",
    );
    assert.match(
      validatorContent,
      /geoCoordinates:\s*z\s*\.union\(\[\s*z\.tuple\(\[z\.number\(\),\s*z\.number\(\)\]\)/,
      "Validator Zod wajib memvalidasi geoCoordinates",
    );
    assert.match(
      validatorContent,
      /geoRadius:\s*z\.number\(\)\.optional\(\)/,
      "Validator Zod wajib memvalidasi geoRadius",
    );
  });

  await t.test("2. NetworkMap Mengekspos onMapReady & Membagikan Instance Leaflet Map", () => {
    assert.match(
      mapContent,
      /onMapReady\?:\s*\(map:\s*LeafletMap\)\s*=>\s*void/,
      "NetworkMapProps wajib menyertakan prop onMapReady",
    );
    assert.match(
      mapContent,
      /const handleMapRef = useCallback\(\s*\(mapInstance:\s*LeafletMap\s*\|\s*null\)\s*=>/,
      "NetworkMap wajib memiliki handleMapRef untuk menghubungkan Leaflet Map instance",
    );
    assert.match(
      mapContent,
      /<MapContainer[\s\S]*?ref=\{handleMapRef\}/,
      "MapContainer wajib menerima ref handleMapRef",
    );
  });

  await t.test("3. DrawingLayerMapBoard Menerima Instance Peta & Menghubungkannya ke LeaferCanvasOverlay", () => {
    assert.match(
      boardContent,
      /const \[leafletMap, setLeafletMap\] = useState<L\.Map \| null>\(null\)/,
      "DrawingLayerMapBoard wajib menyimpan state leafletMap",
    );
    assert.match(
      boardContent,
      /<NetworkMapLeafletLoader[\s\S]*?onMapReady=\{setLeafletMap\}/,
      "NetworkMapLeafletLoader wajib menerima callback onMapReady={setLeafletMap}",
    );
    assert.match(
      boardContent,
      /<LeaferCanvasOverlay[\s\S]*?leafletMapInstance=\{leafletMap\}/,
      "LeaferCanvasOverlay wajib menerima prop leafletMapInstance={leafletMap}",
    );
  });

  await t.test("4. Pencatatan Koordinat Geografis (containerPointToLatLng) Saat Menggambar", () => {
    assert.match(
      overlayContent,
      /leafletMapInstance\.containerPointToLatLng\(\[minX,\s*minY\]\)/,
      "Overlay wajib mengonversi koordinat layar rectangle menjadi koordinat GPS riil",
    );
    assert.match(
      overlayContent,
      /centerLatLng\.distanceTo\(edgeLatLng\)/,
      "Overlay wajib menghitung radius fisik meter GPS untuk lingkaran",
    );
    assert.match(
      overlayContent,
      /leafletMapInstance\.containerPointToLatLng\(\[startPoint\.x,\s*startPoint\.y\]\)/,
      "Overlay wajib mengonversi titik awal garis/panah menjadi koordinat GPS",
    );
    assert.match(
      overlayContent,
      /leafletMapInstance\.containerPointToLatLng\(\[currentPoint\.x,\s*currentPoint\.y\]\)/,
      "Overlay wajib mengonversi titik akhir garis/panah menjadi koordinat GPS",
    );
  });

  await t.test("5. Proyeksi Koordinat Dinamis (latLngToContainerPoint) Saat Render", () => {
    assert.match(
      overlayContent,
      /leafletMapInstance\.latLngToContainerPoint\(\[g1\[0\],\s*g1\[1\]\]\)/,
      "Overlay wajib memproyeksikan koordinat GPS kembali ke piksel layar kanvas saat render",
    );
    assert.match(
      overlayContent,
      /leafletMapInstance\.latLngToContainerPoint\(\[\s*shape\.properties\.geoCoordinates\[0\],\s*shape\.properties\.geoCoordinates\[1\],\s*\]\)/,
      "Overlay wajib memproyeksikan titik pusat lingkaran GPS",
    );
  });

  await t.test("6. Event Listener Transformasi Peta Leaflet (move, zoom, viewreset, resize)", () => {
    assert.match(
      overlayContent,
      /leafletMapInstance\.on\("move",\s*handleMapTransform\)/,
      "Overlay wajib merespons event move peta Leaflet",
    );
    assert.match(
      overlayContent,
      /leafletMapInstance\.on\("zoom",\s*handleMapTransform\)/,
      "Overlay wajib merespons event zoom peta Leaflet",
    );
    assert.match(
      overlayContent,
      /leafletMapInstance\.on\("viewreset",\s*handleMapTransform\)/,
      "Overlay wajib merespons event viewreset peta Leaflet",
    );
    assert.match(
      overlayContent,
      /leafletMapInstance\.on\("resize",\s*handleMapTransform\)/,
      "Overlay wajib merespons event resize kontainer peta",
    );
  });
});
