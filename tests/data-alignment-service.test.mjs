import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";

const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:1/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3101";

register();

const { ALIGNMENT_ADVISORY_LOCK_KEY, runDataAlignmentIdempotent } =
  await import("../src/services/data-alignment.service.ts");

test("ALIGNMENT_ADVISORY_LOCK_KEY didefinisikan secara unik", () => {
  assert.equal(ALIGNMENT_ADVISORY_LOCK_KEY, 727274003);
});

test("runDataAlignmentIdempotent menangani database offline secara aman", async () => {
  const res = await runDataAlignmentIdempotent({
    actor: "test_suite",
    steps: ["billing_status", "thresholds"],
    pool: {
      connect: async () => {
        throw new Error("Connection refused (database offline)");
      },
    },
  });
  assert.equal(res.success, false);
  assert.equal(res.totalSteps, 2);
  assert.equal(res.totalRecordsProcessed, 0);
  assert.ok(res.errorMessage);
  assert.equal(res.steps.length, 2);
  assert.equal(res.steps[0].status, "skipped");
  assert.ok(res.executedAt);
});
