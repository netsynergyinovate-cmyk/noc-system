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

const routeMapMarkers = await import("../src/app/api/map/markers/route.ts");
const { getMapMarkersData, classifyOpticalPower } =
  await import("../src/services/map-markers.service.ts");

test("GET /api/map/markers: Proteksi Sesi dan Endpoint Penanda Pelanggan & Perangkat", async (t) => {
  await t.test("Menolak akses anonim dengan status HTTP 401", async () => {
    const req = new Request("http://localhost:3000/api/map/markers");
    const res = await routeMapMarkers.GET(req);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error.code, "UNAUTHORIZED");
  });

  await t.test(
    "Mengembalikan seluruh penanda pelanggan dan perangkat dengan koordinat sah",
    async () => {
      const result = await getMapMarkersData({ forceMock: true });

      assert.ok(Array.isArray(result.markers), "result.markers harus array");
      assert.ok(result.markers.length > 0, "Harus memuat penanda");
      assert.ok(result.customers.length > 0, "Harus memuat penanda pelanggan");
      assert.ok(result.devices.length > 0, "Harus memuat penanda perangkat");

      // Pastikan seluruh penanda memiliki koordinat numerik sah
      for (const marker of result.markers) {
        assert.equal(typeof marker.latitude, "number");
        assert.equal(typeof marker.longitude, "number");
        assert.ok(Number.isFinite(marker.latitude));
        assert.ok(Number.isFinite(marker.longitude));
        assert.ok(typeof marker.isOnline === "boolean");
        assert.ok(marker.name.length > 0);
      }

      // Verifikasi ringkasan (summary)
      assert.equal(result.summary.total, result.markers.length);
      assert.equal(result.summary.totalCustomers, result.customers.length);
      assert.equal(result.summary.totalDevices, result.devices.length);
      assert.ok(result.summary.onlineCount >= 0);
      assert.ok(result.summary.offlineCount >= 0);
    },
  );

  await t.test("Filter berdasarkan tipe: hanya pelanggan", async () => {
    const result = await getMapMarkersData({
      type: "customers",
      forceMock: true,
    });
    assert.ok(result.markers.length > 0);
    for (const marker of result.markers) {
      assert.equal(marker.type, "customer");
    }
  });

  await t.test(
    "Filter berdasarkan tipe: hanya perangkat infrastruktur",
    async () => {
      const result = await getMapMarkersData({
        type: "devices",
        forceMock: true,
      });
      assert.ok(result.markers.length > 0);
      for (const marker of result.markers) {
        assert.ok(["router", "olt", "odp", "pole"].includes(marker.type));
      }
    },
  );

  await t.test("Filter status online", async () => {
    const result = await getMapMarkersData({
      status: "online",
      forceMock: true,
    });
    for (const marker of result.markers) {
      assert.equal(marker.isOnline, true);
    }
  });

  await t.test("Filter pencarian kata kunci", async () => {
    const result = await getMapMarkersData({
      search: "CIARA",
      forceMock: true,
    });
    assert.ok(result.markers.length > 0);
    for (const marker of result.markers) {
      const match =
        marker.name.includes("CIARA") ||
        marker.details?.routerName?.includes("CIARA");
      assert.ok(match, "Marker harus cocok dengan pencarian");
    }
  });

  await t.test("Klasifikasi daya optik (optical power classification)", () => {
    assert.equal(classifyOpticalPower(-18.5), "normal");
    assert.equal(classifyOpticalPower(-22.0), "normal");
    assert.equal(classifyOpticalPower(-23.5), "warning");
    assert.equal(classifyOpticalPower(-24.5), "warning");
    assert.equal(classifyOpticalPower(-25.5), "critical");
    assert.equal(classifyOpticalPower(-28.0), "critical");
    assert.equal(classifyOpticalPower(null), "unknown");
    assert.equal(classifyOpticalPower(NaN), "unknown");
  });
});
