import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { testDeviceConnectionSchema: s } =
  await import("../src/validators/devices.ts");

const ok = { type: "mikrotik", host: "10.0.0.1" };

test("menerima input minimal; mode default real", () => {
  const r = s.safeParse(ok);
  assert.ok(r.success);
  assert.equal(r.data.mode, "real");
});

test("memangkas host dan menerima semua field opsional", () => {
  const r = s.safeParse({
    ...ok,
    host: " r.local ",
    mode: "simulator",
    port: 443,
    username: "u",
    password: "p",
    brand: "hsgq",
    driver: "hsgq",
  });
  assert.ok(r.success);
  assert.equal(r.data.host, "r.local");
});

test("menolak type/mode/host/port tidak valid", () => {
  for (const bad of [
    { ...ok, type: "x" },
    { ...ok, mode: "x" },
    { ...ok, host: "   " },
    { ...ok, host: "a".repeat(256) },
    { ...ok, port: 0 },
    { ...ok, port: 65536 },
    { ...ok, port: 1.5 },
    { ...ok, port: "80" },
    { ...ok, password: "a".repeat(101) },
    { host: "h" },
  ]) {
    assert.equal(s.safeParse(bad).success, false, JSON.stringify(bad));
  }
});

test("menolak field tak dikenal (strict)", () => {
  assert.equal(s.safeParse({ ...ok, extra: 1 }).success, false);
});
