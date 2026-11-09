import test from "node:test";
import assert from "node:assert/strict";
import { GenieAcsClient } from "../src/lib/genieacs/client.ts";

const sim = {
  url: "http://sim.local:7557",
  timeoutMs: 1000,
  mode: "simulator",
};
const real = {
  url: "http://acs.local:7557",
  timeoutMs: 1000,
  mode: "real",
  authHeader: "Basic eDp5",
};
const SSID_PATH = "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID";
const PSK_PATH =
  "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.PreSharedKey";

function mockFetch(status, body = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fn, calls };
}

test("simulator: setWifiConfig ok dengan taskId", async () => {
  const r = await new GenieAcsClient(sim).setWifiConfig("dev-1", {
    ssid: "A",
    password: "rahasia123",
  });
  assert.equal(r.ok, true);
  assert.match(r.taskId, /^sim-task-\d+$/);
});

test("real: POST ke /devices/<id>/tasks?connection_request dengan parameterValues dan Authorization", async () => {
  const { fn, calls } = mockFetch(200, { _id: "task-42" });
  const r = await new GenieAcsClient(real, fn).setWifiConfig(
    "00259E-F609-ZTE/1",
    {
      ssid: "WIFI_baru",
      password: "rahasia123",
    },
  );
  assert.deepEqual([r.ok, r.taskId], [true, "task-42"]);
  assert.equal(calls.length, 1);
  const { url, init } = calls[0];
  assert.equal(
    url,
    `http://acs.local:7557/devices/${encodeURIComponent("00259E-F609-ZTE/1")}/tasks?connection_request`,
  );
  assert.equal(init.method, "POST");
  assert.equal(init.headers.Authorization, "Basic eDp5");
  assert.equal(init.headers["Content-Type"], "application/json");
  const body = JSON.parse(init.body);
  assert.equal(body.name, "setParameterValues");
  assert.deepEqual(body.parameterValues, [
    [SSID_PATH, "WIFI_baru", "xsd:string"],
    [PSK_PATH, "rahasia123", "xsd:string"],
  ]);
});

test("real: tanpa password hanya SSID; connectionRequest=false tanpa query", async () => {
  const { fn, calls } = mockFetch(202);
  const c = new GenieAcsClient(real, fn);
  await c.setWifiConfig("d", { ssid: "X" });
  assert.deepEqual(JSON.parse(calls[0].init.body).parameterValues, [
    [SSID_PATH, "X", "xsd:string"],
  ]);
  await c.postTask("d", { name: "reboot" }, false);
  assert.equal(calls[1].url, "http://acs.local:7557/devices/d/tasks");
});

for (const [status, word] of [
  [404, /tidak ditemukan/],
  [409, /Konflik/],
  [504, /offline/],
]) {
  test(`real: HTTP ${status} menjadi ok=false tanpa membocorkan password`, async () => {
    const { fn } = mockFetch(status, { message: "echo rahasia123" });
    const r = await new GenieAcsClient(real, fn).setWifiConfig("d", {
      ssid: "X",
      password: "rahasia123",
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, status);
    assert.match(r.error, word);
    assert.ok(!JSON.stringify(r).includes("rahasia123"));
  });
}

test("real: kegagalan jaringan menjadi ok=false", async () => {
  const fn = async () => {
    throw new Error("ECONNREFUSED rahasia123");
  };
  const r = await new GenieAcsClient(real, fn).setWifiConfig("d", {
    ssid: "X",
    password: "rahasia123",
  });
  assert.equal(r.ok, false);
  assert.ok(!r.error.includes("rahasia123"));
});

test("findDeviceIdByPppoe: real mengembalikan _id pertama, kosong menjadi null", async () => {
  const hit = mockFetch(200, [{ _id: "dev-9" }]);
  assert.equal(
    await new GenieAcsClient(real, hit.fn).findDeviceIdByPppoe("budi01"),
    "dev-9",
  );
  const miss = mockFetch(200, []);
  assert.equal(
    await new GenieAcsClient(real, miss.fn).findDeviceIdByPppoe("nobody"),
    null,
  );
});
