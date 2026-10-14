import test from "node:test";
import assert from "node:assert/strict";
import {
  filterWhatsappLogs,
  mockWhatsappLogs,
  summarizeWhatsappLogs,
} from "../src/lib/dashboard/whatsapp-log.ts";

const NOW = 1_800_000_000;
const all = { status: "all", severity: "all", query: "" };

test("mockWhatsappLogs deterministik, 24 entri dalam 7 hari", () => {
  const a = mockWhatsappLogs(NOW);
  assert.deepEqual(a, mockWhatsappLogs(NOW));
  assert.equal(a.length, 24);
  assert.equal(new Set(a.map((l) => l.id)).size, 24);
  for (const l of a) {
    assert.ok(l.sentAt <= NOW && l.sentAt > NOW - 7 * 24 * 3600);
    if (l.status === "failed") {
      assert.equal(l.latencyMs, null);
      assert.ok(l.errorReason);
    } else {
      assert.ok(l.latencyMs >= 200 && l.latencyMs <= 850);
    }
  }
  for (const s of ["delivered", "sent", "failed"]) assert.ok(a.some((l) => l.status === s));
});

test("filterWhatsappLogs", () => {
  const logs = mockWhatsappLogs(NOW);
  assert.equal(filterWhatsappLogs(logs, all).length, 24);
  const failed = filterWhatsappLogs(logs, { ...all, status: "failed" });
  assert.ok(failed.length > 0 && failed.every((l) => l.status === "failed"));
  const crit = filterWhatsappLogs(logs, { ...all, severity: "critical" });
  assert.ok(crit.length > 0 && crit.every((l) => l.severity === "critical"));
  const byName = filterWhatsappLogs(logs, { ...all, query: "  dewi " });
  assert.ok(byName.length > 0 && byName.every((l) => l.recipientName === "Dewi Lestari"));
  assert.equal(filterWhatsappLogs(logs, { ...all, query: "6281234567890" })[0].recipientName, "Budi Santoso");
  assert.ok(filterWhatsappLogs(logs, { ...all, query: "router offline" }).length > 0);
  assert.equal(filterWhatsappLogs(logs, { ...all, query: "tidak-ada-ini" }).length, 0);
  assert.equal(filterWhatsappLogs(logs, { status: "failed", severity: "critical", query: "" }).length,
    logs.filter((l) => l.status === "failed" && l.severity === "critical").length);
});

test("summarizeWhatsappLogs", () => {
  const empty = summarizeWhatsappLogs([]);
  assert.deepEqual(empty, { total: 0, delivered: 0, sent: 0, failed: 0, successRate: 0, avgLatencyMs: null });
  const logs = mockWhatsappLogs(NOW);
  const s = summarizeWhatsappLogs(logs);
  assert.equal(s.total, 24);
  assert.equal(s.delivered + s.sent + s.failed, 24);
  assert.equal(s.successRate, Math.round(((24 - s.failed) / 24) * 1000) / 10);
  assert.ok(s.avgLatencyMs >= 200 && s.avgLatencyMs <= 850);
});
