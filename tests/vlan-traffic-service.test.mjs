import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";

process.env.DATABASE_URL ??= "postgresql://starter:starter_password@127.0.0.1:5432/starter";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.DASHBOARD_DATA = "demo";

const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

register();

const { getVlanPonTraffic } = await import("../src/services/vlan-traffic.service.ts");

test("getVlanPonTraffic (live): mengembalikan 6 PON VLAN dengan deret grafik lengkap", async () => {
  const result = await getVlanPonTraffic({ range: "live" });

  assert.ok(result);
  assert.equal(result.range, "live");
  assert.equal(result.items.length, 6);
  assert.equal(result.items[0].vlanName, "vlan1101");
  assert.equal(result.items[0].ponName, "PON 1");
  assert.equal(result.items[0].vlanId, 1101);
  assert.equal(result.items[0].onuCount, 20);
  assert.ok(result.items[0].series.length > 0);

  // Verifikasi setiap titik grafik memiliki timestamp, timeLabel, downloadMbps, dan uploadMbps
  for (const pt of result.items[0].series) {
    assert.equal(typeof pt.timestamp, "number");
    assert.equal(typeof pt.timeLabel, "string");
    assert.equal(typeof pt.downloadMbps, "number");
    assert.equal(typeof pt.uploadMbps, "number");
  }

  // Verifikasi PON 6 (kosong/0 ONU)
  const pon6 = result.items[5];
  assert.equal(pon6.vlanName, "vlan1106");
  assert.equal(pon6.ponIndex, 6);
  assert.equal(pon6.onuCount, 0);

  // Verifikasi total metrik
  assert.ok(result.totalActivePon >= 5);
  assert.ok(result.totalOnuOnline >= 65);
  assert.ok(result.totalDownloadMbps > 0);
  assert.ok(result.totalUploadMbps > 0);
});

test("getVlanPonTraffic (1h): mengembalikan deret histori 1 jam dengan timeLabel jam:menit", async () => {
  const result = await getVlanPonTraffic({ range: "1h" });

  assert.ok(result);
  assert.equal(result.range, "1h");
  assert.equal(result.items.length, 6);
  const pon1 = result.items[0];
  assert.ok(pon1.series.length >= 10);
  assert.match(pon1.series[0].timeLabel, /^\d{2}\.\d{2}$/);
  assert.ok(pon1.peakDownloadMbps >= pon1.avgDownloadMbps);
});

test("getVlanPonTraffic (24h): mengembalikan deret histori 24 jam", async () => {
  const result = await getVlanPonTraffic({ range: "24h" });

  assert.ok(result);
  assert.equal(result.range, "24h");
  assert.equal(result.items.length, 6);
  const pon5 = result.items[4];
  assert.equal(pon5.vlanName, "vlan1105");
  assert.ok(pon5.series.length >= 10);
  assert.match(pon5.series[0].timeLabel, /^\d{2}\.\d{2}$/);
});
