import test from "node:test";
import assert from "node:assert/strict";
import { getTableConfig } from "drizzle-orm/pg-core";
import { register } from "tsx/esm/api";

register();
const direct = await import("../src/db/schema/network-logs.ts");
const barrel = await import("../src/db/schema/index.ts");

const { networkLogs, anomalies } = direct;
const cfg = getTableConfig(networkLogs);
const cols = Object.fromEntries(cfg.columns.map((c) => [c.name, c]));

test("networkLogs dan anomalies diekspor dari network-logs.ts dan barrel schema index", () => {
  assert.equal(cfg.name, "network_logs");
  assert.equal(anomalies, networkLogs);
  assert.equal(barrel.networkLogs, networkLogs);
  assert.equal(barrel.anomalies, networkLogs);
});

test("network_logs: kolom dan atribut penting", () => {
  const expectedCols = [
    "id",
    "router_id",
    "customer_id",
    "type",
    "severity",
    "started_at",
    "ended_at",
    "detail",
  ];
  assert.deepEqual(Object.keys(cols).sort(), expectedCols.sort());

  assert.ok(cols.id.primary);
  assert.ok(cols.id.hasDefault);
  assert.equal(cols.router_id.notNull, true);
  assert.equal(cols.customer_id.notNull, false);
  assert.equal(cols.type.notNull, true);
  assert.equal(cols.severity.notNull, true);
  assert.equal(cols.started_at.notNull, true);
  assert.equal(cols.ended_at.notNull, false);
  assert.equal(cols.detail.notNull, true);
});

test("network_logs: foreign key", () => {
  const fks = cfg.foreignKeys.map((f) => {
    const r = f.reference();
    return [r.columns[0].name, getTableConfig(r.foreignTable).name, f.onDelete];
  });
  assert.deepEqual(fks.sort(), [
    ["customer_id", "customers", "set null"],
    ["router_id", "routers", "restrict"],
  ]);
});

test("network_logs: index dan check constraints", () => {
  assert.deepEqual(cfg.indexes.map((i) => i.config.name).sort(), [
    "network_logs_active_idx",
    "network_logs_router_started_idx",
    "network_logs_started_idx",
  ]);

  assert.deepEqual(cfg.checks.map((c) => c.name).sort(), [
    "network_logs_period_check",
    "network_logs_severity_check",
    "network_logs_type_check",
  ]);
});

test("network_logs: enum types dan severities", () => {
  assert.deepEqual(direct.networkLogTypes, ["queue", "cpu", "optical", "offline", "port"]);
  assert.deepEqual(direct.networkLogSeverities, ["info", "warning", "critical"]);
  assert.equal(barrel.networkLogTypes, direct.networkLogTypes);
  assert.equal(barrel.networkLogSeverities, direct.networkLogSeverities);
});
