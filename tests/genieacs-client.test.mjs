import test from "node:test";
import assert from "node:assert/strict";
import { GenieAcsClient, mapGenieAcsToCpe } from "../src/lib/genieacs/client.ts";

const NOW = 1_760_000_000;
const sim = { url: "http://sim.local:7557", timeoutMs: 1000, mode: "simulator" };
const real = { url: "http://acs.local:7557", timeoutMs: 1000, mode: "real", authHeader: "Basic eDp5" };

const v = (x) => ({ _value: x });

const tr098 = {
  _id: "00259E-F609-ZTEG1234ABCD",
  _lastInform: new Date((NOW - 60) * 1000).toISOString(),
  InternetGatewayDevice: {
    DeviceInfo: {
      Manufacturer: v("ZTE"),
      ModelName: v("F609"),
      SerialNumber: v("ZTEG1234ABCD"),
      HardwareVersion: v("V3.0"),
      SoftwareVersion: v("V3.0.0P2T6"),
      UpTime: v(90061),
    },
    WANDevice: {
      1: { WANConnectionDevice: { 1: { WANPPPConnection: { 1: { ExternalIPAddress: v("10.20.30.40") } } } } },
    },
    LANDevice: {
      1: {
        LANHostConfigManagement: { IPInterface: { 1: { IPInterfaceIPAddress: v("192.168.1.1") } } },
        WLANConfiguration: {
          1: { SSID: v("WIFI_budi"), Enable: v(true), Channel: v(6), BeaconType: v("WPAand11i") },
        },
        Hosts: {
          Host: {
            1: { HostName: v("iPhone"), IPAddress: v("192.168.1.2"), PhysAddress: v("AA:BB:CC:00:00:01"), Active: v(true), InterfaceType: v("802.11") },
            2: { HostName: v("TV"), IPAddress: v("192.168.1.3"), PhysAddress: v("AA:BB:CC:00:00:02"), Active: v(false), InterfaceType: v("Ethernet") },
          },
        },
      },
    },
  },
};

const tr181 = {
  _id: "00E0FC-HG8245H5-HWTC0000BEEF",
  _lastInform: (NOW - 30) * 1000,
  "Device.DeviceInfo.Manufacturer": v("Huawei"),
  "Device.DeviceInfo.ModelName": v("HG8245H5"),
  "Device.DeviceInfo.SerialNumber": v("HWTC0000BEEF"),
  "Device.DeviceInfo.SoftwareVersion": v("V5R019"),
  "Device.DeviceInfo.UpTime": v("3600"),
  "Device.IP.Interface.1.IPv4Address.1.IPAddress": v("192.168.100.1"),
  "Device.IP.Interface.2.IPv4Address.1.IPAddress": v("100.64.1.9"),
  "Device.WiFi.SSID.1.SSID": v("HUAWEI-5G"),
  "Device.WiFi.SSID.1.Enable": v("true"),
  "Device.WiFi.Radio.1.Channel": v(36),
  "Device.WiFi.Radio.1.OperatingFrequencyBand": v("5GHz"),
  "Device.Hosts.Host.1.HostName": v("Laptop"),
  "Device.Hosts.Host.1.IPAddress": v("192.168.100.5"),
  "Device.Hosts.Host.1.PhysAddress": v("AA:BB:CC:00:00:09"),
  "Device.Hosts.Host.1.Active": v(true),
};

test("simulator: testConnection ok", async () => {
  const r = await new GenieAcsClient(sim).testConnection();
  assert.deepEqual(r, { ok: true, latencyMs: 15, deviceCount: 4 });
});

test("simulator: listDevices dan getDevice", async () => {
  const c = new GenieAcsClient(sim);
  const list = await c.listDevices();
  assert.ok(Array.isArray(list));
  assert.equal(list.length, 4);
  const found = await c.getDevice(list[1].deviceId);
  assert.equal(found?.deviceId, list[1].deviceId);
  assert.equal((await c.getDevice(list[2].id))?.id, list[2].id);
  assert.equal(await c.getDevice("tidak-ada"), null);
});

test("mapGenieAcsToCpe: TR-098", () => {
  const d = mapGenieAcsToCpe(tr098, NOW);
  assert.equal(d.deviceId, "00259E-F609-ZTEG1234ABCD");
  assert.equal(d.oui, "00259E");
  assert.equal(d.productClass, "F609");
  assert.equal(d.serialNumber, "ZTEG1234ABCD");
  assert.equal(d.manufacturer, "ZTE");
  assert.equal(d.model, "F609");
  assert.equal(d.hardwareVersion, "V3.0");
  assert.equal(d.softwareVersion, "V3.0.0P2T6");
  assert.equal(d.uptimeSeconds, 90061);
  assert.equal(d.uptimeText, "1 hari 1 jam");
  assert.equal(d.wanIp, "10.20.30.40");
  assert.equal(d.lanIp, "192.168.1.1");
  assert.equal(d.isOnline, true);
  assert.equal(d.lastInformAt, NOW - 60);
  assert.equal(d.wifi.ssid, "WIFI_budi");
  assert.equal(d.wifi.enabled, true);
  assert.equal(d.wifi.channel, 6);
  assert.equal(d.wifi.radioFrequency, "2.4GHz");
  assert.equal(d.wifi.clientCount, 1);
  assert.equal(d.hosts.length, 2);
  assert.equal(d.hosts[0].interfaceType, "wifi_2.4g");
  assert.equal(d.hosts[1].interfaceType, "ethernet");
  assert.equal(d.hosts[1].active, false);
});

