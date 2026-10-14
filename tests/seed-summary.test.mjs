import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const {
  SEED_DATA_MOCK_ENTRY,
  getMockSeedDataList,
  getMockSeedSummaryOverview,
} = await import("../src/lib/dashboard/seed-data.ts");

const { SETUP_DATA_SOURCE_REGISTRY } = await import(
  "../src/lib/dashboard/setup-extended.ts"
);

test("SEED_DATA_MOCK_ENTRY terdaftar di SETUP_DATA_SOURCE_REGISTRY", () => {
  assert.equal(SEED_DATA_MOCK_ENTRY.id, "seed-data-summary");
  assert.equal(SEED_DATA_MOCK_ENTRY.status, "dummy");
  assert.equal(SEED_DATA_MOCK_ENTRY.envKey, "DATABASE_URL");
  assert.match(SEED_DATA_MOCK_ENTRY.notes, /Fase 5/);

  const found = SETUP_DATA_SOURCE_REGISTRY.find(
    (e) => e.id === "seed-data-summary",
  );
  assert.ok(found, "Entry harus ditemukan di SETUP_DATA_SOURCE_REGISTRY");
  assert.deepEqual(found, SEED_DATA_MOCK_ENTRY);
});

test("getMockSeedDataList memuat 5 kategori seed data awal penting", () => {
  const items = getMockSeedDataList();
  assert.equal(items.length, 5);

  const expectedCategories = [
    "accounts",
    "thresholds",
    "devices",
    "whatsapp",
    "billing",
  ];

  for (const cat of expectedCategories) {
    const item = items.find((i) => i.category === cat);
    assert.ok(item, `Kategori seed ${cat} harus ada`);
    assert.ok(item.name.length > 0);
    assert.ok(item.targetTable.length > 0);
    assert.equal(item.status, "seeded");
    assert.equal(item.isIdempotent, true);
    assert.ok(item.checksum.startsWith("sha256-"));
    assert.ok(item.items.length > 0);
  }
});

test("getMockSeedSummaryOverview menghitung metrik kategori dan record dengan tepat", () => {
  const items = getMockSeedDataList();
  const overview = getMockSeedSummaryOverview(items);

  assert.equal(overview.totalCategories, 5);
  assert.equal(overview.seededCategories, 5);
  assert.equal(overview.pendingCategories, 0);
  assert.equal(overview.totalRecords, 13);
  assert.equal(overview.overallStatus, "ready");
  assert.ok(overview.lastVerifiedAt);
});

test("komponen SeedSummary dan halaman sinkronisasi memuat seed-summary", () => {
  const summaryPath = new URL(
    "../src/components/dashboard/seed-summary.tsx",
    import.meta.url,
  );
  assert.ok(existsSync(summaryPath));
  const summarySrc = readFileSync(summaryPath, "utf8");
  assert.match(summarySrc, /export function SeedSummary/);
  assert.match(summarySrc, /data-testid="seed-summary"/);

  const pagePath = new URL(
    "../src/app/(protected)/app/sinkronisasi/page.tsx",
    import.meta.url,
  );
  assert.ok(existsSync(pagePath));
  const pageSrc = readFileSync(pagePath, "utf8");
  assert.match(pageSrc, /<SeedSummary \/>/);
  assert.match(pageSrc, /Ringkasan Seed Data Awal/);
});
