import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  validateQueueInput,
  createMockQueueFromInput,
  applyQueueEdit,
  QUEUE_SPEED_PRESETS,
} from "../src/lib/dashboard/queue-form.ts";

const valid = {
  routerId: "r-1",
  name: "pppoe-budi",
  target: "10.20.1.5",
  maxLimitUploadMbps: 5,
  maxLimitDownloadMbps: 10,
  comment: " tes ",
  disabled: false,
};

test("validateQueueInput lolos dan menambah /32", () => {
  const r = validateQueueInput(valid);
  assert.equal(r.ok, true);
  assert.equal(r.clean.target, "10.20.1.5/32");
  assert.equal(r.clean.comment, "tes");
  assert.equal(validateQueueInput({ ...valid, target: "10.20.1.0/24" }).clean.target, "10.20.1.0/24");
});

test("validateQueueInput menolak nama, target, limit, router salah", () => {
  assert.ok(validateQueueInput({ ...valid, name: "" }).errors.name);
  assert.ok(validateQueueInput({ ...valid, name: "a" }).errors.name);
  assert.ok(validateQueueInput({ ...valid, name: "x".repeat(65) }).errors.name);
  for (const t of ["", "abc", "10.20.1", "300.1.1.1", "10.0.0.1/33", "10.0.0.1/"]) {
    assert.ok(validateQueueInput({ ...valid, target: t }).errors.target, t);
  }
  assert.ok(validateQueueInput({ ...valid, maxLimitUploadMbps: 0 }).errors.maxLimitUploadMbps);
  assert.ok(validateQueueInput({ ...valid, maxLimitDownloadMbps: -1 }).errors.maxLimitDownloadMbps);
  assert.ok(validateQueueInput({ ...valid, maxLimitDownloadMbps: 100001 }).errors.maxLimitDownloadMbps);
  assert.ok(validateQueueInput({ ...valid, maxLimitUploadMbps: NaN }).errors.maxLimitUploadMbps);
  assert.ok(validateQueueInput({ ...valid, routerId: "" }).errors.routerId);
  assert.equal(validateQueueInput({ ...valid, name: "" }).ok, false);
});

test("presets tersedia", () => {
  assert.equal(QUEUE_SPEED_PRESETS.length, 4);
});

test("createMockQueueFromInput memberi bps", () => {
  const q = createMockQueueFromInput({ ...valid, target: "10.20.1.5/32" });
  assert.match(q.id, /^q-custom-\d+$/);
  assert.deepEqual(q.maxLimit, { upload: 5e6, download: 10e6 });
  assert.deepEqual(q.rate, { upload: 0, download: 0 });
  assert.deepEqual(q.bytes, { upload: 0, download: 0 });
  assert.equal(q.dropped, 0);
  assert.equal(q.routerId, "r-1");
});

test("applyQueueEdit mengubah field tanpa mengubah id", () => {
  const base = createMockQueueFromInput({ ...valid, target: "10.20.1.5/32" });
  const e = applyQueueEdit(base, {
    ...valid,
    name: "baru",
    target: "10.0.0.0/24",
    maxLimitUploadMbps: 20,
    maxLimitDownloadMbps: 50,
    comment: "k",
    disabled: true,
  });
  assert.equal(e.id, base.id);
  assert.equal(e.name, "baru");
  assert.equal(e.target, "10.0.0.0/24");
  assert.deepEqual(e.maxLimit, { upload: 20e6, download: 50e6 });
  assert.equal(e.disabled, true);
  assert.equal(base.name, "pppoe-budi");
});

test("SimpleQueueFormDialog punya field yang tepat", () => {
  const src = readFileSync(new URL("../src/components/dashboard/simple-queue-form-dialog.tsx", import.meta.url), "utf8");
  assert.match(src, /export function SimpleQueueFormDialog/);
  for (const s of ["Tambah Simple Queue", "Ubah Simple Queue", "mis. pppoe-budi", "10.20.1.5/32", "Pilih Preset Kecepatan", "Upload (Mbps)", "Download (Mbps)", "Nonaktifkan Queue", "Batal", "Simpan Queue"]) {
    assert.ok(src.includes(s), s);
  }
});

test("SimpleQueueBoard punya tombol Tambah Queue dan Ubah", () => {
  const src = readFileSync(new URL("../src/components/dashboard/simple-queue-board.tsx", import.meta.url), "utf8");
  assert.ok(src.includes("Tambah Queue"));
  assert.ok(src.includes("Ubah"));
  assert.ok(src.includes(">Aksi</TableHead>"));
});
