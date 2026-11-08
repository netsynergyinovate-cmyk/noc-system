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
const { env } = await import("../src/lib/env.ts");
const { getOltPonPorts, getOltLiveOnus, getOltOpticalData } = await import("../src/services/devices.service.ts");
const { resolvePonPortDetail } = await import("../src/lib/dashboard/pon-port-resolver.ts");

// env adalah objek biasa hasil parse: mode diganti per tes (dibaca tiap pemanggilan).
const mode = (m) => {
  process.env.DASHBOARD_DATA = m;
  env.DASHBOARD_DATA = m;
};

test("live: tidak ada data tiruan yang bocor", async () => {
  mode("live");
  assert.equal(await getOltPonPorts("olt-1"), null);
  assert.equal(await getOltLiveOnus("olt-1", {}), null);
  assert.equal(await getOltOpticalData("olt-1"), null);
  assert.equal(await resolvePonPortDetail("olt-1-pon-1"), null);
});

test("demo: data tiruan tetap berfungsi", async () => {
  mode("demo");
  const ports = await getOltPonPorts("olt-1");
  assert.equal(ports.length, 8);
  ports.forEach((p) => assert.ok(p.id.startsWith("olt-1-pon-") && p.capacity > 0));

  const onus = await getOltLiveOnus("olt-1", {});
  assert.equal(onus.source, "simulator");
  assert.ok(onus.items.length > 0);

  assert.ok(await getOltOpticalData("olt-1"));

  const detail = await resolvePonPortDetail("olt-1-pon-1");
  assert.ok(detail);
  assert.equal(detail.source, "mock");
});
