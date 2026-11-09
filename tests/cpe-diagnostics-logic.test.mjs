import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  clearDiagnosticTasks,
  enqueueDiagnosticTask,
  getDiagnosticTasks,
  updateTaskStatus,
} from "../src/lib/dashboard/cpe-diagnostics-logic.ts";

const base = {
  customerId: "c1",
  customerName: "Budi",
  deviceSerial: "SN1",
  action: "ping_test",
  initiatedBy: "tester",
};

beforeEach(() => clearDiagnosticTasks());

test("enqueue: pending, id unik, tanggal ISO", () => {
  const a = enqueueDiagnosticTask(base);
  const b = enqueueDiagnosticTask(base);
  assert.equal(a.status, "pending");
  assert.notEqual(a.id, b.id);
  assert.equal(new Date(a.createdAt).toISOString(), a.createdAt);
});

test("updateTaskStatus: pending -> running -> success/failed", () => {
  const t = enqueueDiagnosticTask(base);
  assert.equal(updateTaskStatus(t.id, "running").status, "running");
  const ok = updateTaskStatus(t.id, "success", {
    resultSummary: "ok",
    latencyMs: 12,
  });
  assert.equal(ok.status, "success");
  assert.equal(ok.resultSummary, "ok");
  assert.equal(ok.latencyMs, 12);
  assert.ok(ok.completedAt);
  const t2 = enqueueDiagnosticTask(base);
  const bad = updateTaskStatus(t2.id, "failed", { errorReason: "timeout" });
  assert.equal(bad.errorReason, "timeout");
  assert.equal(updateTaskStatus("nope", "failed"), null);
  assert.equal(
    getDiagnosticTasks().find((x) => x.id === t.id).status,
    "success",
  );
});

test("getDiagnosticTasks: filter customerId", () => {
  enqueueDiagnosticTask(base);
  enqueueDiagnosticTask({ ...base, customerId: "c2" });
  assert.equal(getDiagnosticTasks().length, 2);
  assert.equal(getDiagnosticTasks("c2").length, 1);
  assert.equal(getDiagnosticTasks("zzz").length, 0);
});

test("cpe-board menampilkan live note dan dialog diagnosa pelanggan terpasang", () => {
  const board = readFileSync("src/components/dashboard/cpe-board.tsx", "utf8");
  assert.ok(board.includes('data-testid="diagnostics-live-note"'));
  assert.match(board, /Tugas Diagnostik/);
  const dlg = readFileSync(
    "src/components/dashboard/customer-cpe-dialog.tsx",
    "utf8",
  );
  assert.match(dlg, /Jalankan Diagnostik Cepat/);
});
