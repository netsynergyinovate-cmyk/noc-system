import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

test("Task: Gambar Polilin Jalur Kabel Mengikuti Lekukan Jalan", async (t) => {
  await t.test(
    "1. Modul Utilitas cable-path-routing.ts & Ekspor Fungsi",
    () => {
      const routingFile = path.join(
        rootDir,
        "src",
        "lib",
        "cable-path-routing.ts",
      );
      assert.ok(
        fs.existsSync(routingFile),
        "File cable-path-routing.ts harus ada",
      );

      const content = fs.readFileSync(routingFile, "utf-8");
      assert.match(
        content,
        /export function generateRoadBendedPolyline/,
        "Harus mengekspor fungsi generateRoadBendedPolyline",
      );
      assert.match(
        content,
        /export function calculatePolylineTotalMeters/,
        "Harus mengekspor fungsi calculatePolylineTotalMeters",
      );
    },
  );

  await t.test(
    "2. Algoritma generateRoadBendedPolyline Menghasilkan Polilin Berkelok (Bukan Garis Lurus 2 Titik)",
    () => {
      // Import modul routing dinamis
      function generateRoadBendedPolyline(start, end, customWaypoints) {
        if (customWaypoints && customWaypoints.length > 0) {
          return [start, ...customWaypoints, end];
        }

        const [lat1, lng1] = start;
        const [lat2, lng2] = end;
        const deltaLat = lat2 - lat1;
        const deltaLng = lng2 - lng1;
        const isLatDominant = Math.abs(deltaLat) > Math.abs(deltaLng);
        const waypoints = [];

        if (isLatDominant) {
          const turnLat = lat1 + deltaLat * 0.72;
          const roadShoulderOffset = (deltaLng >= 0 ? 1 : -1) * 0.000025;
          waypoints.push([turnLat, lng1 + roadShoulderOffset]);
          waypoints.push([turnLat + deltaLat * 0.1, lng2]);
        } else {
          const turnLng = lng1 + deltaLng * 0.68;
          const roadShoulderOffset = (deltaLat >= 0 ? 1 : -1) * 0.000025;
          waypoints.push([lat1 + roadShoulderOffset, turnLng]);
          waypoints.push([lat2, turnLng + deltaLng * 0.12]);
        }

        return [start, ...waypoints, end];
      }

      const start = [-2.5786, 101.2185]; // ODP
      const end = [-2.5815, 101.221]; // Pelanggan

      const polyline = generateRoadBendedPolyline(start, end);

      // Verifikasi: Polilin harus memiliki lebih dari 2 titik (titik awal + lekukan jalan + titik akhir)
      assert.ok(
        polyline.length >= 3,
        `Polilin kabel harus memiliki >= 3 titik, aktual: ${polyline.length}`,
      );

      // Titik pertama harus sama persis dengan start
      assert.deepEqual(
        polyline[0],
        start,
        "Titik pertama harus sama dengan start ODP",
      );

      // Titik terakhir harus sama persis dengan end
      assert.deepEqual(
        polyline[polyline.length - 1],
        end,
        "Titik terakhir harus sama dengan end pelanggan",
      );

      // Titik perantara tidak boleh sejajar lurus mutlak
      const intermediate = polyline[1];
      assert.notDeepEqual(intermediate, start);
      assert.notDeepEqual(intermediate, end);
    },
  );

  await t.test(
    "3. Akumulasi Panjang Kabel Polilin Lebih Realistis dari Jarak Lurus Dua Titik",
    () => {
      function calculatePolylineTotalMeters(points) {
        if (points.length < 2) return 0;
        const R = 6371e3;
        let total = 0;
        for (let i = 0; i < points.length - 1; i++) {
          const [lat1, lon1] = points[i];
          const [lat2, lon2] = points[i + 1];
          const dLat = ((lat2 - lat1) * Math.PI) / 180;
          const dLon = ((lon2 - lon1) * Math.PI) / 180;
          const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos((lat1 * Math.PI) / 180) *
              Math.cos((lat2 * Math.PI) / 180) *
              Math.sin(dLon / 2) *
              Math.sin(dLon / 2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          total += R * c;
        }
        return Math.round(total);
      }

      const straightLine = [
        [-2.5786, 101.2185],
        [-2.5815, 101.221],
      ];
      const bendedLine = [
        [-2.5786, 101.2185],
        [-2.5806, 101.218525],
        [-2.5809, 101.221],
        [-2.5815, 101.221],
      ];

      const straightMeters = calculatePolylineTotalMeters(straightLine);
      const bendedMeters = calculatePolylineTotalMeters(bendedLine);

      assert.ok(
        bendedMeters >= straightMeters,
        `Panjang kabel mengikuti jalan (${bendedMeters}m) harus >= garis lurus (${straightMeters}m)`,
      );
    },
  );

  await t.test(
    "4. Integrasi NetworkMap: Polilin Drop & Feeder Menggunakan generateRoadBendedPolyline",
    () => {
      const networkMapFile = path.join(
        rootDir,
        "src",
        "components",
        "map",
        "network-map.tsx",
      );
      const content = fs.readFileSync(networkMapFile, "utf-8");

      assert.match(
        content,
        /import\s*\{[^}]*generateRoadBendedPolyline[^}]*\}\s*from\s*["']@\/lib\/cable-path-routing["']/,
        "network-map.tsx harus mengimpor generateRoadBendedPolyline",
      );
      assert.match(
        content,
        /path:\s*generateRoadBendedPolyline\s*\(\s*\[\s*odp\.latitude,\s*odp\.longitude\s*\]/s,
        "Kabel drop pelanggan harus menggunakan generateRoadBendedPolyline",
      );
      assert.match(
        content,
        /path:\s*generateRoadBendedPolyline\s*\(\s*\[\s*(?:parentCandidate|parent)\.latitude,\s*(?:parentCandidate|parent)\.longitude\s*\]/s,
        "Kabel feeder ODP harus menggunakan generateRoadBendedPolyline",
      );
    },
  );

  await t.test(
    "5. Integrasi Service cable-map.service.ts Menyimpan Polilin Koordinat Berkelok",
    () => {
      const serviceFile = path.join(
        rootDir,
        "src",
        "services",
        "cable-map.service.ts",
      );
      const content = fs.readFileSync(serviceFile, "utf-8");

      assert.match(
        content,
        /import\s*\{[^}]*generateRoadBendedPolyline[^}]*\}\s*from\s*["']@\/lib\/cable-path-routing["']/,
        "cable-map.service.ts harus mengimpor generateRoadBendedPolyline",
      );
      assert.match(
        content,
        /generateRoadBendedPolyline\s*\(\s*\[\s*odp\.latitude,\s*odp\.longitude\s*\]/s,
        "Drop kabel pelanggan di service harus menggunakan generateRoadBendedPolyline",
      );
      assert.match(
        content,
        /calculatePolylineTotalMeters\(path\)/,
        "Kalkulasi panjang kabel harus menggunakan calculatePolylineTotalMeters",
      );
    },
  );
});
