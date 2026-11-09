import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";

process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:5432/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3101";

const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

register();

const { updateMismatchSchema } = await import("../src/validators/billing.ts");
const {
  updateMismatchResolution,
  getMismatchResolutions,
  getMismatchResolution,
  deleteMismatchResolution,
} = await import("../src/services/billing.service.ts");
const mismatchesRoute =
  await import("../src/app/api/billing/mismatches/route.ts");
const mismatchKeyRoute =
  await import("../src/app/api/billing/mismatches/[key]/route.ts");

test("validator: updateMismatchSchema valid dan invalid payload", () => {
  const valid = updateMismatchSchema.safeParse({
    mismatchKey: "pair|INV-001|cust-123",
    action: "manual_pair",
    notes: "Sudah dikonfirmasi dengan pelanggan",
  });
  assert.equal(valid.success, true);

  const invalidAction = updateMismatchSchema.safeParse({
    mismatchKey: "pair|INV-001|cust-123",
    action: "invalid_action",
  });
  assert.equal(invalidAction.success, false);

  const missingKey = updateMismatchSchema.safeParse({
    mismatchKey: "",
    action: "investigate",
  });
  assert.equal(missingKey.success, false);
});

test("service: updateMismatchResolution, get, and delete", async () => {
  const res = await updateMismatchResolution(
    {
      mismatchKey: "pair|INV-009|c-999",
      action: "followup_customer",
      notes: "Telepon pelanggan",
    },
    "Budi Teknisi",
    "usr-1",
  );

  assert.equal(res.mismatchKey, "pair|INV-009|c-999");
  assert.equal(res.action, "followup_customer");
  assert.equal(res.notes, "Telepon pelanggan");
  assert.equal(res.resolvedBy, "Budi Teknisi");

  const single = await getMismatchResolution("pair|INV-009|c-999");
  assert.deepEqual(single, res);

  const all = await getMismatchResolutions();
  assert.ok(all.some((item) => item.mismatchKey === "pair|INV-009|c-999"));

  const deleted = await deleteMismatchResolution("pair|INV-009|c-999", "usr-1");
  assert.equal(deleted, true);

  const afterDelete = await getMismatchResolution("pair|INV-009|c-999");
  assert.equal(afterDelete, null);
});

test("endpoint: /api/billing/mismatches menolak anonim dengan status 401", async () => {
  const req = new Request("http://localhost:3000/api/billing/mismatches", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mismatchKey: "test", action: "ignore" }),
  });
  const res = await mismatchesRoute.POST(req);
  assert.equal(res.status, 401);
});

test("endpoint: /api/billing/mismatches/[key] menolak anonim dengan status 401", async () => {
  const req = new Request(
    "http://localhost:3000/api/billing/mismatches/pair%7C123",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "ignore" }),
    },
  );
  const res = await mismatchKeyRoute.PATCH(req, {
    params: Promise.resolve({ key: "pair%7C123" }),
  });
  assert.equal(res.status, 401);
});
