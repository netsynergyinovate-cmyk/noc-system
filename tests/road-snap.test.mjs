import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { register } from "tsx/esm/api";

// OSRM tiruan: balasan diatur per test lewat `reply`, URL terakhir dicatat.
let reply = () => [200, {}];
let lastUrl = "";
const osrm = createServer((req, res) => {
  lastUrl = req.url;
  const [status, body] = reply();
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
});
await new Promise((done) => osrm.listen(0, "127.0.0.1", done));

process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:5432/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3101";
process.env.OSRM_BASE_URL = `http://127.0.0.1:${osrm.address().port}`;

const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

register();

const { snapToRoads } = await import("../src/services/road-snap.service.ts");
const snapRoute = await import("../src/app/api/snap/route.ts");

// [lat, lng] dari klien; urutan = rute pilihan pengguna.
const points = [
  [-0.95, 100.35],
  [-0.951, 100.352],
  [-0.953, 100.351],
];

test("snap: geometri jalan OSRM dibalik ke [lat, lng], urutan titik dipertahankan", async () => {
  reply = () => [
    200,
    {
      code: "Ok",
      routes: [{ geometry: { type: "LineString", coordinates: [[100.3501, -0.9501], [100.3515, -0.9504], [100.3519, -0.9512], [100.351, -0.9529]] } }],
    },
  ];
  const result = await snapToRoads(points, 30);
  assert.deepEqual(result, {
    snapped: true,
    geometry: [[-0.9501, 100.3501], [-0.9504, 100.3515], [-0.9512, 100.3519], [-0.9529, 100.351]],
    provider: "osrm-foot",
  });
  const url = new URL(lastUrl, "http://osrm");
  assert.equal(
    decodeURIComponent(url.pathname),
    "/route/v1/foot/100.350000,-0.950000;100.352000,-0.951000;100.351000,-0.953000",
  );
  assert.equal(url.searchParams.get("radiuses"), "30;30;30");
  assert.equal(url.searchParams.get("overview"), "full");
  assert.equal(url.searchParams.get("geometries"), "geojson");
});

test("snap: titik di luar toleransi (NoSegment) mengembalikan geometri asli", async () => {
  reply = () => [400, { code: "NoSegment", message: "Could not find a matching segment for coordinate 1" }];
  assert.deepEqual(await snapToRoads(points, 30), { snapped: false, geometry: points, provider: "manual" });
});

test("snap: balasan OSRM tanpa rute tidak dikarang jadi geometri", async () => {
  reply = () => [200, { code: "Ok", routes: [] }];
  assert.deepEqual(await snapToRoads(points, 30), { snapped: false, geometry: points, provider: "manual" });
});

test("POST /api/snap: 401 tanpa API key", async () => {
  const res = await snapRoute.POST(
    new Request("http://localhost:3101/api/snap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ points, toleranceM: 30 }),
    }),
  );
  assert.equal(res.status, 401);
});

// Bagian berikut butuh PostgreSQL sekali pakai dari `npm test`.
const withDb = process.env.STARTER_TEST_RUN?.startsWith("starter-pg-test-");

test("POST /api/snap: key hanya-baca boleh (hitung saja), body divalidasi", { skip: !withDb && "jalankan lewat npm test" }, async () => {
  const { db } = await import("../src/db/index.ts");
  const { user } = await import("../src/db/schema/index.ts");
  const { createApiKey } = await import("../src/services/api-keys.service.ts");
  const { eq } = await import("drizzle-orm");

  const userId = `snap-test-${randomBytes(4).toString("hex")}`;
  await db.insert(user).values({ id: userId, name: "Uji Snap", email: `${userId}@test.local`, role: "user" });
  const { key } = await createApiKey(userId, { name: "peta", access: "read" });
  const post = (body) =>
    snapRoute.POST(
      new Request("http://localhost:3101/api/snap", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

  reply = () => [200, { code: "Ok", routes: [{ geometry: { coordinates: [[100.35, -0.95], [100.352, -0.951]] } }] }];
  const ok = await post({ points: points.slice(0, 2), toleranceM: 30 });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { snapped: true, geometry: [[-0.95, 100.35], [-0.951, 100.352]], provider: "osrm-foot" });

  assert.equal((await post({ points: [points[0]], toleranceM: 30 })).status, 422);
  assert.equal((await post({ points: [[91, 0], [0, 0]], toleranceM: 30 })).status, 422);
  assert.equal((await post({ points, toleranceM: 30, extra: 1 })).status, 422);

  await db.delete(user).where(eq(user.id, userId));
  await (await import("../src/db/index.ts")).getRawPool().end();
});

// Terakhir: OSRM dimatikan, port tidak lagi menerima koneksi.
test("snap: OSRM mati mengembalikan geometri asli", async () => {
  await new Promise((done) => osrm.close(done));
  assert.deepEqual(await snapToRoads(points, 30), { snapped: false, geometry: points, provider: "manual" });
});
