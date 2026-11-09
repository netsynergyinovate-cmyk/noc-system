import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { generateMockAlertKpi, isAlertBoardMockActive, ALERT_BOARD_MOCK_ENTRY } =
  await import("../src/lib/dashboard/alert-board-mock.ts");
const { SETUP_DATA_SOURCE_REGISTRY } =
  await import("../src/lib/dashboard/setup-extended.ts");
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

const NOW = 1_700_000_000;
const H = 3600;

test("generateMockAlertKpi: hitung kritis dan warning dari active", () => {
  const active = [
    { severity: "critical" },
    { severity: "critical" },
    { severity: "warning" },
    { severity: "info" },
  ];
  const k = generateMockAlertKpi(active, [], NOW);
  assert.equal(k.totalActive, 4);
  assert.equal(k.criticalCount, 2);
  assert.equal(k.warningCount, 1);
  assert.equal(k.unacknowledgedCount, 4);
  assert.equal(k.sourceStatus, "dummy");
  assert.equal(k.lastSyncedAt, new Date(NOW * 1000).toISOString());
});

test("generateMockAlertKpi: 24 jam dan 7 hari dari resolved (batas tepat)", () => {
  const resolved = [
    { endedAt: NOW - 1 * H },
    { endedAt: NOW - 24 * H + 1 }, // masih di dalam 24 jam
    { endedAt: NOW - 24 * H }, // tepat di batas: keluar dari 24 jam
    { endedAt: NOW - 6 * 24 * H },
    { endedAt: NOW - 7 * 24 * H }, // tepat di batas: keluar dari 7 hari
    { endedAt: NOW + 10 }, // masa depan: diabaikan
  ];
  const k = generateMockAlertKpi([], resolved, NOW);
  assert.equal(k.resolvedPast24h, 2);
  assert.equal(k.resolvedPast7d, 4);
});

test("generateMockAlertKpi: tanpa argumen aman dan deterministik", () => {
  const k = generateMockAlertKpi();
  assert.equal(k.totalActive, 0);
  assert.equal(k.resolvedPast7d, 0);
  assert.deepEqual(
    generateMockAlertKpi(
      [{ severity: "critical" }],
      [{ endedAt: NOW - 5 }],
      NOW,
    ),
    generateMockAlertKpi(
      [{ severity: "critical" }],
      [{ endedAt: NOW - 5 }],
      NOW,
    ),
  );
});

test("ALERT_BOARD_MOCK_ENTRY tercatat di SETUP_DATA_SOURCE_REGISTRY", () => {
  assert.equal(ALERT_BOARD_MOCK_ENTRY.id, "alert-board-data");
  assert.equal(ALERT_BOARD_MOCK_ENTRY.status, "dummy");
  assert.match(ALERT_BOARD_MOCK_ENTRY.notes, /Fase 5/);
  const entry = SETUP_DATA_SOURCE_REGISTRY.find(
    (e) => e.id === "alert-board-data",
  );
  assert.ok(entry);
  assert.deepEqual(entry, ALERT_BOARD_MOCK_ENTRY);
  assert.ok(SETUP_DATA_SOURCE_REGISTRY.length >= 14);
});

test("isAlertBoardMockActive", () => {
  assert.equal(isAlertBoardMockActive("dummy"), true);
  assert.equal(isAlertBoardMockActive("nyata"), false);
  assert.equal(isAlertBoardMockActive(), false);
});

test("AlertMetricSummary diekspor dan dipasang di AlertBoard", () => {
  const src = read("../src/components/dashboard/alert-metric-summary.tsx");
  assert.match(src, /^"use client";/);
  assert.match(src, /export function AlertMetricSummary/);
  for (const t of [
    "Alert Kritis Aktif",
    "Peringatan Berjalan",
    "Selesai 24 Jam Terakhir",
    "Total Riwayat 7 Hari",
  ]) {
    assert.ok(src.includes(`label="${t}"`), t);
  }
  const board = read("../src/components/dashboard/alert-board.tsx");
  const a = board.indexOf(
    "<AlertMetricSummary active={active} resolved={resolved} />",
  );
  const b = board.indexOf("<ActiveAlertList");
  assert.ok(a > 0 && a < b, "ringkasan tepat di atas daftar aktif");
});
