import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { describeConnectionTroubleshoot: d } = await import(
  "../src/components/dashboard/connection-error-notice.tsx"
);

test("TIMEOUT: tanpa command", () => {
  const r = d("TIMEOUT", "mikrotik");
  assert.match(r.title, /merespons/);
  assert.equal(r.command, undefined);
});

test("AUTH_FAILED: saran kredensial", () => {
  const r = d("AUTH_FAILED", "mikrotik");
  assert.match(r.hint, /kredensial|kata sandi/i);
  assert.equal(r.command, undefined);
});

test("NOT_FOUND mikrotik memuat command RouterOS; non-mikrotik tidak", () => {
  assert.match(d("NOT_FOUND", "mikrotik").command, /\/ip service/);
  assert.equal(d("NOT_FOUND", "olt").command, undefined);
});

test("CONNECTION_REFUSED mikrotik memuat command RouterOS", () => {
  assert.match(d("CONNECTION_REFUSED", "mikrotik").command, /\/ip service/);
  assert.equal(d("CONNECTION_REFUSED", "billing").command, undefined);
});

test("INVALID_HOST", () => {
  const r = d("INVALID_HOST");
  assert.match(r.title, /host/i);
  assert.equal(r.command, undefined);
});

test("kode tak dikenal / kosong: fallback aman", () => {
  for (const c of ["WAT", undefined, "", "__proto__"]) {
    const r = d(c, "mikrotik");
    assert.equal(r.title, "Koneksi gagal");
    assert.ok(r.hint.length > 0);
    assert.equal(r.command, undefined);
  }
});
