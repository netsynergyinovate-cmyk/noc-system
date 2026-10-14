import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";

process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:5432/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3101";

const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

register();

const routeExport = await import("../src/app/api/export/route.ts");
const routeReports = await import("../src/app/api/reports/route.ts");
const { generateRealExportData } = await import("../src/services/export.service.ts");

const NOW = Date.UTC(2026, 5, 15, 12, 0, 0) / 1000;

test("GET /api/export: 401 untuk anonim", async () => {
  const req = new Request("http://localhost:3000/api/export");
  const res = await routeExport.GET(req);
  assert.equal(res.status, 401);
});

test("POST /api/export: 401 untuk anonim", async () => {
  const req = new Request("http://localhost:3000/api/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataset: "customers", format: "json" }),
  });
  const res = await routeExport.POST(req);
  assert.equal(res.status, 401);
});

test("GET /api/reports: 401 untuk anonim", async () => {
  const req = new Request("http://localhost:3000/api/reports");
  const res = await routeReports.GET(req);
  assert.equal(res.status, 401);
});

test("generateRealExportData: mampu menghasilkan laporan CSV dan JSON", async () => {
  const datasets = [
    "alerts-history",
    "anomalies",
    "customers",
    "billing",
    "audit-log",
  ];

  for (const ds of datasets) {
    const csv = await generateRealExportData(ds, "csv", "7d", NOW);
    assert.ok(csv.filename.endsWith(".csv"), `${ds} filename .csv`);
    assert.match(csv.mimeType, /text\/csv/);
    assert.ok(typeof csv.content === "string");
    assert.ok(csv.rowCount >= 0);

    const json = await generateRealExportData(ds, "json", "7d", NOW);
    assert.ok(json.filename.endsWith(".json"), `${ds} filename .json`);
    assert.equal(json.mimeType, "application/json");
    assert.doesNotThrow(() => JSON.parse(json.content), `${ds} json valid`);
  }
});

test("generateRealExportData: rentang waktu mempengaruhi hasil dataset berbasis waktu", async () => {
  const res24h = await generateRealExportData("alerts-history", "csv", "24h", NOW);
  const res7d = await generateRealExportData("alerts-history", "csv", "7d", NOW);
  assert.ok(res24h.rowCount <= res7d.rowCount);
});
