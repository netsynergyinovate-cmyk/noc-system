import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { buildLiveRouterDetails, formatRouterOsUptime } = await import("../src/lib/dashboard/routers.ts");

const store = [
  { id: "r1", name: "Core CIARA", host: "10.0.0.1", active: true },
  { id: "r2", name: "Cadangan", host: "10.0.0.2", active: false },
];
const item = (o) => ({
  id: "r1", name: "x", host: "x", boardModel: "RB4011iGS+", rosVersion: "7.16.1 (stable)",
  role: "Gateway", cpuLoad: 31, memoryUsage: 44, uptime: "23 hari 4 jam", active: true,
  queueCount: 12, temperature: 47, pppoeCount: 0, ...o,
});

test("router terbaca memakai angka dari router, nama/host/status dari store, PPPoE dari hitungan pelanggan", () => {
  const [a] = buildLiveRouterDetails(store, [item({})], { r1: 69 });
  assert.deepEqual(
    [a.name, a.host, a.boardModel, a.cpuLoad, a.memoryUsage, a.queueCount, a.temperature, a.pppoeCount, a.active],
    ["Core CIARA", "10.0.0.1", "RB4011iGS+", 31, 44, 12, 47, 69, true],
  );
});

test("router yang belum terbaca tidak diisi angka karangan", () => {
  const [a] = buildLiveRouterDetails(store.slice(0, 1), null, {});
  assert.deepEqual(
    [a.boardModel, a.rosVersion, a.cpuLoad, a.memoryUsage, a.uptime, a.queueCount, a.temperature, a.active],
    ["-", "-", 0, 0, "-", undefined, undefined, true],
  );
});

test("router nonaktif di store atau tak menjawab ditampilkan Offline tanpa beban", () => {
  const out = buildLiveRouterDetails(store, [item({}), item({ id: "r2", active: true })], {});
  assert.equal(out[1].active, false); // store bilang nonaktif
  assert.deepEqual([out[1].cpuLoad, out[1].memoryUsage, out[1].temperature, out[1].uptime], [0, 0, undefined, "Offline"]);
  const down = buildLiveRouterDetails(store.slice(0, 1), [item({ active: false })], {});
  assert.equal(down[0].active, false); // server gagal membaca router itu
  assert.equal(down[0].uptime, "Offline");
});

test("item tidak dimutasi dan data tiruan bawaan tidak pernah dipakai", () => {
  const src = item({});
  const [a] = buildLiveRouterDetails(store.slice(0, 1), [src], { r1: 5 });
  assert.equal(src.pppoeCount, 0);
  assert.notEqual(a, src);
  const unknown = buildLiveRouterDetails([{ id: "router-1", name: "T", host: "h", active: true }], null, {});
  assert.equal(unknown[0].boardModel, "-");
});

test("uptime RouterOS menjadi teks Indonesia ringkas", () => {
  assert.equal(formatRouterOsUptime("3w2d4h5m6s"), "23 hari 4 jam");
  assert.equal(formatRouterOsUptime("14h5m"), "14 jam 5 menit");
  assert.equal(formatRouterOsUptime("45s"), "45 detik");
  assert.equal(formatRouterOsUptime(""), "-");
});
