import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  alertTicketPriorityLabels,
  alertTicketStatusLabels,
  clearTicketResponses,
  createTicketResponseRecord,
  getLatestTicketResponse,
  getTicketResponses,
  saveTicketResponse,
  validateTicketActionInput,
} from "../src/lib/dashboard/alert-ticket-actions.ts";

const base = {
  alertId: "a1",
  operator: "Budi",
  status: "in_progress",
  priority: "high",
  notes: "Cek kabel fiber",
};

class MemStorage {
  m = new Map();
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}

beforeEach(() => {
  delete globalThis.localStorage;
  clearTicketResponses();
});

test("validasi: input valid lolos", () => {
  assert.deepEqual(validateTicketActionInput(base), { valid: true, errors: [] });
  assert.equal(
    validateTicketActionInput({ ...base, dispatchTechnician: true, technicianName: "Joko" }).valid,
    true,
  );
});

test("validasi: tolak notes pendek, alertId/operator kosong, teknisi kosong", () => {
  assert.equal(validateTicketActionInput({ ...base, notes: " ab " }).valid, false);
  assert.equal(validateTicketActionInput({ ...base, alertId: "" }).valid, false);
  assert.equal(validateTicketActionInput({ ...base, operator: "  " }).valid, false);
  const r = validateTicketActionInput({ ...base, dispatchTechnician: true, technicianName: " J " });
  assert.equal(r.valid, false);
  assert.equal(r.errors.length, 1);
  // dispatch false: nama teknisi tidak diperlukan
  assert.equal(validateTicketActionInput({ ...base, dispatchTechnician: false }).valid, true);
});

test("createTicketResponseRecord: lengkap, id unik, ISO", () => {
  const a = createTicketResponseRecord({ ...base, dispatchTechnician: true, technicianName: " Joko " });
  const b = createTicketResponseRecord(base);
  assert.notEqual(a.id, b.id);
  assert.equal(new Date(a.respondedAt).toISOString(), a.respondedAt);
  assert.equal(a.technicianName, "Joko");
  assert.equal(a.dispatchTechnician, true);
  assert.equal(b.technicianName, undefined);
  assert.equal(createTicketResponseRecord(base, "2026-01-01T00:00:00.000Z").respondedAt, "2026-01-01T00:00:00.000Z");
});

test("storage memori: save, get by alertId, latest, clear", () => {
  saveTicketResponse(createTicketResponseRecord(base));
  saveTicketResponse(createTicketResponseRecord({ ...base, alertId: "a2" }));
  const last = createTicketResponseRecord({ ...base, status: "resolved" });
  saveTicketResponse(last);
  assert.equal(getTicketResponses().length, 3);
  assert.equal(getTicketResponses("a1").length, 2);
  assert.equal(getLatestTicketResponse("a1").id, last.id);
  assert.equal(getLatestTicketResponse("zzz"), null);
  clearTicketResponses();
  assert.equal(getTicketResponses().length, 0);
});

test("storage localStorage: tersimpan di key, data rusak diabaikan", () => {
  const ls = new MemStorage();
  globalThis.localStorage = ls;
  saveTicketResponse(createTicketResponseRecord(base));
  assert.equal(JSON.parse(ls.getItem("alert_ticket_responses")).length, 1);
  ls.setItem("alert_ticket_responses", "{bukan json");
  assert.doesNotThrow(() => getTicketResponses());
  ls.setItem("alert_ticket_responses", JSON.stringify([{ x: 1 }, createTicketResponseRecord(base)]));
  assert.equal(getTicketResponses().length, 1);
  delete globalThis.localStorage;
});

test("label status & prioritas", () => {
  assert.deepEqual(alertTicketStatusLabels, {
    open: "Terbuka", in_progress: "Sedang Ditangani", resolved: "Selesai", escalated: "Eskalasi",
  });
  assert.deepEqual(alertTicketPriorityLabels, {
    low: "Rendah", medium: "Sedang", high: "Tinggi", critical: "Kritis",
  });
});

test("komponen AlertTicketDialog diekspor dan memuat testid", () => {
  const src = readFileSync(new URL("../src/components/dashboard/alert-ticket-dialog.tsx", import.meta.url), "utf8");
  assert.match(src, /export function AlertTicketDialog/);
  assert.match(src, /"use client"/);
  assert.match(src, /data-testid="alert-ticket-dialog"/);
  const list = readFileSync(new URL("../src/components/dashboard/active-alert-list.tsx", import.meta.url), "utf8");
  assert.match(list, /ticket-status-chip/);
});
