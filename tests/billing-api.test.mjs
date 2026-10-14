import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { loadBilling, loadBillingSync } = await import(
  "../src/lib/dashboard/billing.ts"
);

const NOW = 1_760_000_000;

function assertSync(sync) {
  assert.equal(typeof sync.intervalSeconds, "number");
  assert.equal(typeof sync.nextRunAt, "number");
  assert.ok(sync.nextRunAt > NOW);
  assert.ok(Array.isArray(sync.runs));
}

test("loadBilling (tanpa browser) mengembalikan BillingOverview tiruan", async () => {
  const o = await loadBilling(NOW);
  assert.ok(Array.isArray(o.rows) && o.rows.length > 0);
  assert.ok(Array.isArray(o.unmatched));
  assertSync(o.sync);
  assert.equal(o.source, undefined); // di luar browser: tiruan apa adanya
});

test("loadBillingSync (tanpa browser) mengembalikan BillingSyncState tiruan", async () => {
  const s = await loadBillingSync(NOW);
  assertSync(s);
});

test("endpoint offline di browser jatuh ke tiruan", async () => {
  globalThis.window = {};
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    throw new TypeError("offline");
  };
  try {
    const o = await loadBilling(NOW);
    const s = await loadBillingSync(NOW);
    assert.deepEqual(calls, ["/api/billing", "/api/billing/sync"]);
    assert.equal(o.source, "mock");
    assert.equal(s.source, "mock");
    assertSync(o.sync);
    assertSync(s);
  } finally {
    delete globalThis.window;
  }
});

test("status bukan 200 jatuh ke tiruan; 200 dipakai apa adanya", async () => {
  globalThis.window = {};
  try {
    globalThis.fetch = async () => new Response("{}", { status: 503 });
    assert.equal((await loadBilling(NOW)).source, "mock");

    const live = { rows: [], unmatched: [], sync: {}, source: "live" };
    globalThis.fetch = async () => Response.json(live);
    assert.deepEqual(await loadBilling(NOW), live);
  } finally {
    delete globalThis.window;
  }
});
