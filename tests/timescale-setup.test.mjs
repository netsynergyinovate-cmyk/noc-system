import { test } from "node:test";
import assert from "node:assert/strict";
import { applyTimescaleSetup } from "../scripts/setup-timescale.mjs";

const mock = (extAvailable) => {
  const calls = [];
  return {
    calls,
    async query(sql) {
      calls.push(sql);
      return {
        rows: [
          {
            exists: sql.includes("pg_available_extensions")
              ? extAvailable
              : true,
          },
        ],
      };
    },
  };
};

test("ekstensi ada: create extension, hypertable, retensi", async () => {
  const c = mock(true);
  const r = await applyTimescaleSetup(c, { retentionDays: 14 });
  assert.deepEqual(r, { enabled: true, isHypertable: true });
  assert.ok(
    c.calls.some((s) =>
      s.startsWith("CREATE EXTENSION IF NOT EXISTS timescaledb"),
    ),
  );
  assert.ok(
    c.calls.some((s) =>
      s.includes("create_hypertable('traffic_samples', 'sampled_at'"),
    ),
  );
  assert.ok(c.calls.some((s) => s.includes("INTERVAL '14 days'")));
});

test("ekstensi tidak ada: fallback aman tanpa error", async () => {
  const c = mock(false);
  const r = await applyTimescaleSetup(c);
  assert.equal(r.enabled, false);
  assert.match(r.reason, /timescaledb tidak tersedia/);
  assert.equal(c.calls.length, 1);
});

test("dimatikan lewat opsi: tidak menyentuh database", async () => {
  const c = mock(true);
  assert.equal(
    (await applyTimescaleSetup(c, { enabled: false })).enabled,
    false,
  );
  assert.equal(c.calls.length, 0);
});

test("error query tidak dilempar", async () => {
  const r = await applyTimescaleSetup({
    async query() {
      throw new Error("boom");
    },
  });
  assert.equal(r.enabled, false);
  assert.match(r.reason, /boom/);
});

test("retensi: default 30, minimum 1, desimal dibulatkan turun", async () => {
  const days = async (retentionDays) => {
    const c = mock(true);
    await applyTimescaleSetup(c, { retentionDays });
    return c.calls
      .find((s) => s.includes("add_retention_policy"))
      .match(/INTERVAL '(\d+) days'/)[1];
  };
  assert.equal(await days(undefined), "30");
  assert.equal(await days("abc"), "30");
  assert.equal(await days(0), "1");
  assert.equal(await days(-5), "1");
  assert.equal(await days("7.9"), "7");
});
