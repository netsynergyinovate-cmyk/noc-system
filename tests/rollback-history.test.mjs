import test from "node:test";
import assert from "node:assert/strict";

const { MOCK_ROLLBACK_HISTORY } = await import(
  "../src/lib/dashboard/deploy-safety.ts"
);

test("MOCK_ROLLBACK_HISTORY memuat riwayat rollback dengan atribut lengkap", () => {
  assert.ok(MOCK_ROLLBACK_HISTORY.length >= 3);
  for (const rb of MOCK_ROLLBACK_HISTORY) {
    assert.ok(rb.id);
    assert.ok(rb.migrationFile.endsWith(".sql"));
    assert.ok(rb.targetVersion);
    assert.ok(rb.reason);
    assert.ok(rb.remediationHint);
    assert.equal(rb.status, "success");
    assert.ok(Array.isArray(rb.affectedTables));
    assert.ok(rb.affectedTables.length > 0);
    assert.ok(rb.durationMs > 0);
    assert.ok(rb.executedAt);
    assert.ok(rb.revertStatementsCount > 0);
  }
});
