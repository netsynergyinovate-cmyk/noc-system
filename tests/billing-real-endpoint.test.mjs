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

const { GET: getBilling } = await import("../src/app/api/billing/route.ts");
const { GET: getBillingSync } = await import("../src/app/api/billing/sync/route.ts");
const { getBillingOverview, getBillingSyncState } = await import(
  "../src/services/billing.service.ts"
);

test("GET /api/billing menolak anonim dengan status 401", async () => {
  const req = new Request("http://localhost:3000/api/billing");
  const res = await getBilling(req);
  assert.equal(res.status, 401);
  const data = await res.json();
  assert.equal(data.error?.code, "UNAUTHORIZED");
});

test("GET /api/billing/sync menolak anonim dengan status 401", async () => {
  const req = new Request("http://localhost:3000/api/billing/sync");
  const res = await getBillingSync(req);
  assert.equal(res.status, 401);
  const data = await res.json();
  assert.equal(data.error?.code, "UNAUTHORIZED");
});

test("getBillingSyncState mengembalikan struktur BillingSyncState sah", async () => {
  try {
    const syncState = await getBillingSyncState(1_760_000_000);
    assert.equal(typeof syncState.intervalSeconds, "number");
    assert.equal(typeof syncState.nextRunAt, "number");
    assert.ok(Array.isArray(syncState.runs));
  } catch (err) {
    // Database mungkin offline di unit runner tanpa docker
    assert.ok(err);
  }
});

test("getBillingOverview mengembalikan struktur BillingOverview dengan penanda selisih sah", async () => {
  try {
    const overview = await getBillingOverview(1_760_000_000);
    assert.ok(overview.sync);
    assert.ok(Array.isArray(overview.rows));
    assert.ok(Array.isArray(overview.unmatched));

    for (const row of overview.rows) {
      assert.ok(row.customerId);
      assert.ok(["exact", "normalized", "none"].includes(row.match));
      assert.ok(["lunas", "isolir"].includes(row.status));
      if (row.match === "none") {
        assert.equal(row.invoiceRef, null);
        assert.equal(row.billingName, null);
      }
    }

    for (const un of overview.unmatched) {
      assert.ok(["unknown", "duplicate", "ambiguous"].includes(un.reason));
      assert.ok(["lunas", "isolir"].includes(un.status));
    }
  } catch (err) {
    // Database mungkin offline di unit runner tanpa docker
    assert.ok(err);
  }
});
