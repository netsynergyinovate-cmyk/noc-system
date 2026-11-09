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

const { getGeocodedCustomers, applyCustomerQueryFilters } =
  await import("../src/services/customer-location.service.ts");
const { geocodedCustomersQuerySchema } =
  await import("../src/validators/customer-location.ts");

test("Dukungan Pencarian dan Saringan pada Endpoint Daftar Pelanggan Berkoordinat", async (t) => {
  await t.test(
    "Validasi Schema: Mendukung parameter q, region, billingStatus, dan opticalStatus",
    () => {
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
    },
  );

  const fixtureCustomers = [
    {
      id: "c1",
      name: "Marsam",
      pppoeUsername: "17060001609",
      routerId: "r1",
      routerName: "Router Core",
      address: "Marsam Jaya No. 12",
      latitude: -2.5786,
      longitude: 101.2185,
      odpName: "ODP-TTJ-01",
      billingStatus: "lunas",
      opticalPower: -19.5,
      isOnline: true,
      lastUpdatedAt: new Date(),
    },
    {
      id: "c2",
      name: "Budi Santoso",
      pppoeUsername: "17060001610",
      routerId: "r1",
      routerName: "Router Core",
      address: "Jl. Anggrek No. 5",
      latitude: -2.579,
      longitude: 101.219,
      odpName: "ODP-TTJ-01",
      billingStatus: "isolir",
      opticalPower: -25.0,
      isOnline: false,
      lastUpdatedAt: new Date(),
    },
    {
      id: "c3",
      name: "Siti Aminah",
      pppoeUsername: "17060001611",
      routerId: "r1",
      routerName: "Router Core",
      address: "Jl. Mawar No. 1",
      latitude: -2.58,
      longitude: 101.22,
      odpName: "ODP-KBR-02",
      billingStatus: "lunas",
      opticalPower: -23.5,
      isOnline: true,
      lastUpdatedAt: new Date(),
    },
  ];
  const testFilter = (q) => {
    const res = applyCustomerQueryFilters(fixtureCustomers, q);
    return { customers: res.filtered, summary: res.summary };
  };

  await t.test(
    "Pencarian: Filter berdasarkan kata kunci nama / pppoe / alamat (search & q)",
    async () => {
      const resSearch = testFilter({ search: "marsam" });
      assert.ok(resSearch.customers.length > 0);
      for (const c of resSearch.customers) {
        assert.ok(
          c.name.toLowerCase().includes("marsam") ||
            c.pppoeUsername.toLowerCase().includes("marsam") ||
            (c.address && c.address.toLowerCase().includes("marsam")),
        );
      }

      const resQ = testFilter({ q: "17060001609" });
      assert.ok(resQ.customers.length > 0);
      for (const c of resQ.customers) {
        assert.ok(
          c.pppoeUsername.includes("17060001609") ||
            c.name.includes("17060001609"),
        );
      }
    },
  );

  await t.test("Saringan Wilayah & ODP: odp dan region alias", async () => {
    const resOdp = testFilter({ odp: "ODP-TTJ-01" });
    for (const c of resOdp.customers) {
      assert.ok(c.odpName?.toLowerCase().includes("odp-ttj-01"));
    }

    const resRegion = testFilter({ region: "ODP-TTJ-01" });
    assert.equal(resRegion.customers.length, resOdp.customers.length);
  });

  await t.test(
    "Saringan Status Titik: online, offline, weak, isolir, warning, normal",
    async () => {
      const resOnline = testFilter({ status: "online" });
      for (const c of resOnline.customers) {
        assert.equal(c.isOnline, true);
      }

      const resOffline = testFilter({ status: "offline" });
      for (const c of resOffline.customers) {
        assert.equal(c.isOnline, false);
      }

      const resWeak = testFilter({ status: "weak" });
      for (const c of resWeak.customers) {
        assert.ok(c.opticalPower !== null && c.opticalPower <= -24.5);
      }

      const resWarning = testFilter({ status: "warning" });
      for (const c of resWarning.customers) {
        assert.ok(
          c.opticalPower !== null &&
            c.opticalPower > -24.5 &&
            c.opticalPower <= -23.0,
        );
      }

      const resNormal = testFilter({ status: "normal" });
      for (const c of resNormal.customers) {
        assert.ok(c.opticalPower !== null && c.opticalPower > -23.0);
      }

      const resIsolir = testFilter({ status: "isolir" });
      for (const c of resIsolir.customers) {
        assert.equal(c.billingStatus, "isolir");
      }
    },
  );

  await t.test(
    "Saringan Optical Status Terdedikasi: normal, warning, critical",
    async () => {
      const resCrit = testFilter({ opticalStatus: "critical" });
      for (const c of resCrit.customers) {
        assert.ok(c.opticalPower !== null && c.opticalPower <= -24.5);
      }

      const resNorm = testFilter({ opticalStatus: "normal" });
      for (const c of resNorm.customers) {
        assert.ok(c.opticalPower !== null && c.opticalPower > -23.0);
      }
    },
  );

  await t.test(
    "Saringan Billing Status Terdedikasi: lunas vs isolir",
    async () => {
      const resLunas = testFilter({ billingStatus: "lunas" });
      for (const c of resLunas.customers) {
        assert.equal(c.billingStatus, "lunas");
      }

      const resIsolir = testFilter({ billingStatus: "isolir" });
      for (const c of resIsolir.customers) {
        assert.equal(c.billingStatus, "isolir");
      }
    },
  );

  await t.test("Integrasi Ringkasan (Summary) & Pagination", async () => {
    const all = testFilter();
    assert.ok(all.summary.totalGeocoded > 0);

    const filtered = testFilter({
      status: "online",
      limit: 1,
      offset: 0,
    });

    assert.equal(filtered.customers.length, 1);
    assert.equal(filtered.summary.totalGeocoded, all.summary.totalGeocoded);
    assert.equal(filtered.summary.onlineCount, all.summary.onlineCount);
    assert.equal(filtered.summary.filteredCount, all.summary.onlineCount);
    assert.equal(filtered.summary.limit, 1);
    assert.equal(filtered.summary.offset, 0);
  });
});
