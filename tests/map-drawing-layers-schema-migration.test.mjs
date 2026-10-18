import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("Tabel Anotasi Lapisan Peta & Migrasi Database Drizzle (Map Drawing Layers Schema & Migration)", async (t) => {
  const schemaFile = path.resolve("src/db/schema/map-drawing-layers.ts");
  const schemaIndexFile = path.resolve("src/db/schema/index.ts");
  const migrationSqlFile = path.resolve("drizzle/0027_map_drawing_layers.sql");
  const journalFile = path.resolve("drizzle/meta/_journal.json");

  assert.equal(fs.existsSync(schemaFile), true, "File map-drawing-layers.ts harus ada");
  assert.equal(fs.existsSync(schemaIndexFile), true, "File src/db/schema/index.ts harus ada");
  assert.equal(fs.existsSync(migrationSqlFile), true, "File 0027_map_drawing_layers.sql harus ada");
  assert.equal(fs.existsSync(journalFile), true, "File _journal.json harus ada");

  const schemaContent = fs.readFileSync(schemaFile, "utf-8");
  const schemaIndexContent = fs.readFileSync(schemaIndexFile, "utf-8");
  const migrationSql = fs.readFileSync(migrationSqlFile, "utf-8");
  const journalJson = JSON.parse(fs.readFileSync(journalFile, "utf-8"));

  await t.test("1. Skema Drizzle mendefinisikan tabel map_drawing_layers beserta field penting", () => {
    assert.match(schemaContent, /export const mapDrawingLayers = pgTable\(\s*"map_drawing_layers"/);
    assert.match(schemaContent, /id:\s*text\("id"\)\.primaryKey\(\)/);
    assert.match(schemaContent, /name:\s*text\("name"\)\.notNull\(\)/);
    assert.match(schemaContent, /opacity:\s*numeric\("opacity"/);
    assert.match(schemaContent, /zIndex:\s*integer\("z_index"\)/);
    assert.match(schemaContent, /isVisible:\s*boolean\("is_visible"\)/);
    assert.match(schemaContent, /shapes:\s*jsonb\("shapes"\)/);
    assert.match(schemaContent, /createdBy:\s*text\("created_by"\)/);
    assert.match(schemaContent, /createdAt:\s*timestamp\("created_at"/);
    assert.match(schemaContent, /updatedAt:\s*timestamp\("updated_at"/);
  });

  await t.test("2. Skema mendefinisikan tipe bentuk gambar geometris dan koordinat geografis", () => {
    assert.match(schemaContent, /export type DrawingShapeType\s*=\s*\| "rectangle"/);
    assert.match(schemaContent, /"circle"/);
    assert.match(schemaContent, /"arrow"/);
    assert.match(schemaContent, /"line"/);
    assert.match(schemaContent, /"text"/);
    assert.match(schemaContent, /"polygon"/);
    assert.match(schemaContent, /geoCoordinates\?:/);
    assert.match(schemaContent, /geoRadius\?:/);
  });

  await t.test("3. Skema mendefinisikan indeks untuk performa query visibilitas dan urutan zIndex", () => {
    assert.match(schemaContent, /index\("map_drawing_layers_visible_idx"\)\.on\(table\.isVisible\)/);
    assert.match(schemaContent, /index\("map_drawing_layers_z_index_idx"\)\.on\(table\.zIndex\)/);
  });

  await t.test("4. src/db/schema/index.ts mengekspor map-drawing-layers", () => {
    assert.match(schemaIndexContent, /export \* from "\.\/map-drawing-layers";/);
  });

  await t.test("5. Berkas migrasi 0027_map_drawing_layers.sql memuat DDL valid", () => {
    assert.match(migrationSql, /CREATE TABLE IF NOT EXISTS "map_drawing_layers"/);
    assert.match(migrationSql, /"id" text PRIMARY KEY/);
    assert.match(migrationSql, /"name" text NOT NULL/);
    assert.match(migrationSql, /"opacity" numeric\(3, 2\)/);
    assert.match(migrationSql, /"z_index" integer/);
    assert.match(migrationSql, /"is_visible" boolean/);
    assert.match(migrationSql, /"shapes" jsonb/);
    assert.match(migrationSql, /CREATE INDEX IF NOT EXISTS "map_drawing_layers_visible_idx"/);
    assert.match(migrationSql, /CREATE INDEX IF NOT EXISTS "map_drawing_layers_z_index_idx"/);
  });

  await t.test("6. Journal Drizzle memuat entri migrasi 0027_map_drawing_layers", () => {
    const entry = journalJson.entries.find((e) => e.tag === "0027_map_drawing_layers");
    assert.ok(entry, "Entri 0027_map_drawing_layers harus terdaftar di _journal.json");
    assert.equal(entry.idx, 27, "Index entri harus 27");
  });
});
