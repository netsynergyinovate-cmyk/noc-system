import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";

const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:1/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3101";

register();

const {
  listBackupSnapshots,
  createNewBackupSnapshot,
  resetBackupSnapshotsForTest,
} = await import("../src/services/backup-snapshots.service.ts");

test("listBackupSnapshots mengembalikan daftar snapshot terurut waktu terbaru", async () => {
  resetBackupSnapshotsForTest();
  const list = await listBackupSnapshots();
  assert.ok(list.length >= 2);
  const t0 = new Date(list[0].createdAt).getTime();
  const t1 = new Date(list[1].createdAt).getTime();
  assert.ok(t0 >= t1, "Snapshot harus diurutkan waktu terbaru lebih dulu");
});

test("createNewBackupSnapshot menambahkan snapshot baru dengan checksum & status available", async () => {
  const snap = await createNewBackupSnapshot(
    "schema_only",
    "Uji Snapshot Baru",
  );

  assert.equal(snap.type, "schema_only");
  assert.equal(snap.label, "Uji Snapshot Baru");
  assert.equal(snap.status, "available");
  assert.ok(snap.checksum.startsWith("sha256-"));
  assert.ok(snap.canRestore);

  const list = await listBackupSnapshots();
  assert.equal(list[0].id, snap.id);
});
