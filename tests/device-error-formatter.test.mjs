import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatDeviceError } from "../src/lib/dashboard/device-config.ts";

const dev = { host: "10.10.0.1", port: 443, username: "noc-monitor", type: "mikrotik", envPassKey: "MIKROTIK_REST_PASSWORD" };
const fail = (extra) => ({ ok: false, message: "x", latencyMs: null, ...extra });

test("formatter: TIMEOUT", () => {
  const e = formatDeviceError(fail({ code: "TIMEOUT" }), dev);
  assert.equal(e.title, "Batas Waktu Terlampaui (Timeout)");
  assert.equal(e.detail, "Host 10.10.0.1:443 tidak merespons dalam 8 detik.");
  assert.match(e.suggestion, /rute jaringan/);
});

test("formatter: AUTH_FAILED", () => {
  const e = formatDeviceError(fail({ code: "AUTH_FAILED" }), dev);
  assert.equal(e.title, "Autentikasi Gagal (HTTP 401)");
  assert.ok(e.detail.includes('"noc-monitor"'));
  assert.ok(e.suggestion.includes("MIKROTIK_REST_PASSWORD"));
});

test("formatter: CONNECTION_REFUSED", () => {
  const e = formatDeviceError(fail({ code: "CONNECTION_REFUSED" }), { ...dev, port: 9999 });
  assert.equal(e.title, "Koneksi Ditolak (Connection Refused)");
  assert.ok(e.detail.includes("Port 9999"));
  assert.ok(e.suggestion.includes("port 9999"));
});

test("formatter: INVALID_PORT", () => {
  const e = formatDeviceError(fail({ code: "INVALID_PORT" }), { ...dev, port: 70000 });
  assert.equal(e.title, "Port Tidak Valid");
  assert.ok(e.detail.includes("70000"));
  assert.match(e.suggestion, /port standar yang valid/);
});

test("formatter: HTTP_ERROR dengan status code", () => {
  const e = formatDeviceError(fail({ code: "HTTP_ERROR", statusCode: 500, message: "Internal" }), dev);
  assert.equal(e.title, "Galat HTTP 500");
  assert.equal(e.detail, "Internal");
  assert.match(e.suggestion, /sertifikat TLS/);
});

test("formatter: default tanpa kode & pesan", () => {
  const e = formatDeviceError(fail({ message: "" }), dev);
  assert.equal(e.title, "Koneksi Gagal");
  assert.equal(e.detail, "Perangkat mengembalikan respons galat.");
});

const src = readFileSync("src/components/dashboard/device-outcome-alert.tsx", "utf8");

test("komponen: role status saat sukses, alert saat gagal", () => {
  assert.match(src, /role="status"/);
  assert.match(src, /role="alert"/);
  assert.match(src, /Koneksi berhasil/);
  assert.match(src, /data-testid="device-outcome-alert"/);
  assert.match(src, /data-code=\{outcome\.code \|\| "UNKNOWN"\}/);
});

test("komponen: judul, detail, dan saran dirender", () => {
  assert.match(src, /\{err\.title\}/);
  assert.match(src, /\{err\.detail\}/);
  assert.match(src, /Saran: \{err\.suggestion\}/);
});

test("komponen: timeout warning vs error destructive", () => {
  assert.match(src, /timeout \? Clock : AlertCircle/);
  assert.match(src, /border-warning\/30 bg-warning\/10 text-warning/);
  assert.match(src, /border-destructive\/20 bg-destructive\/10 text-destructive/);
});

test("integrasi: alert dipakai di tiga komponen", () => {
  for (const f of ["device-quick-cards", "device-config-board", "device-test-button"]) {
    assert.match(readFileSync(`src/components/dashboard/${f}.tsx`, "utf8"), /<DeviceOutcomeAlert/, f);
  }
});
