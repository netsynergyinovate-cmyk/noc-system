import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { test } from "node:test";

const guidePath = new URL("../docs/device-env-guide.md", import.meta.url);
const examplePath = new URL("../.env.server.example", import.meta.url);
const guide = readFileSync(guidePath, "utf8");
const example = readFileSync(examplePath, "utf8");

const exampleKeys = [...example.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map(
  (m) => m[1],
);

test("guide exists and is substantial", () => {
  assert.ok(statSync(guidePath).size > 4000);
  assert.match(guide, /^# Panduan Konfigurasi Variabel Environment/m);
  assert.match(guide, /## 1\. Prinsip Keamanan/);
  assert.match(guide, /## 3\. Checklist Verifikasi Pra-Deploy/);
});

test("example parsed at least the expected keys", () => {
  assert.ok(exampleKeys.length >= 40);
});

test("every variable in .env.server.example is documented", () => {
  const missing = exampleKeys.filter(
    (k) => !new RegExp(`\`${k}\``).test(guide),
  );
  assert.deepEqual(missing, []);
});

test("all five components are covered with technical detail", () => {
  const checks = [
    [/### 2\.1 MikroTik RouterOS v7/, /rest-api/, /www-ssl/],
    [/### 2\.2 OLT HSGQ/, /redaman optik/, /Polling interval/],
    [/### 2\.3 GenieACS NBI/, /7557/, /TR-181/],
    [/### 2\.4 Portal Billing/, /CSRF/, /50%/],
    [/### 2\.5 Realtime Engine/, /ALLOWED_ORIGINS/, /NetFlow/],
  ];
  for (const patterns of checks)
    for (const p of patterns) assert.match(guide, p);
});

test("guide contains no real-looking secrets", () => {
  assert.doesNotMatch(guide, /postgres(ql)?:\/\/[^<\s]+:[^<\s]+@/);
  assert.doesNotMatch(guide, /\b[0-9a-f]{32,}\b/i);
  assert.doesNotMatch(guide, /\b(ngpk_|sk-|ghp_|AKIA)[A-Za-z0-9]{8,}/);
  assert.doesNotMatch(guide, /Bearer\s+[A-Za-z0-9._-]{16,}/);
  // no KEY=value assignment of a secret in the guide
  assert.doesNotMatch(
    guide,
    /^(\w*(SECRET|PASSWORD|PASS|TOKEN)\w*)=\S+/m,
  );
});

test(".env.server.example itself keeps placeholders only", () => {
  for (const line of example.split(/\r?\n/)) {
    const m = line.match(/^(\w*(SECRET|PASSWORD|PASS|TOKEN)\w*)=(.*)$/);
    if (m) assert.match(m[3], /^<.+>$/, `${m[1]} must be a placeholder`);
  }
});
