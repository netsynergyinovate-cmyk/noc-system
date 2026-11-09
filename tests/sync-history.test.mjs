import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const {
  SYNC_HISTORY_MOCK_ENTRY,
  getMockSyncHistoryList,
  getMockSyncHistoryOverview,
  filterSyncHistoryEntries,
  getSyncHistoryFacetCounts,
  createRefreshedSyncHistoryEntry,
} = await import("../src/lib/dashboard/sync-history.ts");

const { SETUP_DATA_SOURCE_REGISTRY } =
  await import("../src/lib/dashboard/setup-extended.ts");

test("SYNC_HISTORY_MOCK_ENTRY terdaftar di SETUP_DATA_SOURCE_REGISTRY", () => {
  assert.equal(SYNC_HISTORY_MOCK_ENTRY.id, "sync-history-log");
  assert.equal(SYNC_HISTORY_MOCK_ENTRY.status, "dummy");
  assert.equal(SYNC_HISTORY_MOCK_ENTRY.envKey, "DATABASE_URL");
  assert.match(SYNC_HISTORY_MOCK_ENTRY.notes, /Fase 5/);

  const found = SETUP_DATA_SOURCE_REGISTRY.find(
    (e) => e.id === "sync-history-log",
  );
  assert.ok(found, "Entry harus ditemukan di SETUP_DATA_SOURCE_REGISTRY");
  assert.deepEqual(found, SYNC_HISTORY_MOCK_ENTRY);
});

test("getMockSyncHistoryList memuat 5 entri riwayat sinkronisasi lengkap", () => {
  const entries = getMockSyncHistoryList();
  assert.equal(entries.length, 5);

  for (const entry of entries) {
    assert.ok(entry.id.startsWith("run-"));
    assert.ok(entry.runAt.length > 0);
    assert.ok(entry.durationMs > 0);
    assert.ok(entry.recordsProcessed > 0);
    assert.ok(entry.actor.length > 0);
    assert.ok(entry.checksum.startsWith("sha256-"));
  }
});

test("createRefreshedSyncHistoryEntry menghasilkan entri riwayat baru yang valid", () => {
  const newEntry = createRefreshedSyncHistoryEntry("Operator Uji", "customers");
  assert.ok(newEntry.id.startsWith("run-"));
  assert.equal(newEntry.actor, "Operator Uji");
  assert.equal(newEntry.scope, "customers");
  assert.equal(newEntry.status, "success");
  assert.ok(newEntry.checksum.startsWith("sha256-sync-"));
});

test("getSyncHistoryFacetCounts menghitung jumlah terfilter per kategori status & trigger", () => {
  const entries = getMockSyncHistoryList();
  const facets = getSyncHistoryFacetCounts(entries, {
    status: "all",
    triggerType: "all",
    query: "",
  });

  assert.equal(facets.status.all, 5);
  assert.equal(facets.status.success, 5);
  assert.equal(facets.status.failed, 0);
  assert.equal(facets.triggerType.scheduled, 2);
  assert.equal(facets.triggerType.manual, 1);
  assert.equal(facets.triggerType.startup_seed, 1);
  assert.equal(facets.triggerType.transfer_pipeline, 1);
});

test("filterSyncHistoryEntries menyaring berdasarkan status, trigger, dan query", () => {
  const entries = getMockSyncHistoryList();

  const all = filterSyncHistoryEntries(entries, {
    status: "all",
    triggerType: "all",
    query: "",
  });
  assert.equal(all.length, 5);

  const manualOnly = filterSyncHistoryEntries(entries, {
    status: "all",
    triggerType: "manual",
    query: "",
  });
  assert.equal(manualOnly.length, 1);
  assert.equal(manualOnly[0].scope, "billing");

  const querySearch = filterSyncHistoryEntries(entries, {
    status: "all",
    triggerType: "all",
    query: "MikroTik",
  });
  assert.equal(querySearch.length, 1);
  assert.equal(querySearch[0].scope, "devices");
});

test("komponen SyncHistoryPanel memuat fungsionalitas refresh dan filter", () => {
  const compPath = new URL(
    "../src/components/dashboard/sync-history-panel.tsx",
    import.meta.url,
  );
  assert.ok(existsSync(compPath));
  const compSrc = readFileSync(compPath, "utf8");
  assert.match(compSrc, /handleManualRefresh/);
  assert.match(compSrc, /autoRefreshIntervalSec/);
  assert.match(compSrc, /Segarkan Riwayat/);
  assert.match(compSrc, /Reset Saringan|Reset/);
});
