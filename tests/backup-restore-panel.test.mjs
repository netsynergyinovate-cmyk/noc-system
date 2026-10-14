import test from "node:test";
import assert from "node:assert/strict";

const { MOCK_BACKUP_SNAPSHOTS, formatBytes } = await import(
  "../src/lib/dashboard/deploy-safety.ts"
);

test("MOCK_BACKUP_SNAPSHOTS memuat snapshot dengan tipe dan checksum valid", () => {
  assert.ok(MOCK_BACKUP_SNAPSHOTS.length >= 3);
  for (const snap of MOCK_BACKUP_SNAPSHOTS) {
    assert.ok(snap.id);
    assert.ok(snap.label);
    assert.ok(snap.checksum.startsWith("sha256-"));
    assert.ok(snap.sizeBytes > 0);
    assert.equal(snap.status, "available");
    assert.equal(typeof snap.canRestore, "boolean");
  }
});

test("formatBytes menangani berbagai ordo ukuran", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(1024), "1.0 KB");
  assert.equal(formatBytes(1024 * 1024 * 10), "10.0 MB");
});
