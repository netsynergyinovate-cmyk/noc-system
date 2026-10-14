import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MOCK_DEVICE_CONFIGS,
  getStatusBadgeModel,
  summarizeDeviceStatuses,
} from "../src/lib/dashboard/device-config.ts";

const withStatus = (statuses) =>
  statuses.map((status, i) => ({ ...MOCK_DEVICE_CONFIGS[0], id: `d${i}`, status }));

test("summarize: hitung per status", () => {
  const s = summarizeDeviceStatuses(withStatus(["connected", "connected", "error", "timeout", "untested"]));
  assert.deepEqual(s, { total: 5, connected: 2, error: 1, timeout: 1, untested: 1, testing: 0, allOk: false });
});

test("summarize: allOk hanya bila semua terhubung dan tidak kosong", () => {
  assert.equal(summarizeDeviceStatuses(withStatus(["connected", "connected"])).allOk, true);
  assert.equal(summarizeDeviceStatuses([]).allOk, false);
  assert.equal(summarizeDeviceStatuses(withStatus(["connected"]), ["d0"]).allOk, false);
});

test("summarize: perangkat sedang diuji dihitung testing saja", () => {
  const s = summarizeDeviceStatuses(withStatus(["connected", "error", "untested"]), ["d0", "d1", "tidak-ada"]);
  assert.equal(s.testing, 2);
  assert.equal(s.connected, 0);
  assert.equal(s.error, 0);
  assert.equal(s.untested, 1);
  assert.equal(s.connected + s.error + s.timeout + s.untested + s.testing, s.total);
});

test("summarize: disconnected dihitung gagal", () => {
  assert.equal(summarizeDeviceStatuses(withStatus(["disconnected"])).error, 1);
});

test("badge model: label & jenis per status", () => {
  const m = (s, ...r) => getStatusBadgeModel(s, ...r);
  assert.deepEqual([m("connected").kind, m("connected").label], ["connected", "Terhubung"]);
  assert.deepEqual([m("error").kind, m("error").label], ["error", "Gagal"]);
  assert.deepEqual([m("timeout").kind, m("timeout").label], ["timeout", "Timeout"]);
  assert.deepEqual([m("untested").kind, m("untested").label], ["untested", "Belum Diuji"]);
  assert.equal(m("disconnected").kind, "error");
});

test("badge model: latensi hanya pada terhubung dan bila showLatency", () => {
  assert.equal(getStatusBadgeModel("connected", false, 12).label, "Terhubung · 12 ms");
  assert.equal(getStatusBadgeModel("connected", false, 12, false).label, "Terhubung");
  assert.equal(getStatusBadgeModel("connected", false, null).label, "Terhubung");
  assert.equal(getStatusBadgeModel("error", false, 12).label, "Gagal");
});

test("badge model: isTesting menimpa status apa pun", () => {
  for (const s of ["connected", "error", "timeout", "untested", "disconnected"]) {
    const m = getStatusBadgeModel(s, true, 99);
    assert.equal(m.kind, "testing", s);
    assert.equal(m.label, "Sedang diuji...", s);
    assert.equal(m.busy, true, s);
  }
  assert.equal(getStatusBadgeModel("connected").busy, false);
});

test("komponen: atribut a11y & data-status, ikon aria-hidden", () => {
  const src = readFileSync("src/components/dashboard/device-status-badge.tsx", "utf8");
  assert.match(src, /role="status"/);
  assert.match(src, /aria-label=\{m\.ariaLabel\}/);
  assert.match(src, /aria-busy=\{m\.busy \? "true" : undefined\}/);
  assert.match(src, /data-status=\{m\.kind\}/);
  assert.match(src, /<Icon[^>]*aria-hidden="true"/);
  assert.match(src, /animate-spin/);
  for (const icon of ["Loader2", "CheckCircle2", "AlertCircle", "Clock", "CircleDashed"]) {
    assert.match(src, new RegExp(`\\b${icon}\\b`), icon);
  }
});

test("integrasi: badge dipakai di tiga komponen, tombol mengirim onTestingChange", () => {
  for (const f of ["device-quick-cards", "connection-test-panel", "device-config-board"]) {
    assert.match(readFileSync(`src/components/dashboard/${f}.tsx`, "utf8"), /<DeviceStatusBadge/, f);
  }
  for (const f of ["device-quick-cards", "connection-test-panel"]) {
    const src = readFileSync(`src/components/dashboard/${f}.tsx`, "utf8");
    assert.match(src, /summarizeDeviceStatuses/, f);
    assert.match(src, /onTestingChange=/, f);
  }
  const btn = readFileSync("src/components/dashboard/device-test-button.tsx", "utf8");
  assert.match(btn, /onTestingChange\?\.\(true\)/);
  assert.match(btn, /finally \{[\s\S]*onTestingChange\?\.\(false\)/);
});
