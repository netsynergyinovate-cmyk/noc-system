import test from "node:test";
import assert from "node:assert/strict";
import { getTableColumns } from "drizzle-orm";
import {
  auditLog,
  operatorActivityLogs,
} from "../src/db/schema/audit-log.ts";

test("auditLog dan operatorActivityLogs schema definisi sesuai kontrak", () => {
  assert.equal(auditLog, operatorActivityLogs);

  const cols = getTableColumns(operatorActivityLogs);
  assert.ok(cols.id, "kolom id harus ada");
  assert.ok(cols.userId, "kolom userId harus ada");
  assert.ok(cols.action, "kolom action harus ada");
  assert.ok(cols.target, "kolom target harus ada");
  assert.ok(cols.detail, "kolom detail harus ada");
  assert.ok(cols.createdAt, "kolom createdAt harus ada");
});
