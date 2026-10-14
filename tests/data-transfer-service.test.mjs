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
  TRANSFER_ADVISORY_LOCK_KEY,
  TRANSFERRABLE_TABLES,
  computeRowsChecksum,
  runDataTransferTransactionally,
} = await import("../src/services/data-transfer.service.ts");

test("TRANSFER_ADVISORY_LOCK_KEY didefinisikan secara unik", () => {
  assert.equal(TRANSFER_ADVISORY_LOCK_KEY, 727274002);
});

test("TRANSFERRABLE_TABLES memuat tabel-tabel utama yang dipromosikan", () => {
  assert.ok(TRANSFERRABLE_TABLES.includes("routers"));
  assert.ok(TRANSFERRABLE_TABLES.includes("olts"));
  assert.ok(TRANSFERRABLE_TABLES.includes("customers"));
  assert.ok(TRANSFERRABLE_TABLES.includes("alert_thresholds"));
  assert.ok(TRANSFERRABLE_TABLES.includes("whatsapp_recipients"));
});

test("computeRowsChecksum menghasilkan checksum sha256 konsisten", () => {
  const sum1 = computeRowsChecksum([{ id: 1, name: "Router 1" }]);
  const sum2 = computeRowsChecksum([{ id: 1, name: "Router 1" }]);
  assert.ok(sum1.startsWith("sha256-"));
  assert.equal(sum1, sum2);

  const emptySum = computeRowsChecksum([]);
  assert.equal(emptySum, "sha256-empty");
});

test("runDataTransferTransactionally menolak eksekusi nyata jika target URL kosong", async () => {
  const res = await runDataTransferTransactionally({
    dryRun: false,
    targetDatabaseUrl: "",
  });

  assert.equal(res.success, false);
  assert.equal(res.dryRun, false);
  assert.match(res.errorMessage, /TARGET_DATABASE_URL belum dikonfigurasi/);
});
