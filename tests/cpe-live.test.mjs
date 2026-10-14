import test from "node:test";
import assert from "node:assert/strict";
import { mapGenieAcsToCpe, readPppoeUsername } from "../src/lib/genieacs/client.ts";
import { CpeLoadError, fetchCpeByPppoe, fetchLiveCpe, rebootCpeLive } from "../src/lib/dashboard/cpe-live.ts";

const NOW = 1_760_000_000;
const v = (x) => ({ _value: x });

const tr098 = {
  _id: "00259E-UJIHG8245-UJI%2DNOC%2D0001",
  _lastInform: new Date((NOW - 30) * 1000).toISOString(),
  InternetGatewayDevice: {
    DeviceInfo: { Manufacturer: v("Huawei"), ModelName: v("HG8245H-UJI"), SerialNumber: v("UJI-NOC-0001") },
    WANDevice: {
      1: { WANConnectionDevice: { 1: { WANPPPConnection: { 1: { Username: v("17060001103@runsnet.id"), ExternalIPAddress: v("10.88.0.5") } } } } },
    },
  },
};

const tr181 = {
  _id: "X-Y-Z",
  _lastInform: new Date((NOW - 30) * 1000).toISOString(),
  Device: { PPP: { Interface: { 1: { Username: v("pelanggan@isp") } } } },
};

test("readPppoeUsername membaca TR-098 WANPPPConnection", () => {
  assert.equal(readPppoeUsername(tr098), "17060001103@runsnet.id");
});

test("readPppoeUsername membaca TR-181 PPP.Interface", () => {
  assert.equal(readPppoeUsername(tr181), "pelanggan@isp");
});

test("readPppoeUsername kosong bila tidak ada", () => {
  assert.equal(readPppoeUsername({ _id: "a" }), "");
  assert.equal(readPppoeUsername({ InternetGatewayDevice: { WANDevice: {} } }), "");
});

test("mapGenieAcsToCpe mengisi pppoeUsername", () => {
  const d = mapGenieAcsToCpe(tr098, NOW);
  assert.equal(d.pppoeUsername, "17060001103@runsnet.id");
  assert.equal(d.isOnline, true);
});

function mockFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
  return calls;
}
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("fetchLiveCpe mengambil satu halaman bila datanya sedikit", async () => {
  const calls = mockFetch(() => json(200, { data: [{ deviceId: "a", pppoeUsername: "x" }], total: 1 }));
  const r = await fetchLiveCpe();
  assert.equal(r.devices.length, 1);
  assert.equal(r.truncated, false);
  assert.equal(calls.length, 1);
});

test("fetchLiveCpe mengikuti halaman berikutnya", async () => {
  const mk = (n, from) => Array.from({ length: n }, (_, i) => ({ deviceId: `d${from + i}`, pppoeUsername: "" }));
  const calls = mockFetch((url) => (url.includes("page=1") ? json(200, { data: mk(100, 0), total: 130 }) : json(200, { data: mk(30, 100), total: 130 })));
  const r = await fetchLiveCpe();
  assert.equal(r.devices.length, 130);
  assert.equal(calls.length, 2);
});

test("fetchLiveCpe: server 502 menjadi CpeLoadError tentang GenieACS", async () => {
  mockFetch(() => json(502, {}));
  await assert.rejects(fetchLiveCpe(), (e) => e instanceof CpeLoadError && /GenieACS/.test(e.message));
});

test("fetchLiveCpe: jaringan putus menjadi CpeLoadError", async () => {
  mockFetch(() => {
    throw new TypeError("fetch failed");
  });
  await assert.rejects(fetchLiveCpe(), CpeLoadError);
});

test("fetchCpeByPppoe hanya cocok persis, tanpa beda huruf", async () => {
  mockFetch(() =>
    json(200, { data: [{ deviceId: "a", pppoeUsername: "budi@isp.2" }, { deviceId: "b", pppoeUsername: "Budi@ISP" }], total: 2 }),
  );
  const d = await fetchCpeByPppoe("  budi@isp ");
  assert.equal(d?.deviceId, "b");
});

test("fetchCpeByPppoe tanpa username tidak memanggil server", async () => {
  const calls = mockFetch(() => json(200, { data: [], total: 0 }));
  assert.equal(await fetchCpeByPppoe("  "), null);
  assert.equal(calls.length, 0);
});

test("rebootCpeLive: 403 dan 404 punya pesan sendiri", async () => {
  mockFetch(() => json(403, {}));
  const a = await rebootCpeLive("c1");
  assert.equal(a.ok, false);
  assert.match(a.message, /izin/);
  mockFetch(() => json(404, {}));
  const b = await rebootCpeLive("c1");
  assert.equal(b.ok, false);
  assert.match(b.message, /tidak ditemukan/);
});

test("rebootCpeLive: 201 dengan status gagal tidak dianggap sukses", async () => {
  mockFetch(() => json(201, { data: { status: "failed", payload: { errorReason: "modem offline" } } }));
  const r = await rebootCpeLive("c1");
  assert.equal(r.ok, false);
});

test("rebootCpeLive: 201 sukses", async () => {
  const calls = mockFetch(() => json(201, { data: { status: "success", payload: {} } }));
  const r = await rebootCpeLive("c1");
  assert.equal(r.ok, true);
  assert.equal(JSON.parse(calls[0].init.body).action, "reboot_device");
});
