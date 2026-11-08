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

const { logSyncOperationAudit } = await import(
  "../src/services/audit.service.ts"
);

test("logSyncOperationAudit gagal-aman saat database offline", async () => {
  const res = await logSyncOperationAudit({
    operation: "seed",
    target: "initial_data",
    summary: "Uji pencatatan audit log sinkronisasi",
    success: true,
    recordsCount: 10,
    durationMs: 50,
    detail: { test: true },
  });

  // Gagal-aman: saat offline mengembalikan null tanpa crash, saat DB aktif mencatat record
  assert.ok(res === null || res?.action === "sync:seed");
});
