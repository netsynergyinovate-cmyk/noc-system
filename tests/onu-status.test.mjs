import test from "node:test";
import assert from "node:assert/strict";
import {
  getOnuStatusMeta,
  formatLastSeen,
} from "../src/lib/dashboard/onu-status.ts";

test("getOnuStatusMeta maps known statuses", () => {
  const on = getOnuStatusMeta("online");
  assert.equal(on.label, "Online");
  assert.equal(on.variant, "success");
  const off = getOnuStatusMeta("offline");
  assert.equal(off.label, "Mati / Power Off");
  assert.equal(off.variant, "warning");
  const los = getOnuStatusMeta("los");
  assert.equal(los.label, "Kabel Putus (LOS)");
  assert.equal(los.variant, "destructive");
  for (const m of [on, off, los]) {
    assert.ok(m.dotClass && m.badgeClass && m.description);
  }
});

test("getOnuStatusMeta falls back for unknown statuses", () => {
  for (const s of ["xyz", "", "constructor", "__proto__"]) {
    assert.equal(getOnuStatusMeta(s).label, "Tidak diketahui", s);
  }
});

test("formatLastSeen gives WIB time and guards bad input", () => {
  // 2025-10-09T08:53:20Z = 15:53:20 WIB
  const s = formatLastSeen(1_760_000_000);
  assert.match(s, /2025/);
  assert.match(s, /15[.:]53[.:]20/);
  assert.ok(s.endsWith(" WIB"));
  assert.equal(formatLastSeen(NaN), "-");
  assert.equal(formatLastSeen(Infinity), "-");
});
