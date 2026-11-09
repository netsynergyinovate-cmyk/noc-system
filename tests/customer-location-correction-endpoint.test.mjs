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

const routeLocation = await import(
  "../src/app/api/customers/[id]/location/route.ts"
);
const routeMapLocation = await import(
  "../src/app/api/map/customers/[id]/location/route.ts"
);
const routeCustomerById = await import(
  "../src/app/api/customers/[id]/route.ts"
);
const { updateCustomerLocation, getCustomerCoordinates } = await import(
  "../src/services/customer-location.service.ts"
);
const { db } = await import("../src/db/index.ts");
const { customers } = await import("../src/db/schema/index.ts");
const { updateCustomerLocationSchema } = await import(
  "../src/validators/customer-location.ts"
);

test("Endpoint & Service Simpan Koreksi Koordinat Pelanggan", async (t) => {
  await t.test(
    "Proteksi Autentikasi: Menolak request PATCH/PUT/POST tanpa login (401)",
    async () => {
      const params = Promise.resolve({ id: "cust-123" });

      const reqPatch = new Request(
        "http://localhost:3101/api/customers/cust-123/location",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ latitude: -2.5786, longitude: 101.2185 }),
        },
      );
      const resPatch = await routeLocation.PATCH(reqPatch, { params });
      assert.equal(resPatch.status, 401);

      const reqPut = new Request(
        "http://localhost:3101/api/customers/cust-123/location",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ latitude: -2.5786, longitude: 101.2185 }),
        },
      );
      const resPut = await routeLocation.PUT(reqPut, { params });
      assert.equal(resPut.status, 401);

      const reqPost = new Request(
        "http://localhost:3101/api/customers/cust-123/location",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ latitude: -2.5786, longitude: 101.2185 }),
        },
      );
      const resPost = await routeLocation.POST(reqPost, { params });
      assert.equal(resPost.status, 401);

      const reqMap = new Request(
        "http://localhost:3101/api/map/customers/cust-123/location",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ latitude: -2.5786, longitude: 101.2185 }),
        },
      );
      const resMap = await routeMapLocation.PATCH(reqMap, { params });
      assert.equal(resMap.status, 401);

      const reqDirect = new Request(
        "http://localhost:3101/api/customers/cust-123",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ latitude: -2.5786, longitude: 101.2185 }),
        },
      );
      const resDirect = await routeCustomerById.PATCH(reqDirect, { params });
      assert.equal(resDirect.status, 401);
    },
  );

  await t.test("Validasi Schema: Format koordinat baku { latitude, longitude }", () => {
    const valid = updateCustomerLocationSchema.safeParse({
      latitude: -2.578611,
      longitude: 101.218522,
    });
    assert.ok(valid.success);
    if (valid.success) {
      assert.equal(valid.data.latitude, -2.578611);
      assert.equal(valid.data.longitude, 101.218522);
    }
  });

  await t.test("Validasi Schema: Format fleksibel Leaflet { lat, lng } dan string numerik", () => {
    const validAlias = updateCustomerLocationSchema.safeParse({
      lat: "-2.578611",
      lng: "101.218522",
    });
    assert.ok(validAlias.success);
    if (validAlias.success) {
      assert.equal(validAlias.data.latitude, -2.578611);
      assert.equal(validAlias.data.longitude, 101.218522);
    }
  });

  await t.test("Validasi Schema: Menolak koordinat di luar batas bola bumi", () => {
    const invalidLat = updateCustomerLocationSchema.safeParse({
      latitude: 95,
      longitude: 100,
    });
    assert.equal(invalidLat.success, false, "Latitude > 90 harus ditolak");

    const invalidLng = updateCustomerLocationSchema.safeParse({
      latitude: 0,
      longitude: 190,
    });
    assert.equal(invalidLng.success, false, "Longitude > 180 harus ditolak");

    const nonNumeric = updateCustomerLocationSchema.safeParse({
      latitude: "invalid",
      longitude: "invalid",
    });
    assert.equal(nonNumeric.success, false, "Nilai non-numerik harus ditolak");
  });

  await t.test("Service updateCustomerLocation: Memperbarui koordinat pelanggan", async (st) => {
    let cust;
    try {
      const rows = await db.select({ id: customers.id }).from(customers).limit(1);
      cust = rows[0];
    } catch {
      if (typeof st.skip === "function") st.skip("tidak ada koneksi DB pada standalone test");
      return;
    }
    if (!cust) {
      if (typeof st.skip === "function") st.skip("tabel customers kosong");
      return;
    }
    const updated = await updateCustomerLocation(cust.id, {
      latitude: -2.5801,
      longitude: 101.2205,
    });

    assert.ok(updated);
    assert.equal(updated.latitude, -2.5801);
    assert.equal(updated.longitude, 101.2205);
    assert.ok(Number.isFinite(updated.latitude));
    assert.ok(Number.isFinite(updated.longitude));
    assert.ok(updated.name.length > 0);
  });
});
