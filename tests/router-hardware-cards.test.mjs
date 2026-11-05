import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  getCpuStatus,
  getMemoryStatus,
  getThermalStatus,
  getUptimeStatus,
} from "../src/lib/dashboard/router-resources.ts";

const cardsSrc = readFileSync("src/components/dashboard/router-hardware-cards.tsx", "utf8");
const tableSrc = readFileSync("src/components/dashboard/router-table.tsx", "utf8");
const boardSrc = readFileSync("src/components/dashboard/router-test-board.tsx", "utf8");

test("getCpuStatus: normal, tinggi, kritis, offline", () => {
  assert.deepEqual(getCpuStatus(40), { tone: "success", label: "Normal", isWarning: false });
  assert.deepEqual(getCpuStatus(80), { tone: "success", label: "Normal", isWarning: false });
  assert.deepEqual(getCpuStatus(81), { tone: "warning", label: "Beban tinggi (>80%)", isWarning: true });
  assert.deepEqual(getCpuStatus(95), { tone: "warning", label: "Beban tinggi (>80%)", isWarning: true });
  assert.deepEqual(getCpuStatus(96), { tone: "destructive", label: "Kritis (>95%)", isWarning: true });
  assert.deepEqual(getCpuStatus(99, false), { tone: "muted", label: "Offline", isWarning: false });
});

test("getMemoryStatus: normal, hampir penuh, offline", () => {
  assert.deepEqual(getMemoryStatus(50), { tone: "success", label: "Tersedia" });
  assert.deepEqual(getMemoryStatus(85), { tone: "success", label: "Tersedia" });
  assert.deepEqual(getMemoryStatus(86), { tone: "warning", label: "Hampir penuh" });
  assert.deepEqual(getMemoryStatus(90, false), { tone: "muted", label: "Offline" });
});

test("getUptimeStatus", () => {
  assert.equal(getUptimeStatus("3d 4h").tone, "success");
  assert.equal(getUptimeStatus("3d 4h", false).tone, "muted");
});

test("getThermalStatus: normal, hangat, kritis, tanpa sensor", () => {
  assert.deepEqual(getThermalStatus(42), { tone: "success", label: "Normal" });
  assert.deepEqual(getThermalStatus(50), { tone: "warning", label: "Hangat" });
  assert.deepEqual(getThermalStatus(64), { tone: "warning", label: "Hangat" });
  assert.deepEqual(getThermalStatus(65), { tone: "destructive", label: "Panas kritis" });
  assert.deepEqual(getThermalStatus(0), { tone: "muted", label: "Sensor tidak tersedia" });
  assert.deepEqual(getThermalStatus(undefined), { tone: "muted", label: "Sensor tidak tersedia" });
  assert.equal(getThermalStatus(70, false).tone, "muted");
});

test("komponen RouterHardwareCards: 4 kartu, progressbar, a11y", () => {
  assert.match(cardsSrc, /^"use client";/);
  assert.match(cardsSrc, /export function RouterHardwareCards/);
  assert.match(cardsSrc, /export interface RouterHardwareCardsProps/);
  for (const t of ["Penggunaan CPU", "Penggunaan RAM", "Uptime Sistem", "Suhu & Hardware"]) {
    assert.ok(cardsSrc.includes(t), t);
  }
  for (const id of ["hw-card-cpu", "hw-card-ram", "hw-card-uptime", "hw-card-thermal"]) {
    assert.ok(cardsSrc.includes(id), id);
  }
  assert.equal((cardsSrc.match(/<Bar /g) ?? []).length, 2);
  assert.match(cardsSrc, /role="progressbar"/);
  assert.match(cardsSrc, /aria-valuenow=/);
  assert.match(cardsSrc, /aria-valuemin=\{0\}/);
  assert.match(cardsSrc, /aria-valuemax=\{100\}/);
  assert.match(cardsSrc, /aria-hidden="true"/);
  assert.match(cardsSrc, /Sejak boot\/reboot terakhir/);
  assert.ok(cardsSrc.includes('cpuAvailable ? `${cpuLoad}%` : "—"'), "CPU null harus tampil —");
  assert.ok(cardsSrc.includes('active && uptime ? uptime : "—"'), "uptime kosong harus tampil —");
  assert.doesNotMatch(cardsSrc, /cpuLoad: number;/); // harus number | null
});

test("router-table dan router-test-board memakai RouterHardwareCards", () => {
  assert.match(tableSrc, /import \{ RouterHardwareCards \}/);
  assert.match(tableSrc, /<RouterHardwareCards[\s\S]*?cpuLoad=\{selectedRouter\.cpuLoad\}/);
  assert.match(tableSrc, /active=\{selectedRouter\.active\}/);
  assert.match(boardSrc, /import \{ RouterHardwareCards \}/);
  assert.match(boardSrc, /<RouterHardwareCards[\s\S]*?cpuLoad=\{resource\.cpuPct\}/);
});
