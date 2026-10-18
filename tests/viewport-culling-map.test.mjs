import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("Optimasi Penyembunyian Titik di Luar Area Viewport Peta (Spatial Culling)", async (t) => {
  const mapFile = path.resolve("src/components/map/network-map.tsx");
  assert.equal(fs.existsSync(mapFile), true, "File src/components/map/network-map.tsx harus ada");
  const content = fs.readFileSync(mapFile, "utf-8");

  await t.test("Komponen MapViewportTracker melacak event moveend dan zoomend dari Leaflet", () => {
    assert.match(content, /function MapViewportTracker/, "Harus mendefinisikan komponen MapViewportTracker");
    assert.match(content, /useMapEvents\(\{/, "Harus menggunakan hook useMapEvents");
    assert.match(content, /moveend\s*\(/, "Harus melacak event moveend");
    assert.match(content, /zoomend\s*\(/, "Harus melacak event zoomend");
    assert.match(content, /map\.getBounds\(\)/, "Harus mengambil bounds saat viewport berubah");
    assert.match(content, /<MapViewportTracker\s+onViewportChange=\{handleViewportChange\}\s*\/>/, "MapViewportTracker harus dipasang di MapContainer");
  });

  await t.test("Fungsi isPointInViewport memiliki margin buffer 15% untuk perpindahan halus tanpa pop-in", () => {
    assert.match(content, /const isPointInViewport = useCallback/, "Harus mendefinisikan isPointInViewport dengan useCallback");
    assert.match(content, /viewportBounds\.pad\(0\.15\)/, "Harus menerapkan buffer 15% (pad 0.15) pada batas viewport");
    assert.match(content, /if\s*\(isHighlighted\)\s*\{\s*return true;\s*\}/, "Titik yang sedang dipilih/disorot wajib tetap tampil");
    assert.match(content, /paddedBounds\.contains\(L\.latLng\(lat, lng\)\)/, "Harus memeriksa apakah titik berada dalam area bounds Leaflet");
  });

  await t.test("Array visibleInfrastructure dan visibleCustomers menyaring titik berdasarkan viewport", () => {
    assert.match(content, /const visibleInfrastructure = useMemo\(/, "Harus mendefinisikan visibleInfrastructure");
    assert.match(content, /isPointInViewport\(infra\.latitude,\s*infra\.longitude,\s*isHighlighted\)/, "Menyaring infrastruktur dengan isPointInViewport");
    assert.match(content, /const visibleCustomers = useMemo\(/, "Harus mendefinisikan visibleCustomers");
    assert.match(content, /isPointInViewport\(cust\.latitude,\s*cust\.longitude,\s*isHighlighted\)/, "Menyaring pelanggan dengan isPointInViewport");
  });

  await t.test("Loop rendering marker pada MapContainer menggunakan array visibleInfrastructure dan visibleCustomers", () => {
    assert.match(content, /visibleInfrastructure\.map\(\(infra\) =>/, "Marker infrastruktur harus merender dari visibleInfrastructure");
    assert.match(content, /visibleCustomers\.map\(\(cust\) =>/, "Marker pelanggan harus merender dari visibleCustomers");
  });

  await t.test("Tersedia indikator statistik viewport dan toggle switch pada antarmuka", () => {
    assert.match(content, /data-testid="viewport-culling-indicator"/, "Harus ada elemen indikator jumlah titik dalam viewport");
    assert.match(content, /data-testid="toggle-viewport-culling"/, "Harus ada toggle switch untuk mengaktifkan/menonaktifkan culling");
    assert.match(content, /Sembunyikan Luar Layar \(Viewport\)/, "Label kontrol harus jelas dan informatif");
  });
});
