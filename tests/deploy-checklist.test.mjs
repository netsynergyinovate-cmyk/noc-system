import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { test } from "node:test";

const docPath = new URL("../docs/deploy-checklist.md", import.meta.url);
const routePath = new URL("../src/app/api/health/route.ts", import.meta.url);
const doc = readFileSync(docPath, "utf8");

test("checklist ada dan substansial", () => {
  assert.ok(statSync(docPath).size > 3500);
  assert.match(doc, /^# Checklist Deploy Server NOC ISP Berurutan/);
});

test("6 fase tercakup dan berurutan", () => {
  const heads = [...doc.matchAll(/^## Fase (\d): /gm)].map((m) => Number(m[1]));
  assert.deepEqual(heads, [1, 2, 3, 4, 5, 6]);
  for (const t of [
    "Pre-flight",
    "Persiapan Database",
    "Build & Verifikasi Image",
    "Orkestrasi",
    "Smoke Tests",
    "Rollback",
  ]) {
    assert.ok(doc.includes(t), t);
  }
});

test("perintah CLI resmi ada di package.json dan di checklist", () => {
  const scripts = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ).scripts;
  for (const c of ["db:migrate:server", "db:migrate:status", "db:timescale"]) {
    assert.ok(scripts[c], `script ${c} tidak ada`);
    assert.ok(doc.includes(`npm run ${c}`), c);
  }
});

test("urutan perintah database benar", () => {
  const at = (s) => doc.indexOf(`npm run ${s}`);
  assert.ok(at("db:migrate:status") < at("db:migrate:server"));
  assert.ok(at("db:migrate:server") < at("db:timescale"));
});

test("healthcheck, urutan startup dan rollback terdokumentasi", () => {
  for (const t of [
    "/api/health",
    "/healthz",
    "DB -> Go Daemon -> Next.js Web -> Reverse Proxy",
    "pg_restore",
    "pg_dump",
    "non-root",
    ".env.server.example",
  ]) {
    assert.ok(doc.includes(t), t);
  }
});

test("endpoint /api/health merespons JSON status ok", async () => {
  const src = readFileSync(routePath, "utf8");
  assert.match(src, /export function GET/);
  assert.match(src, /status:\s*"ok"/);
  assert.match(src, /timestamp/);
  const { default: ts } = await import("typescript");
  const js = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const mod = await import(
    `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`
  );
  const res = mod.GET();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "ok");
  assert.ok(!Number.isNaN(Date.parse(body.timestamp)));
});
