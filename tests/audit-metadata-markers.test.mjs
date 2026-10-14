import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const {
  AUDIT_SYSTEM_ACTOR,
  auditActions,
  auditActionList,
  auditGroupLabels,
  auditActorType,
  formatAuditAge,
} = await import("../src/lib/dashboard/audit.ts");

const src = readFileSync(
  new URL("../src/components/dashboard/audit-board.tsx", import.meta.url),
  "utf8",
);

test("AuditTable: penanda atribut baru dan lama ada", () => {
  for (const marker of [
    "data-epoch={entry.at}",
    "data-actor-type={auditActorType(entry.actor)}",
    "data-action-kind={entry.action}",
    "data-action-group={auditActions[entry.action]?.group}",
    'data-testid="audit-time"',
    'data-testid="audit-actor"',
    'data-testid="audit-row"',
    "data-entry-id={entry.id}",
    "data-action={entry.action}",
    "data-actor={entry.actor.id}",
    'variant="secondary"',
    'variant="outline"',
  ]) {
    assert.ok(src.includes(marker), marker);
  }
});

test("auditActorType: sistem vs operator", () => {
  assert.equal(auditActorType(AUDIT_SYSTEM_ACTOR), "system");
  assert.equal(auditActorType({ id: "x", name: "Sistem" }), "system");
  assert.equal(auditActorType({ id: "system", name: "Apa" }), "system");
  assert.equal(auditActorType({ id: "op-1", name: "Budi" }), "operator");
});

test("grup aksi: semua aksi punya grup berlabel", () => {
  const expected = {
    login: "akses",
    logout: "akses",
    "alert-handled": "alert",
    "threshold-changed": "alert",
    "router-added": "perangkat",
    "router-updated": "perangkat",
    "cpe-changed": "perangkat",
    "billing-sync": "pengaturan",
    "settings-changed": "pengaturan",
  };
  assert.deepEqual(Object.keys(expected).sort(), [...auditActionList].sort());
  for (const [action, group] of Object.entries(expected)) {
    assert.equal(auditActions[action].group, group, action);
    assert.ok(auditGroupLabels[group].length > 0);
  }
  assert.equal(auditGroupLabels.perangkat, "Perangkat");
});

test("formatAuditAge: batas menit, jam, hari", () => {
  const now = 1_000_000;
  assert.equal(formatAuditAge(now, now), "< 1 mnt lalu");
  assert.equal(formatAuditAge(now - 59, now), "< 1 mnt lalu");
  assert.equal(formatAuditAge(now - 60, now), "1 mnt lalu");
  assert.equal(formatAuditAge(now - 3599, now), "59 mnt lalu");
  assert.equal(formatAuditAge(now - 3600, now), "1 jam lalu");
  assert.equal(formatAuditAge(now - 86_399, now), "23 jam lalu");
  assert.equal(formatAuditAge(now - 86_400, now), "1 hari lalu");
  assert.equal(formatAuditAge(now + 500, now), "< 1 mnt lalu");
});
