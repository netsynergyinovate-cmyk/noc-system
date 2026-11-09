import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { createOltSchema: s } = await import("../src/validators/devices.ts");

const ok = {
  name: "OLT Pusat",
  host: "10.0.0.5",
  brand: "hsgq",
  driver: "hsgq",
  username: "admin",
  password: "rahasia",
};

test("menerima input valid dan memangkas spasi", () => {
  assert.ok(s.safeParse(ok).success);
  const r = s.safeParse({ ...ok, name: "  OLT  ", host: " olt.local " });
  assert.equal(r.data.name, "OLT");
  assert.equal(r.data.host, "olt.local");
});

test("menolak field wajib kosong atau hilang", () => {
  for (const k of Object.keys(ok)) {
    assert.equal(s.safeParse({ ...ok, [k]: "" }).success, false, `${k} kosong`);
    const { [k]: _, ...rest } = ok;
    assert.equal(s.safeParse(rest).success, false, `${k} hilang`);
  }
  assert.equal(s.safeParse({ ...ok, name: "   " }).success, false);
});

test("menolak melebihi batas panjang", () => {
  assert.equal(s.safeParse({ ...ok, name: "a".repeat(101) }).success, false);
  assert.ok(s.safeParse({ ...ok, name: "a".repeat(100) }).success);
  assert.equal(s.safeParse({ ...ok, host: "a".repeat(256) }).success, false);
  assert.ok(s.safeParse({ ...ok, host: "a".repeat(255) }).success);
  assert.equal(s.safeParse({ ...ok, brand: "a".repeat(51) }).success, false);
  assert.equal(s.safeParse({ ...ok, driver: "a".repeat(51) }).success, false);
  assert.equal(
    s.safeParse({ ...ok, username: "a".repeat(101) }).success,
    false,
  );
  assert.equal(
    s.safeParse({ ...ok, password: "a".repeat(101) }).success,
    false,
  );
});

test("menolak tipe salah dan kunci asing", () => {
  assert.equal(s.safeParse({ ...ok, host: 123 }).success, false);
  assert.equal(s.safeParse({ ...ok, status: "aktif" }).success, false);
  assert.equal(s.safeParse(null).success, false);
});
