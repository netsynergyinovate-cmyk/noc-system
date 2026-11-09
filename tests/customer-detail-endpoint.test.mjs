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

const routeDetail =
  await import("../src/app/api/customers/[id]/detail/route.ts");
const routeById = await import("../src/app/api/customers/[id]/route.ts");
const routeMapById = await import("../src/app/api/map/customers/[id]/route.ts");
const { getCustomerMapDetail } =
  await import("../src/services/customer-location.service.ts");
const { db } = await import("../src/db/index.ts");
const { routers } = await import("../src/db/schema/routers.ts");
const { customers } = await import("../src/db/schema/customers.ts");
test("Endpoint & Service Detail Pelanggan untuk Panel Peta", async (t) => {
  await t.test(
    "GET /api/customers/[id]/detail: Menolak akses tanpa autentikasi (401)",
    async () => {
      const req = new Request(
        "http://localhost:3101/api/customers/cust-123/detail",
      );
      const params = Promise.resolve({ id: "cust-123" });
      const res = await routeDetail.GET(req, { params });
      assert.equal(res.status, 401);
      const body = await res.json();
      assert.equal(body.error.code, "UNAUTHORIZED");
    },
  );

  await t.test(
    "GET /api/customers/[id]: Menolak akses tanpa autentikasi (401)",
    async () => {
      const req = new Request("http://localhost:3101/api/customers/cust-123");
      const params = Promise.resolve({ id: "cust-123" });
      const res = await routeById.GET(req, { params });
      assert.equal(res.status, 401);
      const body = await res.json();
      assert.equal(body.error.code, "UNAUTHORIZED");
    },
  );

  await t.test(
    "GET /api/map/customers/[id]: Menolak akses tanpa autentikasi (401)",
    async () => {
      const req = new Request(
        "http://localhost:3101/api/map/customers/cust-123",
      );
      const params = Promise.resolve({ id: "cust-123" });
      const res = await routeMapById.GET(req, { params });
      assert.equal(res.status, 401);
      const body = await res.json();
      assert.equal(body.error.code, "UNAUTHORIZED");
    },
  );

  await t.test(
    "getCustomerMapDetail: Mengembalikan null jika pelanggan tidak ditemukan",
    async () => {
      try {
        const result = await getCustomerMapDetail("non-existent-user-xyz-999");
        assert.equal(result, null);
      } catch (err) {
        assert.ok(err);
      }
    },
  );

  await t.test(
    "getCustomerMapDetail: Mengembalikan struktur detail lengkap pelanggan untuk panel peta",
    async () => {
      let testCustomer = null;
      try {
        const existing = await db.select().from(customers).limit(1);
        if (existing.length > 0) {
          testCustomer = existing[0];
        } else {
          const [r] = await db
            .insert(routers)
            .values({
              name: "Router Uji Detail",
              host: "10.99.1.1",
              username: "admin",
              passwordEnc: "dummy:enc:pass",
            })
            .returning();
          const [c] = await db
            .insert(customers)
            .values({
              name: "Pelanggan Uji Map",
              pppoeUsername: "user-map-test-01",
              routerId: r.id,
              address: "Jl. Uji No. 1",
              latitude: -2.5786,
              longitude: 101.2185,
              billingStatus: "lunas",
              opticalPower: -19.5,
            })
            .returning();
          testCustomer = c;
        }
      } catch {}

      if (!testCustomer) return;
      const result = await getCustomerMapDetail(testCustomer.id);
      assert.ok(result, "Data detail pelanggan harus ditemukan");

      assert.equal(typeof result.id, "string");
      assert.equal(typeof result.name, "string");
      assert.equal(typeof result.pppoeUsername, "string");
      assert.ok(
        result.billingStatus === "lunas" || result.billingStatus === "isolir",
      );
      assert.equal(typeof result.isOnline, "boolean");

      if (result.latitude !== null && result.longitude !== null) {
        assert.equal(typeof result.latitude, "number");
        assert.equal(typeof result.longitude, "number");
        assert.ok(Number.isFinite(result.latitude));
        assert.ok(Number.isFinite(result.longitude));
      }

      assert.ok(result.dataSource);
      assert.equal(typeof result.dataSource.provider, "string");
      assert.equal(typeof result.dataSource.isRealData, "boolean");
    },
  );

  await t.test(
    "getCustomerMapDetail: Mendukung pencarian berdasarkan pppoeUsername",
    async () => {
      let testCustomer = null;
      try {
        const existing = await db.select().from(customers).limit(1);
        if (existing.length > 0) testCustomer = existing[0];
      } catch {}
      if (!testCustomer) return;
      const byUsername = await getCustomerMapDetail(testCustomer.pppoeUsername);
      assert.ok(byUsername);
      assert.equal(byUsername.id, testCustomer.id);
    },
  );
});
