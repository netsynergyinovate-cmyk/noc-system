import test from "node:test";
import assert from "node:assert/strict";
import { generateMockCpeDevices, summarizeCpeMetrics } from "../src/lib/dashboard/cpe-mock.ts";

const customers = Array.from({ length: 40 }, (_, i) => ({
  id: `c-${i + 1}`,
  name: `Pelanggan ${i + 1} Test`,
  pppoeUsername: `user${i + 1}@isp`,
  routerId: "r-1",
  address: `Jl. Contoh ${i + 1}`,
  odpName: `ODP-${(i % 5) + 1}`,
  latitude: -6.2,
  longitude: 106.8,
  billingStatus: "lunas",
  opticalPowerDbm: -18 - (i % 14),
  isOnline: i % 4 !== 0,
  planMbps: 20,
}));

test("deterministik untuk input yang sama", () => {
  assert.deepEqual(generateMockCpeDevices(customers), generateMockCpeDevices(customers));
  assert.equal(generateMockCpeDevices(customers).length, customers.length);
});

test("Device ID berformat OUI-ProductClass-SN", () => {
  for (const d of generateMockCpeDevices(customers)) {
    assert.equal(d.deviceId, `${d.oui}-${d.productClass}-${d.serialNumber}`);
    assert.match(d.oui, /^[0-9A-F]{6}$/);
    assert.match(d.serialNumber, /^[A-Z]{4}[0-9A-F]{8}$/);
  }
});

test("model bervariasi", () => {
  const models = new Set(generateMockCpeDevices(customers).map((d) => d.model));
  assert.ok(models.size >= 3);
});

test("host unik, IP 192.168.1.x, MAC valid", () => {
  for (const d of generateMockCpeDevices(customers)) {
    assert.ok(d.hosts.length >= 1);
    assert.equal(new Set(d.hosts.map((h) => h.ip)).size, d.hosts.length);
    assert.equal(new Set(d.hosts.map((h) => h.mac)).size, d.hosts.length);
    assert.equal(new Set(d.hosts.map((h) => h.hostname)).size, d.hosts.length);
    for (const h of d.hosts) {
      assert.match(h.ip, /^192\.168\.1\.(?:[2-9]|[1-9]\d|1\d\d|2[0-4]\d)$/);
      assert.match(h.mac, /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/);
      assert.ok(["wifi_2.4g", "wifi_5g", "ethernet"].includes(h.interfaceType));
    }
    assert.equal(d.wifi.clientCount, d.hosts.filter((h) => h.active).length);
    if (!d.isOnline) assert.equal(d.wifi.clientCount, 0);
  }
});

test("summarizeCpeMetrics", () => {
  const devices = generateMockCpeDevices(customers);
  const m = summarizeCpeMetrics(devices);
  assert.equal(m.total, 40);
  assert.equal(m.online, customers.filter((c) => c.isOnline).length);
  assert.equal(m.offline, m.total - m.online);
  assert.equal(m.weakSignal, customers.filter((c) => c.opticalPowerDbm < -27).length);
  assert.equal(m.totalClients, devices.reduce((s, d) => s + d.hosts.filter((h) => h.active).length, 0));
  assert.deepEqual(summarizeCpeMetrics([]), { total: 0, online: 0, offline: 0, weakSignal: 0, totalClients: 0 });
});

test("macAddress valid, optical/health terisi hanya saat online", () => {
  for (const d of generateMockCpeDevices(customers)) {
    assert.match(d.macAddress, /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i);
    if (d.isOnline) {
      assert.equal(d.optical.rxDbm, d.opticalPowerDbm);
      assert.ok(d.optical.txDbm !== null && d.optical.biasMa !== null && d.optical.voltageV !== null && d.optical.temperatureC !== null);
      assert.ok(d.health.cpuPercent !== null && d.health.memoryFreeKb !== null && d.health.memoryTotalKb !== null);
      assert.ok(d.health.temperatures.length >= 1);
    } else {
      assert.deepEqual(d.optical, { rxDbm: null, txDbm: null, biasMa: null, voltageV: null, temperatureC: null });
      assert.deepEqual(d.health, { cpuPercent: null, memoryFreeKb: null, memoryTotalKb: null, temperatures: [] });
    }
  }
});
