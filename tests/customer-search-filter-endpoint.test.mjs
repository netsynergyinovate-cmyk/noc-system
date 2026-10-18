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

const { getGeocodedCustomers, applyCustomerQueryFilters } = await import(
  "../src/services/customer-location.service.ts"
);
const { geocodedCustomersQuerySchema } = await import(
  "../src/validators/customer-location.ts"
);

test("Dukungan Pencarian dan Saringan pada Endpoint Daftar Pelanggan Berkoordinat", async (t) => {
  await t.test("Validasi Schema: Mendukung parameter q, region, billingStatus, dan opticalStatus", () => {
    const valid = geocodedCustomersQuerySchema.safeParse({
      q: "marsam",
      region: "ODP-TTJ-01",
      billingStatus: "lunas",
      opticalStatus: "critical",
      limit: 25,
      offset: 0,
    });
    assert.ok(valid.success, "Schema harus berhasil memvalidasi parameter");
    if (valid.success) {
      assert.equal(valid.data.q, "marsam");
      assert.equal(valid.data.region, "ODP-TTJ-01");
      assert.equal(valid.data.billingStatus, "lunas");
      assert.equal(valid.data.opticalStatus, "critical");
      assert.equal(valid.data.limit, 25);
    }
  });

  await t.test("Pencarian: Filter berdasarkan kata kunci nama / pppoe / alamat (search & q)", async () => {
    const resSearch = await getGeocodedCustomers({ search: "marsam", forceMock: true });
    assert.ok(resSearch.customers.length > 0);
    for (const c of resSearch.customers) {
      assert.ok(
        c.name.toLowerCase().includes("marsam") ||
          c.pppoeUsername.toLowerCase().includes("marsam") ||
          (c.address && c.address.toLowerCase().includes("marsam")),
      );
    }

    const resQ = await getGeocodedCustomers({ q: "17060001609", forceMock: true });
    assert.ok(resQ.customers.length > 0);
    for (const c of resQ.customers) {
      assert.ok(c.pppoeUsername.includes("17060001609") || c.name.includes("17060001609"));
    }
  });

  await t.test("Saringan Wilayah & ODP: odp dan region alias", async () => {
    const resOdp = await getGeocodedCustomers({ odp: "ODP-TTJ-01", forceMock: true });
    for (const c of resOdp.customers) {
      assert.ok(c.odpName?.toLowerCase().includes("odp-ttj-01"));
    }

    const resRegion = await getGeocodedCustomers({ region: "ODP-TTJ-01", forceMock: true });
    assert.equal(resRegion.customers.length, resOdp.customers.length);
  });

  await t.test("Saringan Status Titik: online, offline, weak, isolir, warning, normal", async () => {
    const resOnline = await getGeocodedCustomers({ status: "online", forceMock: true });
    for (const c of resOnline.customers) {
      assert.equal(c.isOnline, true);
    }

    const resOffline = await getGeocodedCustomers({ status: "offline", forceMock: true });
    for (const c of resOffline.customers) {
      assert.equal(c.isOnline, false);
    }

    const resWeak = await getGeocodedCustomers({ status: "weak", forceMock: true });
    for (const c of resWeak.customers) {
      assert.ok(c.opticalPower !== null && c.opticalPower <= -24.5);
    }

    const resWarning = await getGeocodedCustomers({ status: "warning", forceMock: true });
    for (const c of resWarning.customers) {
      assert.ok(c.opticalPower !== null && c.opticalPower > -24.5 && c.opticalPower <= -23.0);
    }

    const resNormal = await getGeocodedCustomers({ status: "normal", forceMock: true });
    for (const c of resNormal.customers) {
      assert.ok(c.opticalPower !== null && c.opticalPower > -23.0);
    }

    const resIsolir = await getGeocodedCustomers({ status: "isolir", forceMock: true });
    for (const c of resIsolir.customers) {
      assert.equal(c.billingStatus, "isolir");
    }
  });

  await t.test("Saringan Optical Status Terdedikasi: normal, warning, critical", async () => {
    const resCrit = await getGeocodedCustomers({ opticalStatus: "critical", forceMock: true });
    for (const c of resCrit.customers) {
      assert.ok(c.opticalPower !== null && c.opticalPower <= -24.5);
    }

    const resNorm = await getGeocodedCustomers({ opticalStatus: "normal", forceMock: true });
    for (const c of resNorm.customers) {
      assert.ok(c.opticalPower !== null && c.opticalPower > -23.0);
    }
  });

  await t.test("Saringan Billing Status Terdedikasi: lunas vs isolir", async () => {
    const resLunas = await getGeocodedCustomers({ billingStatus: "lunas", forceMock: true });
    for (const c of resLunas.customers) {
      assert.equal(c.billingStatus, "lunas");
    }

    const resIsolir = await getGeocodedCustomers({ billingStatus: "isolir", forceMock: true });
    for (const c of resIsolir.customers) {
      assert.equal(c.billingStatus, "isolir");
    }
  });

  await t.test("Integrasi Ringkasan (Summary) & Pagination", async () => {
    const all = await getGeocodedCustomers({ forceMock: true });
    assert.ok(all.summary.totalGeocoded > 0);

    const filtered = await getGeocodedCustomers({
      status: "online",
      limit: 1,
      offset: 0,
      forceMock: true,
    });

    assert.equal(filtered.customers.length, 1);
    assert.equal(filtered.summary.totalGeocoded, all.summary.totalGeocoded);
    assert.equal(filtered.summary.onlineCount, all.summary.onlineCount);
    assert.equal(filtered.summary.filteredCount, all.summary.onlineCount);
    assert.equal(filtered.summary.limit, 1);
    assert.equal(filtered.summary.offset, 0);
  });
});
