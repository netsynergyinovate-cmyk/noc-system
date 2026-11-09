import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  WHATSAPP_LOG_MOCK_ENTRY,
  filterWhatsappLogs,
  getWhatsappLogFacetCounts,
  mockWhatsappLogs,
  whatsappLogsToCsv,
} from "../src/lib/dashboard/whatsapp-log.ts";
import { SETUP_DATA_SOURCE_REGISTRY } from "../src/lib/dashboard/setup-extended.ts";

const NOW = 1_760_000_000;
const logs = mockWhatsappLogs(NOW);
const all = { status: "all", severity: "all", query: "", timeRange: "all" };
const f = (o) => filterWhatsappLogs(logs, { ...all, ...o }, NOW);

test("filter status", () => {
  for (const s of ["delivered", "sent", "failed"]) {
    const r = f({ status: s });
    assert.ok(r.length > 0);
    assert.ok(r.every((l) => l.status === s));
  }
  assert.equal(f({}).length, logs.length);
});

test("filter severity", () => {
  for (const s of ["critical", "warning"]) {
    const r = f({ severity: s });
    assert.ok(r.length > 0 && r.every((l) => l.severity === s));
  }
});

test("filter timeRange", () => {
  const within = (sec) => logs.filter((l) => l.sentAt >= NOW - sec).length;
  assert.equal(f({ timeRange: "1h" }).length, within(3600));
  assert.equal(f({ timeRange: "24h" }).length, within(86400));
  assert.equal(f({ timeRange: "7d" }).length, within(604800));
  assert.ok(f({ timeRange: "1h" }).length < f({ timeRange: "24h" }).length);
  assert.ok(f({ timeRange: "24h" }).length < f({ timeRange: "7d" }).length);
  // tanpa timeRange = all
  assert.equal(
    filterWhatsappLogs(logs, { status: "all", severity: "all", query: "" }, NOW)
      .length,
    logs.length,
  );
});

test("filter query multi-kata, case-insensitive, kind & errorReason", () => {
  assert.ok(
    f({ query: "BUDI santoso" }).every(
      (l) => l.recipientName === "Budi Santoso",
    ),
  );
  assert.ok(f({ query: "router OFFLINE" }).length > 0);
  assert.equal(f({ query: "budi dewi" }).length, 0);
  assert.ok(f({ query: "KUOTA gateway" }).every((l) => l.status === "failed"));
  assert.ok(f({ query: "KUOTA gateway" }).length > 0);
  assert.equal(f({ query: "tidak-ada-ini" }).length, 0);
});

test("facet counts akurat dan konsisten dengan filter", () => {
  const filter = { ...all, severity: "critical" };
  const fc = getWhatsappLogFacetCounts(logs, filter, NOW);
  for (const s of ["delivered", "sent", "failed"]) {
    assert.equal(fc.status[s], f({ severity: "critical", status: s }).length);
  }
  assert.equal(fc.status.all, f({ severity: "critical" }).length);
  assert.equal(fc.severity.warning, f({ severity: "warning" }).length);
  assert.equal(fc.severity.critical + fc.severity.warning, fc.severity.all);
  assert.equal(
    fc.timeRange["24h"],
    f({ severity: "critical", timeRange: "24h" }).length,
  );
  assert.equal(fc.timeRange.all, fc.status.all);
});

test("CSV: header, baris, escape dan anti-injeksi rumus", () => {
  const csv = whatsappLogsToCsv(logs.slice(0, 2));
  assert.equal(csv.split("\r\n").length, 3);
  const evil = whatsappLogsToCsv([
    { ...logs[0], recipientName: '=HYPERLINK("x")' },
  ]);
  assert.match(evil, /"'=HYPERLINK\(""x""\)"/);
});

test("WHATSAPP_LOG_MOCK_ENTRY terdaftar di registry (7 entri)", () => {
  assert.equal(WHATSAPP_LOG_MOCK_ENTRY.id, "whatsapp-notification-log");
  assert.equal(WHATSAPP_LOG_MOCK_ENTRY.status, "dummy");
  assert.match(WHATSAPP_LOG_MOCK_ENTRY.notes, /Fase 5/);
  const e = SETUP_DATA_SOURCE_REGISTRY.find(
    (x) => x.id === "whatsapp-notification-log",
  );
  assert.deepEqual(e, WHATSAPP_LOG_MOCK_ENTRY);
  assert.ok(SETUP_DATA_SOURCE_REGISTRY.length >= 7);
});

test("WhatsappLogBoard: ekspor & atribut penting", () => {
  const src = readFileSync(
    new URL(
      "../src/components/dashboard/whatsapp-log-board.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(src, /export function WhatsappLogBoard/);
  for (const id of [
    "wa-log-mock-badge",
    "wa-log-kpi",
    "wa-log-table",
    "wa-log-row",
    "wa-log-empty",
    "wa-log-message",
  ]) {
    assert.ok(src.includes(`data-testid="${id}"`), id);
  }
  assert.ok(
    src.includes(
      "Log Tiruan (Fase 2) \\u00b7 Wajib beralih ke DB nyata di Fase 5",
    ),
  );
  for (const t of [
    "Semua Waktu",
    "1 Jam Terakhir",
    "24 Jam Terakhir",
    "7 Hari Terakhir",
    "Ekspor CSV Log",
    "Lihat Pesan",
  ]) {
    assert.ok(src.includes(t), t);
  }
});
