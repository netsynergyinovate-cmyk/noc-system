import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

test("Task: Pertajam Render Polilin Jalur Saat Zoom Tinggi", async (t) => {
  await t.test(
    "1. Aturan CSS globals.css: Ketajaman Ekstra Vektor Polilin Kabel (.sharp-cable-polyline)",
    () => {
      const globalsCssPath = path.join(rootDir, "src", "app", "globals.css");
      assert.ok(fs.existsSync(globalsCssPath), "File globals.css harus ada");

      const content = fs.readFileSync(globalsCssPath, "utf-8");

      assert.match(
        content,
        /\.sharp-cable-polyline\s*\{/,
        "globals.css wajib mendefinisikan kelas .sharp-cable-polyline",
      );
      assert.match(
        content,
        /\.sharp-cable-polyline[\s\S]*?shape-rendering:\s*geometricPrecision/,
        ".sharp-cable-polyline harus menggunakan shape-rendering: geometricPrecision",
      );
      assert.match(
        content,
        /\.sharp-cable-polyline[\s\S]*?stroke-linecap:\s*round/,
        ".sharp-cable-polyline harus menggunakan stroke-linecap: round",
      );
      assert.match(
        content,
        /\.sharp-cable-polyline[\s\S]*?stroke-linejoin:\s*round/,
        ".sharp-cable-polyline harus menggunakan stroke-linejoin: round",
      );
      assert.match(
        content,
        /\.sharp-cable-polyline[\s\S]*?stroke-miterlimit:\s*4/,
        ".sharp-cable-polyline harus menggunakan stroke-miterlimit: 4 untuk mencegah spike sudut tajam",
      );
      assert.match(
        content,
        /\.sharp-cable-polyline[\s\S]*?vector-effect:\s*non-scaling-stroke/,
        ".sharp-cable-polyline harus menggunakan vector-effect: non-scaling-stroke",
      );
      assert.match(
        content,
        /\.cable-halo-polyline\s*\{/,
        "globals.css wajib mendefinisikan kelas .cable-halo-polyline",
      );
    },
  );

  await t.test(
    "2. Integrasi Komponen NetworkMap: Kelas sharp-cable-polyline pada Polyline Inti Kabel",
    () => {
      const networkMapPath = path.join(
        rootDir,
        "src",
        "components",
        "map",
        "network-map.tsx",
      );
      assert.ok(
        fs.existsSync(networkMapPath),
        "File network-map.tsx harus ada",
      );

      const content = fs.readFileSync(networkMapPath, "utf-8");

      assert.match(
        content,
        /className:\s*["']sharp-cable-polyline["']/,
        "Polyline kabel inti harus menyertakan className: 'sharp-cable-polyline'",
      );
      assert.match(
        content,
        /className:\s*["']cable-halo-polyline["']/,
        "Polyline halo pendar kabel harus menyertakan className: 'cable-halo-polyline'",
      );
    },
  );

  await t.test(
    "3. Penskalaan Simplifikasi Halus (smoothFactor) Adaptif Terhadap Level Zoom",
    () => {
      const networkMapPath = path.join(
        rootDir,
        "src",
        "components",
        "map",
        "network-map.tsx",
      );
      const content = fs.readFileSync(networkMapPath, "utf-8");

      assert.match(
        content,
        /smoothFactor=\{(?:dynamicSmoothFactor|currentZoom\s*>=\s*16\s*\?\s*0\.25\s*:\s*1\.0)\}/,
        "Polyline wajib menyertakan smoothFactor dinamis (0.25 pada zoom >= 16) untuk mempertahankan lekukan jalan tajam tanpa terpotong",
      );
    },
  );

  await t.test(
    "4. Konsistensi Ketebalan Adaptif dan Line Join/Cap pada Polyline Leaflet",
    () => {
      const networkMapPath = path.join(
        rootDir,
        "src",
        "components",
        "map",
        "network-map.tsx",
      );
      const content = fs.readFileSync(networkMapPath, "utf-8");

      assert.match(
        content,
        /lineCap:\s*["']round["']/,
        "Polyline kabel wajib menggunakan lineCap: 'round'",
      );
      assert.match(
        content,
        /lineJoin:\s*["']round["']/,
        "Polyline kabel wajib menggunakan lineJoin: 'round'",
      );
    },
  );
});
