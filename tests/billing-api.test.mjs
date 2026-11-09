import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { loadBilling, loadBillingSync } =
  await import("../src/lib/dashboard/billing.ts");

const NOW = 1_760_000_000;

function assertSync(sync) {
  assert.equal(typeof sync.intervalSeconds, "number");
  assert.equal(typeof sync.nextRunAt, "number");
  assert.ok(sync.nextRunAt > NOW);
  assert.ok(Array.isArray(sync.runs));
}

test("status 200 dipakai apa adanya, error melempar", async () => {
  globalThis.window = {};
  try {
    const live = { rows: [], unmatched: [], sync: {}, source: "live" };
    globalThis.fetch = async () => Response.json(live);
    assert.deepEqual(await loadBilling(NOW), live);

    globalThis.fetch = async () => new Response("{}", { status: 503 });
    await assert.rejects(() => loadBilling(NOW));
  } finally {
    delete globalThis.window;
  }
});

test("loadBillingSync: status 200 dipakai apa adanya, error melempar", async () => {
  globalThis.window = {};
  try {
    const live = { runs: [], nextRunAt: NOW + 3600, source: "live" };
    globalThis.fetch = async () => Response.json(live);
    assert.deepEqual(await loadBillingSync(NOW), live);

    globalThis.fetch = async () => new Response("{}", { status: 500 });
    await assert.rejects(() => loadBillingSync(NOW));
  } finally {
    delete globalThis.window;
  }
});
