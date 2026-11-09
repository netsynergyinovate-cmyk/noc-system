import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";
import { register } from "tsx/esm/api";

register();
const direct = await import("../src/db/schema/alerts.ts");
const barrel = await import("../src/db/schema/index.ts");

const { alerts } = direct;
const cfg = getTableConfig(alerts);
const cols = Object.fromEntries(cfg.columns.map((c) => [c.name, c]));

test("alerts diekspor dari alerts.ts dan schema index", () => {
  assert.equal(cfg.name, "alerts");
  assert.equal(barrel.alerts, alerts);
});

test("alerts: kolom penting", () => {
  for (const n of [
    "id",
    "router_id",
    "customer_id",
    "type",
    "severity",
    "status",
    "started_at",
    "detected_at",
    "ended_at",
    "time_source",
    "handled_by",
    "ticket_status",
    "ticket_priority",
    "detail",
  ]) {
    assert.ok(cols[n], n);
  }
  assert.ok(cols.id.primary && cols.id.hasDefault);
  for (const n of [
    "type",
    "severity",
    "status",
    "started_at",
    "detected_at",
    "time_source",
    "ticket_status",
    "ticket_priority",
    "detail",
  ]) {
    assert.ok(cols[n].notNull, n);
  }
  for (const n of ["router_id", "customer_id", "ended_at", "handled_by"]) {
    assert.ok(!cols[n].notNull, n);
  }
  assert.equal(cols.status.default, "active");
  assert.equal(cols.time_source.default, "poll");
  assert.equal(cols.ticket_status.default, "open");
  assert.equal(cols.ticket_priority.default, "medium");
});

test("alerts: foreign key", () => {
  const fks = cfg.foreignKeys.map((f) => {
    const r = f.reference();
    return [r.columns[0].name, getTableConfig(r.foreignTable).name, f.onDelete];
  });
  assert.deepEqual(fks.sort(), [
    ["customer_id", "customers", "set null"],
    ["router_id", "routers", "restrict"],
  ]);
});

test("alerts: index dan check", () => {
  assert.deepEqual(cfg.indexes.map((i) => i.config.name).sort(), [
    "alerts_active_idx",
    "alerts_customer_idx",
    "alerts_router_started_idx",
    "alerts_started_idx",
    "alerts_status_idx",
  ]);
  assert.deepEqual(cfg.checks.map((c) => c.name).sort(), [
    "alerts_period_check",
    "alerts_severity_check",
    "alerts_status_check",
    "alerts_ticket_priority_check",
    "alerts_ticket_status_check",
    "alerts_type_check",
  ]);
});

test("konstanta enum", () => {
  assert.deepEqual(direct.alertKinds, [
    "queue",
    "cpu",
    "port",
    "optical",
    "offline",
  ]);
  assert.deepEqual(direct.alertSeverities, ["info", "warning", "critical"]);
  assert.deepEqual(direct.alertStatuses, [
    "active",
    "resolved",
    "handled",
    "acknowledged",
  ]);
  assert.deepEqual(direct.alertTicketStatuses, [
    "open",
    "in_progress",
    "resolved",
    "escalated",
  ]);
  assert.deepEqual(direct.alertTicketPriorities, [
    "low",
    "medium",
    "high",
    "critical",
  ]);
  assert.equal(barrel.alertKinds, direct.alertKinds);
});

test("migrasi memuat CREATE TABLE alerts + foreign key", () => {
  const dir = new URL("../drizzle/", import.meta.url);
  const file = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .find((f) =>
      readFileSync(new URL(f, dir), "utf8").includes('CREATE TABLE "alerts"'),
    );
  assert.ok(file, "migrasi alerts tidak ditemukan");
  const sql = readFileSync(new URL(file, dir), "utf8");
  for (const col of [
    '"router_id" uuid',
    '"customer_id" uuid',
    '"started_at"',
    '"ticket_status"',
    '"detail" jsonb',
  ]) {
    assert.ok(sql.includes(col), col);
  }
  assert.match(
    sql,
    /FOREIGN KEY \("router_id"\) REFERENCES "public"\."routers"\("id"\) ON DELETE restrict/,
  );
  assert.match(
    sql,
    /FOREIGN KEY \("customer_id"\) REFERENCES "public"\."customers"\("id"\) ON DELETE set null/,
  );
});
