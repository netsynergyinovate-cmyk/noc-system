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

const {
  deriveTransferRemediationHint,
  TransferExecutionError,
  runDataTransferTransactionally,
} = await import("../src/services/data-transfer.service.ts");

test("deriveTransferRemediationHint mengkategorikan galat koneksi dan memberikan panduan", () => {
  const res = deriveTransferRemediationHint("ECONNREFUSED 10.0.0.1:5432");
  assert.equal(res.category, "connection");
  assert.match(res.remediation, /TARGET_DATABASE_URL/);
});

test("deriveTransferRemediationHint mendeteksi konflik constraint dan foreign key", () => {
  const res = deriveTransferRemediationHint(
    "violates foreign key constraint 'customers_router_id_fkey'",
  );
  assert.equal(res.category, "constraint_violation");
  assert.match(res.remediation, /upsert/);
});

test("deriveTransferRemediationHint mendeteksi perebutan advisory lock", () => {
  const res = deriveTransferRemediationHint(
    "Advisory lock 727274002 sedang digunakan proses transfer lain.",
  );
  assert.equal(res.category, "lock_contention");
  assert.match(res.remediation, /advisory lock/);
});

test("deriveTransferRemediationHint mendeteksi ketidaksesuaian skema tabel", () => {
  const res = deriveTransferRemediationHint(
    'relation "public.routers" does not exist',
  );
  assert.equal(res.category, "schema_mismatch");
  assert.match(res.remediation, /Drizzle/);
});

test("TransferExecutionError menyimpan metadata remedial", () => {
  const err = new TransferExecutionError(
    "Gagal simpan",
    "Gunakan dry-run terlebih dahulu",
    "custom",
  );
  assert.equal(err.name, "TransferExecutionError");
  assert.equal(err.message, "Gagal simpan");
  assert.equal(err.remediationHint, "Gunakan dry-run terlebih dahulu");
  assert.equal(err.category, "custom");
});

test("runDataTransferTransactionally menyertakan remediationHint saat gagal", async () => {
  const res = await runDataTransferTransactionally({
    dryRun: false,
    targetDatabaseUrl: "",
  });

  assert.equal(res.success, false);
  assert.equal(res.rollbackExecuted, false);
  assert.ok(res.remediationHint);
  assert.equal(res.errorCategory, "connection");
});
