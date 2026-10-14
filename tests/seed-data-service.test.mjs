import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";

const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:5432/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3101";
process.env.DEVICE_SECRET_KEY ??= "k".repeat(64);

register();

const {
  computePayloadChecksum,
  seedAlertThresholdsIdempotent,
  seedDefaultRecipientsIdempotent,
  seedDefaultRouterIdempotent,
  runAllInitialSeeds,
} = await import("../src/services/seed-data.service.ts");

test("computePayloadChecksum menghasilkan hash sha256 konsisten", () => {
  const hash1 = computePayloadChecksum({ a: 1, b: "hello" });
  const hash2 = computePayloadChecksum({ a: 1, b: "hello" });
  assert.ok(hash1.startsWith("sha256-"));
  assert.equal(hash1, hash2);

  const hashDiff = computePayloadChecksum({ a: 2, b: "hello" });
  assert.notEqual(hash1, hashDiff);
});

test("fungsi-fungsi service seed terdefinisi dan dapat dipanggil", () => {
  assert.equal(typeof seedAlertThresholdsIdempotent, "function");
  assert.equal(typeof seedDefaultRecipientsIdempotent, "function");
  assert.equal(typeof seedDefaultRouterIdempotent, "function");
  assert.equal(typeof runAllInitialSeeds, "function");
});
