import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultRouterDetails,
  buildRouterDetails,
  filterRouterDetails,
  isCpuWarning,
  summarizeRouterResources,
} from "../src/lib/dashboard/routers.ts";

test("tiga router default memakai ID yang benar", () => {
  assert.deepEqual(
    defaultRouterDetails.map((r) => r.id),
    ["router-1", "router-2", "router-3"],
  );
});

test("batas CPU, RAM dan queueCount", () => {
  for (const r of defaultRouterDetails) {
    assert.ok(r.cpuLoad >= 0 && r.cpuLoad <= 100, `${r.id} cpu`);
    assert.ok(r.memoryUsage >= 0 && r.memoryUsage <= 100, `${r.id} ram`);
    assert.ok(Number.isInteger(r.queueCount) && r.queueCount >= 0, `${r.id} queue`);
  }
});

test("hanya router-2 yang CPU-nya peringatan", () => {
  assert.deepEqual(
    defaultRouterDetails.filter(isCpuWarning).map((r) => r.id),
    ["router-2"],
  );
});

test("pencarian teks: nama, host, model, banyak kata, huruf besar", () => {
  const all = defaultRouterDetails;
  assert.equal(filterRouterDetails(all, "").length, 3);
  assert.equal(filterRouterDetails(all, "   ").length, 3);
  assert.deepEqual(filterRouterDetails(all, "core").map((r) => r.id), ["router-1"]);
  assert.deepEqual(filterRouterDetails(all, "10.10.0.3").map((r) => r.id), ["router-3"]);
  assert.deepEqual(filterRouterDetails(all, "RB5009").map((r) => r.id), ["router-2"]);
  assert.deepEqual(filterRouterDetails(all, "rtr distribusi").map((r) => r.id), ["router-2"]);
  assert.equal(filterRouterDetails(all, "tidak-ada").length, 0);
});

test("filter status", () => {
  const routers = buildRouterDetails([
    { id: "router-1", name: "RTR-1", host: "10.10.0.1", active: true },
    { id: "router-2", name: "RTR-2", host: "10.10.0.2", active: true },
    { id: "router-x", name: "RTR-Mati", host: "10.10.0.9", active: false },
  ]);
  assert.equal(filterRouterDetails(routers, "", "all").length, 3);
  assert.deepEqual(filterRouterDetails(routers, "", "active").map((r) => r.id), [
    "router-1",
    "router-2",
  ]);
  assert.deepEqual(filterRouterDetails(routers, "", "disconnected").map((r) => r.id), ["router-x"]);
  assert.equal(filterRouterDetails(routers, "mati", "active").length, 0);
});

test("buildRouterDetails: sesi, router nonaktif, router tak dikenal", () => {
  const [a, , c] = buildRouterDetails(
    [
      { id: "router-1", name: "X", host: "1.1.1.1", active: false },
      { id: "router-2", name: "Y", host: "2.2.2.2", active: true },
      { id: "baru", name: "Z", host: "3.3.3.3", active: true },
    ],
    { "router-1": 5 },
  );
  assert.equal(a.pppoeCount, 5);
  assert.equal(a.cpuLoad, 0);
  assert.equal(a.uptime, "Offline");
  assert.equal(isCpuWarning(a), false);
  assert.equal(c.boardModel, "MikroTik RouterBOARD");
  assert.equal(c.queueCount, 0);
});

test("summarizeRouterResources: data kosong", () => {
  assert.deepEqual(summarizeRouterResources([]), {
    totalRouters: 0,
    activeRouters: 0,
    offlineRouters: 0,
    warningRouters: 0,
    avgCpuLoad: 0,
    peakCpuLoad: null,
    avgMemoryUsage: 0,
    totalQueues: 0,
    totalPppoe: 0,
  });
});

test("summarizeRouterResources: tiga router default", () => {
  assert.deepEqual(summarizeRouterResources(defaultRouterDetails), {
    totalRouters: 3,
    activeRouters: 3,
    offlineRouters: 0,
    warningRouters: 1,
    avgCpuLoad: 48, // (34+88+22)/3
    peakCpuLoad: { routerName: "RTR-Distribusi-RB5009", value: 88 },
    avgMemoryUsage: 47, // (41+63+37)/3
    totalQueues: 208,
    totalPppoe: 0,
  });
});

test("summarizeRouterResources: router offline tidak masuk rata-rata", () => {
  const routers = buildRouterDetails(
    [
      { id: "router-1", name: "X", host: "1.1.1.1", active: true },
      { id: "router-2", name: "Y", host: "2.2.2.2", active: false },
    ],
    { "router-1": 3, "router-2": 4 },
  );
  const s = summarizeRouterResources(routers);
  assert.equal(s.activeRouters, 1);
  assert.equal(s.offlineRouters, 1);
  assert.equal(s.avgCpuLoad, 34);
  assert.equal(s.avgMemoryUsage, 41);
  assert.equal(s.warningRouters, 0);
  assert.deepEqual(s.peakCpuLoad, { routerName: "RTR-Core-CCR2004", value: 34 });
  assert.equal(s.totalPppoe, 7);
  const allOff = summarizeRouterResources(routers.map((r) => ({ ...r, active: false })));
  assert.equal(allOff.avgCpuLoad, 0);
  assert.equal(allOff.peakCpuLoad, null);
});
