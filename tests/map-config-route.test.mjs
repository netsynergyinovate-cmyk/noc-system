import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";

process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:5432/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3101";

const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

register();

const routeMapConfig = await import("../src/app/api/map/config/route.ts");
const { getMapConfiguration } = await import("../src/services/map-config.service.ts");

test("GET /api/map/config: Proteksi Sesi dan Respons Konfigurasi Peta", async (t) => {
  await t.test("Menolak akses anonim dengan status HTTP 401", async () => {
    const req = new Request("http://localhost:3000/api/map/config");
    const res = await routeMapConfig.GET(req);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error.code, "UNAUTHORIZED");
  });

  await t.test("getMapConfiguration mengembalikan konfigurasi tile dan area operasional yang valid", () => {
    const config = getMapConfiguration();

    // Verifikasi koordinat sentral default
    assert.ok(Array.isArray(config.defaultCenter), "defaultCenter harus array");
    assert.equal(config.defaultCenter.length, 2, "defaultCenter harus memuat [lat, lng]");
    assert.equal(typeof config.defaultCenter[0], "number");
    assert.equal(typeof config.defaultCenter[1], "number");
    assert.ok(config.defaultCenter[0] < 0, "Latitude Mukomuko/Bengkulu berada di belahan bumi selatan");

    // Verifikasi zoom default
    assert.equal(typeof config.defaultZoom, "number");
    assert.ok(config.defaultZoom >= 1 && config.defaultZoom <= 20);

    // Verifikasi layer tile providers
    assert.ok(config.providers.satellite, "Harus menyediakan tile satelit");
    assert.ok(config.providers.streets, "Harus menyediakan tile jalan");
    assert.ok(config.providers.topo, "Harus menyediakan tile topografi");

    assert.ok(config.providers.satellite.url.includes("server.arcgisonline.com") || config.providers.satellite.url.length > 0);
    assert.ok(config.providers.streets.url.includes("openstreetmap.org") || config.providers.streets.url.length > 0);
    assert.ok(config.providers.satellite.attribution.length > 0);
    assert.ok(config.providers.streets.attribution.length > 0);

    // Verifikasi daftar availableLayers
    assert.deepEqual(config.availableLayers.sort(), ["satellite", "streets", "topo"].sort());

    // Verifikasi operationalArea
    assert.ok(config.operationalArea.name.length > 0);
    assert.deepEqual(config.operationalArea.center, config.defaultCenter);
  });
});
