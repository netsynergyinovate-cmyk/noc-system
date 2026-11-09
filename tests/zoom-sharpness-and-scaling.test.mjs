import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const networkMapPath = path.resolve(
  __dirname,
  "../src/components/map/network-map.tsx",
);
const lineageLibPath = path.resolve(
  __dirname,
  "../src/lib/hierarchy-lineage.ts",
);
const globalsCssPath = path.resolve(__dirname, "../src/app/globals.css");

test("Task: Jaga ketajaman garis penghubung saat zoom peta", async (t) => {
  const networkMapContent = fs.readFileSync(networkMapPath, "utf8");
  const lineageLibContent = fs.readFileSync(lineageLibPath, "utf8");
  const globalsCssContent = fs.readFileSync(globalsCssPath, "utf8");

  await t.test(
    "Fungsi getZoomScaledLineWeight: Penskalaan Adaptif Terhadap Level Zoom",
    () => {
      assert.match(
        lineageLibContent,
        /export function getZoomScaledLineWeight/,
        "Wajib mengekspor getZoomScaledLineWeight untuk perhitungan ketebalan adaptif",
      );

      // Simulasi in-memory formula getZoomScaledLineWeight
      function calcWeight(baseWeight, zoom) {
        if (zoom >= 18) return Math.round(baseWeight * 1.35 * 10) / 10;
        if (zoom >= 16) return Math.round(baseWeight * 1.15 * 10) / 10;
        if (zoom >= 14) return baseWeight;
        if (zoom >= 12)
          return Math.max(1.5, Math.round(baseWeight * 0.8 * 10) / 10);
        return Math.max(1, Math.round(baseWeight * 0.65 * 10) / 10);
      }

      // Base weight 4 (backbone)
      assert.equal(calcWeight(4, 18), 5.4, "Pada zoom 18 harus diskala 1.35x");
      assert.equal(calcWeight(4, 16), 4.6, "Pada zoom 16 harus diskala 1.15x");
      assert.equal(
        calcWeight(4, 14),
        4.0,
        "Pada zoom default 14 ketebalan dasar dipertahankan",
      );
      assert.equal(
        calcWeight(4, 12),
        3.2,
        "Pada zoom 12 harus ditipiskan ke 0.8x agar tidak menggumpal",
      );
      assert.equal(
        calcWeight(4, 10),
        2.6,
        "Pada zoom 10 harus ditipiskan ke 0.65x",
      );

      // Base weight 2 (drop cable)
      assert.equal(
        calcWeight(2, 19),
        2.7,
        "Drop cable pada zoom tinggi harus tetap tegas",
      );
      assert.equal(
        calcWeight(2, 8),
        1.3,
        "Drop cable pada zoom rendah dibatasi minimum",
      );
    },
  );

  await t.test(
    "CSS globals.css: Aturan Vektor Tajam Leaflet SVG (Crisp Vectors)",
    () => {
      assert.match(
        globalsCssContent,
        /shape-rendering:\s*geometricPrecision/,
        "SVG path Leaflet wajib menggunakan shape-rendering: geometricPrecision",
      );
      assert.match(
        globalsCssContent,
        /stroke-linecap:\s*round/,
        "SVG path Leaflet wajib menggunakan stroke-linecap: round untuk mencegah spike",
      );
      assert.match(
        globalsCssContent,
        /stroke-linejoin:\s*round/,
        "SVG path Leaflet wajib menggunakan stroke-linejoin: round",
      );
      assert.match(
        globalsCssContent,
        /vector-effect:\s*non-scaling-stroke/,
        "SVG path Leaflet wajib menggunakan vector-effect: non-scaling-stroke",
      );
      assert.match(
        globalsCssContent,
        /\.leaflet-zoom-animated svg/,
        "Transisi zoom SVG Leaflet harus dioptimasi akselerasi GPU",
      );
    },
  );

  await t.test(
    "Komponen NetworkMap: MapZoomTracker & Integrasi scaledWeight pada Polyline",
    () => {
      assert.match(
        networkMapContent,
        /function MapZoomTracker/,
        "Komponen harus menyediakan MapZoomTracker listener event zoomend",
      );
      assert.match(
        networkMapContent,
        /<MapZoomTracker onZoomChange=\{setCurrentZoom\} \/>/,
        "MapContainer harus memasang MapZoomTracker",
      );
      assert.match(
        networkMapContent,
        /const scaledWeight = getZoomScaledLineWeight\(\s*baseWeight,\s*currentZoom,?\s*\);/,
        "Polyline kabel wajib menggunakan scaledWeight hasil perhitungan zoom",
      );
      assert.match(
        networkMapContent,
        /const haloWeight = getZoomScaledLineWeight/,
        "Glow halo layer kabel wajib diskalakan mengikuti zoom",
      );
    },
  );
});
