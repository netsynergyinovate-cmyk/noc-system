import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();

const { getTableConfig } = await import("drizzle-orm/pg-core");
const { dataSyncRuns, seedTracking } =
  await import("../src/db/schema/index.ts");

const cols = (t) =>
  Object.fromEntries(getTableConfig(t).columns.map((c) => [c.name, c]));

test("dataSyncRuns: kolom pelacakan eksekusi sinkronisasi", () => {
  const cfg = getTableConfig(dataSyncRuns);
  assert.equal(cfg.name, "data_sync_runs");
  const c = cols(dataSyncRuns);

  for (const k of [
    "id",
    "module",
    "sync_type",
    "direction",
    "status",
    "records_processed",
    "records_inserted",
    "records_updated",
    "records_skipped",
    "checksum",
    "duration_ms",
    "actor",
    "summary_message",
    "error_message",
    "started_at",
    "completed_at",
    "metadata",
  ]) {
    assert.ok(c[k], `kolom ${k} ada`);
  }
});

test("seedTracking: kolom pelacakan data awal seed idempoten", () => {
  const cfg = getTableConfig(seedTracking);
  assert.equal(cfg.name, "seed_tracking");
  const c = cols(seedTracking);

  for (const k of [
    "id",
    "seed_key",
    "category",
    "target_table",
    "records_count",
    "checksum",
    "is_idempotent",
    "status",
    "seeded_at",
    "verified_at",
    "details",
  ]) {
    assert.ok(c[k], `kolom ${k} ada`);
  }
});
