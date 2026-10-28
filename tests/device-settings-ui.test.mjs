import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MOCK_DEVICE_CONFIGS,
  isValidHost,
  isValidPort,
  sanitizeText,
  validateDeviceInput,
  runDeviceTest,
  statusLabel,
  applyTestOutcome,
} from "../src/lib/dashboard/device-config.ts";

const dev = MOCK_DEVICE_CONFIGS[0];
const jsonRes = (status, body) => async () =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("data tiruan: 4 perangkat default lengkap", () => {
  assert.deepEqual(
    MOCK_DEVICE_CONFIGS.map((d) => d.type).sort(),
    ["billing", "genieacs", "mikrotik", "olt"],
  );
  for (const d of MOCK_DEVICE_CONFIGS) {
    assert.ok(isValidHost(d.host) && isValidPort(d.port), d.id);
  }
});

test("validasi host", () => {
  for (const h of ["10.10.0.1", "router.local", "a-b.example.com"]) assert.ok(isValidHost(h), h);
  for (const h of ["", " ", "999.1.1.1", "1.2.3", "a b", "-bad.com", "x".repeat(300), "http://x"])
    assert.ok(!isValidHost(h), h);
});

test("validasi port 1-65535", () => {
  for (const p of [1, 80, 65535]) assert.ok(isValidPort(p));
  for (const p of [0, -1, 65536, 1.5, NaN, "80", null]) assert.ok(!isValidPort(p), String(p));
});

test("sanitasi input: karakter kontrol dibuang, spasi dipangkas", () => {
  assert.equal(sanitizeText("  abc\u0000\n\t "), "abc");
  const v = validateDeviceInput({ name: " MT\u0007 ", host: " 10.0.0.1 ", port: 443, username: " noc " });
  assert.ok(v.ok);
  assert.deepEqual(v.clean, { name: "MT", host: "10.0.0.1", port: 443, username: "noc" });
  const bad = validateDeviceInput({ name: "", host: "x y", port: 70000, username: "" });
  assert.ok(!bad.ok);
  assert.deepEqual(Object.keys(bad.errors).sort(), ["host", "name", "port", "username"]);
});

test("uji koneksi: sukses dari API", async () => {
  const r = await runDeviceTest(dev, jsonRes(200, { success: true, data: { ok: true, message: "ok", latencyMs: 15 } }));
  assert.deepEqual(r, { ok: true, message: "ok", latencyMs: 15 });
});

test("uji koneksi: API 404 jatuh ke simulasi lokal (latency > 0)", async () => {
  const r = await runDeviceTest(dev, jsonRes(404, {}));
  assert.equal(r.ok, true);
  assert.ok(r.latencyMs > 0);
  assert.match(r.message, /simulasi lokal/);
});

test("uji koneksi: mode real tidak disimulasikan", async () => {
  const r = await runDeviceTest({ ...dev, mode: "real" }, jsonRes(500, {}));
  assert.equal(r.ok, false);
  assert.equal(r.latencyMs, null);
});

test("uji koneksi: host .0 simulasi timeout, 401/403 pesan jelas", async () => {
  const t = await runDeviceTest({ ...dev, host: "10.10.0.0" }, jsonRes(404, {}));
  assert.equal(t.ok, false);
  assert.equal(t.latencyMs, 8000);
  assert.equal(t.status, "timeout");
  const a = await runDeviceTest(dev, jsonRes(403, {}));
  assert.equal(a.ok, false);
  assert.match(a.message, /router:manage/);
});

test("uji koneksi: timeout dan error jaringan", async () => {
  const timeout = async () => {
    throw Object.assign(new Error("t"), { name: "TimeoutError" });
  };
  const r1 = await runDeviceTest(dev, timeout);
  assert.equal(r1.ok, false);
  assert.match(r1.message, /Batas waktu/);
  const r2 = await runDeviceTest(dev, async () => {
    throw new TypeError("fetch failed");
  });
  assert.equal(r2.ok, true); // simulator fallback
  assert.match(r2.message, /tidak dapat dihubungi/);
});

test("status label & applyTestOutcome", () => {
  assert.equal(statusLabel("connected"), "Terhubung");
  assert.equal(statusLabel("error"), "Gagal");
  assert.equal(statusLabel("untested"), "Belum Diuji");
  const d = applyTestOutcome(dev, { ok: false, message: "x", latencyMs: null }, 5);
  assert.equal(d.status, "error");
  assert.equal(d.lastTestedAt, 5);
});

test("settings-board: tab Perangkat, kartu cepat, link ke halaman lanjutan", () => {
  const board = readFileSync("src/components/dashboard/settings-board.tsx", "utf8");
  assert.match(board, /<TabsTrigger value="devices"[\s\S]*?<span>Perangkat<\/span>/);
  assert.match(board, /<TabsContent value="devices"[\s\S]*?<DeviceQuickCards/);
  const cards = readFileSync("src/components/dashboard/device-quick-cards.tsx", "utf8");
  assert.match(cards, /href="\/app\/router"/);
  assert.match(cards, /<DeviceTestButton/);
  const button = readFileSync("src/components/dashboard/device-test-button.tsx", "utf8");
  assert.match(button, /Uji Koneksi/);
  assert.match(button, /Menguji\.\.\./);
});
