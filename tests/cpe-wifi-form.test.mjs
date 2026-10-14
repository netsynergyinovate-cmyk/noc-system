import test from "node:test";
import assert from "node:assert/strict";
import { changeWifiSchema } from "../src/validators/cpe.ts";

const base = { customerId: "c-1", ssid: "WIFI_Budi", password: "rahasia123" };

test("valid dengan SSID dan password standar", () => {
  assert.equal(changeWifiSchema.safeParse(base).success, true);
});

test("nilai bawaan security dan enabled", () => {
  const r = changeWifiSchema.parse(base);
  assert.equal(r.security, "WPA2-PSK");
  assert.equal(r.enabled, true);
});

test("tolak SSID kosong dan lebih dari 32 karakter", () => {
  assert.equal(changeWifiSchema.safeParse({ ...base, ssid: "" }).success, false);
  assert.equal(changeWifiSchema.safeParse({ ...base, ssid: "   " }).success, false);
  assert.equal(changeWifiSchema.safeParse({ ...base, ssid: "a".repeat(33) }).success, false);
  assert.equal(changeWifiSchema.safeParse({ ...base, ssid: "a".repeat(32) }).success, true);
});

test("tolak password kurang dari 8 dan lebih dari 64 karakter", () => {
  assert.equal(changeWifiSchema.safeParse({ ...base, password: "1234567" }).success, false);
  assert.equal(changeWifiSchema.safeParse({ ...base, password: "a".repeat(65) }).success, false);
  assert.equal(changeWifiSchema.safeParse({ ...base, password: "a".repeat(8) }).success, true);
  assert.equal(changeWifiSchema.safeParse({ ...base, password: "a".repeat(64) }).success, true);
});

test("tolak kolom tak dikenal (strict)", () => {
  assert.equal(changeWifiSchema.safeParse({ ...base, extra: 1 }).success, false);
});
