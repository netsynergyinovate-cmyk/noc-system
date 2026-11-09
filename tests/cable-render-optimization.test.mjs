import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("Optimasi Render Ribuan Jalur Kabel di Peta (Spatial Bounding Box Culling & Zoom LOD)", async (t) => {
  const mapFile = path.resolve("src/components/map/network-map.tsx");
  assert.equal(
    fs.existsSync(mapFile),
    true,
    "File src/components/map/network-map.tsx harus ada",
  );
  const content = fs.readFileSync(mapFile, "utf-8");

  await t.test(
    "Fungsi isCableInViewport mengimplementasikan Spatial Bounding Box Culling dengan buffer 15%",
    () => {
      assert.match(
        content,
        /const isCableInViewport = useCallback/,
        "Harus mendefinisikan isCableInViewport",
      );
      assert.match(
        content,
        /bounds\.pad\s*\(\s*0\.15\s*\)/,
        "Harus menerapkan buffer margin 15% pada area viewport",
      );
      assert.match(
        content,
        /L\.latLngBounds\(\[minLat,\s*minLng\],\s*\[maxLat,\s*maxLng\]\)/,
        "Harus membentuk bounding box kabel",
      );
      assert.match(
        content,
        /paddedBounds\.intersects\(cableBounds\)/,
        "Harus mengevaluasi irisan bounding box kabel dengan viewport",
      );
    },
  );

  await t.test(
    "Level-of-Detail (LOD): Menyederhanakan kabel drop pada zoom jauh dan memprioritaskan backbone/feeder",
    () => {
      assert.match(
        content,
        /zoom\s*<\s*13\s*&&\s*cable\.type\s*===\s*"drop"/,
        "Harus memfilter kabel drop pada zoom < 13 untuk mencegah beban DOM",
      );
      assert.match(
        content,
        /if\s*\(cable\.isHighlighted\)\s*\{\s*return true;\s*\}/,
        "Kabel yang sedang disorot atau dipilih wajib selalu tampil",
      );
    },
  );

  await t.test(
    "Dynamic smoothFactor menyesuaikan algoritma penyederhanaan kurva jalan Leaflet berdasarkan zoom",
    () => {
      assert.match(
        content,
        /dynamicSmoothFactor\s*=\s*currentZoom\s*>=\s*16\s*\?\s*0\.25\s*:\s*currentZoom\s*>=\s*13\s*\?\s*1\.0\s*:\s*2\.0/,
        "Harus menghitung dynamicSmoothFactor berdasarkan level zoom",
      );
      assert.match(
        content,
        /smoothFactor=\{dynamicSmoothFactor\}/,
        "Harus meneruskan dynamicSmoothFactor ke komponen Polyline",
      );
    },
  );

  await t.test(
    "Memoization visibleCableRoutes dan rendering loop ke MapContainer",
    () => {
      assert.match(
        content,
        /const visibleCableRoutes = useMemo\(/,
        "Harus mendefinisikan array visibleCableRoutes",
      );
      assert.match(
        content,
        /visibleCableRoutes\.map\(\(cable\) =>/,
        "Marker jalur kabel pada MapContainer harus menggunakan visibleCableRoutes",
      );
    },
  );

  await t.test(
    "Kontrol interaktif UI: toggle optimasi kabel dan indikator rasio jalur aktif",
    () => {
      assert.match(
        content,
        /data-testid="toggle-cable-optimization"/,
        "Harus menyediakan toggle switch optimasi kabel",
      );
      assert.match(
        content,
        /data-testid="cable-render-indicator"/,
        "Harus menyediakan indikator rasio kabel yang sedang dirender",
      );
      assert.match(
        content,
        /Optimasi Kabel \(Viewport & LOD\)/,
        "Label toggle harus jelas dan informatif",
      );
    },
  );
});
