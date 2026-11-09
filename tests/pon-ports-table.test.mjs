import test from "node:test";
import assert from "node:assert/strict";

const {
  generateMockPonPortOverview,
  filterPonPorts,
  computePonSummary,
  PON_ONU_DATA_MOCK_ENTRY,
  EMPTY_PON_FILTER,
} = await import("../src/lib/dashboard/pon-port-table-data.ts");
const { SETUP_DATA_SOURCE_REGISTRY } =
  await import("../src/lib/dashboard/setup-extended.ts");

const ports = generateMockPonPortOverview();

test("generateMockPonPortOverview: valid, deterministik, optik & kapasitas", () => {
  assert.ok(ports.length > 0);
  assert.deepEqual(generateMockPonPortOverview(), ports);
  assert.equal(new Set(ports.map((p) => p.portId)).size, ports.length);
  for (const p of ports) {
    assert.ok(p.onlineOnu <= p.totalOnu);
    assert.ok(p.capacityPercent > 0 && p.capacityPercent <= 100);
    assert.ok(["normal", "warning", "critical"].includes(p.opticalStatus));
    if (p.status === "up") {
      assert.equal(typeof p.rxPowerDbm, "number");
      assert.equal(typeof p.txPowerDbm, "number");
    } else {
      assert.equal(p.onlineOnu, 0);
      assert.equal(p.opticalStatus, "critical");
    }
  }
  assert.ok(ports.some((p) => p.status === "down"));
  assert.ok(ports.some((p) => p.status === "up"));
});

test("filterPonPorts: status, OLT, optik, query", () => {
  assert.equal(filterPonPorts(ports, EMPTY_PON_FILTER).length, ports.length);
  const down = filterPonPorts(ports, { ...EMPTY_PON_FILTER, status: "down" });
  assert.ok(down.length > 0 && down.every((p) => p.status === "down"));
  const olt = filterPonPorts(ports, { ...EMPTY_PON_FILTER, oltId: "olt-2" });
  assert.ok(olt.length > 0 && olt.every((p) => p.oltId === "olt-2"));
  for (const o of ["normal", "warning", "critical"]) {
    const r = filterPonPorts(ports, { ...EMPTY_PON_FILTER, opticalStatus: o });
    assert.ok(r.every((p) => p.opticalStatus === o));
  }
  const q = filterPonPorts(ports, {
    ...EMPTY_PON_FILTER,
    query: "  epon   pon 1/1/3 ",
  });
  assert.ok(
    q.length > 0 && q.every((p) => /epon/i.test(p.oltName) && p.ponIndex === 3),
  );
  assert.equal(
    filterPonPorts(ports, { ...EMPTY_PON_FILTER, query: "zzz-tidak-ada" })
      .length,
    0,
  );
  const combo = filterPonPorts(ports, {
    ...EMPTY_PON_FILTER,
    oltId: "olt-1",
    status: "up",
  });
  assert.ok(combo.every((p) => p.oltId === "olt-1" && p.status === "up"));
});

test("computePonSummary: akumulasi akurat", () => {
  const s = computePonSummary(ports);
  assert.equal(s.totalPorts, ports.length);
  assert.equal(s.upPorts, ports.filter((p) => p.status === "up").length);
  assert.equal(
    s.totalOnu,
    ports.reduce((a, p) => a + p.totalOnu, 0),
  );
  assert.equal(
    s.onlineOnu,
    ports.reduce((a, p) => a + p.onlineOnu, 0),
  );
  assert.equal(
    s.weakOnu,
    ports.reduce((a, p) => a + p.weakOnuCount, 0),
  );
  assert.equal(
    s.losOnu,
    ports.reduce((a, p) => a + p.losOnuCount, 0),
  );
  assert.deepEqual(computePonSummary([]), {
    totalPorts: 0,
    upPorts: 0,
    totalOnu: 0,
    onlineOnu: 0,
    weakOnu: 0,
    losOnu: 0,
  });
});

test("PON_ONU_DATA_MOCK_ENTRY terdaftar di registry", () => {
  assert.equal(PON_ONU_DATA_MOCK_ENTRY.id, "pon-ports-onus-data");
  assert.equal(PON_ONU_DATA_MOCK_ENTRY.status, "dummy");
  assert.ok(SETUP_DATA_SOURCE_REGISTRY.length >= 9);
  assert.ok(SETUP_DATA_SOURCE_REGISTRY.includes(PON_ONU_DATA_MOCK_ENTRY));
});
