import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  filterDeletedQueues,
  simulateDeleteQueue,
} from "../src/lib/dashboard/queue-form.ts";

const src = readFileSync(
  new URL(
    "../src/components/dashboard/simple-queue-board.tsx",
    import.meta.url,
  ),
  "utf8",
);
const qs = [{ id: "a" }, { id: "b" }, { id: "c" }];

test("filterDeletedQueues membuang id terhapus, menjaga lainnya", () => {
  assert.deepEqual(
    filterDeletedQueues(qs, new Set(["b"])).map((q) => q.id),
    ["a", "c"],
  );
  assert.equal(filterDeletedQueues(qs, new Set()).length, 3);
  assert.equal(filterDeletedQueues(qs, new Set(["x"])).length, 3);
  assert.equal(qs.length, 3);
});

test("simulateDeleteQueue gagal bila id memuat fail-delete", () => {
  assert.deepEqual(simulateDeleteQueue({ id: "q1" }), { ok: true });
  const r = simulateDeleteQueue({ id: "q-fail-delete-1" });
  assert.equal(r.ok, false);
  assert.ok(r.reason.length > 0);
});

test("board memuat tombol Hapus, ikon Trash2, dan AlertDialog", () => {
  assert.match(src, /Trash2/);
  assert.match(src, /data-testid="delete-queue-btn"/);
  assert.match(src, /text-destructive hover:bg-destructive\/10/);
  assert.match(src, /setDeletingQueue\(q\)/);
  assert.match(src, /<AlertDialog\b/);
});

test("dialog konfirmasi memuat nama, target, batas, Batal, Ya Hapus Queue", () => {
  assert.match(
    src,
    /Hapus Simple Queue &quot;\{deletingQueue\?\.name\}&quot;\?/,
  );
  assert.match(src, /deletingQueue\.target/);
  assert.match(src, /formatBitrate\(deletingQueue\.maxLimit\.upload\)/);
  assert.match(src, /formatBitrate\(deletingQueue\.maxLimit\.download\)/);
  assert.match(src, /menghapus aturan limitasi bandwidth ini dari\s+router/);
  assert.match(src, /<AlertDialogCancel[^>]*>\s*Batal\s*</);
  assert.match(src, /Ya, Hapus Queue/);
});

test("notifikasi sukses dan galat", () => {
  assert.match(src, /berhasil dihapus\./);
  assert.match(
    src,
    /Gagal menghapus queue '\$\{q\.name\}': \$\{result\.reason\}/,
  );
  assert.match(src, /role=\{notice\.type === "error" \? "alert" : "status"\}/);
  assert.match(src, /CheckCircle2/);
  assert.match(src, /AlertCircle/);
  assert.match(src, /Coba lagi/);
  assert.match(src, /aria-label="Tutup notifikasi"/);
  assert.match(src, /setDeletedQueueIds/);
});
