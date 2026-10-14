import test from "node:test";
import assert from "node:assert/strict";
import {
  describeBillingSession,
  mockBillingSession,
} from "../src/lib/dashboard/billing-session.ts";
import { readFileSync } from "node:fs";
import { roles } from "../src/lib/permissions.ts";

const base = {
  portalUrl: "https://billing.example.net",
  username: "noc",
  isConfigured: true,
  sessionStatus: "active",
  csrfStatus: "acquired",
  lastLoginAt: 1,
  consecutiveFailures: 0,
  isBackoffActive: false,
  cookiejarCount: 2,
};

test("belum dikonfigurasi", () => {
  const r = describeBillingSession({ ...base, isConfigured: false });
  assert.equal(r.tone, "muted");
  assert.equal(r.text, "Kredensial belum dikonfigurasi");
});

test("backoff aktif menang atas sesi aktif", () => {
  for (const s of [
    { isBackoffActive: true },
    { consecutiveFailures: 3 },
  ]) {
    const r = describeBillingSession({ ...base, ...s });
    assert.equal(r.tone, "danger");
    assert.equal(r.text, "Proteksi perlambatan 6 jam aktif");
  }
  assert.equal(
    describeBillingSession({ ...base, consecutiveFailures: 2 }).tone,
    "success",
  );
});

test("sesi aktif", () => {
  const r = describeBillingSession(base);
  assert.equal(r.tone, "success");
  assert.equal(r.text, "Sesi login aktif");
});

test("sesi kedaluwarsa dan belum login", () => {
  const e = describeBillingSession({ ...base, sessionStatus: "expired" });
  assert.deepEqual([e.tone, e.text], ["warning", "Sesi kedaluwarsa"]);
  const n = describeBillingSession({ ...base, sessionStatus: "not_logged_in" });
  assert.deepEqual([n.tone, n.text], ["warning", "Belum login"]);
});

test("mock: tiga gagal beruntun mengaktifkan backoff", () => {
  const run = (status) => ({ status, finishedAt: 1 });
  const s = mockBillingSession({
    runs: [run("failed"), run("failed"), run("failed"), run("success")],
  });
  assert.equal(s.isBackoffActive, true);
  assert.equal(describeBillingSession(s).tone, "danger");
  assert.equal(mockBillingSession({ runs: [run("success")] }).sessionStatus, "active");
});

test("izin manageBilling: admin ya, user tidak", () => {
  // access.ts memakai impor tanpa ekstensi (tak bisa dimuat Node langsung),
  // jadi petakan kemampuannya dari sumber dan uji peran sungguhan.
  const src = readFileSync(
    new URL("../src/lib/access.ts", import.meta.url),
    "utf8",
  );
  assert.match(src, /manageBilling:\s*\{\s*billing:\s*\["manage"\]\s*\}/);
  const perms = { billing: ["manage"] };
  assert.equal(roles.admin.authorize(perms).success, true);
  assert.equal(roles.user.authorize(perms).success, false);
});
