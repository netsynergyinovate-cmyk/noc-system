import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { mapAuditRow, resolveAuditAction, loadLiveAudit } = await import("../src/lib/dashboard/audit-live.ts");
const { AUDIT_SYSTEM_ACTOR, AuditLoadError } = await import("../src/lib/dashboard/audit.ts");

const row = (o = {}) => ({
  id: "e1", at: 1_790_000_000, actor: { id: "u1", name: "Budi Admin" },
  action: "router-added", target: "/api/routers/r1", summary: "Budi Admin menambah router Core CIARA", changes: [],
  ...o,
});

test("tindakan: yang dikenal, alias penulis lama, dan yang asing", () => {
  assert.equal(resolveAuditAction("router-added"), "router-added");
  assert.equal(resolveAuditAction("alert_handle"), "alert-handled");
  assert.equal(resolveAuditAction("update_thresholds"), "threshold-changed");
  assert.equal(resolveAuditAction("whatsapp_send"), "settings-changed");
  assert.equal(resolveAuditAction("__proto__"), "settings-changed");
  assert.equal(resolveAuditAction("constructor"), "settings-changed");
});

test("catatan biasa dipetakan; aktor sistem memakai aktor Sistem", () => {
  const e = mapAuditRow(row());
  assert.deepEqual([e.id, e.at, e.actor.name, e.action, e.summary], ["e1", 1_790_000_000, "Budi Admin", "router-added", "Budi Admin menambah router Core CIARA"]);
  const sys = mapAuditRow(row({ actor: { id: "system", name: "Sistem" }, action: "billing-sync" }));
  assert.deepEqual(sys.actor, AUDIT_SYSTEM_ACTOR);
});

test("perubahan bidang valid dipertahankan, yang rusak dibuang", () => {
  const e = mapAuditRow(row({
    action: "threshold-changed",
    changes: [{ field: "CPU", from: 85, to: "90" }, { field: "", from: "a", to: "b" }, "bukan objek", { field: "X", from: {}, to: "y" }, { field: "Sandi", redacted: true }],
  }));
  assert.deepEqual(e.changes, [{ field: "CPU", from: "85", to: "90" }, { field: "Sandi", redacted: true }]);
});

test("catatan yang memuat rahasia tidak pernah ditampilkan nilainya", () => {
  const secret = "ghp_" + "a".repeat(36);
  const e = mapAuditRow(row({ summary: `Token diubah ke ${secret}`, changes: [] }));
  assert.ok(e, "tidak menjatuhkan halaman");
  assert.ok(!JSON.stringify(e).includes(secret), "nilai rahasia tidak boleh lolos");
  const viaChange = mapAuditRow(row({ changes: [{ field: "Catatan", from: "a", to: `Bearer ${"x".repeat(30)}` }] }));
  assert.ok(viaChange && !JSON.stringify(viaChange).includes("Bearer xxx"));
});

test("baris rusak ditolak tanpa melempar", () => {
  for (const bad of [null, {}, row({ at: 1.5 }), row({ at: -1 }), row({ id: 7 })]) {
    assert.equal(mapAuditRow(bad), null);
  }
});

test("loadLiveAudit: jendela 30 hari, terbaru di atas, gagal jadi AuditLoadError", async () => {
  const real = globalThis.fetch;
  const now = 1_790_000_000;
  const json = (s, b) => new Response(JSON.stringify(b), { status: s });
  try {
    globalThis.fetch = async () => json(200, { data: [
      row({ id: "lama", at: now - 31 * 86400 }),
      row({ id: "a", at: now - 100 }),
      row({ id: "b", at: now - 10 }),
      row({ id: "masa-depan", at: now + 500 }),
    ] });
    assert.deepEqual((await loadLiveAudit(now)).map((e) => e.id), ["b", "a"]);
    globalThis.fetch = async () => json(500, {});
    await assert.rejects(loadLiveAudit(now), AuditLoadError);
    globalThis.fetch = async () => { throw new TypeError("fetch failed"); };
    await assert.rejects(loadLiveAudit(now), AuditLoadError);
  } finally {
    globalThis.fetch = real;
  }
});
