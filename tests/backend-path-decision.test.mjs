import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";

const path = new URL("../docs/backend-path-decision.md", import.meta.url);
const doc = readFileSync(path, "utf8");

test("dokumen ada dan substansial", () => {
  assert.ok(statSync(path).size > 3500);
  assert.match(doc, /^# Keputusan Jalur Backend & Konsekuensi Arsitektur/);
  assert.match(doc, /Status:\*\* Accepted/);
  assert.match(doc, /2026-10-13/);
});

test("Opsi A tercakup", () => {
  for (const k of ["Opsi A", "Go", "goroutine", "NetFlow", "Syslog", "WebSocket hub", "ring buffer"]) {
    assert.ok(doc.includes(k), `hilang: ${k}`);
  }
});

test("Opsi B tercakup", () => {
  for (const k of ["Opsi B", "Next.js", "Better Auth", "Drizzle ORM", "CRUD", "/api/realtime/ticket"]) {
    assert.ok(doc.includes(k), `hilang: ${k}`);
  }
});

test("keputusan hibrida dan pembagian plane", () => {
  assert.match(doc, /Hibrida/);
  assert.match(doc, /Data Plane/);
  assert.match(doc, /Management Plane/);
  assert.match(doc, /REALTIME_TOKEN_SECRET/);
  assert.match(doc, /HMAC-SHA256/);
  assert.match(doc, /pemilik migrasi tunggal/);
});

test("matriks komparasi lengkap", () => {
  assert.match(doc, /## Matriks Komparasi/);
  for (const k of ["Throughput", "Latensi", "RAM", "CPU", "Operasional", "Protokol UDP"]) {
    assert.ok(doc.includes(`| ${k}`), `baris hilang: ${k}`);
  }
});

test("konsekuensi deployment, konkurensi, dan ADR-0001", () => {
  assert.match(doc, /Konkurensi/);
  assert.match(doc, /Docker dual-container/);
  assert.match(doc, /Zero Secret Leak/);
  assert.match(doc, /ADR-0001/);
  assert.match(doc, /adr\/0001-stack-decision\.md/);
});
