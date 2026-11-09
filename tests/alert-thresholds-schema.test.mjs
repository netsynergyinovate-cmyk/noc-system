import test from "node:test";
import assert from "node:assert/strict";
import { getTableConfig } from "drizzle-orm/pg-core";
// Schema files use extensionless imports, so load them through tsx.
import { register } from "tsx/esm/api";

register();
const { alertThresholds } =
  await import("../src/db/schema/alert-thresholds.ts");
const schema = await import("../src/db/schema/index.ts");

const cfg = getTableConfig(alertThresholds);
const col = (name) => cfg.columns.find((c) => c.name === name);

test("alert_thresholds is exported from schema index", () => {
  assert.equal(schema.alertThresholds, alertThresholds);
  assert.equal(cfg.name, "alert_thresholds");
});

test("alert_thresholds columns", () => {
  assert.deepEqual(
    cfg.columns.map((c) => c.name),
    ["id", "rule_kind", "threshold", "for_seconds", "updated_by", "updated_at"],
  );
  assert.ok(col("id").primary && col("id").hasDefault);
  assert.ok(col("rule_kind").notNull && col("rule_kind").isUnique);
  assert.equal(col("threshold").notNull, false);
  assert.equal(col("threshold").dataType, "number");
  assert.ok(col("for_seconds").notNull);
  assert.equal(col("updated_by").notNull, false);
  assert.ok(col("updated_at").notNull && col("updated_at").hasDefault);
});

test("alert_thresholds fk and checks", () => {
  assert.equal(cfg.foreignKeys.length, 1);
  const fk = cfg.foreignKeys[0].reference();
  assert.equal(getTableConfig(fk.foreignTable).name, "user");
  assert.equal(cfg.foreignKeys[0].onDelete, "set null");
  assert.deepEqual(cfg.checks.map((c) => c.name).sort(), [
    "alert_thresholds_for_seconds_check",
    "alert_thresholds_rule_kind_check",
  ]);
});
