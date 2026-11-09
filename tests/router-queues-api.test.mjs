import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";

process.env.DASHBOARD_DATA = "demo";
process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:5432/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3101";

const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

register();
const { generateMockSimpleQueues, filterSimpleQueues } =
  await import("../src/lib/dashboard/routers.ts");

const sampleCustomers = [
  {
    id: "c1",
    routerId: "router-1",
    name: "Budi",
    pppoeUsername: "user-budi",
    planMbps: 20,
    billingStatus: "lunas",
    isOnline: true,
  },
  {
    id: "c2",
    routerId: "router-1",
    name: "Siti",
    pppoeUsername: "user-siti",
    planMbps: 10,
    billingStatus: "isolir",
    isOnline: false,
  },
  {
    id: "c3",
    routerId: "router-2",
    name: "Andi",
    pppoeUsername: "user-andi",
    planMbps: 50,
    billingStatus: "lunas",
    isOnline: true,
  },
];

for (const id of ["router-1", "router-2"]) {
  test(`${id}: quota upload & download valid`, () => {
    const qs = generateMockSimpleQueues(id, sampleCustomers);
    assert.ok(qs.length > 0);
    for (const q of qs) {
      assert.equal(q.routerId, id);
      assert.ok(q.maxLimit.upload > 0 && q.maxLimit.download > 0);
      assert.ok(q.rate.upload <= q.maxLimit.upload);
      assert.ok(q.rate.download <= q.maxLimit.download);
    }
  });
}

test("filter pencarian nama dan IP target", () => {
  const all = generateMockSimpleQueues("router-1", sampleCustomers);
  const byName = filterSimpleQueues(all, all[0].name);
  assert.ok(byName.some((q) => q.id === all[0].id));
  const ip = all[0].target.split("/")[0];
  const byIp = filterSimpleQueues(all, ip);
  assert.ok(byIp.length > 0 && byIp.every((q) => q.target.includes(ip)));
  assert.deepEqual(filterSimpleQueues(all, "zzz-tidak-ada"), []);
});

test("filter status active / disabled", () => {
  const all = generateMockSimpleQueues("router-1", sampleCustomers);
  const active = filterSimpleQueues(all, "", "active");
  const disabled = filterSimpleQueues(all, "", "disabled");
  assert.ok(active.every((q) => !q.disabled));
  assert.ok(disabled.every((q) => q.disabled));
  assert.equal(active.length + disabled.length, all.length);
});
