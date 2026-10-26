import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const {
  MOCK_SCHEMA_MIGRATIONS,
  SCHEMA_MIGRATION_MOCK_ENTRY,
  MIGRATION_ADVISORY_LOCK_KEY,
  MIGRATION_TRACKER_TABLE,
  MOCK_FAILED_MIGRATION_SAMPLE,
  getMockSchemaMigrations,
  getMockMigrationOverview,
  filterSchemaMigrations,
} = await import("../src/lib/dashboard/schema-migrations.ts");

const { SETUP_DATA_SOURCE_REGISTRY } = await import(
  "../src/lib/dashboard/setup-extended.ts"
);

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("SCHEMA_MIGRATION_MOCK_ENTRY terdaftar di SETUP_DATA_SOURCE_REGISTRY", () => {
  assert.equal(SCHEMA_MIGRATION_MOCK_ENTRY.id, "schema-migrations-history");
  assert.equal(SCHEMA_MIGRATION_MOCK_ENTRY.status, "dummy");
  assert.equal(SCHEMA_MIGRATION_MOCK_ENTRY.envKey, "DATABASE_URL");
  assert.match(SCHEMA_MIGRATION_MOCK_ENTRY.notes, /Fase 5/);

  const found = SETUP_DATA_SOURCE_REGISTRY.find(
    (e) => e.id === "schema-migrations-history",
  );
  assert.ok(found, "Entry harus ditemukan di SETUP_DATA_SOURCE_REGISTRY");
  assert.deepEqual(found, SCHEMA_MIGRATION_MOCK_ENTRY);
});

test("MOCK_SCHEMA_MIGRATIONS memuat 15 migrasi lengkap sesuai jurnal Drizzle", () => {
  const migrations = getMockSchemaMigrations();
  assert.equal(migrations.length, 15);

  // Pastikan urutan idx 0..14 terurut
  for (let i = 0; i < migrations.length; i++) {
    const m = migrations[i];
    assert.equal(m.idx, i);
    assert.ok(m.tag.startsWith(String(i).padStart(4, "0")));
    assert.ok(m.folderMillis > 0);
    assert.equal(m.status, "applied");
    assert.ok(m.statementsCount > 0);
    assert.ok(m.durationMs > 0);
    assert.match(m.hash, /^[0-9a-f]{64}$/);
    assert.ok(m.statementsSummary.length > 0);
  }
});

test("getMockMigrationOverview menghitung agregat dengan benar dan idempoten", () => {
  const overview = getMockMigrationOverview();
  assert.equal(overview.totalMigrations, 15);
  assert.equal(overview.appliedMigrations, 15);
  assert.equal(overview.pendingMigrations, 0);
  assert.equal(overview.failedMigrations, 0);
  assert.equal(overview.isUpToDate, true);
  assert.equal(overview.advisoryLockKey, MIGRATION_ADVISORY_LOCK_KEY);
  assert.equal(overview.advisoryLockKey, "727274001");
  assert.equal(overview.trackerTable, MIGRATION_TRACKER_TABLE);
  assert.equal(overview.timescaleStatus, "active");
  assert.equal(overview.timescaleRetentionDays, 30);
  assert.ok(overview.lastAppliedAt);
});

test("filterSchemaMigrations memfilter status dan query teks", () => {
  const all = getMockSchemaMigrations();

  // Filter status
  const appliedOnly = filterSchemaMigrations(all, {
    status: "applied",
    query: "",
  });
  assert.equal(appliedOnly.length, 15);

  const pendingOnly = filterSchemaMigrations(all, {
    status: "pending",
    query: "",
  });
  assert.equal(pendingOnly.length, 0);

  // Filter query teks tag
  const authSearch = filterSchemaMigrations(all, {
    status: "all",
    query: "0000_auth",
  });
  assert.equal(authSearch.length, 1);
  assert.equal(authSearch[0].idx, 0);

  // Filter query nama/deskripsi
  const timescaledbSearch = filterSchemaMigrations(all, {
    status: "all",
    query: "traffic_archive",
  });
  assert.equal(timescaledbSearch.length, 1);
  assert.equal(timescaledbSearch[0].idx, 4);

  // Filter query tidak ada
  const emptySearch = filterSchemaMigrations(all, {
    status: "all",
    query: "xyznonexistent",
  });
  assert.equal(emptySearch.length, 0);
});

test("MOCK_FAILED_MIGRATION_SAMPLE memuat atribut galat dan terhitung di overview", () => {
  assert.equal(MOCK_FAILED_MIGRATION_SAMPLE.status, "failed");
  assert.ok(MOCK_FAILED_MIGRATION_SAMPLE.errorMessage);
  assert.ok(MOCK_FAILED_MIGRATION_SAMPLE.failedStatement);
  assert.ok(MOCK_FAILED_MIGRATION_SAMPLE.remediationHint);
  assert.equal(MOCK_FAILED_MIGRATION_SAMPLE.rollbackExecuted, true);

  const failedList = getMockSchemaMigrations(true);
  assert.equal(failedList.length, 16);

  const overviewFailed = getMockMigrationOverview(failedList);
  assert.equal(overviewFailed.failedMigrations, 1);
  assert.equal(overviewFailed.isUpToDate, false);
  assert.equal(overviewFailed.status, "failed");
  assert.ok(overviewFailed.lastFailure);
  assert.equal(overviewFailed.lastFailure.tag, "0015_broken_constraint");
  assert.match(overviewFailed.lastFailure.error, /Violates unique constraint/);
  assert.ok(overviewFailed.lastFailure.remediationHint);

  const failedOnly = filterSchemaMigrations(failedList, {
    status: "failed",
    query: "",
  });
  assert.equal(failedOnly.length, 1);
  assert.equal(failedOnly[0].tag, "0015_broken_constraint");

  const searchError = filterSchemaMigrations(failedList, {
    status: "all",
    query: "unique constraint",
  });
  assert.equal(searchError.length, 1);
  assert.equal(searchError[0].tag, "0015_broken_constraint");
});

test("Komponen SchemaMigrationsBoard dan halaman terpasang dengan baik", () => {
  const boardSrc = read("../src/components/dashboard/schema-migrations-board.tsx");
  assert.match(boardSrc, /data-testid="schema-migrations-board"/);
  assert.match(boardSrc, /data-testid="migration-row"/);
  assert.match(boardSrc, /data-testid="migration-status-failed"/);
  assert.match(boardSrc, /data-testid="migration-status-ok"/);
  assert.match(boardSrc, /data-testid="migration-failure-alert"/);
  assert.match(boardSrc, /data-testid="view-failure-detail-btn"/);
  assert.match(boardSrc, /data-testid="migration-dialog-error-section"/);
  assert.match(boardSrc, /data-testid="copy-error-btn"/);
  assert.match(boardSrc, /Kunci #/);
  assert.match(boardSrc, /Prinsip Idempotensi/);
});
