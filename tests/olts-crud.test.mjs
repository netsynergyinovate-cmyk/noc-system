import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { oltIdSchema, updateOltSchema } =
  await import("../src/validators/devices.ts");

test("ID OLT harus uuid", () => {
  assert.ok(
    oltIdSchema.safeParse("550e8400-e29b-41d4-a716-446655440000").success,
  );
  for (const bad of ["", "1", "abc", "../etc", "550e8400-e29b-41d4-a716"])
    assert.ok(!oltIdSchema.safeParse(bad).success, bad);
});

test("update OLT menerima field sebagian", () => {
  assert.ok(updateOltSchema.safeParse({ name: "OLT-2" }).success);
  assert.ok(
    updateOltSchema.safeParse({ host: "10.0.0.1", password: "x" }).success,
  );
});

test("update OLT menolak kosong, field asing, dan nilai tidak valid", () => {
  assert.ok(!updateOltSchema.safeParse({}).success);
  assert.ok(!updateOltSchema.safeParse({ id: "x" }).success);
  assert.ok(!updateOltSchema.safeParse({ name: "" }).success);
  assert.ok(!updateOltSchema.safeParse({ password: "" }).success);
});
