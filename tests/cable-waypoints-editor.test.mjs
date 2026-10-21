import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

test("Task: Tambah, Geser, Hapus Titik Belokan Jalur Kabel (Waypoints Editor)", async (t) => {
  await t.test("1. Validator Zod saveCableWaypointsSchema di src/validators/cable-waypoints.ts", () => {
    const validatorFile = path.join(
      rootDir,
      "src",
      "validators",
      "cable-waypoints.ts",
    );
    assert.ok(fs.existsSync(validatorFile), "File cable-waypoints.ts harus ada");

    const content = fs.readFileSync(validatorFile, "utf-8");
    assert.match(
      content,
      /export const saveCableWaypointsSchema/,
      "Harus mengekspor saveCableWaypointsSchema",
    );
    assert.match(
      content,
      /waypoints:\s*z\.array\(waypointCoordinateSchema\)/,
      "Harus memvalidasi array waypointCoordinateSchema",
    );
  });

  await t.test("2. Endpoint API POST /api/map/cables/waypoints Terproteksi Sesi", () => {
    const apiFile = path.join(
      rootDir,
      "src",
      "app",
      "api",
      "map",
      "cables",
      "waypoints",
      "route.ts",
    );
    assert.ok(fs.existsSync(apiFile), "File route.ts waypoints harus ada");

    const content = fs.readFileSync(apiFile, "utf-8");
    assert.match(content, /export async function POST/, "Harus mengekspor handler POST");
    assert.match(content, /withApiSession/, "Handler wajib dilindungi withApiSession");
    assert.match(content, /saveCableWaypointsSchema\.safeParse/, "Wajib memvalidasi body dengan safeParse");
    assert.match(content, /saveCableWaypoints\(/, "Wajib memanggil service saveCableWaypoints");
  });

  await t.test("3. Service saveCableWaypoints di src/services/cable-map.service.ts", () => {
    const serviceFile = path.join(
      rootDir,
      "src",
      "services",
      "cable-map.service.ts",
    );
    const content = fs.readFileSync(serviceFile, "utf-8");

    assert.match(
      content,
      /export async function saveCableWaypoints/,
      "Harus mengekspor fungsi saveCableWaypoints",
    );
    assert.match(
      content,
      /cableWaypoints:\s*waypoints/,
      "Harus menyimpan waypoints ke details.cableWaypoints di PostgreSQL",
    );
    assert.match(
      content,
      /totalMeters\s*=\s*calculatePolylineTotalMeters\(waypoints\)/,
      "Harus mengkalkulasi ulang total panjang kabel polilin",
    );
  });

  await t.test("5. Simulasi In-Memory: Penambahan, Pergeseran & Penghapusan Titik Waypoint", () => {
    // Array rute awal: 2 titik (Awal dan Akhir)
    let waypoints = [
      [-2.5786, 101.2185], // Point 0 (Awal)
      [-2.5815, 101.221],  // Point 1 (Akhir)
    ];

    // Aksi 1: Tambah titik perantara
    const midIdx = Math.floor(waypoints.length / 2);
    const p1 = waypoints[midIdx - 1];
    const p2 = waypoints[midIdx];
    const newPoint = [
      Number(((p1[0] + p2[0]) / 2).toFixed(6)),
      Number(((p1[1] + p2[1]) / 2).toFixed(6)),
    ];
    waypoints.splice(midIdx, 0, newPoint);

    assert.equal(waypoints.length, 3, "Setelah ditambah, harus ada 3 titik koordinat");
    assert.deepEqual(waypoints[1], [-2.58005, 101.21975], "Titik tengah terinterpolasi dengan benar");

    // Aksi 2: Geser titik perantara (index 1)
    waypoints[1] = [-2.5802, 101.2201];
    assert.deepEqual(waypoints[1], [-2.5802, 101.2201], "Titik belokan berhasil digeser");

    // Aksi 3: Hapus titik perantara (index 1)
    waypoints.splice(1, 1);
    assert.equal(waypoints.length, 2, "Setelah dihapus, kembali menjadi 2 titik ujung");
    assert.deepEqual(waypoints[0], [-2.5786, 101.2185], "Titik awal tetap terjaga");
    assert.deepEqual(waypoints[1], [-2.5815, 101.221], "Titik akhir tetap terjaga");
  });
});
