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

const routeGeocoded =
  await import("../src/app/api/customers/geocoded/route.ts");
const routeMapCustomers = await import("../src/app/api/map/customers/route.ts");
const routeCustomers = await import("../src/app/api/customers/route.ts");
const { getGeocodedCustomers, applyCustomerQueryFilters } =
  await import("../src/services/customer-location.service.ts");
const { geocodedCustomersQuerySchema } =
  await import("../src/validators/customer-location.ts");

test("Endpoint & Service Daftar Pelanggan Berkoordinat", async (t) => {
  await t.test(
    "GET /api/customers/geocoded: Menolak akses tanpa sesi login (401)",
    async () => {
      const req = new Request("http://localhost:3101/api/customers/geocoded");
      const res = await routeGeocoded.GET(req);
      assert.equal(res.status, 401);
      const body = await res.json();
      assert.equal(body.error.code, "UNAUTHORIZED");
    },
  );

  await t.test(
    "GET /api/map/customers: Menolak akses tanpa sesi login (401)",
    async () => {
      const req = new Request("http://localhost:3101/api/map/customers");
      const res = await routeMapCustomers.GET(req);
      assert.equal(res.status, 401);
      const body = await res.json();
      assert.equal(body.error.code, "UNAUTHORIZED");
    },
  );

  await t.test(
    "GET /api/customers: Menolak akses tanpa sesi login (401)",
    async () => {
      const req = new Request(
        "http://localhost:3101/api/customers?geocoded=true",
      );
      const res = await routeCustomers.GET(req);
      assert.equal(res.status, 401);
      const body = await res.json();
      assert.equal(body.error.code, "UNAUTHORIZED");
    },
  );

  await t.test(
    "Validator Zod: geocodedCustomersQuerySchema memvalidasi filter dengan benar",
    () => {
      const valid = geocodedCustomersQuerySchema.safeParse({
        status: "online",
        odp: "ODP-FAT-01",
        search: "budi",
        limit: "50",
        offset: "0",
      });
      assert.ok(valid.success, "Harus valid parse input string");
      if (valid.success) {
        assert.equal(valid.data.status, "online");
        assert.equal(valid.data.odp, "ODP-FAT-01");
        assert.equal(valid.data.search, "budi");
        assert.equal(valid.data.limit, 50);
        assert.equal(valid.data.offset, 0);
      }

      const invalid = geocodedCustomersQuerySchema.safeParse({
        status: "unknown_status",
      });
      assert.equal(
        invalid.success,
        false,
        "Status tidak dikenal harus ditolak",
      );
    },
  );

  const fixtureCustomers = [
    {
      id: "c1",
      name: "Budi Santoso",
      pppoeUsername: "user-01",
      routerId: "r1",
      routerName: "Router Core",
      address: "Jl. Merdeka No. 1",
      latitude: -2.5786,
      longitude: 101.2185,
      odpName: "ODP-FAT-01",
      billingStatus: "lunas",
      opticalPower: -19.5,
      isOnline: true,
      lastUpdatedAt: new Date(),
    },
    {
      id: "c2",
      name: "Siti Rahma",
      pppoeUsername: "user-02",
      routerId: "r1",
      routerName: "Router Core",
      address: "Jl. Mawar No. 2",
      latitude: -2.579,
      longitude: 101.219,
      odpName: "ODP-FAT-01",
      billingStatus: "isolir",
      opticalPower: -26.0,
      isOnline: false,
      lastUpdatedAt: new Date(),
    },
  ];
  const testGetGeocoded = (q) => {
    const res = applyCustomerQueryFilters(fixtureCustomers, q);
    return {
      customers: res.filtered,
      summary: res.summary,
      dataSource: {
        provider: "Test Fixture",
        isRealData: true,
        lastSynchronizedAt: new Date().toISOString(),
      },
    };
  };

  await t.test(
    "getGeocodedCustomers: Mengembalikan daftar pelanggan berkoordinat valid dan ringkasan",
    async () => {
      const result = testGetGeocoded();

      assert.ok(
        Array.isArray(result.customers),
        "result.customers harus berupa array",
      );
      assert.ok(
        result.customers.length > 0,
        "Daftar pelanggan tidak boleh kosong",
      );
      assert.ok(result.summary, "Ringkasan metrik harus ada");
      assert.ok(result.dataSource, "Metadata data source harus ada");

      // Pastikan setiap pelanggan memiliki koordinat sah
      for (const c of result.customers) {
        assert.equal(typeof c.id, "string");
        assert.equal(typeof c.name, "string");
        assert.equal(typeof c.pppoeUsername, "string");
        assert.equal(typeof c.latitude, "number");
        assert.equal(typeof c.longitude, "number");
        assert.ok(Number.isFinite(c.latitude));
        assert.ok(Number.isFinite(c.longitude));
        assert.ok(typeof c.isOnline === "boolean");
        assert.ok(c.billingStatus === "lunas" || c.billingStatus === "isolir");
      }

      // Ringkasan harus konsisten
      assert.equal(result.summary.totalGeocoded, result.customers.length);
      assert.equal(
        result.summary.onlineCount + result.summary.offlineCount,
        result.summary.totalGeocoded,
        "onlineCount + offlineCount harus sama dengan totalGeocoded",
      );
    },
  );

  await t.test("getGeocodedCustomers: Filter status online", async () => {
    const result = testGetGeocoded({ status: "online" });
    for (const c of result.customers) {
      assert.equal(c.isOnline, true, "Semua pelanggan harus berstatus online");
    }
  });

  await t.test("getGeocodedCustomers: Filter status offline", async () => {
    const result = testGetGeocoded({ status: "offline" });
    for (const c of result.customers) {
      assert.equal(
        c.isOnline,
        false,
        "Semua pelanggan harus berstatus offline",
      );
    }
  });

  await t.test("getGeocodedCustomers: Filter status isolir", async () => {
    const result = testGetGeocoded({ status: "isolir" });
    for (const c of result.customers) {
      assert.equal(
        c.billingStatus,
        "isolir",
        "Semua pelanggan harus berstatus isolir",
      );
    }
  });

  await t.test(
    "getGeocodedCustomers: Filter pencarian nama / pppoe",
    async () => {
      const all = testGetGeocoded();
      const target = all.customers[0];
      const searchTerm = target.name.slice(0, 4);

      const filtered = testGetGeocoded({ search: searchTerm });
      for (const c of filtered.customers) {
        const match =
          c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          c.pppoeUsername.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (c.address &&
            c.address.toLowerCase().includes(searchTerm.toLowerCase()));
        assert.ok(match, "Harus cocok dengan query pencarian");
      }
    },
  );

  await t.test(
    "getGeocodedCustomers: Pagination limit dan offset",
    async () => {
      const page1 = testGetGeocoded({ limit: 1, offset: 0 });
      assert.equal(page1.customers.length, 1);

      if (page1.summary.totalGeocoded > 1) {
        const page2 = testGetGeocoded({ limit: 1, offset: 1 });
        assert.notEqual(page1.customers[0]?.id, page2.customers[0]?.id);
      }
    },
  );
});
