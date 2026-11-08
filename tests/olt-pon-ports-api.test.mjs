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
const { getOltPonPorts } = await import("../src/services/devices.service.ts");

function assertSummary(p, oltId) {
  assert.equal(p.oltId, oltId);
  assert.ok(Number.isInteger(p.ponIndex) && p.ponIndex >= 1);
  assert.equal(typeof p.name, "string");
  assert.ok(p.name.length > 0);
  assert.ok(p.capacity === 64 || p.capacity === 128);
  assert.ok(p.status === "up" || p.status === "down");
  assert.ok(Number.isInteger(p.onuCount) && p.onuCount >= 0);
  assert.ok(p.onlineOnuCount <= p.onuCount);
}

for (const [id, name] of [
  ["olt-1", "OLT Utama Kebon Jeruk"],
  ["olt-2", "OLT Pasar Minggu"],
]) {
  test(`mock ${id} -> 8 port PON valid`, async () => {
    const ports = await getOltPonPorts(id);
    assert.equal(ports.length, 8);
    ports.forEach((p) => {
      assertSummary(p, id);
      assert.equal(p.oltName, name);
    });
    assert.deepEqual(ports.map((p) => p.ponIndex), [1, 2, 3, 4, 5, 6, 7, 8]);
  });
}

test("ID bukan UUID dan bukan mock -> null (tanpa menyentuh DB)", async () => {
  // mode demo menyajikan mock untuk ID apa pun; penolakan ID hanya berlaku di live.
  const { env } = await import("../src/lib/env.ts");
  process.env.DASHBOARD_DATA = "live";
  env.DASHBOARD_DATA = "live";
  try {
    for (const bad of ["", "abc", "../etc", "550e8400-e29b-41d4-a716"])
      assert.equal(await getOltPonPorts(bad), null, bad);
  } finally {
    process.env.DASHBOARD_DATA = "demo";
    env.DASHBOARD_DATA = "demo";
  }
});
