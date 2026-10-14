import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { getTableConfig } = await import("drizzle-orm/pg-core");
const { routers, olts } = await import("../src/db/schema/index.ts");

const cols = (t) =>
  Object.fromEntries(getTableConfig(t).columns.map((c) => [c.name, c]));

for (const [label, table, name] of [
  ["routers", routers, "routers"],
  ["olts", olts, "olts"],
]) {
  test(`${label}: kolom setup perangkat`, () => {
    const cfg = getTableConfig(table);
    assert.equal(cfg.name, name);
    const c = cols(table);
    for (const k of [
      "id",
      "name",
      "host",
      "username",
      "password_enc",
      "status",
      "last_seen_at",
      "created_at",
    ]) {
      assert.ok(c[k], `kolom ${k} ada`);
    }
    assert.ok(c.host.notNull && c.host.isUnique, "host wajib dan unik");
    assert.ok(c.username.notNull);
    assert.ok(c.password_enc.notNull);
    assert.ok(c.status.notNull && c.status.default === "aktif");
    assert.equal(c.last_seen_at.notNull, false, "lastSeenAt nullable");
    assert.ok(c.created_at.notNull && c.created_at.hasDefault);
    assert.ok(cfg.checks.some((ch) => ch.name === `${name}_status_check`));
  });
}

test("olts: brand dan driver wajib", () => {
  const c = cols(olts);
  assert.ok(c.brand.notNull && c.driver.notNull);
});
