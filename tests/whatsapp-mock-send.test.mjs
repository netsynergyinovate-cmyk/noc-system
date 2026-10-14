import test from "node:test";
import assert from "node:assert/strict";
import { sendMockWhatsappAlert, defaultWhatsappConfig } from "../src/lib/dashboard/whatsapp.ts";
import { createWhatsappLogStore } from "../src/lib/dashboard/whatsapp-log.ts";

const alert = {
  severity: "critical",
  kind: "Router offline",
  subject: "R1",
  router: "R1",
  time: "2026-01-01 00:00:00 UTC",
  message: "down",
};
const cfg = (over = {}) => ({
  ...defaultWhatsappConfig,
  apiKey: "tok",
  recipients: defaultWhatsappConfig.recipients.map((r) => ({ ...r })),
  ...over,
});
const fakeStorage = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, v),
  };
};

test("sukses: log per nomor aktif, latensi valid", async () => {
  const store = createWhatsappLogStore(() => fakeStorage());
  const r = await sendMockWhatsappAlert(cfg(), alert, { delayMs: 20, record: store.record });
  assert.equal(r.ok, true);
  assert.equal(r.sentCount, 2);
  assert.deepEqual(r.phones, ["6281234567890", "6289876543210"]);
  assert.ok(r.latencyMs >= 20);
  const logs = store.read();
  assert.equal(logs.length, 2);
  assert.ok(logs.every((l) => l.status === "delivered" && l.message.includes("Router offline")));
});

test("hanya nomor aktif menerima", async () => {
  const store = createWhatsappLogStore(() => fakeStorage());
  const c = cfg();
  c.recipients[1].active = false;
  const r = await sendMockWhatsappAlert(c, alert, { delayMs: 1, record: store.record });
  assert.equal(r.sentCount, 1);
  assert.equal(store.read().length, 1);
});

test("gagal: tanpa nomor aktif, URL invalid, tanpa token; tidak mencatat", async () => {
  const store = createWhatsappLogStore(() => fakeStorage());
  const opt = { delayMs: 1, record: store.record };
  const none = cfg({ recipients: cfg().recipients.map((r) => ({ ...r, active: false })) });
  assert.deepEqual(await sendMockWhatsappAlert(none, alert, opt), {
    ok: false,
    error: "Tidak ada nomor penerima aktif.",
  });
  assert.equal((await sendMockWhatsappAlert(cfg({ gatewayUrl: "bukan url" }), alert, opt)).ok, false);
  assert.equal((await sendMockWhatsappAlert(cfg({ gatewayUrl: "ftp://x.id" }), alert, opt)).ok, false);
  assert.equal((await sendMockWhatsappAlert(cfg({ apiKey: " " }), alert, opt)).ok, false);
  assert.equal(store.read().length, 0);
});

test("persistensi: record lalu load menggabungkan dengan mock", () => {
  const storage = fakeStorage();
  const a = createWhatsappLogStore(() => storage);
  const now = Math.floor(Date.now() / 1000) + 5;
  const base = a.load(now).length;
  const e = a.record({
    recipientName: "X",
    recipientPhone: "6281234567890",
    alertId: "alert-uji",
    severity: "warning",
    kind: "k",
    message: "m",
    status: "delivered",
    latencyMs: 400,
  });
  assert.match(e.id, /^wa-log-test-\d+/);
  // instans baru dengan storage sama melihat log yang tersimpan
  const b = createWhatsappLogStore(() => storage);
  const loaded = b.load(now);
  assert.equal(loaded.length, base + 1);
  assert.equal(loaded[0].id, e.id);
});

test("storage terblokir: jatuh ke memori", () => {
  const s = createWhatsappLogStore(() => {
    throw new Error("blocked");
  });
  const e = s.record({
    recipientName: "X",
    recipientPhone: "6281234567890",
    alertId: "a",
    severity: "critical",
    kind: "k",
    message: "m",
    status: "sent",
    latencyMs: 1,
  });
  assert.equal(s.read()[0].id, e.id);
});