test("mapGenieAcsToCpe: TR-181 (kunci datar)", () => {
  const d = mapGenieAcsToCpe(tr181, NOW);
  assert.equal(d.manufacturer, "Huawei");
  assert.equal(d.model, "HG8245H5");
  assert.equal(d.serialNumber, "HWTC0000BEEF");
  assert.equal(d.uptimeSeconds, 3600);
  assert.equal(d.wanIp, "100.64.1.9");
  assert.equal(d.lanIp, "192.168.100.1");
  assert.equal(d.isOnline, true);
  assert.equal(d.lastInformAt, NOW - 30);
  assert.equal(d.wifi.ssid, "HUAWEI-5G");
  assert.equal(d.wifi.enabled, true);
  assert.equal(d.wifi.channel, 36);
  assert.equal(d.wifi.radioFrequency, "5GHz");
  assert.equal(d.hosts.length, 1);
  assert.equal(d.hosts[0].hostname, "Laptop");
});

test("mapGenieAcsToCpe: offline bila inform lama", () => {
  const d = mapGenieAcsToCpe({ ...tr181, _lastInform: (NOW - 7200) * 1000 }, NOW);
  assert.equal(d.isOnline, false);
});

test("mapGenieAcsToCpe: payload minim/hilang tidak crash", () => {
  for (const raw of [{}, { _id: "A-B-C" }, null, undefined, "x", 5, [], { _id: "%E0%A4%A", InternetGatewayDevice: null }]) {
    const d = mapGenieAcsToCpe(raw, NOW);
    assert.equal(typeof d.deviceId, "string");
    assert.deepEqual(d.hosts, []);
    assert.equal(d.uptimeSeconds, 0);
    assert.equal(d.isOnline, false);
    assert.equal(d.wifi.ssid, "");
  }
  const d = mapGenieAcsToCpe({ _id: "00259E-F609-SN1" }, NOW);
  assert.equal(d.oui, "00259E");
  assert.equal(d.productClass, "F609");
  assert.equal(d.serialNumber, "SN1");
});

function mockFetch(status, body) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  };
  fn.calls = calls;
  return fn;
}

test("real: testConnection sukses, kirim auth & URL benar", async () => {
  const f = mockFetch(200, [{ _id: "a" }, { _id: "b" }]);
  const r = await new GenieAcsClient(real, f).testConnection();
  assert.equal(r.ok, true);
  assert.equal(r.deviceCount, 2);
  assert.equal(f.calls[0].url, "http://acs.local:7557/devices/?query=%7B%7D&projection=_id");
  assert.equal(f.calls[0].init.headers.Authorization, "Basic eDp5");
});

test("real: 401 Unauthorized", async () => {
  const c = new GenieAcsClient(real, mockFetch(401, "no"));
  const r = await c.testConnection();
  assert.equal(r.ok, false);
  assert.match(r.error, /401/);
  await assert.rejects(c.listDevices(), (e) => e.status === 401);
  await assert.rejects(c.getDevice("x"), (e) => e.status === 401);
});

test("real: 404 Not Found", async () => {
  const c = new GenieAcsClient(real, mockFetch(404, "no"));
  const r = await c.testConnection();
  assert.equal(r.ok, false);
  assert.match(r.error, /404/);
  assert.equal(await c.getDevice("x"), null);
  await assert.rejects(c.listDevices(), (e) => e.status === 404);
});

test("real: getDevice kosong -> null, ada -> terparse; listDevices parse semua", async () => {
  assert.equal(await new GenieAcsClient(real, mockFetch(200, [])).getDevice("x"), null);
  const f = mockFetch(200, [tr098]);
  const d = await new GenieAcsClient(real, f).getDevice("00259E-F609-ZTEG1234ABCD");
  assert.equal(d.serialNumber, "ZTEG1234ABCD");
  assert.equal(f.calls[0].url, `http://acs.local:7557/devices/?query=${encodeURIComponent('{"_id":"00259E-F609-ZTEG1234ABCD"}')}`);
  const list = await new GenieAcsClient(real, mockFetch(200, [tr098, tr181])).listDevices();
  assert.equal(list.length, 2);
});

test("real: error jaringan dan JSON rusak dilaporkan, tidak crash", async () => {
  const boom = async () => {
    throw new Error("ECONNREFUSED");
  };
  const r = await new GenieAcsClient(real, boom).testConnection();
  assert.equal(r.ok, false);
  assert.match(r.error, /ECONNREFUSED/);
  const bad = await new GenieAcsClient(real, mockFetch(200, "<html>")).testConnection();
  assert.equal(bad.ok, false);
});
