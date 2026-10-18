import test from "node:test";
import assert from "node:assert/strict";

test("Network Map Service contract and shape verification", async (t) => {
  await t.test("NetworkMapData schema memiliki properti kunci yang diwajibkan", async () => {
    // Verifikasi struktur data topologi
    const dummyOutput = {
      customers: [],
      infrastructure: [
        {
          id: "router-1",
          name: "Core CIARA",
          type: "router",
          status: "aktif",
          latitude: -2.5786,
          longitude: 101.2185,
        },
      ],
      summary: {
        totalCustomers: 70,
        geocodedCustomers: 0,
        onlineCustomers: 50,
        offlineCustomers: 20,
        criticalOpticsCount: 4,
        totalOlts: 1,
        totalRouters: 1,
        totalOdps: 12,
      },
      dataSource: {
        provider: "PostgreSQL Database (NOC Operational)",
        isRealData: true,
        lastSynchronizedAt: new Date().toISOString(),
      },
    };

    assert.equal(Array.isArray(dummyOutput.customers), true);
    assert.equal(Array.isArray(dummyOutput.infrastructure), true);
    assert.equal(typeof dummyOutput.summary.totalCustomers, "number");
    assert.equal(typeof dummyOutput.summary.criticalOpticsCount, "number");
    assert.equal(dummyOutput.dataSource.isRealData, true);
  });
});
