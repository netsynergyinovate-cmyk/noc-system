import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
import { getTableColumns } from "drizzle-orm";

register();

const { billingStatus, billingMatchKinds } = await import(
  "../src/db/schema/billing-status.ts"
);
const { billingMismatches, billingMismatchReasons } = await import(
  "../src/db/schema/billing-mismatches.ts"
);

test("billing_status schema definition matches expectations", () => {
  const cols = getTableColumns(billingStatus);
  assert.ok(cols.id, "id column must exist");
  assert.ok(cols.customerId, "customerId column must exist");
  assert.ok(cols.status, "status column must exist");
  assert.ok(cols.invoiceRef, "invoiceRef column must exist");
  assert.ok(cols.syncedAt, "syncedAt column must exist");
  assert.ok(cols.matchKind, "matchKind column must exist");
  assert.ok(cols.billingName, "billingName column must exist");
  assert.ok(cols.runId, "runId column must exist");

  assert.deepEqual(billingMatchKinds, ["exact", "normalized"]);
});

test("billing_mismatches schema definition matches expectations", () => {
  const cols = getTableColumns(billingMismatches);
  assert.ok(cols.id, "id column must exist");
  assert.ok(cols.runId, "runId column must exist");
  assert.ok(cols.invoiceName, "invoiceName column must exist");
  assert.ok(cols.invoiceRef, "invoiceRef column must exist");
  assert.ok(cols.invoiceStatus, "invoiceStatus column must exist");
  assert.ok(cols.reason, "reason column must exist");
  assert.ok(cols.customerIds, "customerIds column must exist");
  assert.ok(cols.createdAt, "createdAt column must exist");

  assert.deepEqual(billingMismatchReasons, [
    "unknown",
    "duplicate",
    "ambiguous",
  ]);
});
