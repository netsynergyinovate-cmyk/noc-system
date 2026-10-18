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

const routeDetail = await import(
  "../src/app/api/customers/[id]/detail/route.ts"
);
const routeById = await import("../src/app/api/customers/[id]/route.ts");
const routeMapById = await import(
  "../src/app/api/map/customers/[id]/route.ts"
);
const { getCustomerMapDetail } = await import(
  "../src/services/customer-location.service.ts"
);

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
      const result = await getCustomerMapDetail("non-existent-user-xyz-999", {
        forceMock: true,
      });
      assert.equal(result, null);
    },
  );

  await t.test(
    "getCustomerMapDetail: Mengembalikan struktur detail lengkap pelanggan untuk panel peta",
    async () => {
      // Ambil contoh pelanggan dari data simulasi
      const result = await getCustomerMapDetail("mock-cust-01", { forceMock: true });
      assert.ok(result, "Data detail pelanggan harus ditemukan");

      if (result) {
        assert.equal(typeof result.id, "string");
        assert.equal(typeof result.name, "string");
        assert.equal(typeof result.pppoeUsername, "string");
        assert.ok(
          result.billingStatus === "lunas" || result.billingStatus === "isolir",
        );
        assert.equal(typeof result.isOnline, "boolean");

        // Periksa koordinat numerik
        if (result.latitude !== null && result.longitude !== null) {
          assert.equal(typeof result.latitude, "number");
          assert.equal(typeof result.longitude, "number");
          assert.ok(Number.isFinite(result.latitude));
          assert.ok(Number.isFinite(result.longitude));
        }

        // Periksa rincian ONU
        if (result.onuDetails) {
          assert.ok(
            result.onuDetails.serialNumber === null ||
              typeof result.onuDetails.serialNumber === "string",
          );
          if (result.onuDetails.opticalLevel !== null) {
            assert.equal(typeof result.onuDetails.opticalLevel, "number");
          }
        }

        // Periksa metadata data source
        assert.ok(result.dataSource);
        assert.equal(typeof result.dataSource.provider, "string");
        assert.equal(typeof result.dataSource.isRealData, "boolean");
        assert.equal(typeof result.dataSource.lastSynchronizedAt, "string");
      }
    },
  );

  await t.test(
    "getCustomerMapDetail: Mendukung pencarian berdasarkan pppoeUsername",
    async () => {
      const byId = await getCustomerMapDetail("mock-cust-02", { forceMock: true });
      assert.ok(byId);
      if (byId) {
        const byUsername = await getCustomerMapDetail(byId.pppoeUsername, {
          forceMock: true,
        });
        assert.ok(byUsername);
        assert.equal(byUsername?.id, byId.id);
      }
    },
  );
});
