import test from "node:test";
import assert from "node:assert/strict";
import {
  MOCK_DEVICE_CONFIGS,
  getDeviceTypeLabel,
  mockRunDeviceTest,
} from "../src/lib/dashboard/device-config.ts";

test("device-config: memuat 4 konfigurasi perangkat tiruan", () => {
  assert.equal(MOCK_DEVICE_CONFIGS.length, 4);
  const types = MOCK_DEVICE_CONFIGS.map((d) => d.type);
  assert.ok(types.includes("mikrotik"));
  assert.ok(types.includes("olt"));
  assert.ok(types.includes("genieacs"));
  assert.ok(types.includes("billing"));
});

test("device-config: label jenis perangkat tepat", () => {
  assert.equal(getDeviceTypeLabel("mikrotik"), "Router MikroTik (REST)");
  assert.equal(getDeviceTypeLabel("olt"), "OLT HSGQ");
  assert.equal(getDeviceTypeLabel("genieacs"), "GenieACS NBI (CPE)");
  assert.equal(getDeviceTypeLabel("billing"), "Sistem Billing");
});

test("device-config: mockRunDeviceTest sukses untuk host normal", () => {
  const dev = MOCK_DEVICE_CONFIGS[0];
  const res = mockRunDeviceTest(dev);
  assert.equal(res.ok, true);
  assert.ok(res.latencyMs > 0);
  assert.ok(res.message.includes("Sukses"));
});

test("device-config: mockRunDeviceTest menangani host berakhiran .0 sebagai timeout", () => {
  const dev = { ...MOCK_DEVICE_CONFIGS[0], host: "10.10.0.0" };
  const res = mockRunDeviceTest(dev);
  assert.equal(res.ok, false);
  assert.equal(res.latencyMs, 8000);
  assert.equal(res.status, "timeout");
  assert.ok(res.message.includes("Timeout 8000ms"));
});

test("device-config: mockRunDeviceTest menangani host berakhiran .255 sebagai 401 unauthorized", () => {
  const dev = { ...MOCK_DEVICE_CONFIGS[0], host: "10.10.0.255" };
  const res = mockRunDeviceTest(dev);
  assert.equal(res.ok, false);
  assert.ok(res.message.includes("Autentikasi gagal 401"));
});
