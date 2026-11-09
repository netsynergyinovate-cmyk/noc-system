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
const { getOltLiveOnus } = await import("../src/services/devices.service.ts");
const { liveOnuFilterSchema } = await import("../src/validators/devices.ts");

const STATUSES = ["online", "offline", "los"];

function assertInvariant(r) {
  assert.equal(r.summary.total, r.items.length);
  assert.equal(
    r.summary.online + r.summary.offline + r.summary.los,
    r.summary.total,
  );
}

test("mock OLT -> daftar ONU lengkap dengan status valid", async () => {
  const r = await getOltLiveOnus("olt-1", {});
  assert.equal(r.oltId, "olt-1");
  assert.equal(r.oltName, "OLT Utama Kebon Jeruk");
  assert.equal(r.source, "simulator");
  assert.ok(Number.isInteger(r.syncedAt));
  assert.ok(r.items.length > 0);
  r.items.forEach((o) => assert.ok(STATUSES.includes(o.status)));
  assertInvariant(r);
  assert.equal((await getOltLiveOnus("olt-2", {})).oltName, "OLT Pasar Minggu");
});

test("filter ponIndex", async () => {
  const r = await getOltLiveOnus("olt-1", { ponIndex: 3 });
  assert.ok(r.items.length > 0);
  r.items.forEach((o) => assert.equal(o.ponIndex, 3));
  assertInvariant(r);
});

test("filter status", async () => {
  for (const status of STATUSES) {
    const r = await getOltLiveOnus("olt-1", { status });
    assert.ok(r.items.length > 0, status);
    r.items.forEach((o) => assert.equal(o.status, status));
    assert.equal(r.summary[status], r.summary.total);
    assertInvariant(r);
  }
});

test("filter q (serial number, tanpa peduli huruf besar/kecil)", async () => {
  const all = await getOltLiveOnus("olt-1", {});
  const sn = all.items[0].serialNumber;
  const r = await getOltLiveOnus("olt-1", { q: sn.toLowerCase() });
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].serialNumber, sn);
  assert.equal(
    (await getOltLiveOnus("olt-1", { q: "TIDAK-ADA" })).items.length,
    0,
  );
});

test("filter isWeak membagi himpunan tanpa sisa", async () => {
  const all = await getOltLiveOnus("olt-1", {});
  const weak = await getOltLiveOnus("olt-1", { isWeak: "true" });
  const ok = await getOltLiveOnus("olt-1", { isWeak: "false" });
  assert.equal(weak.items.length + ok.items.length, all.items.length);
});

test("ID tidak valid -> null", async () => {
  for (const bad of ["", "abc", "../etc", "550e8400-e29b-41d4-a716"])
    assert.equal(await getOltLiveOnus(bad, {}), null, bad);
});

test("skema filter: koersi angka, tolak kunci asing & nilai buruk", () => {
  assert.equal(liveOnuFilterSchema.parse({ ponIndex: "5" }).ponIndex, 5);
  assert.equal(liveOnuFilterSchema.safeParse({ status: "x" }).success, false);
  assert.equal(liveOnuFilterSchema.safeParse({ ponIndex: "0" }).success, false);
  assert.equal(
    liveOnuFilterSchema.safeParse({ ponIndex: "129" }).success,
    false,
  );
  assert.equal(liveOnuFilterSchema.safeParse({ foo: "1" }).success, false);
});
