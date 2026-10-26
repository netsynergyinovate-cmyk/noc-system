import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const {
  DATA_SYNC_MOCK_ENTRY,
  getMockDataSyncModules,
  getMockDataSyncOverview,
  filterDataSyncModules,
} = await import("../src/lib/dashboard/data-sync.ts");

const { SETUP_DATA_SOURCE_REGISTRY } = await import(
  "../src/lib/dashboard/setup-extended.ts"
);

test("DATA_SYNC_MOCK_ENTRY terdaftar di SETUP_DATA_SOURCE_REGISTRY (Fase 4 dummy)", () => {
  assert.equal(DATA_SYNC_MOCK_ENTRY.id, "data-sync-status");
  assert.equal(DATA_SYNC_MOCK_ENTRY.status, "dummy");
  assert.equal(DATA_SYNC_MOCK_ENTRY.envKey, "DATABASE_URL");
  assert.match(DATA_SYNC_MOCK_ENTRY.notes, /Fase 5/);

  const found = SETUP_DATA_SOURCE_REGISTRY.find(
    (e) => e.id === "data-sync-status",
  );
  assert.ok(found, "Entry harus ditemukan di SETUP_DATA_SOURCE_REGISTRY");
  assert.deepEqual(found, DATA_SYNC_MOCK_ENTRY);
});

test("MOCK_DATA_SYNC_MODULES memuat 6 modul sinkronisasi data lengkap", () => {
  const modules = getMockDataSyncModules();
  assert.equal(modules.length, 6);

  const expectedTypes = [
    "accounts",
    "devices",
    "customers",
    "thresholds",
    "billing",
    "whatsapp",
  ];

  for (const t of expectedTypes) {
    const item = modules.find((m) => m.entityType === t);
    assert.ok(item, `Modul untuk entityType ${t} harus ada`);
    assert.ok(item.name.length > 0);
    assert.ok(item.recordsCount > 0);
    assert.ok(item.checksum.startsWith("sha256-"));
    assert.ok(item.autoSyncIntervalMinutes > 0);
  }
});

test("getMockDataSyncOverview menghitung ringkasan status global secara akurat", () => {
  const modules = getMockDataSyncModules();
  const overview = getMockDataSyncOverview(modules);

  assert.equal(overview.totalModules, 6);
  assert.equal(overview.syncedModules, 6);
  assert.equal(overview.pendingModules, 0);
  assert.equal(overview.failedModules, 0);
  assert.equal(overview.globalStatus, "in_sync");
  assert.equal(overview.autoSyncEnabled, true);
  assert.ok(overview.totalRecordsSynced > 0);
  assert.ok(overview.lastGlobalSyncAt);
});

test("filterDataSyncModules menyaring berdasarkan status dan query teks", () => {
  const modules = getMockDataSyncModules();

  const all = filterDataSyncModules(modules, { status: "all", query: "" });
  assert.equal(all.length, 6);

  const devicesSearch = filterDataSyncModules(modules, {
    status: "all",
    query: "perangkat",
  });
  assert.equal(devicesSearch.length, 1);
  assert.equal(devicesSearch[0].entityType, "devices");

  const checksumSearch = filterDataSyncModules(modules, {
    status: "all",
    query: "bil77a102c9de51f",
  });
  assert.equal(checksumSearch.length, 1);
  assert.equal(checksumSearch[0].entityType, "billing");

  const noMatch = filterDataSyncModules(modules, {
    status: "failed",
    query: "nonexistent",
  });
  assert.equal(noMatch.length, 0);
});

test("komponen DataSyncBoard tersedia", () => {
  const boardPath = new URL(
    "../src/components/dashboard/data-sync-board.tsx",
    import.meta.url,
  );
  assert.ok(existsSync(boardPath));
  const boardSrc = readFileSync(boardPath, "utf8");
  assert.match(boardSrc, /export function DataSyncBoard/);
});
