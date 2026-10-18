import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";

process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:5432/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3101";

const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

register();

const schema = await import("../src/db/schema/network-infrastructure.ts");
const schemaIndex = await import("../src/db/schema/index.ts");
const infraService = await import("../src/services/map-infrastructure.service.ts");

test("Skema dan Migrasi Tabel Infrastruktur Peta Jaringan", async (t) => {
  await t.test("Drizzle Schema: Tabel networkInfrastructure dan networkCables terdefinisi lengkap", () => {
    assert.ok(schema.networkInfrastructure, "Tabel networkInfrastructure harus diekspor");
    assert.ok(schema.networkCables, "Tabel networkCables harus diekspor");

    // Re-export di index.ts
    assert.ok(schemaIndex.networkInfrastructure, "Tabel networkInfrastructure harus diekspor di index.ts");
    assert.ok(schemaIndex.networkCables, "Tabel networkCables harus diekspor di index.ts");

    // Periksa kolom utama networkInfrastructure
    const infraCols = Object.keys(schema.networkInfrastructure);
    assert.ok(infraCols.includes("id"));
    assert.ok(infraCols.includes("name"));
    assert.ok(infraCols.includes("type"));
    assert.ok(infraCols.includes("status"));
    assert.ok(infraCols.includes("latitude"));
    assert.ok(infraCols.includes("longitude"));
    assert.ok(infraCols.includes("parentId"));
    assert.ok(infraCols.includes("capacity"));
    assert.ok(infraCols.includes("details"));

    // Periksa kolom utama networkCables
    const cableCols = Object.keys(schema.networkCables);
    assert.ok(cableCols.includes("id"));
    assert.ok(cableCols.includes("name"));
    assert.ok(cableCols.includes("sourceId"));
    assert.ok(cableCols.includes("targetId"));
    assert.ok(cableCols.includes("cableType"));
    assert.ok(cableCols.includes("coreCapacity"));
    assert.ok(cableCols.includes("color"));
    assert.ok(cableCols.includes("polyline"));
  });

  await t.test("File Migrasi SQL: 0025_network_infrastructure.sql memuat DDL valid dan lengkap", () => {
    const migrationFile = path.resolve("drizzle/0025_network_infrastructure.sql");
    assert.ok(fs.existsSync(migrationFile), "Berkas migrasi SQL harus ada di direktori drizzle/");

    const sqlContent = fs.readFileSync(migrationFile, "utf-8");

    // Validasi pembuatan tabel
    assert.match(sqlContent, /CREATE TABLE IF NOT EXISTS "network_infrastructure"/);
    assert.match(sqlContent, /CREATE TABLE IF NOT EXISTS "network_cables"/);

    // Validasi batasan CHECK
    assert.match(sqlContent, /"type" in \('router', 'olt', 'odp', 'odc', 'pole', 'server'\)/);
    assert.match(sqlContent, /"status" in \('active', 'inactive', 'maintenance'\)/);
    assert.match(sqlContent, /"latitude" between -90 and 90/);
    assert.match(sqlContent, /"longitude" between -180 and 180/);

    // Validasi indeks
    assert.match(sqlContent, /CREATE INDEX IF NOT EXISTS "network_infra_type_idx"/);
    assert.match(sqlContent, /CREATE INDEX IF NOT EXISTS "network_infra_status_idx"/);
    assert.match(sqlContent, /CREATE INDEX IF NOT EXISTS "network_infra_parent_idx"/);
    assert.match(sqlContent, /CREATE INDEX IF NOT EXISTS "network_cables_source_idx"/);
    assert.match(sqlContent, /CREATE INDEX IF NOT EXISTS "network_cables_target_idx"/);
  });

  await t.test("Drizzle Journal: _journal.json mencatat migrasi 0025_network_infrastructure", () => {
    const journalFile = path.resolve("drizzle/meta/_journal.json");
    assert.ok(fs.existsSync(journalFile));

    const journal = JSON.parse(fs.readFileSync(journalFile, "utf-8"));
    const entry = journal.entries.find((e) => e.tag === "0025_network_infrastructure");

    assert.ok(entry, "Entry 0025_network_infrastructure harus tercatat di journal migrasi Drizzle");
    assert.equal(typeof entry.idx, "number");
  });

  await t.test("Service Infrastruktur: Terhubung ke database dan fungsi operasi tersedia", async () => {
    assert.equal(typeof infraService.createInfrastructurePoint, "function");
    assert.equal(typeof infraService.updateInfrastructureLocation, "function");
    assert.equal(typeof infraService.deleteInfrastructurePoint, "function");
    assert.equal(typeof infraService.getNetworkInfrastructureList, "function");

    // Uji pembuatan objek perangkat
    const created = await infraService.createInfrastructurePoint({
      name: "ODP-TTJ-TEST-01",
      type: "odp",
      latitude: -2.5788,
      longitude: 101.2189,
      details: { capacity: 16 },
    });

    assert.ok(created);
    assert.equal(created.name, "ODP-TTJ-TEST-01");
    assert.equal(created.type, "odp");
    assert.equal(created.latitude, -2.5788);
    assert.equal(created.longitude, 101.2189);
  });
});
