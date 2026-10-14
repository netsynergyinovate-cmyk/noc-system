import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
import { getTableConfig } from "drizzle-orm/pg-core";

register();
const { olts } = await import("../src/db/schema/olts.ts");
const { oltPonPorts } = await import("../src/db/schema/olt-pon-ports.ts");
const { oltOnus } = await import("../src/db/schema/olt-onus.ts");
const schema = await import("../src/db/schema/index.ts");

const cols = (t) => Object.fromEntries(getTableConfig(t).columns.map((c) => [c.name, c]));
const names = (t) => Object.keys(cols(t)).sort();

test("tabel diekspor dari index skema", () => {
  assert.equal(schema.olts, olts);
  assert.equal(schema.oltPonPorts, oltPonPorts);
  assert.equal(schema.oltOnus, oltOnus);
});

test("olts: kolom, host unik, status check", () => {
  const cfg = getTableConfig(olts);
  assert.equal(cfg.name, "olts");
  assert.deepEqual(
    names(olts),
    ["brand", "created_at", "driver", "host", "id", "last_seen_at", "name", "password_enc", "status", "username"],
  );
  const c = cols(olts);
  assert.ok(c.id.primary);
  assert.ok(c.host.isUnique);
  for (const n of ["name", "host", "brand", "driver", "username", "password_enc", "status", "created_at"])
    assert.ok(c[n].notNull, n);
  assert.ok(!c.last_seen_at.notNull);
  assert.equal(c.status.default, "aktif");
  assert.deepEqual(cfg.checks.map((k) => k.name), ["olts_status_check"]);
});

test("olt_pon_ports: cascade OLT, unik oltId+ponIndex, kolom optik", () => {
  const cfg = getTableConfig(oltPonPorts);
  assert.equal(cfg.name, "olt_pon_ports");
  const c = cols(oltPonPorts);
  for (const n of ["olt_id", "pon_index", "onu_online_count", "captured_at"]) assert.ok(c[n].notNull, n);
  for (const n of ["rx_power", "tx_power", "attenuation"]) assert.ok(!c[n].notNull, n);
  assert.equal(c.onu_online_count.default, 0);
  assert.equal(cfg.foreignKeys.length, 1);
  const fk = cfg.foreignKeys[0].reference();
  assert.equal(cfg.foreignKeys[0].onDelete, "cascade");
  assert.equal(getTableConfig(fk.foreignTable).name, "olts");
  assert.deepEqual(fk.columns.map((x) => x.name), ["olt_id"]);
  assert.equal(cfg.uniqueConstraints.length, 1);
  assert.equal(cfg.uniqueConstraints[0].name, "olt_pon_ports_olt_pon_unique");
  assert.deepEqual(cfg.uniqueConstraints[0].columns.map((x) => x.name), ["olt_id", "pon_index"]);
});

test("olt_onus: cascade OLT, set null pelanggan, unik, status check", () => {
  const cfg = getTableConfig(oltOnus);
  assert.equal(cfg.name, "olt_onus");
  const c = cols(oltOnus);
  for (const n of ["olt_id", "pon_index", "onu_index", "status", "captured_at"]) assert.ok(c[n].notNull, n);
  assert.ok(!c.customer_id.notNull);
  assert.equal(c.status.default, "offline");
  const byCol = Object.fromEntries(
    cfg.foreignKeys.map((f) => [f.reference().columns[0].name, f]),
  );
  assert.equal(byCol.olt_id.onDelete, "cascade");
  assert.equal(getTableConfig(byCol.olt_id.reference().foreignTable).name, "olts");
  assert.equal(byCol.customer_id.onDelete, "set null");
  assert.equal(getTableConfig(byCol.customer_id.reference().foreignTable).name, "customers");
  assert.equal(cfg.uniqueConstraints.length, 1);
  assert.equal(cfg.uniqueConstraints[0].name, "olt_onus_olt_pon_onu_unique");
  assert.deepEqual(
    cfg.uniqueConstraints[0].columns.map((x) => x.name),
    ["olt_id", "pon_index", "onu_index"],
  );
  assert.ok(cfg.indexes.some((i) => i.config.name === "olt_onus_customer_unique" && i.config.unique));
  assert.deepEqual(cfg.checks.map((k) => k.name), ["olt_onus_status_check"]);
});
