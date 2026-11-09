import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const audit = await import("../src/lib/dashboard/audit.ts");
const { SETUP_DATA_SOURCE_REGISTRY } =
  await import("../src/lib/dashboard/setup-extended.ts");
const {
  AUDIT_LOG_MOCK_ENTRY,
  loadAudit,
  summarizeAudit,
  pageAudit,
  describeChange,
  redacted,
  AUDIT_PAGE_SIZE,
} = audit;
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

const NOW = Date.UTC(2026, 5, 15, 12, 0, 0) / 1000;

test("AUDIT_LOG_MOCK_ENTRY terdaftar di registry", () => {
  assert.ok(SETUP_DATA_SOURCE_REGISTRY.length >= 14);
  assert.equal(AUDIT_LOG_MOCK_ENTRY.envKey, "DATABASE_URL");
  assert.equal(AUDIT_LOG_MOCK_ENTRY.status, "dummy");
  assert.match(AUDIT_LOG_MOCK_ENTRY.notes, /Fase 5/);
  const found = SETUP_DATA_SOURCE_REGISTRY.find(
    (e) => e.id === "audit-log-events",
  );
  assert.deepEqual(found, AUDIT_LOG_MOCK_ENTRY);
});

test("loadAudit: entri valid, terbaru di atas, dalam jendela", async () => {
  const entries = await loadAudit({ nowSec: NOW });
  assert.ok(Array.isArray(entries));
  if (entries.length === 0) return;
  for (const e of entries) {
    assert.equal(typeof e.id, "string");
    assert.ok(
      e.actor &&
        typeof e.actor.id === "string" &&
        typeof e.actor.name === "string",
    );
    assert.equal(typeof e.action, "string");
    assert.ok(Number.isInteger(e.at) && e.at <= NOW);
    assert.equal(typeof e.target, "string");
    assert.ok(Array.isArray(e.changes));
  }
  for (let i = 1; i < entries.length; i += 1) {
    assert.ok(entries[i - 1].at >= entries[i].at);
  }
  assert.equal(new Set(entries.map((e) => e.id)).size, entries.length);
});

test("loadAudit: limit tidak valid ditolak", async () => {
  await assert.rejects(() => loadAudit({ nowSec: NOW, limit: 0 }), RangeError);
  const two = await loadAudit({ nowSec: NOW, limit: 2 });
  assert.ok(Array.isArray(two));
});

test("summarizeAudit", async () => {
  const entries = await loadAudit({ nowSec: NOW });
  const s = summarizeAudit(entries, NOW);
  assert.equal(s.total, entries.length);
  assert.equal(
    s.last24h,
    entries.filter((e) => e.at > NOW - 86_400 && e.at <= NOW).length,
  );
  if (entries.length > 0) assert.ok(s.operators >= 1);
  assert.deepEqual(summarizeAudit([], NOW), {
    total: 0,
    last24h: 0,
    operators: 0,
  });
});

test("pageAudit: ukuran bawaan dan batas halaman", async () => {
  const entries = await loadAudit({ nowSec: NOW });
  const p1 = pageAudit(entries, 1);
  assert.equal(p1.items.length, Math.min(AUDIT_PAGE_SIZE, entries.length));
  assert.equal(pageAudit(entries, 9999).page, p1.pageCount);
  assert.equal(pageAudit(entries, 1, 0).items.length, p1.items.length);
});

test("describeChange: nilai biasa dan bidang rahasia tanpa nilai", () => {
  const plain = describeChange({
    field: "Ambang CPU",
    from: "80 %",
    to: "85 %",
  });
  assert.match(plain, /80 %/);
  assert.match(plain, /85 %/);
  const secret = describeChange(redacted("Kata sandi Wi-Fi"));
  assert.match(secret, /Kata sandi Wi-Fi/);
});

test("AuditBoard memuat data-testid yang diwajibkan", () => {
  const src = read("../src/components/dashboard/audit-board.tsx");
  for (const id of [
    "audit-board",
    "audit-mock-badge",
    "audit-table",
    "audit-row",
    "audit-tile",
  ]) {
    assert.ok(src.includes(`data-testid="${id}"`), id);
  }
  assert.match(src, /Data Tiruan Audit \(Fase 2\)/);
  assert.match(src, /database audit_log nyata[\s\S]+?Fase 5/);
});
