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

const { resolveViewportBounds, getCustomersByViewport } = await import(
  "../src/services/customer-location.service.ts"
);
const { viewportCustomersQuerySchema } = await import(
  "../src/validators/customer-location.ts"
);
const routeViewport = await import(
  "../src/app/api/map/customers/viewport/route.ts"
);

test("Endpoint Titik Pelanggan Per Viewport (Customer Map Viewport Endpoint)", async (t) => {
  await t.test("1. resolveViewportBounds mengekstrak koordinat dari minLat/maxLat/minLng/maxLng", () => {
    const res = resolveViewportBounds({
      minLat: -6.3,
      maxLat: -6.2,
      minLng: 106.8,
      maxLng: 106.9,
      buffer: 0.1,
    });

    assert.ok(res !== null);
    assert.equal(res.minLat, -6.3);
    assert.equal(res.maxLat, -6.2);
    assert.equal(res.minLng, 106.8);
    assert.equal(res.maxLng, 106.9);
    assert.equal(res.buffer, 0.1);
    // Bounding box buffered 10% dari span 0.1 = 0.01
    assert.ok(Math.abs(res.bufferedMinLat - (-6.31)) < 0.0001);
    assert.ok(Math.abs(res.bufferedMaxLat - (-6.19)) < 0.0001);
  });

  await t.test("2. resolveViewportBounds mengekstrak koordinat dari south/north/west/east", () => {
    const res = resolveViewportBounds({
      south: -7.5,
      north: -7.0,
      west: 110.0,
      east: 110.5,
    });

    assert.ok(res !== null);
    assert.equal(res.minLat, -7.5);
    assert.equal(res.maxLat, -7.0);
    assert.equal(res.minLng, 110.0);
    assert.equal(res.maxLng, 110.5);
    assert.equal(res.buffer, 0.15); // default 15%
  });

  await t.test("3. resolveViewportBounds mengekstrak koordinat dari parameter bbox standar", () => {
    const res = resolveViewportBounds({
      bbox: "106.8123,-6.2555,106.8999,-6.1888",
    });

    assert.ok(res !== null);
    assert.equal(res.minLng, 106.8123);
    assert.equal(res.maxLng, 106.8999);
    assert.equal(res.minLat, -6.2555);
    assert.equal(res.maxLat, -6.1888);
  });

  await t.test("4. resolveViewportBounds mengembalikan null untuk input tidak lengkap", () => {
    assert.equal(resolveViewportBounds(undefined), null);
    assert.equal(resolveViewportBounds({ minLat: -6.2 }), null);
    assert.equal(resolveViewportBounds({ bbox: "invalid,format" }), null);
  });

  await t.test("5. viewportCustomersQuerySchema memvalidasi parameter numerik dan string", () => {
    const valid = viewportCustomersQuerySchema.safeParse({
      minLat: "-6.3",
      maxLat: "-6.2",
      minLng: "106.8",
      maxLng: "106.9",
      zoom: "14",
      status: "online",
      buffer: "0.2",
    });

    assert.equal(valid.success, true);
    if (valid.success) {
      assert.equal(valid.data.minLat, -6.3);
      assert.equal(valid.data.maxLat, -6.2);
      assert.equal(valid.data.zoom, 14);
      assert.equal(valid.data.buffer, 0.2);
    }
  });

  await t.test("6. Route GET /api/map/customers/viewport menolak akses tanpa sesi dengan HTTP 401", async () => {
    const req = new Request(
      "http://localhost:3000/api/map/customers/viewport?minLat=-6.3&maxLat=-6.2&minLng=106.8&maxLng=106.9",
    );
    const res = await routeViewport.GET(req);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error.code, "UNAUTHORIZED");
  });

  await t.test("7. Service getCustomersByViewport mengekspor fungsi dan mengembalikan data ber-summary viewport", async () => {
    const result = await getCustomersByViewport({
      minLat: -6.3,
      maxLat: -6.1,
      minLng: 106.7,
      maxLng: 106.9,
      forceMock: true,
    });

    assert.ok(result.customers);
    assert.ok(result.summary);
    assert.ok(typeof result.summary.totalInViewport === "number");
    assert.ok(typeof result.summary.totalGeocoded === "number");
    assert.ok(result.summary.bounds !== null);
  });
});
