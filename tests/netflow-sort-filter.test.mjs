import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { sortFlows, evaluateFlowAnomaly, applyExtendedFilter } = await import(
  "../src/lib/dashboard/netflow-filter-sort.ts"
);
const { mockNetflow } = await import("../src/lib/dashboard/netflow.ts");
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

const flows = mockNetflow(1_760_000_000, 86_400);
const key = {
  bytes: (f) => f.bytes,
  packets: (f) => f.packets,
  throughput: (f) => f.bytes / Math.max(1, f.durationSec),
  duration: (f) => f.durationSec,
  startedAt: (f) => f.startedAt,
};

for (const field of Object.keys(key)) {
  for (const dir of ["asc", "desc"]) {
    test(`sortFlows ${field} ${dir}`, () => {
      const copy = [...flows];
      const out = sortFlows(flows, field, dir);
      assert.deepEqual(flows, copy, "input tidak dimutasi");
      assert.equal(out.length, flows.length);
      const s = dir === "asc" ? 1 : -1;
      for (let i = 1; i < out.length; i++) {
        const d = s * (key[field](out[i]) - key[field](out[i - 1]));
        assert.ok(d >= 0);
        if (d === 0) assert.ok(out[i - 1].id <= out[i].id, "tie-breaker id");
      }
    });
  }
}

test("evaluateFlowAnomaly", () => {
  const base = { ...flows[0], bytes: 1000, durationSec: 10 };
  assert.deepEqual(evaluateFlowAnomaly(base), { isAnomaly: false, severity: "info" });
  const big = evaluateFlowAnomaly({ ...base, bytes: 524_288_001 });
  assert.equal(big.isAnomaly, true);
  assert.equal(big.severity, "warning");
  assert.match(big.reason, /> 500 MB/);
  const persistent = evaluateFlowAnomaly({ ...base, bytes: 200_000_000, durationSec: 301 });
  assert.equal(persistent.reason, "Koneksi persisten bandwidth tinggi");
  assert.equal(evaluateFlowAnomaly({ ...base, bytes: 200_000_000, durationSec: 300 }).isAnomaly, false);
});

test("applyExtendedFilter", () => {
  const out = applyExtendedFilter(flows, { minBytes: 1_048_576, minDurationSec: 60 });
  assert.ok(out.every((f) => f.bytes >= 1_048_576 && f.durationSec >= 60));
  assert.equal(applyExtendedFilter(flows, {}), flows);
});

test("NetflowDetailDialog dan integrasi board", () => {
  const dlg = read("../src/components/dashboard/netflow-detail-dialog.tsx");
  assert.match(dlg, /^"use client"/);
  assert.match(dlg, /export function NetflowDetailDialog/);
  assert.match(dlg, /Rincian Aliran Trafik NetFlow/);
  for (const id of ["flow-detail-dialog", "flow-detail-close"]) {
    assert.match(dlg, new RegExp(`data-testid="${id}"`));
  }
  const board = read("../src/components/dashboard/netflow-board.tsx");
  assert.match(board, /NetflowDetailDialog/);
  for (const id of ["netflow-sort-select", "view-flow-detail-btn"]) {
    assert.match(board, new RegExp(`data-testid="${id}"`));
  }
  for (const l of ["Ukuran Data (Terbesar)", "Ukuran Data (Terkecil)", "Paket (Terbanyak)", "Laju Throughput (Tertinggi)", "Durasi (Terlama)", "Waktu Terbaru"]) {
    assert.ok(board.includes(l), l);
  }
  assert.match(board, /evaluateFlowAnomaly/);
});
