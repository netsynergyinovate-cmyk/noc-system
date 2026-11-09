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
const { getOltOpticalData } =
  await import("../src/services/devices.service.ts");
const { opticalFilterSchema } = await import("../src/validators/devices.ts");

const CATEGORIES = ["normal", "warning", "critical"];

test("struktur lengkap & invarian jumlah kategori", async () => {
  const r = await getOltOpticalData("olt-1");
  assert.equal(r.oltId, "olt-1");
  assert.equal(r.source, "simulator");
  assert.ok(Number.isInteger(r.syncedAt));
  assert.ok(r.items.length > 0);
  const s = r.summary;
  assert.equal(s.totalOnus, r.items.length);
  assert.equal(
    s.onlineOnus,
    r.items.filter((o) => o.status === "online").length,
  );
  assert.equal(s.normalCount + s.warningCount + s.criticalCount, s.totalOnus);
  for (const o of r.items) {
    assert.ok(CATEGORIES.includes(o.category));
    assert.equal(typeof o.isWeak, "boolean");
    if (o.txPowerDbm !== null && o.rxPowerDbm !== null)
      assert.equal(
        o.lossDb,
        Math.round((o.txPowerDbm - o.rxPowerDbm) * 100) / 100,
      );
    else assert.equal(o.lossDb, null);
    if (o.status !== "online" || o.rxPowerDbm === null)
      assert.equal(o.category, "critical");
    else if (o.rxPowerDbm < -30) assert.equal(o.category, "critical");
    else if (o.rxPowerDbm < -27 || o.rxPowerDbm > -8)
      assert.equal(o.category, "warning");
    else assert.equal(o.category, "normal");
    assert.equal(o.isWeak, o.rxPowerDbm !== null && o.rxPowerDbm < -27);
  }
  const rxs = r.items
    .filter((o) => o.status === "online" && o.rxPowerDbm !== null)
    .map((o) => o.rxPowerDbm);
  if (rxs.length) {
    assert.equal(s.minRxDbm, Math.min(...rxs));
    assert.equal(s.maxRxDbm, Math.max(...rxs));
    assert.ok(
      s.avgRxDbm >= s.minRxDbm - 0.05 && s.avgRxDbm <= s.maxRxDbm + 0.05,
    );
  } else assert.equal(s.avgRxDbm, null);
});

test("filter ponIndex", async () => {
  const r = await getOltOpticalData("olt-1", 3);
  assert.ok(r.items.length > 0);
  r.items.forEach((o) => assert.equal(o.ponIndex, 3));
  assert.equal(r.summary.totalOnus, r.items.length);
});

test("ID tidak valid -> null", async () => {
  for (const bad of ["", "abc", "../etc", "550e8400-e29b-41d4-a716"])
    assert.equal(await getOltOpticalData(bad), null, bad);
});

test("skema: ponIndex 1..128, kunci asing ditolak", () => {
  assert.equal(opticalFilterSchema.parse({ ponIndex: "5" }).ponIndex, 5);
  assert.equal(opticalFilterSchema.parse({}).ponIndex, undefined);
  assert.equal(opticalFilterSchema.safeParse({ ponIndex: "0" }).success, false);
  assert.equal(
    opticalFilterSchema.safeParse({ ponIndex: "129" }).success,
    false,
  );
  assert.equal(
    opticalFilterSchema.safeParse({ ponIndex: "128" }).success,
    true,
  );
  assert.equal(opticalFilterSchema.safeParse({ foo: "1" }).success, false);
});
