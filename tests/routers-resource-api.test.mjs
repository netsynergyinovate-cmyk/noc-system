import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";

// Mode demo: tidak menyentuh DB. Env minimal agar env.ts lolos parse.
process.env.DASHBOARD_DATA = "demo";
process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:5432/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3101";

// "server-only" melempar di luar bundler Next; ganti dengan modul kosong.
const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

register();
const { getRouterResourcesSummary } = await import("../src/services/router-resources.service.ts");

const summaryKeys = [
  "activeRouters",
  "avgCpuLoad",
  "avgMemoryUsage",
  "offlineRouters",
  "peakCpuLoad",
  "totalPppoe",
  "totalQueues",
  "totalRouters",
  "warningRouters",
];

test("demo: envelope { summary, items } dengan invarian", async () => {
  const data = await getRouterResourcesSummary();
  assert.deepEqual(Object.keys(data).sort(), ["items", "summary"]);
  assert.ok(data.items.length > 0);
  assert.equal(data.summary.totalRouters, data.items.length);
  assert.equal(data.summary.activeRouters, data.items.filter((i) => i.active).length);
  assert.equal(data.summary.offlineRouters, data.items.filter((i) => !i.active).length);
});

test("demo: bentuk summary cocok RouterResourceSummary", async () => {
  const { summary } = await getRouterResourcesSummary();
  assert.deepEqual(Object.keys(summary).sort(), summaryKeys);
  for (const k of summaryKeys.filter((k) => k !== "peakCpuLoad")) {
    assert.equal(typeof summary[k], "number", k);
  }
  assert.ok(
    summary.peakCpuLoad === null ||
      (typeof summary.peakCpuLoad.routerName === "string" && typeof summary.peakCpuLoad.value === "number"),
  );
});

test("demo: tidak ada kredensial pada item", async () => {
  const { items } = await getRouterResourcesSummary();
  for (const item of items) {
    assert.ok(!/pass|secret|token|username/i.test(Object.keys(item).join(",")));
  }
  assert.ok(!/passwordEnc|password/i.test(JSON.stringify(items)));
});

test("demo: mengembalikan salinan, bukan objek bersama", async () => {
  const a = await getRouterResourcesSummary();
  a.items[0].cpuLoad = 99999;
  const b = await getRouterResourcesSummary();
  assert.notEqual(b.items[0].cpuLoad, 99999);
});
