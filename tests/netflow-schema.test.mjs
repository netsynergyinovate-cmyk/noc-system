import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { netflowSamples } = await import("../src/db/schema/netflow-samples.ts");
const { getTableConfig } = await import("drizzle-orm/pg-core");

test("netflow_samples columns", () => {
  const cfg = getTableConfig(netflowSamples);
  assert.equal(cfg.name, "netflow_samples");
  const cols = Object.fromEntries(cfg.columns.map((c) => [c.name, c]));
  assert.equal(Object.keys(cols).length, 13);
  assert.deepEqual(Object.keys(cols).sort(), [
    "bytes",
    "captured_at",
    "customer_id",
    "direction",
    "dst_ip",
    "dst_port",
    "flows",
    "id",
    "packets",
    "protocol",
    "router_id",
    "src_ip",
    "src_port",
  ]);
  assert.ok(cols.id.primary);
  assert.equal(cols.router_id.notNull, false);
  for (const n of ["src_ip", "dst_ip", "src_port", "dst_port", "protocol", "bytes", "packets", "captured_at"]) {
    assert.ok(cols[n].notNull, n);
  }
  assert.equal(cols.customer_id.notNull, false);
  assert.equal(cols.direction.notNull, false);
  assert.equal(cols.packets.default, 1);
  assert.equal(cols.flows.default, 1);
  assert.equal(cols.flows.notNull, true);
  assert.equal(cols.bytes.dataType, "number");
});

test("netflow_samples indexes, fk, dan check", () => {
  const cfg = getTableConfig(netflowSamples);
  assert.deepEqual(cfg.indexes.map((i) => i.config.name).sort(), [
    "netflow_captured_idx",
    "netflow_customer_idx",
    "netflow_dst_port_idx",
    "netflow_src_ip_idx",
  ]);
  assert.equal(cfg.foreignKeys.length, 2);
  for (const fk of cfg.foreignKeys) assert.equal(fk.onDelete, "set null");
  assert.deepEqual(cfg.checks.map((c) => c.name), ["netflow_direction_check"]);
});
