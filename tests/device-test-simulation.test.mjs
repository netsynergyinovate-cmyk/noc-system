import test from "node:test";
import assert from "node:assert/strict";
import {
  MOCK_DEVICE_CONFIGS,
  mockRunDeviceTest,
  runDeviceTest,
  statusLabel,
  applyTestOutcome,
} from "../src/lib/dashboard/device-config.ts";

const byType = (t) => MOCK_DEVICE_CONFIGS.find((d) => d.type === t);
const noFetch = async () => {
  throw new Error("fetch tidak boleh dipanggil");
};

test("simulasi deterministik per tipe perangkat", () => {
  const expected = {
    mikrotik: /\/rest\/system\/resource/,
    olt: /10\.10\.1\.1/,
    genieacs: /\/devices/,
    billing: /CSRF/,
  };
  for (const [type, endpoint] of Object.entries(expected)) {
    const d = byType(type);
    const a = mockRunDeviceTest(d, 100);
    const b = mockRunDeviceTest(d, 100);
    assert.deepEqual(a, b, type);
    assert.equal(a.ok, true);
    assert.equal(a.status, "connected");
    assert.equal(a.code, "OK");
    assert.equal(a.statusCode, 200);
    assert.equal(a.timestamp, 100);
    assert.match(a.endpointTested, endpoint, type);
  }
});

test("olt via port 23 diuji lewat Telnet", () => {
  const r = mockRunDeviceTest({ ...byType("olt"), port: 23 }, 1);
  assert.match(r.endpointTested, /^TELNET /);
});

test("timeout: host akhiran .0", () => {
  const d = { ...byType("mikrotik"), host: "10.10.0.0" };
  const r = mockRunDeviceTest(d);
  assert.equal(r.ok, false);
  assert.equal(r.status, "timeout");
  assert.equal(r.code, "TIMEOUT");
  assert.equal(r.latencyMs, 8000);
  assert.equal(r.message, "Timeout 8000ms: host 10.10.0.0 tidak merespons. Periksa rute jaringan.");
});

test("auth gagal: host .255 dan username bad-user", () => {
  const a = mockRunDeviceTest({ ...byType("olt"), host: "10.10.1.255" });
  const b = mockRunDeviceTest({ ...byType("olt"), username: "bad-user" });
  for (const r of [a, b]) {
    assert.equal(r.ok, false);
    assert.equal(r.status, "error");
    assert.equal(r.statusCode, 401);
    assert.equal(r.code, "AUTH_FAILED");
  }
  assert.equal(b.message, "Autentikasi gagal 401: periksa username/password untuk bad-user.");
});

test("connection refused: port 9999 dan port 0", () => {
  for (const port of [9999, 0]) {
    const r = mockRunDeviceTest({ ...byType("genieacs"), port });
    assert.equal(r.ok, false);
    assert.equal(r.status, "error");
    assert.equal(r.code, "CONNECTION_REFUSED");
    assert.equal(r.message, `Koneksi ditolak (Connection Refused) pada port ${port}.`);
  }
});

test("port tak valid lain: INVALID_PORT", () => {
  const r = mockRunDeviceTest({ ...byType("genieacs"), port: 70000 });
  assert.equal(r.code, "INVALID_PORT");
  assert.equal(r.ok, false);
});

test("forceLocal tidak memanggil fetch, bahkan pada mode real", async () => {
  for (const mode of ["simulator", "real"]) {
    const r = await runDeviceTest({ ...byType("mikrotik"), mode }, { forceLocal: true, fetchImpl: noFetch });
    assert.equal(r.ok, true);
    assert.equal(r.code, "OK");
    assert.match(r.message, /simulasi lokal/);
  }
  const t = await runDeviceTest({ ...byType("mikrotik"), host: "10.10.0.0" }, { forceLocal: true, fetchImpl: noFetch });
  assert.equal(t.status, "timeout");
});

test("tanpa forceLocal fetch tetap dipanggil", async () => {
  let called = 0;
  await runDeviceTest(byType("mikrotik"), {
    fetchImpl: async () => {
      called++;
      return new Response("{}", { status: 404 });
    },
  });
  assert.equal(called, 1);
});

test("label & pemetaan outcome timeout", () => {
  assert.equal(statusLabel("timeout"), "Timeout");
  const d = byType("mikrotik");
  const r = mockRunDeviceTest({ ...d, host: "10.10.0.0" });
  const next = applyTestOutcome(d, r, 7);
  assert.equal(next.status, "timeout");
  assert.equal(next.latencyMs, 8000);
  assert.equal(next.lastTestedAt, 7);
  assert.match(next.errorMessage, /Timeout 8000ms/);
  assert.equal(applyTestOutcome(d, { ok: false, message: "x", latencyMs: null }, 1).status, "error");
  assert.equal(applyTestOutcome(d, { ok: true, message: "x", latencyMs: 1 }, 1).status, "connected");
});
