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

const routeMapLayers = await import("../src/app/api/map/layers/route.ts");
const { getMapLayersData } =
  await import("../src/services/map-layers.service.ts");

test("GET /api/map/layers: Proteksi Sesi dan Endpoint Data Lapis Peta", async (t) => {
  await t.test("Menolak akses anonim dengan status HTTP 401", async () => {
    const req = new Request("http://localhost:3000/api/map/layers");
    const res = await routeMapLayers.GET(req);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error.code, "UNAUTHORIZED");
  });

  await t.test(
    "Mengembalikan seluruh lapis peta lengkap (tiles, customers, infrastructure, cables, coverage)",
    async () => {
      const result = await getMapLayersData({ forceMock: true });

      assert.ok("layers" in result, "Harus memuat objek layers");
      assert.ok("summary" in result, "Harus memuat summary");
      assert.ok("dataSource" in result, "Harus memuat dataSource");

      const layers = result.layers;

      // Verifikasi Lapis Tiles
      assert.equal(layers.tiles.id, "tiles");
      assert.equal(layers.tiles.type, "tiles");
      assert.ok(layers.tiles.itemCount >= 3);

      // Verifikasi Lapis Pelanggan
      assert.equal(layers.customers.id, "customers");
      assert.equal(layers.customers.type, "points");
      assert.ok(layers.customers.itemCount > 0);
      assert.ok(Array.isArray(layers.customers.data));

      // Verifikasi Lapis Infrastruktur
      assert.equal(layers.infrastructure.id, "infrastructure");
      assert.equal(layers.infrastructure.type, "points");
      assert.ok(layers.infrastructure.itemCount > 0);
      const infraTypes = layers.infrastructure.data.map((i) => i.type);
      assert.ok(infraTypes.includes("router"));
      assert.ok(infraTypes.includes("olt"));
      assert.ok(infraTypes.includes("odp"));

      // Verifikasi Lapis Kabel
      assert.equal(layers.cables.id, "cables");
      assert.equal(layers.cables.type, "polylines");
      assert.ok(layers.cables.itemCount > 0);
      const cableTypes = layers.cables.data.map((c) => c.type);
      assert.ok(cableTypes.includes("backbone"));
      assert.ok(cableTypes.includes("feeder"));

      // Verifikasi Lapis Cakupan ODP
      assert.equal(layers.coverage.id, "coverage");
      assert.equal(layers.coverage.type, "circles");
      assert.ok(layers.coverage.itemCount > 0);
      for (const zone of layers.coverage.data) {
        assert.equal(zone.radiusMeters, 150);
        assert.equal(zone.center.length, 2);
      }

      // Verifikasi Summary
      assert.equal(result.summary.totalCustomers, layers.customers.itemCount);
      assert.equal(
        result.summary.totalInfrastructure,
        layers.infrastructure.itemCount,
      );
      assert.equal(result.summary.totalCableRoutes, layers.cables.itemCount);
      assert.equal(
        result.summary.totalCoverageZones,
        layers.coverage.itemCount,
      );
    },
  );

  await t.test("Dapat memfilter hanya lapis kabel spesifik", async () => {
    const cableLayer = await getMapLayersData({
      layer: "cables",
      forceMock: true,
    });
    assert.equal(cableLayer.id, "cables");
    assert.equal(cableLayer.type, "polylines");
    assert.ok(Array.isArray(cableLayer.data));
  });

  await t.test("Dapat memfilter hanya lapis cakupan ODP spesifik", async () => {
    const coverageLayer = await getMapLayersData({
      layer: "coverage",
      forceMock: true,
    });
    assert.equal(coverageLayer.id, "coverage");
    assert.equal(coverageLayer.type, "circles");
    assert.ok(Array.isArray(coverageLayer.data));
  });
});
