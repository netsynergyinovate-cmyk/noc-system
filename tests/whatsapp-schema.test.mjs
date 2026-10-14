import test from "node:test";
import assert from "node:assert/strict";
import { getTableConfig } from "drizzle-orm/pg-core";
import { whatsappLogs, whatsappRecipients } from "../src/db/schema/whatsapp.ts";
import { readFileSync } from "node:fs";

const index = readFileSync(new URL("../src/db/schema/index.ts", import.meta.url), "utf8");

const cols = (cfg) => Object.fromEntries(cfg.columns.map((c) => [c.name, c]));

test("whatsapp_recipients: kolom, default, unique", () => {
  const cfg = getTableConfig(whatsappRecipients);
  assert.equal(cfg.name, "whatsapp_recipients");
  const c = cols(cfg);
  assert.deepEqual(Object.keys(c), [
    "id", "name", "target", "type", "is_active", "created_at", "updated_at",
  ]);
  assert.ok(c.id.primary && c.id.hasDefault);
  assert.ok(c.name.notNull && c.target.notNull && c.target.isUnique);
  assert.equal(c.type.default, "individual");
  assert.ok(c.type.notNull);
  assert.equal(c.is_active.default, true);
  assert.ok(c.is_active.notNull);
  for (const n of ["created_at", "updated_at"]) {
    assert.ok(c[n].notNull && c[n].hasDefault);
    assert.equal(c[n].getSQLType(), "timestamp with time zone");
  }
  assert.equal(cfg.foreignKeys.length, 0);
});

test("whatsapp_logs: kolom, default, nullability", () => {
  const cfg = getTableConfig(whatsappLogs);
  assert.equal(cfg.name, "whatsapp_logs");
  const c = cols(cfg);
  assert.deepEqual(Object.keys(c), [
    "id", "recipient_id", "recipient_target", "recipient_name", "message",
    "alert_kind", "status", "error", "sent_at", "created_at",
  ]);
  for (const n of ["recipient_target", "recipient_name", "message", "status", "created_at"]) {
    assert.ok(c[n].notNull, n);
  }
  for (const n of ["recipient_id", "alert_kind", "error", "sent_at"]) {
    assert.ok(!c[n].notNull, n);
  }
  assert.equal(c.status.default, "pending");
  assert.equal(c.sent_at.getSQLType(), "timestamp with time zone");
});

test("whatsapp_logs: foreign key ke recipients, on delete set null", () => {
  const cfg = getTableConfig(whatsappLogs);
  assert.equal(cfg.foreignKeys.length, 1);
  const fk = cfg.foreignKeys[0].reference();
  assert.deepEqual(fk.columns.map((x) => x.name), ["recipient_id"]);
  assert.deepEqual(fk.foreignColumns.map((x) => x.name), ["id"]);
  assert.equal(getTableConfig(fk.foreignTable).name, "whatsapp_recipients");
  assert.equal(cfg.foreignKeys[0].onDelete, "set null");
});

test("whatsapp_logs: index", () => {
  const idx = Object.fromEntries(
    getTableConfig(whatsappLogs).indexes.map((i) => [i.config.name, i.config]),
  );
  assert.deepEqual(Object.keys(idx).sort(), ["wa_logs_created_idx", "wa_logs_status_idx"]);
  assert.deepEqual(idx.wa_logs_created_idx.columns.map((x) => x.name), ["created_at"]);
  assert.deepEqual(idx.wa_logs_status_idx.columns.map((x) => x.name), ["status", "created_at"]);
  assert.equal(idx.wa_logs_status_idx.columns[1].indexConfig.order, "desc");
  assert.equal(idx.wa_logs_created_idx.columns[0].indexConfig.order, "desc");
});

test("whatsapp tabel diekspor dari schema index", () => {
  assert.match(index, /export \* from "\.\/whatsapp";/);
});
