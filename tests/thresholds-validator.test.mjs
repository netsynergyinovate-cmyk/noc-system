import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { updateThresholdsSchema: s } =
  await import("../src/validators/thresholds.ts");

test("menerima input valid dan objek kosong", () => {
  assert.ok(s.safeParse({}).success);
  assert.ok(
    s.safeParse({
      queue: { threshold: 50, forSeconds: 10 },
      cpu: { threshold: 99, forSeconds: 60 },
      port: { threshold: 1000, forSeconds: 30 },
      optical: { threshold: -40, forSeconds: 0 },
      offline: { forSeconds: 120 },
    }).success,
  );
  assert.ok(
    s.safeParse({ offline: { threshold: null, forSeconds: 60 } }).success,
  );
});

test("menolak angka di luar range", () => {
  for (const bad of [
    { queue: { threshold: 49, forSeconds: 10 } },
    { cpu: { threshold: 100, forSeconds: 30 } },
    { port: { threshold: 0, forSeconds: 30 } },
    { port: { threshold: 1001, forSeconds: 30 } },
    { optical: { threshold: -14.5, forSeconds: 0 } },
    { optical: { threshold: -41, forSeconds: 0 } },
    { cpu: { forSeconds: 30 } },
  ])
    assert.equal(s.safeParse(bad).success, false, JSON.stringify(bad));
});

test("menolak tipe salah, forSeconds tak bulat/negatif, kunci asing", () => {
  for (const bad of [
    { cpu: { threshold: "80", forSeconds: 30 } },
    { cpu: { threshold: 80, forSeconds: 30.5 } },
    { cpu: { threshold: 80, forSeconds: -1 } },
    { cpu: { threshold: 80 } },
    { cpu: 80 },
    { bogus: { threshold: 80, forSeconds: 30 } },
    null,
    "x",
  ])
    assert.equal(s.safeParse(bad).success, false, JSON.stringify(bad));
});

test("offline wajib tanpa ambang angka", () => {
  assert.equal(
    s.safeParse({ offline: { threshold: 5, forSeconds: 60 } }).success,
    false,
  );
});
