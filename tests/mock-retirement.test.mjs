import test from "node:test";
import assert from "node:assert/strict";

const {
  isMockDataRetired,
  getMockRetirementPolicy,
  guardRetireMock,
  guardRetireMockArray,
  scanMockDataRegistry,
  assertNoActiveMockInProduction,
  MockDataRetiredError,
} = await import("../src/lib/dashboard/mock-retirement.ts");

test("isMockDataRetired mendeteksi lingkungan produksi dan live", () => {
  assert.equal(isMockDataRetired({ NODE_ENV: "development" }), false);
  assert.equal(isMockDataRetired({ NODE_ENV: "production" }), true);
  assert.equal(isMockDataRetired({ DASHBOARD_DATA: "live" }), true);
  assert.equal(isMockDataRetired({ DATA_MODE: "nyata" }), true);
  assert.equal(isMockDataRetired({ DASHBOARD_DATA: "demo" }), false);
});

test("getMockRetirementPolicy mengembalikan ringkasan kebijakan", () => {
  const devPolicy = getMockRetirementPolicy({ NODE_ENV: "development" });
  assert.equal(devPolicy.isProduction, false);
  assert.equal(devPolicy.retireEnforced, false);

  const prodPolicy = getMockRetirementPolicy({ NODE_ENV: "production" });
  assert.equal(prodPolicy.isProduction, true);
  assert.equal(prodPolicy.retireEnforced, true);
});

test("guardRetireMock melempar MockDataRetiredError di produksi jika realValue kosong", () => {
  const mockItem = { name: "Router Mock" };

  // Mode development: mengembalikan mockValue
  const devResult = guardRetireMock(mockItem, null, {
    module: "Router",
    source: { NODE_ENV: "development" },
  });
  assert.deepEqual(devResult, mockItem);

  // Mode production: melempar error pensiun
  assert.throws(
    () => {
      guardRetireMock(mockItem, null, {
        module: "Router",
        page: "/app/router",
        source: { NODE_ENV: "production" },
      });
    },
    (err) => {
      assert.ok(err instanceof MockDataRetiredError);
      assert.equal(err.code, "MOCK_DATA_RETIRED");
      assert.match(err.message, /Router/);
      assert.match(err.message, /\/app\/router/);
      return true;
    },
  );

  // Jika realValue ada: mengembalikan realValue di produksi tanpa error
  const realItem = { name: "Router Nyata" };
  const prodWithReal = guardRetireMock(mockItem, realItem, {
    module: "Router",
    source: { NODE_ENV: "production" },
  });
  assert.deepEqual(prodWithReal, realItem);
});

test("guardRetireMockArray mengembalikan array kosong di produksi jika realArray kosong", () => {
  const mockList = [{ id: 1 }, { id: 2 }];

  // Development: mengembalikan mock list
  const devList = guardRetireMockArray(mockList, null, {
    module: "Traffic",
    source: { NODE_ENV: "development" },
  });
  assert.deepEqual(devList, mockList);

  // Production: mengembalikan array kosong (bukan data tiruan)
  const prodList = guardRetireMockArray(mockList, null, {
    module: "Traffic",
    source: { NODE_ENV: "production" },
  });
  assert.deepEqual(prodList, []);

  // Production dengan realArray: mengembalikan data nyata
  const realList = [{ id: 99 }];
  const prodReal = guardRetireMockArray(mockList, realList, {
    module: "Traffic",
    source: { NODE_ENV: "production" },
  });
  assert.deepEqual(prodReal, realList);
});

test("scanMockDataRegistry dan assertNoActiveMockInProduction mendeteksi modul dummy", () => {
  const scan = scanMockDataRegistry();
  assert.ok(scan.totalRegistered > 0);
  assert.ok(scan.dummyCount > 0);

  // Di development, assert lolos
  assert.doesNotThrow(() => {
    assertNoActiveMockInProduction(undefined, { NODE_ENV: "development" });
  });

  // Di production jika masih ada dummy, assert melempar MockDataRetiredError
  assert.throws(
    () => {
      assertNoActiveMockInProduction(undefined, { NODE_ENV: "production" });
    },
    (err) => {
      assert.ok(err instanceof MockDataRetiredError);
      return true;
    },
  );

  // Di production jika semua sudah nyata, assert lolos
  const cleanRegistry = scan.activeDummies.map((d) => ({
    ...d,
    status: "nyata",
  }));
  assert.doesNotThrow(() => {
    assertNoActiveMockInProduction(cleanRegistry, { NODE_ENV: "production" });
  });
});
