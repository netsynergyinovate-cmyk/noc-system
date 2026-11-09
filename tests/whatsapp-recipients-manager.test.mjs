import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  addRecipient,
  defaultWhatsappConfig,
  normalizeRecipientPhone,
  removeRecipient,
  toggleRecipient,
} from "../src/lib/dashboard/whatsapp.ts";
import { createWhatsappRegistry } from "../src/lib/dashboard/whatsapp-registry.ts";

const base = defaultWhatsappConfig.recipients.map((r) => ({ ...r }));
const memStore = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
  };
};

test("addRecipient: personal dinormalisasi, grup valid, id unik", () => {
  const p = addRecipient(base, { name: " Budi ", phone: "0812-9999 8888", type: "personal" });
  assert.ok(p.ok);
  assert.equal(p.recipient.phone, "6281299998888");
  assert.equal(p.recipient.name, "Budi");
  assert.equal(p.recipient.active, true);
  assert.equal(p.list.length, base.length + 1);
  const g = addRecipient(p.list, { name: "Grup", phone: "120363012345678901@g.us", type: "group" });
  assert.ok(g.ok);
  assert.equal(new Set(g.list.map((r) => r.id)).size, g.list.length);
});

test("addRecipient: tolak nama kosong, nomor/ID tidak valid, duplikat", () => {
  assert.equal(addRecipient(base, { name: " ", phone: "081234567891", type: "personal" }).ok, false);
  assert.equal(addRecipient(base, { name: "A", phone: "123", type: "personal" }).ok, false);
  assert.equal(addRecipient(base, { name: "A", phone: "abc", type: "group" }).ok, false);
  assert.equal(addRecipient(base, { name: "A", phone: "081234567890", type: "personal" }).ok, false);
  assert.equal(normalizeRecipientPhone("120363012345678901@g.us", "group"), "120363012345678901@g.us");
  assert.equal(normalizeRecipientPhone("grup-abc", "group"), "");
});

test("toggleRecipient & removeRecipient murni", () => {
  const t = toggleRecipient(base, "rcp-1");
  assert.equal(t.find((r) => r.id === "rcp-1").active, false);
  assert.equal(base.find((r) => r.id === "rcp-1").active, true);
  const rm = removeRecipient(base, "rcp-1");
  assert.equal(rm.length, base.length - 1);
  assert.equal(removeRecipient(base, "nope").length, base.length);
});

test("registry: persistensi dan sinkronisasi antar instance", () => {
  const s = memStore();
  const a = createWhatsappRegistry(() => s);
  const b = createWhatsappRegistry(() => s);
  let notified = 0;
  a.subscribe(() => notified++);
  const added = addRecipient(a.get().recipients, { name: "Baru", phone: "081311112222", type: "personal" });
  assert.ok(added.ok);
  a.save({ ...a.get(), recipients: added.list });
  assert.equal(notified, 1);
  assert.ok(b.get().recipients.some((r) => r.phone === "6281311112222"));
  b.save({ ...b.get(), recipients: removeRecipient(b.get().recipients, added.recipient.id) });
  assert.ok(!a.get().recipients.some((r) => r.phone === "6281311112222"));
});

test("registry: loadWhatsappConfig diekspor", () => {
  const src = readFileSync("src/lib/dashboard/whatsapp-registry.ts", "utf8");
  assert.match(src, /export const loadWhatsappConfig/);
  assert.match(src, /export const saveWhatsappConfig/);
});

test("halaman dan komponen: ekspor, metadata, penanda, tautan", () => {
  const page = readFileSync("src/app/(protected)/app/alert/whatsapp/penerima/page.tsx", "utf8");
  assert.match(page, /export const metadata: Metadata = \{ title: "Kelola Penerima WhatsApp" \}/);
  assert.match(page, /export default async function/);
  assert.match(page, /await requireSession\(\)/);
  assert.match(page, /<WhatsappRecipientsManager \/>/);
  assert.match(page, /href="\/app\/alert\/whatsapp"/);
  assert.match(page, /href="\/app\/alert"/);

  const comp = readFileSync("src/components/dashboard/whatsapp-recipients-manager.tsx", "utf8");
  assert.match(comp, /^"use client"/);
  assert.match(comp, /export function WhatsappRecipientsManager/);
  assert.match(comp, /data-testid="whatsapp-recipients-manager"/);
  assert.match(comp, /data-testid="wa-recipients-mock-badge"/);
  assert.match(comp, /loadWhatsappConfig/);
  assert.match(comp, /saveWhatsappConfig/);

  const log = readFileSync("src/app/(protected)/app/alert/whatsapp/page.tsx", "utf8");
  assert.match(log, /href="\/app\/alert\/whatsapp\/penerima"/);
  const settings = readFileSync("src/components/dashboard/whatsapp-settings.tsx", "utf8");
  assert.match(settings, /href="\/app\/alert\/whatsapp\/penerima"/);
});
