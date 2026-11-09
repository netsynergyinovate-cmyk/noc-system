import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "tsx/esm/api";

register();
const m = await import("../src/lib/dashboard/billing-mismatch-actions.ts");
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

function fakeStorage(init = {}) {
  const data = new Map(Object.entries(init));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
    data,
  };
}
const withStorage = (s, fn) => {
  const had = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    value: s,
    configurable: true,
    writable: true,
  });
  try {
    return fn();
  } finally {
    if (had) Object.defineProperty(globalThis, "localStorage", had);
    else delete globalThis.localStorage;
  }
};
const rec = (key, action = "investigate", extra = {}) => ({
  mismatchKey: key,
  action,
  resolvedBy: "Budi",
  resolvedAt: "2026-01-01T00:00:00.000Z",
  ...extra,
});

test("mark + baca + hapus + kosongkan lewat localStorage", () => {
  const s = fakeStorage();
  withStorage(s, () => {
    m.clearMismatchResolutions();
    const saved = m.markMismatchResolved(
      rec("k1", "ignore", { notes: " tes " }),
    );
    assert.equal(saved.notes, "tes");
    assert.equal(saved.resolvedBy, "Budi");
    assert.ok(s.data.has("billing_mismatch_resolutions"));
    assert.equal(m.isMismatchResolved("k1"), true);
    assert.equal(m.isMismatchResolved("k2"), false);
    assert.equal(m.getMismatchResolution("k1").action, "ignore");
    assert.equal(m.getMismatchResolution("__proto__"), null);
    m.markMismatchResolved(rec("k2"));
    assert.deepEqual(Object.keys(m.getAllMismatchResolutions()).sort(), [
      "k1",
      "k2",
    ]);
    assert.equal(m.removeMismatchResolution("k1"), true);
    assert.equal(m.removeMismatchResolution("k1"), false);
    m.clearMismatchResolutions();
    assert.deepEqual(m.getAllMismatchResolutions(), {});
    assert.equal(s.data.has("billing_mismatch_resolutions"), false);
  });
});

test("data rusak di storage diabaikan; input tak valid ditolak", () => {
  withStorage(
    fakeStorage({ billing_mismatch_resolutions: "{bukan json" }),
    () => {
      assert.deepEqual(m.getAllMismatchResolutions(), {});
    },
  );
  withStorage(
    fakeStorage({
      billing_mismatch_resolutions: JSON.stringify({
        a: rec("a"),
        b: { mismatchKey: "b", action: "hack" },
      }),
    }),
    () => assert.deepEqual(Object.keys(m.getAllMismatchResolutions()), ["a"]),
  );
  assert.throws(() => m.markMismatchResolved(rec("")));
  assert.throws(() => m.markMismatchResolved(rec("x", "hack")));
});

test("fallback memori bila localStorage tidak tersedia atau melempar", () => {
  m.clearMismatchResolutions();
  delete globalThis.localStorage;
  m.markMismatchResolved(rec("mem"));
  assert.equal(m.isMismatchResolved("mem"), true);
  assert.equal(m.removeMismatchResolution("mem"), true);

  const broken = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("full");
    },
    removeItem() {
      throw new Error("blocked");
    },
  };
  withStorage(broken, () => {
    m.markMismatchResolved(rec("mem2"));
    assert.equal(m.isMismatchResolved("mem2"), true);
    m.clearMismatchResolutions();
    assert.equal(m.isMismatchResolved("mem2"), false);
  });
});

test("label aksi lengkap", () => {
  assert.deepEqual(Object.keys(m.mismatchActionLabels).sort(), [
    "followup_customer",
    "ignore",
    "investigate",
    "manual_pair",
  ]);
  assert.equal(m.mismatchActionLabels.investigate, "Telah Diinvestigasi");
});

test("dialog dan integrasi di daftar ketidakcocokan", () => {
  const dialog = read(
    "../src/components/dashboard/billing-mismatch-action-dialog.tsx",
  );
  assert.match(dialog, /export function BillingMismatchActionDialog/);
  assert.match(dialog, /Tindakan Ketidaksesuaian Billing/);
  for (const id of [
    "mismatch-action-dialog",
    "mismatch-action-close",
    "save-mismatch-action-btn",
  ]) {
    assert.ok(dialog.includes(`data-testid="${id}"`), id);
  }
  assert.match(dialog, /Simpan Tindakan/);
  assert.match(dialog, /Hapus Tindakan/);
  const list = read("../src/components/dashboard/billing-mismatch-list.tsx");
  assert.ok(list.includes('data-testid="mismatch-action-btn"'));
  assert.ok(list.includes('data-testid="mismatch-resolved-badge"'));
  assert.match(list, /<BillingMismatchActionDialog/);
  // selector lama tetap ada
  for (const id of [
    "mismatch-copy",
    "billing-mismatch-row",
    "mismatch-invoice",
  ]) {
    assert.ok(list.includes(`"${id}"`), id);
  }
});
